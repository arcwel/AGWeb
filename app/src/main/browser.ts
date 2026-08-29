import { BrowserWindow, Menu, WebContentsView, clipboard } from 'electron'
import type { WebContents } from 'electron'
import { IpcEvents } from '@shared/ipc'
import type { BrowserTabState, Rect } from '@shared/ipc'
import { disposeAgentTabState } from './agent-browser'
import { activePartition, sessionForProfile, activeProfile } from './profiles'

/**
 * Owns the embedded Chromium views (one WebContentsView per browser tab).
 * The renderer drives them over IPC and receives BrowserTabState pushes;
 * only the active tab's view is visible at any time.
 *
 * Pages run fully sandboxed in a dedicated persistent session with no
 * preload. Web permissions go through the prompt flow in permissions.ts;
 * the Phase 9 policy engine will layer per-mode rules on top.
 */

/** Shell-level combos reclaimed from focused pages (P1-14). */
const SHELL_COMBOS = new Set(['mod+d', 'mod+t', 'mod+w', 'mod+shift+l'])

let host: BrowserWindow | null = null
const views = new Map<string, WebContentsView>()

export function initBrowser(window: BrowserWindow): void {
  host = window
}

/** Last failure per tab, cleared as soon as a navigation starts or succeeds. */
const loadErrors = new Map<string, { code: number; description: string; url: string }>()

function sendState(tabId: string, wc: WebContents): void {
  if (!host || host.isDestroyed() || wc.isDestroyed()) return
  const state: BrowserTabState = {
    tabId,
    url: wc.getURL(),
    title: wc.getTitle(),
    isLoading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loadError: loadErrors.get(tabId)
  }
  host.webContents.send(IpcEvents.browserState, state)
}

/** Find-in-page (⌘F). `next` steps through matches without restarting. */
export function findInPage(tabId: string, query: string, next: boolean): void {
  const view = views.get(tabId)
  if (!view) return
  if (!query) {
    view.webContents.stopFindInPage('clearSelection')
    return
  }
  view.webContents.findInPage(query, { findNext: next, forward: true })
}

export function stopFindInPage(tabId: string): void {
  views.get(tabId)?.webContents.stopFindInPage('clearSelection')
}

/** Page zoom, in Chromium's zoom-level units (0 is 100%). */
export function setZoom(tabId: string, level: number): number {
  const view = views.get(tabId)
  if (!view) return 0
  const clamped = Math.max(-3, Math.min(4, level))
  view.webContents.setZoomLevel(clamped)
  return clamped
}

export function getZoom(tabId: string): number {
  return views.get(tabId)?.webContents.getZoomLevel() ?? 0
}

