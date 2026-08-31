/**
 * Agent Vision: the agent's window into what the browser itself saw.
 *
 * Pure and host-free by construction — it folds CDP events into a snapshot and
 * nothing more. It lives in core/ because BOTH hosts need it: Electron attaches
 * via `webContents.debugger`, the Chromium fork over a CDP socket, and neither
 * should own the aggregation or the redaction.
 *
 * Electron let the agent only *pantomime* a user — click, type, screenshot. It
 * was blind to the failed XHR, the console error, the request that never
 * resolved. This attaches Chromium's DevTools protocol (via `webContents.debugger`)
 * to an agent-driven tab and records the network + console the page produced, so
 * the agent can *cite* the failing request in its own verification instead of
 * guessing from the rendered DOM. Under the Chromium fork this same surface
 * upgrades to native CDP/Mojo with no change to the agent.
 *
 * Security note: CDP's getResponseBody returns bytes the browser saw *before*
 * CORS is applied to the page's own scripts — so it can read cross-origin error
 * bodies that browser_eval could not. That is a real boundary, so response-body
 * capture is restricted to requests **same-origin** with the tab's document, and
 * every captured body and console line is run through a secret-redaction pass
 * (tokens, keys, JWTs) before it can enter the agent's context or transcript.
 * Bodies are captured only for HTTP error responses and capped.
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
/** Cap the per-tab request log so a long-lived or polling tab can't grow the
 *  main process's memory without bound (oldest entries are evicted, FIFO). */
const MAX_REQUESTS = 200

export function newVisionState(): VisionState {
  return { requests: new Map(), console: [] }
}

/** Keys whose VALUE is a secret, wherever it appears in a body or log line. */
const SECRET_KEY =
  'authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|' +
  'id[_-]?token|token|secret|client[_-]?secret|password|passwd|passphrase|session|cookie|set-cookie'

/**
 * Redact the WHOLE value after a secret-looking key — a quoted string, or
 * everything up to the next delimiter or end of line.
 *
 * Stopping at whitespace (the obvious first attempt) leaves the actual secret
 * exposed in the most common shape of all: `authorization: Bearer <token>`
 * redacts the word "Bearer" and prints the token. A test using a token with no
 * space in it passes and hides that completely.
 */
const SECRET_VALUE = new RegExp(`("?(?:${SECRET_KEY})"?\\s*[:=]\\s*)("[^"]*"|[^,;}\\n\\r]+)`, 'gi')

/** JWTs carry their own claims, so they are secrets wherever they appear. */
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/** Mask secret-looking values before a captured body or console line can reach
 *  the agent's context or the on-disk transcript. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_VALUE, '$1«redacted»').replace(JWT, '«redacted-jwt»')
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
        // FIFO eviction so a long-lived / polling tab can't grow unbounded.
        if (state.requests.size > MAX_REQUESTS) {
          const oldest = state.requests.keys().next().value
          if (oldest !== undefined) state.requests.delete(oldest)
        }
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
            text: redactSecrets(text.slice(0, 500))
          })
        }
      }
      break
    }
    case 'Log.entryAdded': {
      const entry = p.entry as { level?: string; text?: string } | undefined
      if (entry && (entry.level === 'error' || entry.level === 'warning')) {
        if (state.console.length < MAX_CONSOLE) {
          state.console.push({
            level: entry.level,
            text: redactSecrets(String(entry.text ?? '').slice(0, 500))
          })
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
