import type { AgentBrowserPort } from './agent-browser-port'
import {
  newVisionState,
  applyCdpEvent,
  summarizeVision,
  formatSnapshot,
  type VisionState
} from './vision'

/**
 * The agent driving the user's OWN tabs, through the WebDeck page.
 *
 * Same protocol as the isolated browser — this sends the identical DevTools
 * commands — but the transport is different, and that is the whole point. The
 * isolated mode reaches a browser the core spawned over a socket. Here there is
 * no socket: the core asks the page (reverse RPC), the page forwards over Mojo,
 * and the browser drives the tab in-process. Nothing listens on a port, so
 * nothing else on the machine can drive the user's session.
 *
 * The cost is a longer path with more places to fail, so every failure says
 * which link broke rather than surfacing as a timeout.
 */

const TEXT_CAP = 8_000
/**
 * Navigable schemes for the agent browser: http/https only. `file:` is
 * DELIBERATELY excluded — navigating a tab to `file:///…` and reading it back
 * (browser_read/browser_eval) is arbitrary local-file disclosure, and in
 * session mode this drives the user's REAL logged-in tab. The agent has proper
 * workspace-scoped file tools for reading files; this interface is for the web.
 * (The C++ Shell gates its own staged-tab navigation, but the agent's
 * Page.navigate passthrough does not, so this client allowlist is load-bearing.)
 */
const AGENT_URL_SCHEME = /^https?:/i

/** What the core needs from its transport to reach the page. */
export interface PageChannel {
  requestFromClient(method: string, args: unknown[], timeoutMs: number): Promise<unknown>
}

export interface PageAgentBrowserOptions {
  channel: PageChannel
  decide?: (kind: string, detail: string) => 'allow' | 'confirm' | 'deny'
  audit?: (entry: { event: string; kind: string; detail: string; decision: string }) => void
  timeoutMs?: number
}

const METHODS = {
  open: 'agent-tabs:open',
  send: 'agent-tabs:send',
  close: 'agent-tabs:close'
} as const

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const q = (value: string): string => JSON.stringify(value)

