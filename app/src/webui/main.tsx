import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import { getWindowRole, useShellStore } from '@/store'
import { loadInitialTheme } from '@/theme'
import { installShortcutListener } from '@/shortcuts'
import { coreAuthSubprotocol } from '../core/transports/auth'
import { CoreClient } from '../core/transports/ws-client'
import { serveAgentTabs } from './agent-tabs'
import { createAgwebApi } from '../preload/api'
import { createWebUiIpc, primeSyncCache } from './ipc-adapter'
import '@/styles.css'

/**
 * `chrome://webdeck` entry point — the real WebDeck UI, running under the fork.
 *
 * The difference from the Electron renderer is one line of plumbing: instead of
 * a preload injecting `window.agweb` over IPC, we build the *same* API here from
 * a WebSocket to `webdeck-core`. Everything above this file — the store, the
 * Deck, every block — is unchanged and unaware.
 *
 * The port is handed over by the WebUI host as `window.WEBDECK_CORE_PORT` (see
 * `WebDeckUI`), or `?corePort=` when driving the page by hand. The connection
 * token arrives the same way, as `window.WEBDECK_CORE_TOKEN` — see `coreToken`.
 */

declare global {
  interface Window {
    WEBDECK_CORE_PORT?: number
    /**
     * The core's per-boot connection secret, emitted by the WebUI host in
     * `core-port.js` beside the port. Optional in the type because the C++ that
     * emits it lands separately; a page without it simply gets refused by the
     * core, which is the correct outcome.
     */
    WEBDECK_CORE_TOKEN?: string
    __WEBDECK_ASSETS?: Record<string, string>
  }
}

/**
 * Serve bundled text assets from the inlined map instead of the network.
 *
 * Chromium refuses `fetch()` on chrome:// URLs from page script, so the VS Code
 * service layer cannot read its own bundled themes and grammars once they are
 * served from the WebUI pak — it fails with "URL scheme chrome is not
 * supported" and falls back to an unstyled editor. The build emits those files
 * into `window.__WEBDECK_ASSETS` (see vite.webui.config.ts) and this answers
 * from there; everything else falls through to the real fetch untouched.
 */
function installAssetFetchShim(): void {
  const assets = window.__WEBDECK_ASSETS
  if (!assets) return
  const realFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const match = /\/(assets\/[^/?#]+)(?:[?#]|$)/.exec(url ?? '')
    const body = match ? assets[match[1]] : undefined
    if (body === undefined) return realFetch(input as RequestInfo, init)
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    )
  }
}

function corePort(): number {
  const fromQuery = Number(new URLSearchParams(location.search).get('corePort'))
  if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery
  return typeof window.WEBDECK_CORE_PORT === 'number' ? window.WEBDECK_CORE_PORT : 0
}

/**
 * The secret that lets this page drive the core.
 *
 * Only from the host global — never from the query string. A URL is the part of
 * a request that ends up in logs, history and copy-pasted bug reports, and this
 * token is worth as much as the user's shell.
 *
 * Absence is tolerated rather than thrown on: the WebUI host's `core-port.js`
 * gains this global in a separate (C++) change, and until it does the page
 * should reach the same honest "could not reach webdeck-core" screen as any
 * other refused connection — not a blank page from an exception at import time.
 */
function coreToken(): string {
  return typeof window.WEBDECK_CORE_TOKEN === 'string' ? window.WEBDECK_CORE_TOKEN : ''
}

/** Replace the boot screen with an honest failure, rather than a blank page. */
function fail(message: string, detail: string): void {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = 'webui-fail'
  const h = document.createElement('h1')
  h.textContent = message
  const p = document.createElement('pre')
  p.textContent = detail
  wrap.append(h, p)
  root.append(wrap)
}

async function main(): Promise<void> {
  installAssetFetchShim()
  const port = corePort()
  if (!port) {
    fail(
      'webdeck-core is not running.',
      'The browser did not report a core port. See the browser log for "webdeck-core".'
    )
    return
  }

  // The token rides in the subprotocol argument: a page cannot set request
  // headers on a WebSocket, and it must not ride in the URL. See auth.ts.
  const token = coreToken()
  const protocols = token ? [coreAuthSubprotocol(token)] : []
  const client = new CoreClient({
    connect: () => new WebSocket(`ws://127.0.0.1:${port}`, protocols)
  })
  try {
    await client.connect()
  } catch (error) {
    fail(
      'Could not reach webdeck-core.',
      token
        ? String((error as Error)?.message ?? error)
        : 'The browser did not report a core token, so the connection was refused. ' +
            'See the browser log for "webdeck-core".'
    )
    return
  }

  // Let the core drive the user's own tabs through us. The agent runs in the
  // core; the tabs are reachable only from inside the browser, and this page is
  // the only part of WebDeck that lives there.
  serveAgentTabs(client)

  // Build the shared API surface over the socket and install it exactly where
  // the preload would have.
  window.agweb = createAgwebApi(createWebUiIpc(client), {
    kind: 'chromium',
    // The page sits inside a real browser tab: Chromium owns the tab strip,
    // address bar, downloads, profiles, extensions, zoom and find. Drawing our
    // own would put a second, non-functional copy under the real one.
    ownsBrowserChrome: true,
    ownsBrowserFeatures: true,
    // No native pickers or extra OS windows yet.
    canOpenWindows: false,
    canPickPaths: false,
    // Export works, done the browser's own way: a download for HTML, the print
    // preview for PDF. See webui/export.ts.
    canExport: true
  })
  // readSync is consulted during boot, so it must be warm before React mounts.
  await primeSyncCache(client)

  const role = getWindowRole()
  useShellStore.setState({ theme: loadInitialTheme() })
  if (role.kind === 'main') installShortcutListener()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void main()
