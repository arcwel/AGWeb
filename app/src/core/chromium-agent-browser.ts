import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentBrowserPort } from './agent-browser-port'
import { connectCdp, createTarget, closeTarget, listTargets, type CdpSession } from './cdp'
import {
  newVisionState,
  applyCdpEvent,
  summarizeVision,
  formatSnapshot,
  redactSecrets,
  type VisionState
} from './vision'

/**
 * The agent's browser under the Chromium fork. Two modes, because the right
 * answer depends on whether the page is trusted:
 *
 * `session` (default) — the user's own browser. The agent opens real tabs in
 * the window they are using, with their cookies and logins, and they watch it
 * work in their own tab strip. This is the Electron adopted-tab behaviour, and
 * it is the point of the feature: an agent that can only browse logged-out
 * cannot do most of what it is asked to do. It also means the agent acts AS the
 * user — anything it does in that session is indistinguishable from the user
 * doing it, which is why every navigation still goes through the policy gate
 * and every action is audited.
 *
 * `isolated` — a throwaway profile with no cookies and no ambient authority,
 * for pages that are not trusted. An injected page here can still lie to the
 * agent, but it cannot act as the user.
 *
 * Both speak CDP; only the target differs.
 */

const LOAD_TIMEOUT_MS = 20_000
const TEXT_CAP = 8_000
/** http/https only. `file:` is DELIBERATELY excluded — an agent that can point a
 *  staged tab at `file:///…` and read it back is arbitrary local-file
 *  disclosure. Opening a tab must not be a way around the check navigation
 *  performs, so open and navigate share this allowlist. */
const AGENT_URL_SCHEME = /^https?:/i

export interface ChromiumAgentBrowserOptions {
  /**
   * 'session' drives the user's running browser (their tabs, their logins);
   * 'isolated' spawns a throwaway profile. Defaults to 'session'.
   */
  mode?: 'session' | 'isolated'
  /**
   * CDP port of the user's running browser, for 'session' mode. The fork
   * publishes this to the core; $WEBDECK_BROWSER_CDP_PORT is the fallback.
   */
  sessionCdpPort?: number
  /** The browser binary. Defaults to the fork next to us, then $WEBDECK_BROWSER. */
  browserPath?: string
  /** Run without a visible window (the default: the agent's browser is not the user's). */
  headless?: boolean
  /** Policy gate, injected so this module does not import the shell's. */
  decide?: (kind: string, detail: string) => 'allow' | 'confirm' | 'deny'
  audit?: (entry: { event: string; kind: string; detail: string; decision: string }) => void
}

interface AgentTab {
  targetId: string
  session: CdpSession
  vision: VisionState
  /** Last destination the guard refused, surfaced to the model once. */
  blockedNavigation: string | null
}

