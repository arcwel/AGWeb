import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join, sep } from 'node:path'
import { version as appVersion } from '../../package.json'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import type { AppInfo, ThemeSource } from '@shared/ipc'
import { restoreWindowState, trackWindowState } from './window-state'
import {
  addWorkspaceRoot,
  getCurrentWorkspace,
  grantFile,
  registerWorkspaceRpc,
  openWorkspaceDialog,
  openWorkspacePath,
  setWorkspaceFolderPicker,
  setWorkspaceOpenedHook
} from './workspace'
import {
  createBrowserTab,
  destroyAllBrowserTabs,
  destroyBrowserTab,
  initBrowser,
  navigate,
  setBounds,
  setCornerRadius,
  setVisible,
  withTab
} from './browser'
import type { Rect } from '@shared/ipc'
import {
  broadcast,
  closeAllChildWindows,
  closeDeckWindow,
  focusDeckWindow,
  initWindows,
  openDeckWindow,
  syncFloatWindows
} from './windows'
import { registerFsRpc, watchWorkspace } from './fs'
import { disposeAllTerminals, registerTerminalRpc } from './terminal'
import { buildApplicationMenu } from './menu'
import {
  listProfiles,
  setActiveProfile,
  createProfile,
  removeProfile,
  clearBrowsingData,
  initProfileSessions,
  googleStatus,
  activeProfile
} from './profiles'
import { registerSecretsRpc } from './secrets'
import { core } from '../core/rpc'
import { setCoreEnv } from '../core/env'
import { setCoreBroadcaster } from '../core/notify'
import { setAgentBrowserPort } from '../core/agent-browser-port'
import { electronAgentBrowser } from './agent-browser-adapter'
import { electronCoreEnv } from './core-env'
import { electronTransport } from '../core/transports/electron'
import {
  shouldDisableHardwareAcceleration,
  initAppSettings,
  onAppSettingsChanged,
  readAppSettings,
  registerAppSettingsRpc,
  writeAppSettings,
  type AppSettings,
  type ClearableData
} from './app-settings'
import { registerSearchRpc } from './search'
import { exportCapture, exportHtml, exportPdf } from './export'
import { findInPage, getTabWebContents, getZoom, setZoom, stopFindInPage } from './browser'
import { registerTasksRpc } from './tasks'
import { registerDebugRpc, stopDebugSession } from './debug'
import { registerSettingsRpc } from './settings'
import { registerGitRpc } from './git'
import { registerLspRpc, stopAllLanguageServers } from './lsp'
import {
  getAgentModel,
  initAgents,
  registerAgentRpc,
  setAgentModel,
  setAgentModelChangeNotifier
} from './agent'
import type { WorkspaceInfo } from '@shared/ipc'
import {
  listExtensions,
  loadExtensionDialog,
  loadExtensionFromPath,
  loadPackedExtension,
  removeExtension,
  restoreExtensions
} from './extensions'
import { getEmbedProxyStatus, setEmbedProxyEnabled } from './embed-proxy'
import { clearDownloads, initDownloads, listDownloads, showDownload } from './downloads'
import { initPermissions, respondToPermission } from './permissions'
import { initDevServers, registerDevServersRpc, stopDevServer } from './dev-servers'
import { registerSlidesRpc, stopSlideServer } from './slides'
import {
  getPolicyStatus,
  initPolicy,
  registerPolicyRpc,
  sanitizeCustomRules,
  sanitizeSyncedPolicyMode,
  setCustomRules,
  setPolicyBroadcaster,
  setPolicyDenyNotifier,
  setPolicyMode
} from './policy'
import type { PolicyStatus } from '@shared/ipc'
import {
  getSyncStatus,
  initSync,
  registerSyncRpc,
  registerSyncSection,
  setSyncBroadcaster,
  setSyncFile,
  setSyncPulledNotifier,
  syncTouch
} from './sync'
import { getUiTheme, setUiTheme } from './ui-prefs'

import { readFileSync as _readFileSync } from 'node:fs'
function readFileSyncUtf8(path: string): string {
  return _readFileSync(path, 'utf8')
}

// Test/dev hooks: isolate state and open a workspace without the dialog.
if (process.env.AGWEB_USER_DATA) app.setPath('userData', process.env.AGWEB_USER_DATA)

