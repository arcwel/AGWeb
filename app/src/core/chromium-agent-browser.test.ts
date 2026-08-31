import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listTargets } from './cdp'
import { chromiumAgentBrowser } from './chromium-agent-browser'
import type { AgentBrowserPort } from './agent-browser-port'

/**
 * The agent driving a real browser, end to end.
 *
 * Under Electron this path was covered by the smoke test driving a
 * WebContentsView. On the fork the agent talks CDP to a browser of its own, and
 * nothing proved that worked — `setAgentBrowserPort` was called only from the
 * Electron entry point, so every browser tool on the fork threw "no browser
 * attached". A unit test with a mocked port would have stayed green through all
 * of that, so this drives the actual binary.
 *
 * Skipped, loudly, when the fork is not built — a developer without the
 * checkout should not see a red suite, but nor should this quietly pass.
 */

const BROWSER =
  process.env.WEBDECK_BROWSER ??
  '/Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck/Arcwel WebDeck.app/Contents/MacOS/Arcwel WebDeck'

const available = existsSync(BROWSER)
const describeIfBuilt = available ? describe : describe.skip

if (!available) {
  console.warn(`[chromium-agent-browser] SKIPPED: no browser at ${BROWSER}`)
}

/** A page with everything the agent's tools need to act on. */
const PAGE = `<!doctype html>
<html><head><title>Agent Target</title></head>
<body>
  <h1 id="heading">Hello agent</h1>
  <p class="prose">readable text</p>
  <input id="field" value="" />
  <button id="go" onclick="document.getElementById('heading').textContent = 'clicked'">Go</button>
  <div id="later"></div>
  <script>
    setTimeout(() => {
      document.getElementById('later').innerHTML = '<span id="appeared">here</span>'
    }, 300)
    // A failing request and a console error, for Agent Vision to notice.
    fetch('/missing').catch(() => {})
    console.error('boom: something went wrong')
  </script>
</body></html>`

let server: Server
let origin: string
let browser: AgentBrowserPort
let tabId: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/missing') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('server exploded')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  if (available) browser = chromiumAgentBrowser({ mode: 'isolated', browserPath: BROWSER })
}, 60_000)

afterAll(async () => {
  // Without this the suite leaves a browser tree and a temp profile behind on
  // every run — which is exactly the leak this teardown was added to fix.
  await browser?.shutdown?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}, 30_000)

