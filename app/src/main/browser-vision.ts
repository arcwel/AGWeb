import { getTabWebContents } from './browser'
import {
  newVisionState,
  applyCdpEvent,
  summarizeVision,
  formatSnapshot,
  redactSecrets,
  type VisionState
} from '../core/vision'

/**
 * Electron's half of Agent Vision: attach `webContents.debugger` to an agent
 * tab and feed its CDP events into the shared aggregator in core/vision.ts.
 * The fork does the same over a CDP socket, against the same pure code.
 */

export {
  newVisionState,
  applyCdpEvent,
  summarizeVision,
  formatSnapshot,
  redactSecrets
} from '../core/vision'
export type { VisionRequest, VisionConsole, VisionState, VisionSnapshot } from '../core/vision'

const MAX_BODY = 2048

/* ---- Electron attach layer (per agent tab) ---- */

const states = new Map<string, VisionState>()
const attachedTabs = new Set<string>()
/** The CDP message handler per tab, so detach can remove it (no listener leak). */
const messageHandlers = new Map<string, (event: unknown, method: string, params: unknown) => void>()

/** Same registrable origin? Used to gate cross-origin response-body capture. */
function sameOrigin(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

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

  const onMessage = (_event: unknown, method: string, params: unknown): void => {
    applyCdpEvent(state, method, params)
    // Best-effort: pull the body for HTTP error responses (the "why did it 500").
    // Only for requests SAME-ORIGIN with the tab's document: CDP can read
    // cross-origin bodies the page itself cannot (pre-CORS), which would leak
    // third-party secrets into the agent. The body is redacted regardless.
    const response = (params as { response?: { status?: number; url?: string } })?.response
    if (method === 'Network.responseReceived' && (response?.status ?? 0) >= 400) {
      if (!sameOrigin(response?.url, wc.getURL())) return
      const requestId = (params as { requestId?: string }).requestId
      wc.debugger
        .sendCommand('Network.getResponseBody', { requestId })
        .then((res: { body?: string; base64Encoded?: boolean }) => {
          const r = requestId ? state.requests.get(requestId) : undefined
          if (r && res?.body) {
            const decoded = res.base64Encoded
              ? Buffer.from(res.body, 'base64').toString('utf8')
              : res.body
            r.body = redactSecrets(decoded).slice(0, MAX_BODY)
          }
        })
        .catch(() => {})
    }
  }
  wc.debugger.on('message', onMessage)
  messageHandlers.set(tabId, onMessage)

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
  const handler = messageHandlers.get(tabId)
  messageHandlers.delete(tabId)
  try {
    if (wc && handler) wc.debugger.removeListener('message', handler)
    if (wc && wc.debugger.isAttached()) wc.debugger.detach()
  } catch {
    // tab already gone
  }
}