export function createBrowserTab(tabId: string): void {
  if (!host || views.has(tabId)) return
  // Tabs open in the active profile's persistent partition, and touching the
  // session here applies its Chrome user-agent before the first navigation —
  // which is what lets Google sign-in succeed instead of being refused as an
  // "insecure" embedded browser.
  sessionForProfile(activeProfile().id)
  const view = new WebContentsView({
    webPreferences: {
      partition: activePartition(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const wc = view.webContents

  const push = (): void => sendState(tabId, wc)

  // A failed navigation used to leave a blank view and no explanation — the
  // page simply never appeared. Report it so the shell can say what happened.
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which is what a normal in-flight cancel looks like.
    if (!isMainFrame || code === -3) return
    loadErrors.set(tabId, { code, description, url })
    push()
  })
  const clearError = (): void => {
    if (loadErrors.delete(tabId)) push()
  }
  wc.on('did-start-loading', clearError)
  wc.on('did-finish-load', clearError)

  wc.on('found-in-page', (_event, result) => {
    host?.webContents.send(IpcEvents.browserFindResult, {
      tabId,
      matches: result.matches,
      active: result.activeMatchOrdinal
    })
  })

  wc.on('did-start-loading', push)
  wc.on('did-stop-loading', push)
  wc.on('did-navigate', push)
  wc.on('did-navigate-in-page', push)
  wc.on('page-title-updated', push)

  // A focused web page swallows renderer keydowns, so the shell's own
  // shortcuts (⌘D/⌘T/⌘W/⌘⇧L) would die the moment the user clicks a page.
  // Forward just those combos back to the shell renderer (P1-14).
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod) return
    const key = input.key.toLowerCase()
    const combo = `${mod ? 'mod+' : ''}${input.shift ? 'shift+' : ''}${key}`
    if (!SHELL_COMBOS.has(combo)) return
    event.preventDefault()
    host?.webContents.send(IpcEvents.shellShortcut, combo)
  })

  // New-window requests become new shell tabs instead of popups.
  wc.setWindowOpenHandler(({ url }) => {
    host?.webContents.send(IpcEvents.browserOpenTab, url)
    return { action: 'deny' }
  })

  // A right-click menu — the one every browser has and this one didn't. Built
  // per-invocation from Chromium's own `context-menu` params so it offers the
  // right actions for what was actually clicked (a link, an image, editable
  // text, or a plain selection).
  wc.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    const { linkURL, srcURL, selectionText, isEditable, editFlags, mediaType } = params

    if (linkURL) {
      items.push(
        {
          label: 'Open Link in New Tab',
          click: () => host?.webContents.send(IpcEvents.browserOpenTab, linkURL)
        },
        { label: 'Copy Link Address', click: () => clipboard.writeText(linkURL) },
        { type: 'separator' }
      )
    }
    if (mediaType === 'image' && srcURL) {
      items.push(
        {
          label: 'Open Image in New Tab',
          click: () => host?.webContents.send(IpcEvents.browserOpenTab, srcURL)
        },
        { label: 'Copy Image Address', click: () => clipboard.writeText(srcURL) },
        { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
        { type: 'separator' }
      )
    }
    if (isEditable) {
      items.push(
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { role: 'selectAll' },
        { type: 'separator' }
      )
    } else if (selectionText) {
      items.push(
        { role: 'copy' },
        {
          label: `Search the web for “${selectionText.slice(0, 24)}${
            selectionText.length > 24 ? '…' : ''
          }”`,
          click: () =>
            host?.webContents.send(
              IpcEvents.browserOpenTab,
              `https://duckduckgo.com/?q=${encodeURIComponent(selectionText)}`
            )
        },
        { type: 'separator' }
      )
    }
    items.push(
      {
        label: 'Back',
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack()
      },
      {
        label: 'Forward',
        enabled: wc.navigationHistory.canGoForward(),
        click: () => wc.navigationHistory.goForward()
      },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) }
    )

    Menu.buildFromTemplate(items).popup({ window: host ?? undefined })
  })

  view.setVisible(false)
  host.contentView.addChildView(view)
  views.set(tabId, view)
}

export function destroyBrowserTab(tabId: string): void {
  const view = views.get(tabId)
  if (!view) return
  // Frame subscriptions and recorded frames must not outlive the tab (P2-4).
  disposeAgentTabState(tabId)
  views.delete(tabId)
  if (host && !host.isDestroyed()) host.contentView.removeChildView(view)
  if (!view.webContents.isDestroyed()) view.webContents.close()
}

export function withTab(tabId: string, fn: (view: WebContentsView) => void): void {
  const view = views.get(tabId)
  if (view && !view.webContents.isDestroyed()) fn(view)
}

/** Live webContents for a tab, or null. Used by the agent↔browser bridge. */
export function getTabWebContents(tabId: string): WebContents | null {
  const view = views.get(tabId)
  return view && !view.webContents.isDestroyed() ? view.webContents : null
}

export function navigate(tabId: string, url: string): void {
  withTab(tabId, (view) => {
    view.webContents.loadURL(url).catch(() => {
      // Load failures (bad DNS, aborted loads) surface in-page via Chromium.
    })
  })
}

export function setBounds(tabId: string, rect: Rect): void {
  withTab(tabId, (view) => {
    view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
  })
}

export function setVisible(tabId: string, visible: boolean): void {
  withTab(tabId, (view) => view.setVisible(visible))
}

export function setCornerRadius(tabId: string, radius: number): void {
  withTab(tabId, (view) => {
    // View.setBorderRadius is not in all Electron typings yet — call defensively.
    const v = view as unknown as { setBorderRadius?: (r: number) => void }
    v.setBorderRadius?.(Math.max(0, Math.round(radius)))
  })
}

export function destroyAllBrowserTabs(): void {
  for (const tabId of [...views.keys()]) destroyBrowserTab(tabId)
}
