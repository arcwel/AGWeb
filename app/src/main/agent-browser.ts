import type { WebContents } from 'electron'
import { IpcEvents } from '@shared/ipc'
import { broadcast } from './windows'
import { createBrowserTab, getTabWebContents, navigate } from './browser'
import { audit, decide } from './policy'
import { attachVision, detachVision } from './browser-vision'

/**
 * Agent↔browser bridge (Phase 7): agents open and drive real shell tabs.
 * The view is created here in main, then the renderer "adopts" it as a
 * normal tab (visible in the tab strip, activated on the stage) so the user
 * watches the agent work live. Control is executeJavaScript-based: click,
 * type, read, eval, wait-for, viewport emulation, and screenshots.
 */

const LOAD_TIMEOUT_MS = 20_000
const TEXT_CAP = 8_000

let nextAgentTabId = 1

/**
 * Navigation guard for agent-driven tabs (P1-1). The policy gate approves the
 * URL the agent *asked* for; servers can 30x and pages can navigate
 * themselves, so every redirect and in-page navigation is re-checked here
 * against the live policy. A confirm/deny verdict cancels rather than
 * prompting — this fires inside Chromium's synchronous navigation path, and
 * silently following an unapproved destination is the bug we're fixing.
 */
function installNavigationGuard(tabId: string, wc: WebContents): void {
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (decide('browser_navigate', url) === 'allow') return
    event.preventDefault()
    audit({ event: 'action', kind: 'browser_navigate', detail: url, decision: 'deny' })
    blockedNavigations.set(tabId, url)
  }
  wc.on('will-redirect', (event, url) => guard(event, url))
  wc.on('will-navigate', (event, url) => guard(event, url))
}

/** Last destination the guard refused per tab, surfaced to the model once. */
const blockedNavigations = new Map<string, string>()

/** Report (and clear) a navigation the guard cancelled for this tab. */
/** Drop any recording/blocked-nav state for a destroyed tab (P2-4). */
export function disposeAgentTabState(tabId: string): void {
  blockedNavigations.delete(tabId)
  detachVision(tabId)
  const recording = recordings.get(tabId)
  if (!recording) return
  recordings.delete(tabId)
  const wc = getTabWebContents(tabId)
  try {
    wc?.endFrameSubscription()
  } catch {
    // already gone
  }
}