/** JSON-quote a value for embedding in page script, exactly as Electron does. */
const q = (value: string): string => JSON.stringify(value)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function chromiumAgentBrowser(options: ChromiumAgentBrowserOptions = {}): AgentBrowserPort {
  const tabs = new Map<string, AgentTab>()
  let child: ChildProcess | null = null
  let port = 0
  let profileDir = ''
  let nextTabId = 1
  let starting: Promise<void> | null = null

  const decide = options.decide ?? ((): 'allow' => 'allow')
  const audit = options.audit ?? ((): void => {})
  // Isolated is the default only until the browser-side half of session mode
  // lands. Session — the user's own tabs and logins — is the mode that matters
  // for real work and becomes the default the moment it can actually connect;
  // shipping it as the default while it cannot would mean every agent browser
  // call fails on a fresh install.
  const mode = options.mode ?? 'isolated'

  /** The user's running browser, for session mode. */
  function sessionPort(): number {
    const configured = options.sessionCdpPort ?? Number(process.env.WEBDECK_BROWSER_CDP_PORT ?? 0)
    if (!configured) {
      throw new Error(
        'the agent cannot reach your browser session — WebDeck did not publish a ' +
          'DevTools endpoint. Switch the agent browser to "isolated", or restart WebDeck.'
      )
    }
    return configured
  }

  function resolveBrowser(): string {
    const candidates = [
      options.browserPath,
      process.env.WEBDECK_BROWSER,
      // The fork, as laid out in a component build next to the core.
      join(
        process.execPath,
        '..',
        '..',
        'Arcwel WebDeck.app',
        'Contents',
        'MacOS',
        'Arcwel WebDeck'
      )
    ].filter((c): c is string => Boolean(c))
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    throw new Error(
      'no browser available for the agent — set WEBDECK_BROWSER to the Arcwel WebDeck binary'
    )
  }

  /** Point at the browser the agent should drive: the user's, or its own. */
  async function ensureBrowser(): Promise<void> {
    if (mode === 'session') {
      if (port) return
      port = sessionPort()
      // Fail here, not on the first tool call, so the agent gets one clear
      // error instead of a confusing failure mid-task.
      if (!(await browserReachable(port))) {
        const reached = port
        port = 0
        throw new Error(
          `the agent could not reach your browser session on port ${reached} — ` +
            'is WebDeck still running?'
        )
      }
      return
    }
    if (port && child && !child.killed) return
    if (starting) return starting
    starting = (async () => {
      const binary = resolveBrowser()
      profileDir = mkdtempSync(join(tmpdir(), 'webdeck-agent-browser-'))
      // Port 0: let the OS choose, so two agents (or an agent and a test) never
      // collide on a fixed port and silently drive each other's browser.
      child = spawn(
        binary,
        [
          '--remote-debugging-port=0',
          `--user-data-dir=${profileDir}`,
          ...(options.headless === false ? [] : ['--headless=new']),
          '--no-first-run',
          '--no-default-browser-check',
          // The agent's browser is not the user's: no session, no sign-in, and
          // nothing carried over between runs.
          '--no-service-autorun',
          '--disable-background-networking',
          'about:blank'
        ],
        // Its own process group, so shutdown can signal the whole tree.
        { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
      )

      // Chromium prints the DevTools endpoint to stderr when the port is 0.
      port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('the agent browser did not report a debugging port')),
          LOAD_TIMEOUT_MS
        )
        let buffered = ''
        child?.stderr?.on('data', (chunk) => {
          buffered += String(chunk)
          const match = buffered.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)
          if (match) {
            clearTimeout(timer)
            resolve(Number(match[1]))
          }
        })
        child?.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`the agent browser exited before it was ready (code ${code})`))
        })
      })
    })()
    try {
      await starting
    } finally {
      starting = null
    }
  }

  function requireTab(tabId: string): AgentTab {
    const tab = tabs.get(tabId)
    if (!tab) throw new Error(`no agent tab ${tabId} — open one with browser_open first`)
    if (!tab.session.open) throw new Error(`agent tab ${tabId} is no longer connected`)
    return tab
  }

  /** Evaluate page script and return the value, as Electron's executeJavaScript does. */
  async function evaluate<T>(tab: AgentTab, expression: string): Promise<T> {
    const res = await tab.session.send<{
      result?: { value?: T }
      exceptionDetails?: { exception?: { description?: string }; text?: string }
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (res.exceptionDetails) {
      const detail =
        res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'script failed'
      throw new Error(detail)
    }
    return res.result?.value as T
  }

  /** Resolve once the page has finished loading, or the timeout elapses. */
  async function waitForLoad(tab: AgentTab): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, LOAD_TIMEOUT_MS)
      const off = tab.session.on((event) => {
        if (event.method === 'Page.loadEventFired') finish()
      })
      function finish(): void {
        clearTimeout(timer)
        off()
        resolve()
      }
    })
  }

  /**
   * Re-check every navigation against the live policy, exactly as the Electron
   * guard does. The gate approved the URL the agent *asked* for; servers 30x and
   * pages navigate themselves, and silently following an unapproved destination
   * is the bug the guard exists to prevent.
   */
  function installNavigationGuard(tabId: string, tab: AgentTab): void {
    tab.session.on((event) => {
      if (event.method !== 'Page.frameRequestedNavigation') return
      const url = (event.params as { url?: string })?.url
      if (!url || decide('browser_navigate', url) === 'allow') return
      tab.blockedNavigation = url
      audit({ event: 'action', kind: 'browser_navigate', detail: url, decision: 'deny' })
      // Stop the load rather than prompt: this fires inside the navigation path.
      void tab.session.send('Page.stopLoading').catch(() => {})
    })
  }

  async function openTab(url: string): Promise<string> {
    if (!AGENT_URL_SCHEME.test(url)) throw new Error(`unsupported URL scheme: ${url}`)
    await ensureBrowser()
    const tabId = `agent-tab-${nextTabId++}`
    const target = await createTarget(port, 'about:blank')
    const session = await connectCdp(target.webSocketDebuggerUrl)
    const tab: AgentTab = {
      targetId: target.id,
      session,
      vision: newVisionState(),
      blockedNavigation: null
    }
    tabs.set(tabId, tab)

    // Agent Vision: subscribe BEFORE navigating, so the page's own load requests
    // and console output are recorded rather than only what fires after paint.
    session.on((event) => applyCdpEvent(tab.vision, event.method, event.params))
    await session.send('Page.enable')
    await session.send('Runtime.enable')
    await session.send('Log.enable')
    await session.send('Network.enable')
    installNavigationGuard(tabId, tab)

    const load = waitForLoad(tab)
    await session.send('Page.navigate', { url })
    await load
    const page = await evaluate<{ title: string; url: string }>(
      tab,
      '({ title: document.title, url: location.href })'
    )
    return `tabId: ${tabId}\ntitle: ${page.title}\nurl: ${page.url}`
  }

  async function navigate(tabId: string, url: string): Promise<string> {
    const tab = requireTab(tabId)
    if (!AGENT_URL_SCHEME.test(url)) throw new Error(`unsupported URL scheme: ${url}`)
    const load = waitForLoad(tab)
    await tab.session.send('Page.navigate', { url })
    await load
    const page = await evaluate<{ title: string; url: string }>(
      tab,
      '({ title: document.title, url: location.href })'
    )
    return `title: ${page.title}\nurl: ${page.url}`
  }

  async function readPage(tabId: string, selector?: string): Promise<string> {
    const tab = requireTab(tabId)
    if (selector) {
      const text = await evaluate<string | null>(
        tab,
        `(() => {
          const el = document.querySelector(${q(selector)})
          return el ? el.innerText : null
        })()`
      )
      if (text === null) throw new Error(`no element matches ${selector}`)
      return text.slice(0, TEXT_CAP)
    }
    const page = await evaluate<{ title: string; url: string; text: string }>(
      tab,
      `({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })`
    )
    return `title: ${page.title}\nurl: ${page.url}\n\n${page.text.slice(0, TEXT_CAP)}`
  }

  async function evaluateTool(tabId: string, expression: string): Promise<string> {
    const tab = requireTab(tabId)
    const result = await evaluate<unknown>(tab, expression)
    if (result === undefined) return 'undefined'
    try {
      return JSON.stringify(result)?.slice(0, TEXT_CAP) ?? String(result)
    } catch {
      return String(result).slice(0, TEXT_CAP)
    }
  }

  async function click(tabId: string, selector: string): Promise<string> {
    const tab = requireTab(tabId)
    const found = await evaluate<boolean>(
      tab,
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
  }

  async function type(tabId: string, selector: string, text: string): Promise<string> {
    const tab = requireTab(tabId)
    // Native value setter + input/change events, so framework-bound inputs
    // (React controlled components and the like) actually see the change.
    const outcome = await evaluate<string>(
      tab,
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
  }

  async function waitFor(tabId: string, selector: string, timeoutMs: number): Promise<string> {
    const tab = requireTab(tabId)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const present = await evaluate<boolean>(
        tab,
        `document.querySelector(${q(selector)}) !== null`
      )
      if (present) return `found ${selector}`
      await sleep(150)
    }
    throw new Error(`timed out after ${timeoutMs}ms waiting for ${selector}`)
  }

  async function capture(tabId: string, selector?: string): Promise<Buffer> {
    const tab = requireTab(tabId)
    let clip: Record<string, number> | undefined
    if (selector) {
      const box = await evaluate<{ x: number; y: number; width: number; height: number } | null>(
        tab,
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
    const shot = await tab.session.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      ...(clip ? { clip } : {})
    })
    return Buffer.from(shot.data, 'base64')
  }

  function setViewport(tabId: string, width: number, height: number): string {
    const tab = requireTab(tabId)
    void tab.session
      .send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 0,
        mobile: width < 768
      })
      .catch(() => {})
    return `viewport set to ${width}x${height}`
  }

  async function recordStart(): Promise<string> {
    // Electron recorded via frame subscription. CDP's screencast is the
    // equivalent, but nothing consumes the frames yet, so say so rather than
    // return a success the agent would cite in a verification it never made.
    throw new Error('recording is not implemented for the Chromium agent browser yet')
  }

  async function recordStop(): Promise<string> {
    throw new Error('recording is not implemented for the Chromium agent browser yet')
  }

  return {
    openTab,
    navigate,
    readPage,
    evaluate: evaluateTool,
    click,
    type,
    waitFor,
    capture,
    setViewport,
    recordStart,
    recordStop,
    takeBlockedNavigation(tabId: string): string | null {
      const tab = tabs.get(tabId)
      if (!tab?.blockedNavigation) return null
      const url = tab.blockedNavigation
      tab.blockedNavigation = null
      return url
    },
    visionReport(tabId: string): string {
      const tab = tabs.get(tabId)
      if (!tab) return 'No browser vision for this tab — open a page with browser_open first.'
      return formatSnapshot(summarizeVision(tab.vision))
    },
    visionHasProblems(tabId: string): boolean {
      const tab = tabs.get(tabId)
      if (!tab) return false
      const snapshot = summarizeVision(tab.vision)
      return snapshot.failures.length > 0 || snapshot.console.length > 0
    },
    async shutdown(): Promise<void> {
      for (const [, tab] of tabs) {
        tab.session.close()
        // Close the agent's own tabs — but in session mode these are tabs in
        // the user's window, so only ours, never the browser itself.
        if (port) await closeTarget(port, tab.targetId)
      }
      tabs.clear()
      if (mode === 'session') {
        // We attached to a browser we did not start. Killing it would close the
        // user's windows out from under them.
        port = 0
        return
      }
      // Kill the process TREE: Chromium's helpers (gpu, network, storage,
      // renderers) do not exit with the parent, so killing only the parent left
      // ten processes and a temp profile behind after every agent session.
      const running = child
      child = null
      port = 0
      if (running && !running.killed) {
        try {
          process.kill(-running.pid!, 'SIGTERM')
        } catch {
          try {
            running.kill('SIGTERM')
          } catch {
            // already gone
          }
        }
        // Give it a moment, then insist.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            try {
              running.kill('SIGKILL')
            } catch {
              // already gone
            }
            resolve()
          }, 2000)
          running.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
      if (profileDir) {
        rmSync(profileDir, { recursive: true, force: true })
        profileDir = ''
      }
    }
  }
}

/** Redaction is applied to captured bodies here as it is under Electron. */
export { redactSecrets }

/** Close a tab and drop its state. Exported for the host's dispose path. */
export async function disposeChromiumAgentTab(
  port: number,
  targetId: string,
  session: CdpSession
): Promise<void> {
  session.close()
  await closeTarget(port, targetId)
}

/** Exported for tests: is a browser reachable on this port? */
export async function browserReachable(port: number): Promise<boolean> {
  try {
    await listTargets(port)
    return true
  } catch {
    return false
  }
}