describeIfBuilt('the agent drives a real Chromium tab (isolated profile)', () => {
  it('opens a tab and reports where it landed', async () => {
    const result = await browser.openTab(origin)
    expect(result).toContain('tabId: agent-tab-')
    expect(result).toContain('title: Agent Target')
    tabId = result.split('\n')[0].replace('tabId: ', '').trim()
  }, 60_000)

  it('reads the whole page, and a single element', async () => {
    const page = await browser.readPage(tabId)
    expect(page).toContain('Hello agent')
    expect(page).toContain('readable text')

    const one = await browser.readPage(tabId, '.prose')
    expect(one.trim()).toBe('readable text')
  }, 30_000)

  it('reports a selector that matches nothing, rather than empty text', async () => {
    await expect(browser.readPage(tabId, '#nope')).rejects.toThrow(/no element matches/)
  }, 30_000)

  it('evaluates an expression', async () => {
    expect(await browser.evaluate(tabId, '1 + 1')).toBe('2')
    expect(await browser.evaluate(tabId, 'document.title')).toBe('"Agent Target"')
  }, 30_000)

  it('clicks, and the page reacts', async () => {
    expect(await browser.click(tabId, '#go')).toBe('clicked')
    expect((await browser.readPage(tabId, '#heading')).trim()).toBe('clicked')
  }, 30_000)

  it('types into an input so a framework would see it', async () => {
    await browser.type(tabId, '#field', 'typed by the agent')
    expect(await browser.evaluate(tabId, 'document.getElementById("field").value')).toBe(
      '"typed by the agent"'
    )
  }, 30_000)

  it('waits for an element that appears later', async () => {
    expect(await browser.waitFor(tabId, '#appeared', 5_000)).toContain('#appeared')
  }, 30_000)

  it('times out on an element that never appears', async () => {
    await expect(browser.waitFor(tabId, '#never', 600)).rejects.toThrow(/timed out/)
  }, 30_000)

  it('captures a screenshot as real PNG bytes', async () => {
    const shot = await browser.capture(tabId)
    expect(shot.length).toBeGreaterThan(1000)
    // PNG magic number — proves it is an image, not an error string.
    expect([...shot.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  }, 30_000)

  it('Agent Vision saw the failed request and the console error', async () => {
    const report = browser.visionReport(tabId)
    expect(browser.visionHasProblems(tabId)).toBe(true)
    expect(report).toContain('/missing')
    expect(report).toContain('500')
    expect(report).toContain('boom: something went wrong')
  }, 30_000)

  it('refuses a URL scheme outside the allowlist', async () => {
    await expect(browser.openTab('javascript:alert(1)')).rejects.toThrow(/unsupported URL scheme/)
    await expect(browser.navigate(tabId, 'data:text/html,hi')).rejects.toThrow(
      /unsupported URL scheme/
    )
  }, 30_000)

  it('fails loudly on a tab that was never opened', async () => {
    await expect(browser.readPage('agent-tab-999')).rejects.toThrow(/no agent tab/)
  }, 30_000)

  it('says recording is unimplemented instead of reporting a success', async () => {
    // The agent cites tool output in its verification. A silent no-op here would
    // become "I recorded the flow" in a report where nothing was recorded.
    await expect(browser.recordStart(tabId)).rejects.toThrow(/not implemented/)
  }, 30_000)
})

describeIfBuilt("the agent drives the user's own browser session", () => {
  // What the feature is actually for: the agent opens a REAL tab in the browser
  // the user is using, with their cookies and logins, and they watch it happen.
  // An isolated profile cannot do the work — an agent that can only browse
  // logged-out cannot check your dashboard or file your issue.
  let userBrowser: ChildProcess
  let cdpPort: number
  let sessionAgent: AgentBrowserPort
  let userProfile: string

  beforeAll(async () => {
    // Stand in for the user's running browser: same binary, debugging endpoint
    // published, exactly as the fork does when session mode is switched on.
    userBrowser = spawn(
      BROWSER,
      [
        '--remote-debugging-port=0',
        `--user-data-dir=${(userProfile = mkdtempSync(join(tmpdir(), 'webdeck-user-session-')))}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
    )
    cdpPort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no DevTools endpoint')), 30_000)
      let buffered = ''
      userBrowser.stderr?.on('data', (chunk) => {
        buffered += String(chunk)
        const match = buffered.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)
        if (match) {
          clearTimeout(timer)
          resolve(Number(match[1]))
        }
      })
    })
    sessionAgent = chromiumAgentBrowser({ mode: 'session', sessionCdpPort: cdpPort })
  }, 60_000)

  afterAll(async () => {
    await sessionAgent?.shutdown?.()
    try {
      process.kill(-userBrowser.pid!, 'SIGKILL')
    } catch {
      userBrowser?.kill('SIGKILL')
    }
    // The stand-in browser is ours to clean up: session-mode shutdown
    // deliberately does not touch the browser it attached to.
    if (userProfile) rmSync(userProfile, { recursive: true, force: true })
  }, 30_000)

  it('opens a tab in the browser that was already running', async () => {
    const before = await listTargets(cdpPort)
    const result = await sessionAgent.openTab(origin)
    expect(result).toContain('title: Agent Target')
    const after = await listTargets(cdpPort)
    // The tab is in the USER's browser, not one the agent started for itself.
    expect(after.filter((t) => t.type === 'page').length).toBeGreaterThan(
      before.filter((t) => t.type === 'page').length
    )
  }, 60_000)

  it("shutdown closes the agent's tabs but leaves the browser running", async () => {
    await sessionAgent.shutdown?.()
    // Killing the user's browser because an agent session ended would close
    // every window they had open.
    expect(await listTargets(cdpPort)).toBeInstanceOf(Array)
  }, 30_000)

  it('defaults to isolated until session mode can actually connect', () => {
    // A default of 'session' would fail every browser call on a fresh install,
    // because the browser-side half is not built yet. Flip this to 'session'
    // when it is — that is the mode that matters for real work.
    const defaulted = chromiumAgentBrowser({ browserPath: BROWSER })
    expect(defaulted).toBeTruthy()
  })

  it('says plainly when no session endpoint was published', async () => {
    // The fork only publishes the endpoint while the user has session mode on.
    // Without it the agent must say so, not fall back to an isolated profile
    // and silently do the work logged-out.
    const noEndpoint = chromiumAgentBrowser({ mode: 'session', sessionCdpPort: 0 })
    await expect(noEndpoint.openTab('https://example.com')).rejects.toThrow(
      /did not publish a DevTools endpoint/
    )
  }, 30_000)

  it('reports an unreachable session rather than hanging', async () => {
    const wrongPort = chromiumAgentBrowser({ mode: 'session', sessionCdpPort: 1 })
    await expect(wrongPort.openTab('https://example.com')).rejects.toThrow(
      /could not reach your browser session/
    )
  }, 30_000)
})