const MAX_RENDERER_RESTARTS = 3

let mainWindow: BrowserWindow | null = null
let rendererRestarts = 0

// Single-instance lock: a second launch focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

function createMainWindow(): void {
  const state = restoreWindowState()
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // The Glass ground, so there is no white flash before the renderer paints.
    backgroundColor: '#0f1114',
    title: 'Arcwel WebDeck',
    icon: join(__dirname, '../../resources/icon.png'),
    // No title bar: tabs live in that row, the way every browser does it. The
    // traffic lights stay native and are inset; the tab strip reserves room
    // for them and is a drag region, so the window still moves by its top edge.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  trackWindowState(mainWindow)
  if (state.isMaximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Crash recovery: reload a crashed renderer a bounded number of times.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || !mainWindow) return
    console.error(`Renderer gone (${details.reason}), restarts: ${rendererRestarts}`)
    if (rendererRestarts < MAX_RENDERER_RESTARTS) {
      rendererRestarts += 1
      // The fresh renderer starts with empty tab state and restarting tab ids;
      // the old WebContentsViews would otherwise stay painted over it and
      // collide with reused ids.
      destroyAllBrowserTabs()
      mainWindow.webContents.reload()
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    rendererRestarts = 0
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('Renderer unresponsive')
  })

  // The shell itself never hosts external pages: open them in the OS browser
  // until the integrated browser tabs (Phase 2) land.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost')) event.preventDefault()
  })

  // Tear down browser views on 'close' (window still alive) — on 'closed' the
  // window object is destroyed and removeChildView would throw, hanging quit.
  mainWindow.on('close', () => {
    destroyAllBrowserTabs()
    closeAllChildWindows()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  initBrowser(mainWindow)
  initWindows(mainWindow)
  initDownloads(mainWindow)
  initPermissions(mainWindow)
  initDevServers(mainWindow)
  initPolicy(mainWindow)
  // Fan policy changes out to every window so a PolicyControls in another window
  // never shows stale mode/rules (P2-13).
  setPolicyBroadcaster((status) => {
    broadcast(IpcEvents.policyChanged, status, null)
    syncTouch() // a policy change is a synced-settings change → auto-push
  })
  setPolicyDenyNotifier((info) => broadcast(IpcEvents.policyDenied, info, null))
  void restoreExtensions()

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // Wire the platform seam before any CORE domain runs. Under the Chromium fork
  // this is the only line that changes — a Node adapter replaces the Electron one.
  setCoreEnv(electronCoreEnv())
  // The reverse bridge: CORE domains emit events through this sink. On Electron
  // it's the BrowserWindow broadcast; the standalone core injects a WS push.
  setCoreBroadcaster(broadcast)
  // The agent's browser tools. In-process WebContentsView here; under the fork,
  // a proxy to the browser process over the transport.
  setAgentBrowserPort(electronAgentBrowser())

  // The workspace domain's only host affordance: a native folder picker. Inject
  // the Electron one here; the fork supplies its own, keeping workspace.ts
  // Electron-free.
  setWorkspaceFolderPicker(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Project Folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.appInfo, (): AppInfo => {
    return {
      // app.getVersion() falls back to Electron's own version in unpackaged dev runs
      version: app.isPackaged ? app.getVersion() : appVersion,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform
    }
  })

  const applyWorkspace = (workspace: WorkspaceInfo | null): void => {
    if (!workspace) return
    watchWorkspace(workspace.path)
    // The dev server is scoped to the project it was started in.
    void stopDevServer()
    broadcast(IpcEvents.workspaceChanged, workspace, null)
  }

  ipcMain.handle(IpcChannels.workspaceOpen, async () => {
    const workspace = await openWorkspaceDialog()
    applyWorkspace(workspace)
    return workspace
  })

  // workspaceOpenPath is a CORE method now (the fork must be able to open a
  // project without a native picker); the shell contributes its side effects
  // through this hook rather than a second handler.
  setWorkspaceOpenedHook(applyWorkspace)

  // The native menu's Open Project Folder… goes through applyWorkspace, the
  // same path as the in-app control — a second way in, not a second
  // implementation.
  buildApplicationMenu({
    openWorkspace: () => {
      void openWorkspaceDialog().then(applyWorkspace)
    }
  })

  // Multi-root (3B.4). A root is granted only through this picker: there is no
  // path-taking variant, so nothing but a human choosing a folder can widen
  // what the app — or the agent inside it — can reach.
  // workspace:add-root and workspace:remove-root are served by the CORE now
  // (workspace.ts), because they are plain path operations that both hosts can
  // do. Only the PICKER needed the host — the renderer opens one through
  // dialog:pick-paths and passes the chosen path in. Registering them here as
  // well threw "a second handler for 'workspace:add-root'" at startup, which
  // took the whole window with it.
  ipcMain.handle(IpcChannels.themeSet, (_event, source: unknown) => {
    if (source === 'system' || source === 'light' || source === 'dark') {
      nativeTheme.themeSource = source as ThemeSource
    }
    // Mirror the renderer-owned theme so WebDeck Sync can read/push it.
    if (source === 'light' || source === 'dark') {
      setUiTheme(source)
      syncTouch()
    }
  })

  const tabId = (value: unknown): string | null => (typeof value === 'string' ? value : null)

  ipcMain.handle(IpcChannels.browserCreate, (_e, id: unknown) => {
    const t = tabId(id)
    if (t) createBrowserTab(t)
  })
  ipcMain.handle(IpcChannels.browserDestroy, (_e, id: unknown) => {
    const t = tabId(id)
    if (t) destroyBrowserTab(t)
  })
  ipcMain.handle(IpcChannels.browserNavigate, (_e, id: unknown, url: unknown) => {
    const t = tabId(id)
    if (t && typeof url === 'string' && /^(https?|data|about|file):/i.test(url)) navigate(t, url)
  })
  ipcMain.handle(IpcChannels.browserBack, (_e, id: unknown) => {
    const t = tabId(id)
    if (t) withTab(t, (v) => v.webContents.navigationHistory.goBack())
  })
  ipcMain.handle(IpcChannels.browserForward, (_e, id: unknown) => {
    const t = tabId(id)
    if (t) withTab(t, (v) => v.webContents.navigationHistory.goForward())
  })
  ipcMain.handle(IpcChannels.browserReload, (_e, id: unknown, ignoreCache: unknown) => {
    const t = tabId(id)
    if (t) {
      withTab(t, (v) =>
        ignoreCache === true ? v.webContents.reloadIgnoringCache() : v.webContents.reload()
      )
    }
  })
  ipcMain.handle(IpcChannels.browserStop, (_e, id: unknown) => {
    const t = tabId(id)
    if (t) withTab(t, (v) => v.webContents.stop())
  })
  ipcMain.handle(IpcChannels.browserSetBounds, (_e, id: unknown, rect: unknown) => {
    const t = tabId(id)
    const r = rect as Rect
    if (t && r && [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n))) {
      setBounds(t, r)
    }
  })
  ipcMain.handle(IpcChannels.browserSetVisible, (_e, id: unknown, visible: unknown) => {
    const t = tabId(id)
    if (t) setVisible(t, visible === true)
  })
  ipcMain.handle(IpcChannels.browserSetCornerRadius, (_e, id: unknown, radius: unknown) => {
    const t = tabId(id)
    if (t && typeof radius === 'number' && Number.isFinite(radius)) setCornerRadius(t, radius)
  })
  ipcMain.handle(IpcChannels.browserDevTools, (_e, id: unknown) => {
    const t = tabId(id)
    if (t) withTab(t, (v) => v.webContents.openDevTools({ mode: 'detach' }))
  })

  ipcMain.handle(IpcChannels.deckOpen, () => openDeckWindow())
  ipcMain.handle(IpcChannels.deckClose, () => closeDeckWindow())
  ipcMain.handle(IpcChannels.deckFocus, () => focusDeckWindow())
  ipcMain.handle(IpcChannels.floatSync, (_e, ids: unknown) => {
    if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
      syncFloatWindows(ids as string[])
    }
  })
  ipcMain.handle(IpcChannels.shellBroadcast, (event, payload: unknown) => {
    broadcast(IpcEvents.shellSync, payload, event.sender.id)
  })

  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

  ipcMain.handle(IpcChannels.dialogConfirm, async (_e, message: unknown) => {
    if (!mainWindow) return false
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'OK'],
      defaultId: 1,
      cancelId: 0,
      message: str(message) ?? 'Are you sure?'
    })
    return response === 1
  })

  // Attachment picker. Selections outside the open workspace are dropped
  // rather than silently widening what the agent can reach.
  ipcMain.handle(IpcChannels.dialogPickPaths, async (_e, mode: unknown) => {
    if (!mainWindow) return []
    const workspace = getCurrentWorkspace()
    const kind = mode === 'dir' ? 'dir' : mode === 'image' ? 'image' : 'file'

    // The picker opens with or without a project. Requiring a workspace made
    // the composer's attach buttons do nothing at all, silently, which is the
    // worst possible answer to a click.
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'dir' ? 'Add folder as context' : 'Attach to the conversation',
      defaultPath: workspace?.path ?? app.getPath('home'),
      properties:
        kind === 'dir' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters:
        kind === 'image'
          ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
          : undefined
    })
    if (canceled) return []

    const root = workspace ? workspace.path + sep : null
    return filePaths.map((full) => {
      // Inside the project: the workspace-relative path everything else uses.
      if (root && full.startsWith(root)) return full.slice(root.length)
      // Outside it: picking a file in a native dialog is the same explicit
      // human gesture that grants a folder, so grant this one file — not its
      // directory — and hand back the absolute path. Previously these were
      // dropped silently, so attaching anything outside the project appeared
      // to do nothing.
      if (kind === 'dir') addWorkspaceRoot(full)
      else grantFile(full)
      return full
    })
  })

  const owner = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle(IpcChannels.exportHtml, (event, html: unknown, name: unknown) => {
    const h = str(html)
    if (h === null) return { error: 'bad arguments' }
    return exportHtml(owner(event), h, str(name) ?? 'document.html')
  })
  ipcMain.handle(IpcChannels.exportPdf, (event, html: unknown, name: unknown) => {
    const h = str(html)
    if (h === null) return { error: 'bad arguments' }
    return exportPdf(owner(event), h, str(name) ?? 'document.pdf')
  })
  ipcMain.handle(IpcChannels.exportCapture, (event, rect: unknown, name: unknown) => {
    const r = rect as Rect
    if (!r || ![r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n))) {
      return { error: 'bad arguments' }
    }
    return exportCapture(owner(event), r, str(name) ?? 'document.png')
  })

  // Debugging (12.4).

  // Settings and keybindings (12.6).
  ipcMain.handle(IpcChannels.settingsImport, async () => {
    if (!mainWindow) return { error: 'No window.' }
    // Deliberately not pinned to the workspace: the point of importing is to
    // pick up a config that lives in the user's VS Code profile.
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a VS Code settings.json or keybindings.json',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePaths[0]) return {}
    try {
      const { readFile } = await import('node:fs/promises')
      return { text: await readFile(filePaths[0], 'utf8') }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Tasks (12.5).

  // Browser: find in page and zoom.
  ipcMain.handle(IpcChannels.browserFind, (_e, tabId: unknown, q: unknown, next: unknown) => {
    const id = str(tabId)
    if (id) findInPage(id, str(q) ?? '', next === true)
  })
  ipcMain.handle(IpcChannels.browserFindStop, (_e, tabId: unknown) => {
    const id = str(tabId)
    if (id) stopFindInPage(id)
  })
  ipcMain.handle(IpcChannels.browserZoom, (_e, tabId: unknown, level: unknown) => {
    const id = str(tabId)
    if (!id) return 0
    return typeof level === 'number' ? setZoom(id, level) : getZoom(id)
  })
  // Printing belongs to the page's own web contents, not the shell's — the
  // shell renderer would otherwise print its chrome and a hole where the
  // WebContentsView paints.
  ipcMain.handle(IpcChannels.browserPrint, (_e, tabId: unknown) => {
    const id = str(tabId)
    if (!id) return false
    const contents = getTabWebContents(id)
    if (!contents) return false
    contents.print({}, () => {
      // The callback is required; a cancelled dialog is not an error.
    })
    return true
  })
  // appSettingsRead/Write are served through webdeck-core; the boot-time
  // synchronous read stays here (it needs ipcMain.on's returnValue).
  ipcMain.on(IpcChannels.appSettingsReadSync, (event) => {
    event.returnValue = readAppSettings()
  })
  ipcMain.handle(IpcChannels.appSettingsClearData, async (_e, kinds: unknown) => {
    await clearBrowsingData(Array.isArray(kinds) ? (kinds as ClearableData[]) : [])
  })
  ipcMain.handle(IpcChannels.appSettingsChooseDownloadDir, async () => {
    if (!mainWindow) return readAppSettings()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose download location',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result.canceled && result.filePaths[0]) {
      return writeAppSettings({ downloadPath: result.filePaths[0] })
    }
    return readAppSettings()
  })

  // Secrets is served through webdeck-core rather than a direct ipcMain.handle
  // (P1 decoupling); the electron transport binds it below. Migrating a domain
  // is: register it with the core, delete its ipcMain.handle calls here.
  registerSecretsRpc()
  registerAppSettingsRpc()
  registerGitRpc()
  registerTasksRpc()
  registerSearchRpc()
  registerLspRpc()
  registerDebugRpc()
  registerSettingsRpc()
  registerTerminalRpc()
  registerFsRpc()
  registerDevServersRpc()
  registerAgentRpc()
  registerPolicyRpc()
  registerWorkspaceRpc()
  registerSlidesRpc()

  // WebDeck Sync (settings sync via a local-first file). Register the syncable
  // sections, wire the shell affordances (status broadcast, native file picker),
  // and touch the engine whenever a synced setting changes so it auto-pushes.
  registerSyncSection({
    key: 'settings',
    read: () => readAppSettings(),
    apply: (v) => writeAppSettings((v ?? {}) as Partial<AppSettings>)
  })
  registerSyncSection({
    key: 'policy',
    read: () => getPolicyStatus(),
    apply: (v) => {
      // The policy is the agent's security gate, and the sync file may be in a
      // shared folder — so validate exactly as the IPC path does (no raw cast),
      // and drop anything malformed rather than partially applying it.
      const s = (v ?? {}) as Partial<PolicyStatus>
      // Synced, so it may lower the agent's authority but never raise it to
      // full autonomy — see sanitizeSyncedPolicyMode.
      const mode = sanitizeSyncedPolicyMode(s.mode)
      const custom = sanitizeCustomRules(s.custom)
      if (mode) setPolicyMode(mode)
      if (custom) setCustomRules(custom)
    }
  })
  registerSyncSection({
    key: 'model',
    read: () => getAgentModel(),
    apply: (v) => {
      if (typeof v === 'string') setAgentModel(v)
    }
  })
  registerSyncSection({
    key: 'theme',
    read: () => getUiTheme(),
    apply: (v) => {
      if (v === 'light' || v === 'dark') {
        setUiTheme(v)
        nativeTheme.themeSource = v
        broadcast(IpcEvents.themeChanged, v, null) // renderer adopts it into its store
      }
    }
  })
  registerSyncRpc()
  setSyncBroadcaster((s) => broadcast(IpcEvents.syncStatusChanged, s, null))
  // After a pull applies new settings, tell renderers to re-read them.
  setSyncPulledNotifier(() => broadcast(IpcEvents.syncPulled, null, null))
  // Local settings changes → debounced auto-push.
  onAppSettingsChanged(() => syncTouch())
  setAgentModelChangeNotifier(() => syncTouch())

  ipcMain.handle(IpcChannels.syncChooseFile, async () => {
    const result = await dialog.showSaveDialog({
      title: 'Choose WebDeck Sync File',
      defaultPath: 'webdeck-sync.json',
      filters: [{ name: 'WebDeck Sync', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    // Cancelling the picker leaves the current file untouched.
    if (result.canceled || !result.filePath) return getSyncStatus()
    return setSyncFile(result.filePath)
  })

  ipcMain.handle(IpcChannels.profilesList, () => listProfiles())
  ipcMain.handle(IpcChannels.profilesSetActive, (_e, id: unknown) => setActiveProfile(id))
  ipcMain.handle(IpcChannels.profilesCreate, (_e, name: unknown) => createProfile(name))
  ipcMain.handle(IpcChannels.profilesRemove, (_e, id: unknown) => removeProfile(id))
  ipcMain.handle(IpcChannels.profilesGoogleStatus, () => googleStatus())

  ipcMain.handle(IpcChannels.bookmarksImportFile, async () => {
    if (!mainWindow) return {}
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import bookmarks',
      properties: ['openFile'],
      filters: [{ name: 'Bookmarks', extensions: ['html', 'htm', 'json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return {}
    try {
      return { text: readFileSyncUtf8(result.filePaths[0]) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not read that file' }
    }
  })

  ipcMain.handle(IpcChannels.windowNew, () => {
    createMainWindow()
    return true
  })

  // Source control (12.3). Driven by the user's own clicks, so unlike the
  // agent's tools these are not routed through the policy engine.

  // Language servers (12.2). The workspace is the server's cwd, so a server is
  // only useful once a workspace is open — starting without one is refused
  // rather than pointed at the app's own directory.

  ipcMain.handle(IpcChannels.extLoad, () => loadExtensionDialog(activeProfile().id))
  ipcMain.handle(IpcChannels.extLoadPacked, () => loadPackedExtension(activeProfile().id))
  ipcMain.handle(IpcChannels.extLoadPath, (_e, path: unknown) => {
    const p = str(path)
    return p ? loadExtensionFromPath(p, activeProfile().id) : { error: 'bad arguments' }
  })
  ipcMain.handle(IpcChannels.extList, () => listExtensions(activeProfile().id))
  ipcMain.handle(IpcChannels.extRemove, (_e, id: unknown) => {
    const s = str(id)
    if (s) removeExtension(s, activeProfile().id)
  })

  ipcMain.handle(IpcChannels.proxyStatus, () => getEmbedProxyStatus())
  ipcMain.handle(IpcChannels.proxySetEnabled, (_e, enabled: unknown) =>
    setEmbedProxyEnabled(enabled === true)
  )

  ipcMain.handle(IpcChannels.downloadsList, () => listDownloads())
  ipcMain.handle(IpcChannels.downloadsShow, (_e, id: unknown) => {
    const s = str(id)
    if (s) showDownload(s)
  })
  ipcMain.handle(IpcChannels.downloadsClear, () => clearDownloads())

  ipcMain.handle(
    IpcChannels.permissionRespond,
    (_e, id: unknown, allow: unknown, remember: unknown) => {
      const s = str(id)
      if (s) respondToPermission(s, allow === true, remember === true)
    }
  )

  // Expose every webdeck-core method registered above (currently the secrets
  // domain) over Electron IPC. As more domains migrate off direct
  // ipcMain.handle calls, they join this single bind — and swapping the
  // transport is all it takes to serve them from the Chromium fork instead.
  core.bind(electronTransport)
}

// Hardware acceleration can only be turned off before the app is ready, so
// this runs at module scope rather than inside whenReady. The store owns the
// decision (pure); the shell owns the Electron call.
if (shouldDisableHardwareAcceleration()) app.disableHardwareAcceleration()

app.whenReady().then(() => {
  // Configure the profile sessions first, then push settings so spellcheck and
  // Do-Not-Track land on the sessions tabs actually use.
  initProfileSessions()
  initAppSettings()
  registerIpcHandlers()
  initAgents()
  initSync() // after sections are registered in registerIpcHandlers()

  if (process.env.AGWEB_WORKSPACE) {
    const workspace = openWorkspacePath(process.env.AGWEB_WORKSPACE)
    if (workspace) watchWorkspace(workspace.path)
    // Test seam, alongside AGWEB_WORKSPACE: pre-grant extra roots (3B.4) so
    // the smoke test can exercise the granted path, whose real entry point is
    // a native folder picker it cannot drive. This is launch configuration by
    // whoever starts the process — not an IPC or an agent-reachable surface,
    // so it does not widen what a page or a tool call can do.
    for (const path of (process.env.AGWEB_EXTRA_ROOTS ?? '').split(':').filter(Boolean)) {
      addWorkspaceRoot(path)
    }
  }

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  disposeAllTerminals()
  void stopDevServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void stopDevServer()
  stopSlideServer()
  stopAllLanguageServers()
  stopDebugSession()
})
