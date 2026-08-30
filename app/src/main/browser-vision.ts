import { getTabWebContents } from './browser'

/**
 * Agent Vision (v0): the agent's window into what the browser itself saw.
 *
 * Electron let the agent only *pantomime* a user — click, type, screenshot. It
 * was blind to the failed XHR, the console error, the request that never
 * resolved. This attaches Chromium's DevTools protocol (via `webContents.debugger`)
 * to an agent-driven tab and records the network + console the page produced, so
 * the agent can *cite* the failing request in its own verification instead of
 * guessing from the rendered DOM. Under the Chromium fork this same surface
 * upgrades to native CDP/Mojo with no change to the agent.
 *
 * Capability note: the agent already runs arbitrary JS on tabs it opens
 * (browser_eval, policy-gated), so reading that tab's network log is within the
 * grant it already holds — not a new trust boundary. Response bodies are captured
 * only for HTTP error responses and capped, to avoid hoarding page data.
 */

export interface VisionRequest {
  requestId: string
  url: string
  method: string
  type?: string
  status?: number
  failed: boolean
  error?: string
  body?: string
}

export interface VisionConsole {
  level: 'error' | 'warning'
  text: string
}

export interface VisionState {
  requests: Map<string, VisionRequest>
  console: VisionConsole[]
}

export interface VisionSnapshot {
  totalRequests: number
  failures: VisionRequest[]
  console: VisionConsole[]
}

const MAX_CONSOLE = 50
const MAX_BODY = 2048

export function newVisionState(): VisionState {
  return { requests: new Map(), console: [] }
}

/**
 * Fold one CDP event into the state. Pure and Electron-free, so the whole
 * aggregation is unit-tested directly against synthetic events.
 */
export function applyCdpEvent(state: VisionState, method: string, params: unknown): void {
  const p = (params ?? {}) as Record<string, unknown>
  switch (method) {
    case 'Network.requestWillBeSent': {
      const request = p.request as { url?: string; method?: string } | undefined
      const id = p.requestId as string | undefined
      if (id && request) {
        state.requests.set(id, {
          requestId: id,
          url: request.url ?? '(unknown)',
          method: request.method ?? 'GET',
          type: p.type as string | undefined,
          failed: false
        })
      }
      break
    }
    case 'Network.responseReceived': {
      const r = state.requests.get(p.requestId as string)
      const response = p.response as { status?: number } | undefined
      if (r) {
        r.status = response?.status
        r.type = (p.type as string) ?? r.type
      }
      break
    }
    case 'Network.loadingFailed': {
      const id = p.requestId as string
      const r = state.requests.get(id)
      if (r) {
        r.failed = true
        r.error = p.errorText as string
      } else if (id) {
        state.requests.set(id, {
          requestId: id,
          url: '(unknown)',
          method: '?',
          failed: true,
          error: p.errorText as string
        })
      }
      break
    }
    case 'Runtime.consoleAPICalled': {
      const level = p.type as string
      if (level === 'error' || level === 'warning' || level === 'warn') {
        const args = (p.args as Array<Record<string, unknown>>) ?? []
        const text = args
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ')
          .trim()
        if (text && state.console.length < MAX_CONSOLE) {
          state.console.push({
            level: level === 'error' ? 'error' : 'warning',
            text: text.slice(0, 500)
          })
        }
      }
      break
    }
    case 'Log.entryAdded': {
      const entry = p.entry as { level?: string; text?: string } | undefined
      if (entry && (entry.level === 'error' || entry.level === 'warning')) {
        if (state.console.length < MAX_CONSOLE) {
          state.console.push({ level: entry.level, text: String(entry.text ?? '').slice(0, 500) })
        }
      }
      break
    }
  }
}

/** What the agent should see: request count, the failures, and console problems. */
export function summarizeVision(state: VisionState): VisionSnapshot {
  const all = [...state.requests.values()]
  const failures = all.filter((r) => r.failed || (r.status !== undefined && r.status >= 400))
  return { totalRequests: all.length, failures, console: state.console }
}

/** Render a snapshot as the terse text the agent reads and cites in verification. */
export function formatSnapshot(s: VisionSnapshot): string {
  if (!s.failures.length && !s.console.length) {
    return `Browser saw ${s.totalRequests} request(s); no network failures or console errors.`
  }
  const lines = [`Browser saw ${s.totalRequests} request(s), ${s.failures.length} failed.`]
  for (const f of s.failures.slice(0, 10)) {
    lines.push(`  ✗ ${f.method} ${f.url} → ${f.status ?? f.error ?? 'failed'}`)
    if (f.body) lines.push(`      body: ${f.body.slice(0, 300)}`)
  }
  if (s.console.length) {
    lines.push(`Console: ${s.console.length} error/warning(s).`)
    for (const c of s.console.slice(0, 10)) lines.push(`  [${c.level}] ${c.text}`)
  }
  return lines.join('\n')
}

/* ---- Electron attach layer (per agent tab) ---- */

const states = new Map<string, VisionState>()
const attachedTabs = new Set<string>()

/**
 * Attach the debugger and start recording. Synchronous by design: the domain
 * enables are fired but not awaited, so this never delays the navigation that
 * follows it. The message handler is registered before the enables are sent, so
 * every event from the moment a domain turns on is captured — including the
 * page's own load-time requests and console output.
 */
export function attachVision(tabId: string): void {
  const wc = getTabWebContents(tabId)
  if (!wc || attachedTabs.has(tabId)) return
  const state = newVisionState()
  states.set(tabId, state)
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  } catch {
    states.delete(tabId)
    return // e.g. DevTools already owns the debugger — vision is best-effort
  }
  attachedTabs.add(tabId)

  wc.debugger.on('message', (_event, method, params) => {
    applyCdpEvent(state, method, params)
    // Best-effort: pull the body for HTTP error responses (the "why did it 500").
    const response = (params as { response?: { status?: number }; requestId?: string })?.response
    if (method === 'Network.responseReceived' && (response?.status ?? 0) >= 400) {
      const requestId = (params as { requestId?: string }).requestId
      wc.debugger
        .sendCommand('Network.getResponseBody', { requestId })
        .then((res: { body?: string; base64Encoded?: boolean }) => {
          const r = requestId ? state.requests.get(requestId) : undefined
          if (r && res?.body) {
            r.body = (
              res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body
            ).slice(0, MAX_BODY)
          }
        })
        .catch(() => {})
    }
  })

  // Fire-and-forget: enabling a domain is fast, and awaiting it would stall the
  // caller's navigate(). A rejection just means teardown raced us.
  for (const domain of ['Network.enable', 'Runtime.enable', 'Log.enable']) {
    void wc.debugger.sendCommand(domain).catch(() => {})
  }
}

/** The snapshot the agent cites, as text. */
export function inspectText(tabId: string): string {
  const state = states.get(tabId)
  if (!state) return 'No browser vision for this tab — open a page with browser_open first.'
  return formatSnapshot(summarizeVision(state))
}

/** Whether the tab saw any network failure or console error (for auto-surfacing). */
export function hasVisionProblems(tabId: string): boolean {
  const state = states.get(tabId)
  if (!state) return false
  const s = summarizeVision(state)
  return s.failures.length > 0 || s.console.length > 0
}

export function detachVision(tabId: string): void {
  states.delete(tabId)
  if (!attachedTabs.delete(tabId)) return
  const wc = getTabWebContents(tabId)
  try {
    if (wc && wc.debugger.isAttached()) wc.debugger.detach()
  } catch {
    // tab already gone
  }
}
