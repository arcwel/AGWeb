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
  removeWorkspaceRoot,
  workspaceRoots,
  getRecentProjects,
  openWorkspaceDialog,
  openWorkspacePath
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
import {
  createEntry,
  deleteEntry,
  listDir,
  readFile,
  renameEntry,
  watchWorkspace,
  writeFile
} from './fs'
import {
  attachTerminal,
  createTerminal,
  disposeAllTerminals,
  disposeTerminal,
  resizeTerminal,
  stopTerminal,
  writeTerminal
} from './terminal'
import { buildApplicationMenu } from './menu'
import {
  listProfiles,
  setActiveProfile,
  createProfile,
  removeProfile,
  clearBrowsingData,
  initProfileSessions
} from './profiles'
import { clearApiKey, isEncryptionAvailable, listConfiguredProviders, setApiKey } from './secrets'
import {
  applyPreReadySettings,
  initAppSettings,
  readAppSettings,
  writeAppSettings,
  type AppSettings,
  type ClearableData
} from './app-settings'
import { searchWorkspace } from './search'
import { exportCapture, exportHtml, exportPdf } from './export'
import { findInPage, getTabWebContents, getZoom, setZoom, stopFindInPage } from './browser'
import { listTaskRuns, listTasks, runTask, stopTask } from './tasks'
import {
  attachDebugChild,
  isDebuggerAvailable,
  sendToDebugAdapter,
  startDebugSession,
  stopDebugSession
} from './debug'
import {
  readUserKeybindings,
  readUserSettings,
  readWorkspaceSettings,
  writeUserKeybindings,
  writeUserSettings,
  writeWorkspaceSettings
} from './settings'
import {
  gitBlame,
  gitBranches,
  gitCheckout,
  gitCommit,
  gitFileDiff,
  gitStage,
  gitStatus,
  gitUnstage
} from './git'
import {
  sendToLanguageServer,
  startLanguageServer,
  stopAllLanguageServers,
  stopLanguageServer
} from './lsp'
import {
  approveAgentPlan,
  clearFinishedAgentSessions,
  deleteAgentSession,
  exportAgentSession,
  renameAgentSession,
  getAgentKeyStatus,
  initAgents,
  listAgentSessions,
  openAgentReport,
  rejectAgentPlan,
  resumeAgentTask,
  setAgentApiKey,
  startAgentTask,
  stopAgent,
  updateAgentPlan
} from './agent'
import type { AgentAttachment, PlanStep } from '@shared/agents'
import type { WorkspaceInfo } from '@shared/ipc'
import {
  listExtensions,
  loadExtensionDialog,
  loadExtensionFromPath,
  removeExtension,
  restoreExtensions
} from './extensions'
import { getEmbedProxyStatus, setEmbedProxyEnabled } from './embed-proxy'
import { clearDownloads, initDownloads, listDownloads, showDownload } from './downloads'
import { initPermissions, respondToPermission } from './permissions'
import { getDevServerStatus, initDevServers, startDevServer, stopDevServer } from './dev-servers'
import { openSlides, stopSlideServer } from './slides'
import {
  getPolicyStatus,
  initPolicy,
  respondToPolicyPrompt,
  setCustomRules,
  setPolicyMode
} from './policy'
import type { CustomPolicyRules, PermissionMode } from '@shared/ipc'

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
  void restoreExtensions()

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
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

  ipcMain.handle(IpcChannels.workspaceOpenPath, (_event, path: unknown) => {
    if (typeof path !== 'string') return null
    const workspace = openWorkspacePath(path)
    applyWorkspace(workspace)
    return workspace
  })

  // The native menu's Open Project Folder… goes through applyWorkspace, the
  // same path as the in-app control — a second way in, not a second
  // implementation.
  buildApplicationMenu({
    openWorkspace: () => {
      void openWorkspaceDialog().then(applyWorkspace)
    }
  })

  ipcMain.handle(IpcChannels.workspaceCurrent, () => getCurrentWorkspace())

  // Multi-root (3B.4). A root is granted only through this picker: there is no
  // path-taking variant, so nothing but a human choosing a folder can widen
  // what the app — or the agent inside it — can reach.
  ipcMain.handle(IpcChannels.workspaceRoots, () => workspaceRoots())
  ipcMain.handle(IpcChannels.workspaceAddRoot, async () => {
    if (!mainWindow) return workspaceRoots()
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Grant another folder to this session',
      properties: ['openDirectory']
    })
    if (canceled || !filePaths[0]) return workspaceRoots()
    const roots = addWorkspaceRoot(filePaths[0])
    broadcast(IpcEvents.fsChanged, null, null)
    return roots
  })
  ipcMain.handle(IpcChannels.workspaceRemoveRoot, (_e, path: unknown) => {
    const p = str(path)
    const roots = p ? removeWorkspaceRoot(p) : workspaceRoots()
    broadcast(IpcEvents.fsChanged, null, null)
    return roots
  })
  ipcMain.handle(IpcChannels.workspaceRecent, () => getRecentProjects())

  ipcMain.handle(IpcChannels.themeSet, (_event, source: unknown) => {
    if (source === 'system' || source === 'light' || source === 'dark') {
      nativeTheme.themeSource = source as ThemeSource
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
  // Path lists arrive over IPC as unknown; keep only the strings.
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  ipcMain.handle(IpcChannels.fsList, (_e, rel: unknown) => listDir(str(rel) ?? ''))
  ipcMain.handle(IpcChannels.fsRead, (_e, rel: unknown) => readFile(str(rel) ?? ''))
  ipcMain.handle(IpcChannels.fsWrite, (_e, rel: unknown, content: unknown) => {
    const r = str(rel)
    if (r === null || typeof content !== 'string') return { error: 'bad arguments' }
    return writeFile(r, content)
  })
  ipcMain.handle(IpcChannels.fsCreate, (_e, rel: unknown, kind: unknown) => {
    const r = str(rel)
    if (r === null || (kind !== 'file' && kind !== 'dir')) return { error: 'bad arguments' }
    return createEntry(r, kind)
  })
  ipcMain.handle(IpcChannels.fsRename, (_e, from: unknown, to: unknown) => {
    const f = str(from)
    const t = str(to)
    if (f === null || t === null) return { error: 'bad arguments' }
    return renameEntry(f, t)
  })
  ipcMain.handle(IpcChannels.fsDelete, (_e, rel: unknown) => {
    const r = str(rel)
    if (r === null) return { error: 'bad arguments' }
    return deleteEntry(r)
  })

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

  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback

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

  ipcMain.handle(IpcChannels.termCreate, (_e, id: unknown, cols: unknown, rows: unknown) => {
    const t = str(id)
    if (t) createTerminal(t, num(cols, 80), num(rows, 24))
  })
  ipcMain.handle(IpcChannels.termInput, (_e, id: unknown, data: unknown) => {
    const t = str(id)
    if (t && typeof data === 'string') writeTerminal(t, data)
  })
  ipcMain.handle(IpcChannels.termResize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    const t = str(id)
    if (t) resizeTerminal(t, num(cols, 80), num(rows, 24))
  })
  ipcMain.handle(IpcChannels.termDispose, (_e, id: unknown) => {
    const t = str(id)
    if (t) disposeTerminal(t)
  })
  ipcMain.handle(IpcChannels.termStop, (_e, id: unknown) => {
    const t = str(id)
    if (t) stopTerminal(t)
  })
  ipcMain.handle(IpcChannels.termAttach, (_e, id: unknown) => {
    const t = str(id)
    return t ? attachTerminal(t) : { buffer: '', running: false }
  })

  ipcMain.handle(IpcChannels.searchQuery, (_e, query: unknown) => {
    const q = str(query)
    return q ? searchWorkspace(q) : []
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

  ipcMain.handle(IpcChannels.agentStart, (_e, task: unknown, attachments: unknown) => {
    const t = str(task)?.trim()
    if (!t) throw new Error('empty task')
    const list = Array.isArray(attachments)
      ? (attachments as AgentAttachment[])
          .filter((a) => a && typeof a.path === 'string' && a.path.length > 0)
          .slice(0, 24)
          .map(
            (a) =>
              ({
                path: a.path.slice(0, 400),
                kind: a.kind === 'dir' ? 'dir' : a.kind === 'image' ? 'image' : 'file',
                pinned: a.pinned === true
              }) as AgentAttachment
          )
      : []
    return startAgentTask(t, list)
  })
  ipcMain.handle(IpcChannels.agentApprove, (_e, id: unknown) => {
    const s = str(id)
    if (s) approveAgentPlan(s)
  })
  ipcMain.handle(IpcChannels.agentReject, (_e, id: unknown) => {
    const s = str(id)
    if (s) rejectAgentPlan(s)
  })
  ipcMain.handle(IpcChannels.agentStop, (_e, id: unknown) => {
    const s = str(id)
    if (s) stopAgent(s)
  })
  ipcMain.handle(IpcChannels.agentUpdatePlan, (_e, id: unknown, steps: unknown) => {
    const s = str(id)
    if (s && Array.isArray(steps)) updateAgentPlan(s, steps as PlanStep[])
  })
  ipcMain.handle(IpcChannels.agentResume, (_e, id: unknown) => {
    const s = str(id)
    if (s) resumeAgentTask(s)
  })
  ipcMain.handle(IpcChannels.agentList, () => listAgentSessions())
  ipcMain.handle(IpcChannels.agentOpenReport, (_e, id: unknown) => {
    const s = str(id)
    return s ? openAgentReport(s) : undefined
  })
  ipcMain.handle(IpcChannels.agentClearFinished, () => {
    clearFinishedAgentSessions()
  })
  ipcMain.handle(IpcChannels.agentRename, (_e, id: unknown, title: unknown) => {
    const s = str(id)
    if (s) renameAgentSession(s, str(title) ?? '')
  })
  ipcMain.handle(IpcChannels.agentDelete, (_e, id: unknown) => {
    const s = str(id)
    if (s) deleteAgentSession(s)
  })
  ipcMain.handle(IpcChannels.agentExport, (_e, id: unknown, format: unknown) => {
    const s = str(id)
    if (!s) return { error: 'No such session.' }
    return exportAgentSession(s, format === 'json' ? 'json' : 'md')
  })
  // Debugging (12.4).
  ipcMain.handle(IpcChannels.debugAvailable, () => isDebuggerAvailable())
  ipcMain.handle(IpcChannels.debugStart, () => startDebugSession())
  ipcMain.handle(IpcChannels.debugAttachChild, (_e, sessionId: unknown) => {
    const id = str(sessionId)
    return id ? attachDebugChild(id) : { error: 'bad arguments' }
  })
  ipcMain.on(IpcChannels.debugSend, (_e, sessionId: unknown, message: unknown) => {
    const id = str(sessionId)
    if (id && message && typeof message === 'object') {
      sendToDebugAdapter(id, message as Parameters<typeof sendToDebugAdapter>[1])
    }
  })
  ipcMain.handle(IpcChannels.debugStop, () => stopDebugSession())

  // Settings and keybindings (12.6).
  ipcMain.handle(IpcChannels.settingsRead, async () => ({
    user: readUserSettings(),
    workspace: await readWorkspaceSettings(),
    keybindings: readUserKeybindings()
  }))
  ipcMain.handle(IpcChannels.settingsWrite, async (_e, scope: unknown, text: unknown) => {
    const body = str(text)
    if (body === null) return { error: 'bad arguments' }
    if (scope === 'workspace') return writeWorkspaceSettings(body)
    if (scope === 'keybindings') return writeUserKeybindings(body)
    return writeUserSettings(body)
  })
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
  ipcMain.handle(IpcChannels.taskList, () => listTasks())
  ipcMain.handle(IpcChannels.taskRun, (_e, name: unknown) => {
    const n = str(name)
    return n ? runTask(n) : { task: '', terminalId: '', problems: [], error: 'bad arguments' }
  })
  ipcMain.handle(IpcChannels.taskStop, (_e, name: unknown) => {
    const n = str(name)
    if (n) stopTask(n)
  })
  ipcMain.handle(IpcChannels.taskRuns, () => listTaskRuns())

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
  ipcMain.handle(IpcChannels.appSettingsRead, () => readAppSettings())
  // Synchronous variant for boot-time gates in the renderer (tab restore).
  ipcMain.on(IpcChannels.appSettingsReadSync, (event) => {
    event.returnValue = readAppSettings()
  })
  ipcMain.handle(IpcChannels.appSettingsWrite, (_e, patch: unknown) =>
    writeAppSettings((patch ?? {}) as Partial<AppSettings>)
  )
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

  ipcMain.handle(IpcChannels.secretsList, () => ({
    encryptionAvailable: isEncryptionAvailable(),
    configured: listConfiguredProviders()
  }))
  ipcMain.handle(IpcChannels.secretsSet, (_e, provider: unknown, key: unknown) =>
    setApiKey(provider, key)
  )
  ipcMain.handle(IpcChannels.secretsClear, (_e, provider: unknown) => clearApiKey(provider))

  ipcMain.handle(IpcChannels.profilesList, () => listProfiles())
  ipcMain.handle(IpcChannels.profilesSetActive, (_e, id: unknown) => setActiveProfile(id))
  ipcMain.handle(IpcChannels.profilesCreate, (_e, name: unknown) => createProfile(name))
  ipcMain.handle(IpcChannels.profilesRemove, (_e, id: unknown) => removeProfile(id))

  ipcMain.handle(IpcChannels.windowNew, () => {
    createMainWindow()
    return true
  })

  // Source control (12.3). Driven by the user's own clicks, so unlike the
  // agent's tools these are not routed through the policy engine.
  ipcMain.handle(IpcChannels.gitStatus, () => gitStatus())
  ipcMain.handle(IpcChannels.gitDiff, (_e, path: unknown, staged: unknown) => {
    const p = str(path)
    if (p === null) return { original: '', modified: '', error: 'bad arguments' }
    return gitFileDiff(p, staged === true)
  })
  ipcMain.handle(IpcChannels.gitStage, (_e, paths: unknown) => gitStage(strList(paths)))
  ipcMain.handle(IpcChannels.gitUnstage, (_e, paths: unknown) => gitUnstage(strList(paths)))
  ipcMain.handle(IpcChannels.gitCommit, (_e, message: unknown) => gitCommit(str(message) ?? ''))
  ipcMain.handle(IpcChannels.gitBranches, () => gitBranches())
  ipcMain.handle(IpcChannels.gitCheckout, (_e, branch: unknown) => gitCheckout(str(branch) ?? ''))
  ipcMain.handle(IpcChannels.gitBlame, (_e, path: unknown) => {
    const p = str(path)
    return p === null ? { lines: [], error: 'bad arguments' } : gitBlame(p)
  })

  // Language servers (12.2). The workspace is the server's cwd, so a server is
  // only useful once a workspace is open — starting without one is refused
  // rather than pointed at the app's own directory.
  ipcMain.handle(IpcChannels.lspStart, (_e, id: unknown) => {
    const s = str(id)
    if (!s) return { error: 'No language given.' }
    const workspace = getCurrentWorkspace()
    if (!workspace?.path) return { error: 'No workspace open.' }
    return startLanguageServer(s, workspace.path)
  })
  ipcMain.on(IpcChannels.lspSend, (_e, id: unknown, message: unknown) => {
    const s = str(id)
    if (s && message && typeof message === 'object') {
      sendToLanguageServer(s, message as Parameters<typeof sendToLanguageServer>[1])
    }
  })
  ipcMain.handle(IpcChannels.lspStop, (_e, id: unknown) => {
    const s = str(id)
    if (s) stopLanguageServer(s)
  })

  ipcMain.handle(IpcChannels.agentKeyStatus, () => getAgentKeyStatus())
  ipcMain.handle(IpcChannels.agentSetKey, (_e, key: unknown) => {
    setAgentApiKey(str(key) ?? '')
    return getAgentKeyStatus()
  })

  ipcMain.handle(IpcChannels.extLoad, () => loadExtensionDialog())
  ipcMain.handle(IpcChannels.extLoadPath, (_e, path: unknown) => {
    const p = str(path)
    return p ? loadExtensionFromPath(p) : { error: 'bad arguments' }
  })
  ipcMain.handle(IpcChannels.extList, () => listExtensions())
  ipcMain.handle(IpcChannels.extRemove, (_e, id: unknown) => {
    const s = str(id)
    if (s) removeExtension(s)
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

  ipcMain.handle(IpcChannels.devServerStart, (_e, mode: unknown) =>
    startDevServer(mode === 'script' ? 'script' : 'static')
  )
  ipcMain.handle(IpcChannels.devServerStop, () => stopDevServer())
  ipcMain.handle(IpcChannels.devServerStatus, () => getDevServerStatus())

  ipcMain.handle(IpcChannels.slidesOpen, (_e, rel: unknown) => {
    const r = str(rel)
    return r ? openSlides(r) : { error: 'bad arguments' }
  })

  ipcMain.handle(IpcChannels.policyGet, () => getPolicyStatus())
  ipcMain.handle(IpcChannels.policySetMode, (_e, mode: unknown) => {
    const valid: PermissionMode[] = ['secure', 'review', 'agent', 'custom']
    return valid.includes(mode as PermissionMode)
      ? setPolicyMode(mode as PermissionMode)
      : getPolicyStatus()
  })
  ipcMain.handle(IpcChannels.policySetCustom, (_e, rules: unknown) => {
    const r = rules as CustomPolicyRules
    const decisions = ['allow', 'confirm', 'deny']
    if (
      !r ||
      !decisions.includes(r.fileWrites) ||
      !decisions.includes(r.commands) ||
      !decisions.includes(r.navigation) ||
      !Array.isArray(r.allowedHosts) ||
      !r.allowedHosts.every((h) => typeof h === 'string')
    ) {
      return getPolicyStatus()
    }
    return setCustomRules({
      fileWrites: r.fileWrites,
      commands: r.commands,
      navigation: r.navigation,
      allowedHosts: r.allowedHosts.map((h) => h.trim()).filter(Boolean)
    })
  })
  ipcMain.handle(IpcChannels.policyRespond, (_e, id: unknown, allow: unknown, always: unknown) => {
    const s = str(id)
    if (s) respondToPolicyPrompt(s, allow === true, always === true)
  })
}

// Hardware acceleration can only be turned off before the app is ready, so
// this runs at module scope rather than inside whenReady.
applyPreReadySettings()

app.whenReady().then(() => {
  // Configure the profile sessions first, then push settings so spellcheck and
  // Do-Not-Track land on the sessions tabs actually use.
  initProfileSessions()
  initAppSettings()
  registerIpcHandlers()
  initAgents()

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