export function pageAgentBrowser(options: PageAgentBrowserOptions): AgentBrowserPort {
  const { channel } = options
  const timeoutMs = options.timeoutMs ?? 30_000
  const decide = options.decide ?? ((): 'allow' => 'allow')
  const audit = options.audit ?? ((): void => {})

  /** Per-tab Agent Vision, fed by protocol events the page forwards. */
  const vision = new Map<string, VisionState>()
  const blocked = new Map<string, string>()

  /** Send one protocol command to a tab, through the page. */
  async function command<T = Record<string, unknown>>(
    tabId: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const raw = await channel.requestFromClient(
      METHODS.send,
      [tabId, method, JSON.stringify(params)],
      timeoutMs
    )
    try {
      return JSON.parse(String(raw ?? '{}')) as T
    } catch {
      return {} as T
    }
  }

  /** Evaluate page script, as the isolated mode does, and unwrap the result. */
  async function evaluate<T>(tabId: string, expression: string): Promise<T> {
    const res = await command<{
      result?: { value?: T }
      exceptionDetails?: { exception?: { description?: string }; text?: string }
    }>(tabId, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'script failed'
      )
    }
    return res.result?.value as T
  }

  function requireVision(tabId: string): VisionState {
    let state = vision.get(tabId)
    if (!state) {
      state = newVisionState()
      vision.set(tabId, state)
    }
    return state
  }

  /**
   * Fold a protocol event the page forwarded into this tab's vision, and
   * re-check any navigation against the live policy.
   *
   * The gate approved the URL the agent ASKED for. Servers redirect and pages
   * navigate themselves, and following an unapproved destination silently is
   * the bug the guard exists to prevent — the isolated mode does the same.
   */
  function onEvent(tabId: string, method: string, params: unknown): void {
    applyCdpEvent(requireVision(tabId), method, params)
    if (method !== 'Page.frameRequestedNavigation') return
    const url = (params as { url?: string })?.url
    if (!url || decide('browser_navigate', url) === 'allow') return
    blocked.set(tabId, url)
    audit({ event: 'action', kind: 'browser_navigate', detail: url, decision: 'deny' })
    void command(tabId, 'Page.stopLoading').catch(() => {})
  }

  async function openTab(url: string): Promise<string> {
    if (!AGENT_URL_SCHEME.test(url)) throw new Error(`unsupported URL scheme: ${url}`)
    const tabId = String(await channel.requestFromClient(METHODS.open, [url], timeoutMs))
    requireVision(tabId)
    // Turn the domains on before anything else runs, so the page's own load
    // requests and console output are recorded rather than only what follows.
    for (const domain of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) {
      await command(tabId, domain).catch(() => {})
    }
    const page = await evaluate<{ title: string; url: string }>(
      tabId,
      '({ title: document.title, url: location.href })'
    )
    return `tabId: ${tabId}\ntitle: ${page.title}\nurl: ${page.url}`
  }

  async function navigate(tabId: string, url: string): Promise<string> {
    if (!AGENT_URL_SCHEME.test(url)) throw new Error(`unsupported URL scheme: ${url}`)
    await command(tabId, 'Page.navigate', { url })
    const page = await evaluate<{ title: string; url: string }>(
      tabId,
      '({ title: document.title, url: location.href })'
    )
    return `title: ${page.title}\nurl: ${page.url}`
  }

  async function readPage(tabId: string, selector?: string): Promise<string> {
    if (selector) {
      const text = await evaluate<string | null>(
        tabId,
        `(() => { const el = document.querySelector(${q(selector)}); return el ? el.innerText : null })()`
      )
      if (text === null) throw new Error(`no element matches ${selector}`)
      return text.slice(0, TEXT_CAP)
    }
    const page = await evaluate<{ title: string; url: string; text: string }>(
      tabId,
      `({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })`
    )
    return `title: ${page.title}\nurl: ${page.url}\n\n${page.text.slice(0, TEXT_CAP)}`
  }

  return {
    openTab,
    navigate,
    readPage,
    async evaluate(tabId: string, expression: string): Promise<string> {
      const result = await evaluate<unknown>(tabId, expression)
      if (result === undefined) return 'undefined'
      try {
        return JSON.stringify(result)?.slice(0, TEXT_CAP) ?? String(result)
      } catch {
        return String(result).slice(0, TEXT_CAP)
      }
    },
    async click(tabId: string, selector: string): Promise<string> {
      const found = await evaluate<boolean>(
        tabId,
        `(() => {
          const el = document.querySelector(${q(selector)})
          if (!el) return false
          el.scrollIntoView({ block: 'center' })
          el.click()
          return true
        })()`
      )
      if (!found) throw new Error(`no element matches ${selector}`)
      await sleep(100)
      return 'clicked'
    },
    async type(tabId: string, selector: string, text: string): Promise<string> {
      const outcome = await evaluate<string>(
        tabId,
        `(() => {
          const el = document.querySelector(${q(selector)})
          if (!el) return 'missing'
          el.focus()
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const proto = el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(text)})
          } else if (el.isContentEditable) {
            el.textContent = ${q(text)}
          } else {
            return 'unsupported'
          }
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return 'ok'
        })()`
      )
      if (outcome === 'missing') throw new Error(`no element matches ${selector}`)
      if (outcome === 'unsupported') throw new Error(`${selector} is not a text input`)
      return `typed into ${selector}`
    },
    async waitFor(tabId: string, selector: string, waitMs: number): Promise<string> {
      const deadline = Date.now() + waitMs
      while (Date.now() < deadline) {
        if (await evaluate<boolean>(tabId, `document.querySelector(${q(selector)}) !== null`)) {
          return `found ${selector}`
        }
        await sleep(150)
      }
      throw new Error(`timed out after ${waitMs}ms waiting for ${selector}`)
    },
    async capture(tabId: string, selector?: string): Promise<Buffer> {
      let clip: Record<string, number> | undefined
      if (selector) {
        const box = await evaluate<{ x: number; y: number; width: number; height: number } | null>(
          tabId,
          `(() => {
            const el = document.querySelector(${q(selector)})
            if (!el) return null
            const r = el.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height }
          })()`
        )
        if (!box) throw new Error(`no element matches ${selector}`)
        clip = { ...box, scale: 1 }
      }
      const shot = await command<{ data?: string }>(tabId, 'Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip } : {})
      })
      if (!shot.data) throw new Error('the browser returned no image')
      return Buffer.from(shot.data, 'base64')
    },
    setViewport(tabId: string, width: number, height: number): string {
      void command(tabId, 'Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 0,
        mobile: width < 768
      }).catch(() => {})
      return `viewport set to ${width}x${height}`
    },
    async recordStart(): Promise<string> {
      // Nothing consumes screencast frames yet. Saying so beats returning a
      // success the agent would cite in a verification it never made.
      throw new Error('recording is not implemented for the session browser yet')
    },
    async recordStop(): Promise<string> {
      throw new Error('recording is not implemented for the session browser yet')
    },
    takeBlockedNavigation(tabId: string): string | null {
      const url = blocked.get(tabId)
      if (!url) return null
      blocked.delete(tabId)
      return url
    },
    visionReport(tabId: string): string {
      const state = vision.get(tabId)
      if (!state) return 'No browser vision for this tab — open a page with browser_open first.'
      return formatSnapshot(summarizeVision(state))
    },
    visionHasProblems(tabId: string): boolean {
      const state = vision.get(tabId)
      if (!state) return false
      const snapshot = summarizeVision(state)
      return snapshot.failures.length > 0 || snapshot.console.length > 0
    },
    async shutdown(): Promise<void> {
      // Close only the tabs the agent opened. The user's own tabs are theirs,
      // and this browser is not ours to close.
      for (const tabId of vision.keys()) {
        await channel.requestFromClient(METHODS.close, [tabId], timeoutMs).catch(() => {})
      }
      vision.clear()
      blocked.clear()
    },
    // Exposed so the host can feed forwarded protocol events in.
    onEvent
  } as AgentBrowserPort & { onEvent: typeof onEvent }
}