/** Report (and clear) a navigation the guard cancelled for this tab. */
export function takeBlockedNavigation(tabId: string): string | null {
  const url = blockedNavigations.get(tabId)
  if (!url) return null
  blockedNavigations.delete(tabId)
  return url
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function requireTab(tabId: string): WebContents {
  const wc = getTabWebContents(tabId)
  if (!wc) throw new Error(`no browser tab ${tabId} — open one with browser_open first`)
  return wc
}

/** Wait until the page finishes loading (or the timeout passes). */
async function waitForLoad(wc: WebContents): Promise<void> {
  const start = Date.now()
  // loadURL resolves early for some schemes; poll the loading flag instead.
  while (wc.isLoading() && Date.now() - start < LOAD_TIMEOUT_MS) await sleep(100)
  await sleep(150) // let the first paint land
}

/** JSON-quote a string for safe embedding inside injected page scripts. */
const q = (value: string): string => JSON.stringify(value)

/** Schemes an agent may open or navigate to. Shared by open and navigate. */
const AGENT_URL_SCHEME = /^(https?|data|about|file):/i

export async function agentOpenTab(url: string): Promise<string> {
  // Same scheme allowlist as agentNavigate — opening a tab must not be a way
  // around the check navigation enforces.
  if (!AGENT_URL_SCHEME.test(url)) throw new Error(`unsupported URL scheme: ${url}`)
  const tabId = `agent-tab-${nextAgentTabId++}`
  createBrowserTab(tabId)
  const wc = requireTab(tabId)
  installNavigationGuard(tabId, wc)
  // Attach Agent Vision before navigating so the page's own load requests and
  // console output are recorded, not just what fires after the first paint.
  attachVision(tabId)
  // The renderer adds the tab to its strip and activates it, which positions
  // the native view over the stage and makes it visible.
  broadcast(IpcEvents.browserAdoptTab, { tabId, url }, null)
  navigate(tabId, url)
  await waitForLoad(wc)
  return `tabId: ${tabId}\ntitle: ${wc.getTitle()}\nurl: ${wc.getURL()}`
}

export async function agentNavigate(tabId: string, url: string): Promise<string> {
  const wc = requireTab(tabId)
  if (!AGENT_URL_SCHEME.test(url)) throw new Error(`unsupported URL scheme: ${url}`)
  navigate(tabId, url)
  await waitForLoad(wc)
  return `title: ${wc.getTitle()}\nurl: ${wc.getURL()}`
}

export async function agentReadPage(tabId: string, selector?: string): Promise<string> {
  const wc = requireTab(tabId)
  if (selector) {
    const script = `(() => {
      const el = document.querySelector(${q(selector)})
      return el ? el.innerText : null
    })()`
    const text = (await wc.executeJavaScript(script, true)) as string | null
    if (text === null) throw new Error(`no element matches ${selector}`)
    return text.slice(0, TEXT_CAP)
  }
  const script = `({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })`
  const page = (await wc.executeJavaScript(script, true)) as {
    title: string
    url: string
    text: string
  }
  return `title: ${page.title}\nurl: ${page.url}\n\n${page.text.slice(0, TEXT_CAP)}`
}

export async function agentEval(tabId: string, expression: string): Promise<string> {
  const wc = requireTab(tabId)
  const result: unknown = await wc.executeJavaScript(expression, true)
  if (result === undefined) return 'undefined'
  try {
    return JSON.stringify(result)?.slice(0, TEXT_CAP) ?? String(result)
  } catch {
    return String(result).slice(0, TEXT_CAP)
  }
}

export async function agentClick(tabId: string, selector: string): Promise<string> {
  const wc = requireTab(tabId)
  const script = `(() => {
    const el = document.querySelector(${q(selector)})
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  })()`
  const found = (await wc.executeJavaScript(script, true)) as boolean
  if (!found) throw new Error(`no element matches ${selector}`)
  await sleep(100)
  return 'clicked'
}

export async function agentType(tabId: string, selector: string, text: string): Promise<string> {
  const wc = requireTab(tabId)
  // Native value setter + input/change events so framework-bound inputs
  // (React controlled components etc.) see the change.
  const script = `(() => {
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
      return 'not-editable'
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`
  const result = (await wc.executeJavaScript(script, true)) as string
  if (result === 'missing') throw new Error(`no element matches ${selector}`)
  if (result === 'not-editable') throw new Error(`${selector} is not an input or editable element`)
  return 'typed'
}

export async function agentWaitFor(
  tabId: string,
  selector: string,
  timeoutMs: number
): Promise<string> {
  const wc = requireTab(tabId)
  const start = Date.now()
  const script = `!!document.querySelector(${q(selector)})`
  for (;;) {
    if ((await wc.executeJavaScript(script, true)) === true) return 'found'
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${selector}`)
    await sleep(250)
  }
}

/** Capture the page (or one element) as a PNG. Returns the raw image bytes. */
export async function agentCapture(tabId: string, selector?: string): Promise<Buffer> {
  const wc = requireTab(tabId)
  await sleep(300) // ensure the latest DOM state has painted
  if (selector) {
    const script = `(() => {
      const el = document.querySelector(${q(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`
    const rect = (await wc.executeJavaScript(script, true)) as {
      x: number
      y: number
      width: number
      height: number
    } | null
    if (!rect) throw new Error(`no element matches ${selector}`)
    await sleep(150) // scrollIntoView may have moved the page
    const image = await wc.capturePage({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    })
    return image.toPNG()
  }
  const image = await wc.capturePage()
  return image.toPNG()
}

/** Emulate a viewport size for responsiveness checks; 0×0 resets. */
export function agentSetViewport(tabId: string, width: number, height: number): string {
  const wc = requireTab(tabId)
  if (width <= 0 || height <= 0) {
    wc.disableDeviceEmulation()
    return 'viewport reset to the native stage size'
  }
  wc.enableDeviceEmulation({
    screenPosition: width < 768 ? 'mobile' : 'desktop',
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width, height },
    deviceScaleFactor: 0,
    scale: 1
  })
  return `viewport emulating ${width}×${height}`
}

/* ---- Session recording (7.4): paint-driven frame capture + HTML replay ---- */

interface Recording {
  frames: { t: number; png: Buffer }[]
  startedAt: number
  lastFrameAt: number
}

const MAX_FRAMES = 240
const MIN_FRAME_GAP_MS = 200

const recordings = new Map<string, Recording>()

/** Start capturing the tab: a frame lands on every paint (rate-limited). */
export async function agentRecordStart(tabId: string): Promise<string> {
  const wc = requireTab(tabId)
  if (recordings.has(tabId)) return `already recording ${tabId}`
  const recording: Recording = { frames: [], startedAt: Date.now(), lastFrameAt: 0 }
  recordings.set(tabId, recording)
  // Seed with the current view so even a static page yields a frame.
  const first = await wc.capturePage()
  recording.frames.push({ t: 0, png: first.toPNG() })
  wc.beginFrameSubscription(false, (image) => {
    const now = Date.now()
    if (now - recording.lastFrameAt < MIN_FRAME_GAP_MS) return
    if (recording.frames.length >= MAX_FRAMES) return
    recording.lastFrameAt = now
    recording.frames.push({ t: now - recording.startedAt, png: image.toPNG() })
  })
  return `recording ${tabId}`
}

/** Stop and render the replay: one self-contained HTML player with the
 *  captured frames inlined (play/pause + scrubber, real timings). */
export async function agentRecordStop(tabId: string): Promise<string> {
  const wc = getTabWebContents(tabId)
  const recording = recordings.get(tabId)
  if (!recording) throw new Error(`not recording ${tabId}`)
  recordings.delete(tabId)
  if (wc) {
    try {
      wc.endFrameSubscription()
      const last = await wc.capturePage()
      recording.frames.push({
        t: Date.now() - recording.startedAt,
        png: last.toPNG()
      })
    } catch {
      // tab closed mid-recording — keep what we have
    }
  }
  return renderReplayHtml(recording)
}

function renderReplayHtml(recording: Recording): string {
  const frames = recording.frames.map((f) => ({
    t: f.t,
    src: `data:image/png;base64,${f.png.toString('base64')}`
  }))
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>WebDeck session replay</title>
<style>
  body { margin: 0; background: #0b0f14; color: #cbd5e1; font: 13px sans-serif; }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
  img { display: block; max-width: 100vw; max-height: calc(100vh - 44px); margin: 0 auto; }
  input[type=range] { flex: 1; }
  button { background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
    border-radius: 6px; padding: 3px 10px; font: 600 12px sans-serif; }
</style></head><body>
<div class="bar">
  <button id="play">Play</button>
  <input id="scrub" type="range" min="0" max="${frames.length - 1}" value="0" />
  <span id="time"></span>
</div>
<img id="frame" alt="session frame" />
<script>
  const frames = ${JSON.stringify(frames)}
  const img = document.getElementById('frame')
  const scrub = document.getElementById('scrub')
  const time = document.getElementById('time')
  const play = document.getElementById('play')
  let index = 0, timer = null
  function show(i) {
    index = Math.max(0, Math.min(frames.length - 1, i))
    img.src = frames[index].src
    scrub.value = index
    time.textContent = (frames[index].t / 1000).toFixed(1) + 's · frame ' +
      (index + 1) + '/' + frames.length
  }
  function step() {
    if (index >= frames.length - 1) return stop()
    const delay = Math.min(2000, Math.max(60, frames[index + 1].t - frames[index].t))
    timer = setTimeout(() => { show(index + 1); step() }, delay)
  }
  function stop() { clearTimeout(timer); timer = null; play.textContent = 'Play' }
  play.onclick = () => {
    if (timer) return stop()
    if (index >= frames.length - 1) show(0)
    play.textContent = 'Pause'
    step()
  }
  scrub.oninput = () => { stop(); show(Number(scrub.value)) }
  show(0)
</script>
</body></html>`
}
