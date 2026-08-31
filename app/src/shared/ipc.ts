/**
 * Typed IPC contract shared by main, preload, and renderer.
 *
 * Every channel the renderer may invoke is declared here; the preload bridge
 * and the main-process handlers both compile against these types, so the two
 * sides cannot drift. Renderers never see Node APIs — only `window.agweb`.
 */

export interface WorkspaceInfo {
  path: string
  name: string
}

export interface RecentProject {
  path: string
  name: string
  lastOpenedAt: string
}

export type ThemeSource = 'system' | 'light' | 'dark'

/** The Electron-level settings, as opposed to the editor's. */
export interface AppSettings {
  hardwareAcceleration: boolean
  spellcheck: boolean
  spellcheckLanguages: string[]
  askForPermissions: boolean
  doNotTrack: boolean
  restoreTabs: boolean
  downloadPath: string
  askWhereToSave: boolean
  /** Search-engine id (see SEARCH_ENGINES) used for address-bar queries. */
  searchEngine: string
}

/** The search engines the address bar can use. `%s` is the query slot. */
export interface SearchEngine {
  id: string
  name: string
  template: string
}
export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  { id: 'brave', name: 'Brave', template: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/sp/search?query=%s' },
  { id: 'ecosia', name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s' }
]

/** Build a search URL for a query using the given engine id (falls back to the first). */
export function searchUrlFor(engineId: string, query: string): string {
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]
  return engine.template.replace('%s', encodeURIComponent(query))
}

export type ClearableData = 'cache' | 'cookies' | 'storage' | 'history'

/** LLM providers whose API keys the shell can store in the OS keychain. */
export type AiProvider = 'anthropic' | 'openai' | 'gemini'
/** A browser profile — Chrome's "person": an isolated, persistent session. */
export interface Profile {
  id: string
  name: string
  color: string
}
export interface ProfilesState {
  profiles: Profile[]
  activeId: string
}

/** Where API keys come from: WebDeck's encrypted store, or your password manager. */
export type SecretSourceMode = 'stored' | 'command'

export interface SecretSourceConfig {
  mode: SecretSourceMode
  /** Per-provider command, e.g. `op read op://Private/anthropic/key`. */
  commands: Record<string, string>
}

export interface SecretsStatus {
  /** True when the OS keychain is usable; false means keys cannot be saved. */
  encryptionAvailable: boolean
  configured: Record<AiProvider, boolean>
  /** The active source. In `command` mode WebDeck stores no key at all. */
  source: SecretSourceConfig
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  platform: string
}

/** Screen-space rectangle in device-independent pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Live navigation state of one embedded browser view, pushed to the renderer. */
export interface BrowserTabState {
  tabId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** The page's favicon as a data: URL (fetched in main; remote URLs are
   *  blocked by the renderer CSP). Absent until one loads. */
  favicon?: string
  /** Set when the last navigation failed, so the shell can say why rather
   *  than leaving the user looking at a blank view. */
  loadError?: { code: number; description: string; url: string }
}

/** An unpacked Chrome extension loaded into the browser session. */
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  path: string
}

/** The dev-preview embed proxy: strips frame-busting headers when enabled. */
export interface EmbedProxyStatus {
  enabled: boolean
  /** Origin patterns the header rewrite applies to (dev origins only). */
  allowlist: string[]
}

/** One download in the browser session, streamed to the renderer as it runs. */
export interface DownloadInfo {
  id: string
  filename: string
  url: string
  path: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
}

/** A web permission request awaiting the user's decision. */
export interface PermissionRequestInfo {
  id: string
  origin: string
  permission: string
}

/**
 * Permission policy (Phase 9): the gate for agent-driven actions.
 *
 * Ordered by how much the agent may do without asking. `autonomous` is the top
 * rung — nothing is confirmed, everything is audited — and it exists because
 * `agent` still stops to confirm navigation to any host outside the allowlist,
 * which is not autonomy when the task is "go and find out".
 *
 * It matters most in combination with the agent using the user's own browser
 * session: under `autonomous` the agent acts as the user with no interruption,
 * so the audit log is the only record of what was done in their name.
 */
export type PermissionMode = 'secure' | 'review' | 'agent' | 'autonomous' | 'custom'

/**
 * Which browser the agent drives.
 *
 * `session` is the user's own browser: real tabs in their window, their cookies
 * and logins, watched live — the agent acting as them, which is the point.
 * `isolated` is a throwaway profile with no ambient authority, for work on
 * pages that are not trusted (scraping something unknown, testing a build).
 */
export type AgentBrowserMode = 'session' | 'isolated'
export type PolicyActionKind = 'file_write' | 'command' | 'browser_navigate'
export type PolicyDecision = 'allow' | 'confirm' | 'deny'

/** Custom-mode rules: per-kind decisions plus a navigation host allowlist. */
export interface CustomPolicyRules {
  fileWrites: PolicyDecision
  commands: PolicyDecision
  /** Applied to non-local hosts not covered by allowedHosts. */
  navigation: PolicyDecision
  /** Hosts (and their subdomains) agents may navigate to without asking. */
  allowedHosts: string[]
}

/**
 * A standing decision for one site, made when the user answered a prompt with
 * "always" — or added it by hand.
 *
 * Per SITE, deliberately. The old "always" answer granted the whole action kind
 * for the rest of the session, so approving one navigation let the agent go
 * anywhere. A grant should be no broader than the thing the user was looking at
 * when they gave it.
 */
export interface SitePermission {
  /** Host the decision covers, subdomains included. */
  host: string
  decision: 'allow' | 'deny'
  /** ISO timestamp — so the UI can show and prune stale grants. */
  grantedAt: string
}

export interface PolicyStatus {
  mode: PermissionMode
  custom: CustomPolicyRules
  /** Standing per-site decisions. Outrank the mode in both directions. */
  sites: SitePermission[]
  /**
   * Ask before the agent acts on a high-consequence site, even under full
   * autonomy. On by default. The built-in list is a seed, not coverage — see
   * SENSITIVE_HOSTS in policy.ts.
   */
  blockSensitiveSites: boolean
}

/** A gated agent action waiting on the user's confirmation. */
export interface PolicyPromptInfo {
  id: string
  kind: PolicyActionKind
  detail: string
  sessionId: string
}

/** A denied agent action, surfaced to the user so a silent block isn't invisible. */
export interface PolicyDeniedInfo {
  kind: PolicyActionKind
  detail: string
  /** True when the user denied a prompt; false for an automatic policy deny. */
  byUser: boolean
}

/** The workspace dev server driven by the Preview block (Phase 4). */
export interface DevServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  /** How the server runs: a package.json script, or the built-in static server. */
  mode: 'script' | 'static'
  /** The package.json dev script that would run in script mode, if any. */
  script: { name: string; command: string } | null
  /** Health-checked base URL once running. */
  url: string | null
  /** Recent output lines, newest last — surfaced on errors. */
  logTail: string[]
}

/** Channels the renderer invokes (request/response). */
export const IpcChannels = {
  appInfo: 'app:info',
  workspaceOpen: 'workspace:open',
  workspaceOpenPath: 'workspace:open-path',
  workspaceCurrent: 'workspace:current',
  workspaceRecent: 'workspace:recent',
  workspaceRoots: 'workspace:roots',
  workspaceAddRoot: 'workspace:add-root',
  workspaceRemoveRoot: 'workspace:remove-root',
  themeSet: 'theme:set',
  browserCreate: 'browser:create',
  browserDestroy: 'browser:destroy',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserStop: 'browser:stop',
  browserSetBounds: 'browser:set-bounds',
  browserSetVisible: 'browser:set-visible',
  browserSetCornerRadius: 'browser:set-corner-radius',
  browserDevTools: 'browser:devtools',
  browserFind: 'browser:find',
  browserFindStop: 'browser:find-stop',
  browserZoom: 'browser:zoom',
  browserPrint: 'browser:print',
  appSettingsRead: 'app-settings:read',
  appSettingsReadSync: 'app-settings:read-sync',
  appSettingsWrite: 'app-settings:write',
  appSettingsClearData: 'app-settings:clear-data',
  appSettingsChooseDownloadDir: 'app-settings:choose-download-dir',
  secretsList: 'secrets:list',
  secretsSet: 'secrets:set',
  secretsClear: 'secrets:clear',
  secretsSetSource: 'secrets:set-source',
  profilesList: 'profiles:list',
  profilesSetActive: 'profiles:set-active',
  profilesCreate: 'profiles:create',
  profilesRemove: 'profiles:remove',
  profilesGoogleStatus: 'profiles:google-status',
  bookmarksImportFile: 'bookmarks:import-file',
  windowNew: 'window:new',
  deckOpen: 'deck:open',
  deckClose: 'deck:close',
  deckFocus: 'deck:focus',
  floatSync: 'float:sync',
  shellBroadcast: 'shell:broadcast',
  fsList: 'fs:list',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsCreate: 'fs:create',
  fsRename: 'fs:rename',
  fsDelete: 'fs:delete',
  dialogConfirm: 'dialog:confirm',
  dialogPickPaths: 'dialog:pick-paths',
  termCreate: 'term:create',
  termInput: 'term:input',
  termResize: 'term:resize',
  termDispose: 'term:dispose',
  termStop: 'term:stop',
  termAttach: 'term:attach',
  searchQuery: 'search:query',
  exportHtml: 'export:html',
  exportPdf: 'export:pdf',
  exportCapture: 'export:capture',
  agentStart: 'agent:start',
  agentApprove: 'agent:approve',
  agentReject: 'agent:reject',
  agentStop: 'agent:stop',
  agentList: 'agent:list',
  agentKeyStatus: 'agent:key-status',
  agentSetKey: 'agent:set-key',
  agentSetModel: 'agent:set-model',
  agentOpenReport: 'agent:open-report',
  agentClearFinished: 'agent:clear-finished',
  debugStart: 'debug:start',
  debugSend: 'debug:send',
  debugStop: 'debug:stop',
  debugAttachChild: 'debug:attach-child',
  debugAvailable: 'debug:available',
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  settingsImport: 'settings:import',
  taskList: 'task:list',
  taskRun: 'task:run',
  taskStop: 'task:stop',
  taskRuns: 'task:runs',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  gitBranches: 'git:branches',
  gitCheckout: 'git:checkout',
  gitBlame: 'git:blame',
  lspStart: 'lsp:start',
  lspSend: 'lsp:send',
  lspStop: 'lsp:stop',
  agentRename: 'agent:rename',
  agentDelete: 'agent:delete',
  agentExport: 'agent:export',
  agentUpdatePlan: 'agent:update-plan',
  agentResume: 'agent:resume',
  extLoad: 'ext:load',
  extLoadPacked: 'ext:load-packed',
  extLoadPath: 'ext:load-path',
  extList: 'ext:list',
  extRemove: 'ext:remove',
  proxyStatus: 'proxy:status',
  proxySetEnabled: 'proxy:set-enabled',
  downloadsList: 'downloads:list',
  downloadsShow: 'downloads:show',
  downloadsClear: 'downloads:clear',
  permissionRespond: 'permission:respond',
  devServerStart: 'devserver:start',
  devServerStop: 'devserver:stop',
  devServerStatus: 'devserver:status',
  slidesOpen: 'slides:open',
  policyGet: 'policy:get',
  policySetMode: 'policy:set-mode',
  policySetCustom: 'policy:set-custom',
  policySetSite: 'policy:set-site',
  policyClearSite: 'policy:clear-site',
  policySetSensitive: 'policy:set-sensitive',
  policyRespond: 'policy:respond',
  syncStatus: 'sync:status',
  syncChooseFile: 'sync:choose-file',
  syncSetEnabled: 'sync:set-enabled',
  syncPushNow: 'sync:push-now',
  syncPullNow: 'sync:pull-now'
} as const

/** One project-search match. */
export interface SearchHit {
  path: string
  line: number
  text: string
}

/** Events pushed from main to the renderer. */
export const IpcEvents = {
  workspaceChanged: 'event:workspace-changed',
  browserState: 'event:browser-state',
  browserOpenTab: 'event:browser-open-tab',
  browserFindResult: 'event:browser-find-result',
  browserAdoptTab: 'event:browser-adopt-tab',
  shellSync: 'event:shell-sync',
  requestSync: 'event:request-sync',
  deckWindowClosed: 'event:deck-window-closed',
  floatWindowClosed: 'event:float-window-closed',
  fsChanged: 'event:fs-changed',
  termData: 'event:term-data',
  termExit: 'event:term-exit',
  agentUpdate: 'event:agent-update',
  taskUpdate: 'event:task-update',
  debugMessage: 'event:debug-message',
  debugExit: 'event:debug-exit',
  lspMessage: 'event:lsp-message',
  lspExit: 'event:lsp-exit',
  agentSessionsReset: 'event:agent-sessions-reset',
  downloadUpdate: 'event:download-update',
  permissionRequest: 'event:permission-request',
  devServerUpdate: 'event:devserver-update',
  policyPrompt: 'event:policy-prompt',
  policyChanged: 'event:policy-changed',
  policyDenied: 'event:policy-denied',
  openDoc: 'event:open-doc',
  shellShortcut: 'event:shell-shortcut',
  terminalAdopt: 'event:terminal-adopt',
  syncStatusChanged: 'event:sync-status',
  syncPulled: 'event:sync-pulled',
  themeChanged: 'event:theme-changed'
} as const

/** WebDeck Sync (settings sync via a local-first file) status for the UI. */
export interface SyncStatus {
  /** Whether auto-sync is on (requires a chosen file). */
  enabled: boolean
  /** Absolute path of the sync document, or null if none chosen yet. */
  filePath: string | null
  /** Last successful push/pull, ISO string, or null. */
  lastSyncedAt: string | null
  /** Last error message, or null. */
  error: string | null
  /** Section keys currently participating (theme, settings, policy, model…). */
  sections: string[]
}

/** File types the Document Studio renders as styled documents. Shared so main
 *  (browser navigation interception) and the renderer agree on what a doc is. */
export const DOC_EXTENSIONS = new Set([
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'toml',
  'csv',
  'tsv'
])

export function isDocFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return DOC_EXTENSIONS.has(ext)
}

/** *.slides.md files render as Reveal.js decks instead of Document Studio. */
export function isSlidesFile(path: string): boolean {
  return /\.slides\.md$/i.test(path)
}

export interface FsEntry {
  name: string
  kind: 'file' | 'dir'
}

/** The API surface exposed on `window.agweb` by the preload bridge. */
/**
 * What the *host* provides, as opposed to what WebDeck draws itself.
 *
 * Electron gives WebDeck an empty window, so the app draws its own browser
 * chrome — tab strip, address bar, downloads, profiles, extensions, zoom, find.
 * The Chromium fork is already a browser: it owns all of that natively, and the
 * WebDeck UI is a page inside one of its tabs.
 *
 * The renderer needs to know which it is on. Papering over the difference with
 * benign stubs was the wrong instinct: it turns a missing capability into a
 * control that looks enabled and silently does nothing, which is worse than one
 * that isn't there. Components read these flags and render accordingly.
 */
export interface HostCapabilities {
  /** 'electron' draws its own browser chrome; 'chromium' is inside a real browser. */
  kind: 'electron' | 'chromium'
  /** The host owns tabs, navigation and the address bar. */
  ownsBrowserChrome: boolean
  /** The host owns downloads, profiles, extensions, bookmarks, zoom and find. */
  ownsBrowserFeatures: boolean
  /** The host can open additional OS windows (detached deck, floating blocks). */
  canOpenWindows: boolean
  /** A native file/folder picker is reachable. */
  canPickPaths: boolean
  /** Export to HTML/PDF/PNG is available. */
  canExport: boolean
}

export interface AgwebApi {
  /** What this host provides. Read it before rendering host-owned controls. */
  host: HostCapabilities

  getAppInfo(): Promise<AppInfo>
  /** Electron-level application settings. */
  appSettings: {
    read(): Promise<AppSettings>
    /** Synchronous read for boot-time decisions (e.g. tab restore). */
    readSync(): AppSettings
    write(patch: Partial<AppSettings>): Promise<AppSettings>
    clearData(kinds: ClearableData[]): Promise<void>
    /** Open a folder picker for the download location; returns updated settings. */
    chooseDownloadDir(): Promise<AppSettings>
  }
  /**
   * Provider API keys. The renderer can only set, clear, and ask which are
   * configured — the plaintext key never crosses back over the bridge.
   */
  secrets: {
    list(): Promise<SecretsStatus>
    set(provider: AiProvider, key: string): Promise<boolean>
    clear(provider: AiProvider): Promise<boolean>
    /** Choose where keys come from: WebDeck's store, or a password-manager command. */
    setSource(config: Partial<SecretSourceConfig>): Promise<SecretSourceConfig>
  }
  /** Browser profiles, for keeping separate signed-in accounts. */
  profiles: {
    list(): Promise<ProfilesState>
    setActive(id: string): Promise<ProfilesState>
    create(name: string): Promise<ProfilesState>
    remove(id: string): Promise<ProfilesState>
    /** Which profiles hold a signed-in Google account, keyed by profile id. */
    googleStatus(): Promise<Record<string, boolean>>
  }
  /** Read a bookmarks export file the user picks (HTML or JSON) as text. */
  bookmarks: {
    importFile(): Promise<{ text?: string; error?: string }>
  }
  /** Show a folder picker and open the chosen workspace. Null if cancelled. */
  openWorkspace(): Promise<WorkspaceInfo | null>
  /** Open a known path (e.g. from the recent-projects list). */
  openWorkspacePath(path: string): Promise<WorkspaceInfo | null>
  getCurrentWorkspace(): Promise<WorkspaceInfo | null>
  getRecentProjects(): Promise<RecentProject[]>
  /** Keep Electron's nativeTheme in sync with the renderer's choice. */
  setTheme(source: ThemeSource): Promise<void>
  onWorkspaceChanged(listener: (workspace: WorkspaceInfo) => void): () => void
  /**
   * Folders this session may touch, primary first (task 3B.4). Additional
   * roots are granted by the user through a picker and last only for the
   * session — they are never restored on launch.
   */
  workspaceRoots(): Promise<WorkspaceInfo[]>
  /** Show a picker and grant the chosen folder. Returns the new root list. */
  /**
   * Grant another folder to this session.
   *
   * A path is required on a host with no native folder picker; Electron opens
   * a picker when none is given.
   */
  addWorkspaceRoot(path?: string): Promise<WorkspaceInfo[]>
  removeWorkspaceRoot(path: string): Promise<WorkspaceInfo[]>

  /** Embedded Chromium browser views, keyed by the renderer's tab id. */
  browser: {
    create(tabId: string): Promise<void>
    destroy(tabId: string): Promise<void>
    navigate(tabId: string, url: string): Promise<void>
    back(tabId: string): Promise<void>
    forward(tabId: string): Promise<void>
    reload(tabId: string, ignoreCache?: boolean): Promise<void>
    stop(tabId: string): Promise<void>
    /** Position the view over the renderer's content area. */
    setBounds(tabId: string, rect: Rect): Promise<void>
    setVisible(tabId: string, visible: boolean): Promise<void>
    /** Round the native view's corners to match the stage frame (0 = square). */
    setCornerRadius(tabId: string, radius: number): Promise<void>
    openDevTools(tabId: string): Promise<void>
    /** Find in page; `next` advances through matches. */
    find(tabId: string, query: string, next: boolean): Promise<void>
    findStop(tabId: string): Promise<void>
    /** Set (or read, with no level) page zoom. Returns the applied level. */
    zoom(tabId: string, level?: number): Promise<number>
    /** Print the page itself — the shell renderer cannot see it to print it. */
    print(tabId: string): Promise<boolean>
    /** Match counts for the find bar. */
    onFindResult(
      listener: (result: { tabId: string; matches: number; active: number }) => void
    ): () => void
    onState(listener: (state: BrowserTabState) => void): () => void
    /** Fired when a page requests a new window (target=_blank etc.). */
    onOpenTab(listener: (url: string) => void): () => void
    /** An agent created a browser view in main; adopt it as a real tab. */
    onAdoptTab(listener: (tabId: string, url: string) => void): () => void
    /** A `file:` navigation to a workspace doc — open it in Document Studio. */
    onOpenDoc(listener: (path: string) => void): () => void
  }

  /** Multi-window deck: the detached IDE window, float windows, state sync. */
  windows: {
    /** A second full shell window, with its own tabs and deck. */
    newWindow(): Promise<boolean>
    openDeck(): Promise<void>
    closeDeck(): Promise<void>
    focusDeck(): Promise<void>
    /** Reconcile float windows to exactly these floating group ids. */
    syncFloats(groupIds: string[]): Promise<void>
    /** Mirror the deck layout slice to every other window. */
    broadcastState(state: import('./deck').DeckSyncState): Promise<void>
    onStateSync(listener: (state: import('./deck').DeckSyncState) => void): () => void
    /** Main window only: another window booted and needs the current state. */
    onRequestSync(listener: () => void): () => void
    /** The detached deck window was closed (by Dock back or the OS). */
    onDeckClosed(listener: () => void): () => void
    /** A float window was closed natively (title bar) — dock its group back. */
    onFloatClosed(listener: (groupId: string) => void): () => void
  }

  /** Workspace-scoped filesystem (paths relative to the open workspace). */
  fs: {
    list(rel: string): Promise<FsEntry[]>
    read(
      rel: string
    ): Promise<{ content?: string; error?: string; truncated?: boolean; bytes?: number }>
    write(rel: string, content: string): Promise<{ error?: string }>
    create(rel: string, kind: 'file' | 'dir'): Promise<{ error?: string }>
    rename(fromRel: string, toRel: string): Promise<{ error?: string }>
    remove(rel: string): Promise<{ error?: string }>
    onChanged(listener: () => void): () => void
  }

  /** Native confirm dialog (window.confirm is unavailable in Electron). */
  confirm(message: string): Promise<boolean>

  /** Native picker for composer attachments. Returns workspace-relative paths;
   *  anything chosen outside the workspace is dropped. */
  pickPaths(mode: 'file' | 'dir' | 'image'): Promise<string[]>

  /** Project-wide text search (ripgrep when available, Node fallback). */
  search(query: string): Promise<SearchHit[]>

  /** Document Studio exports; empty result = user cancelled the dialog. */
  exports: {
    html(html: string, suggestedName: string): Promise<{ path?: string; error?: string }>
    pdf(html: string, suggestedName: string): Promise<{ path?: string; error?: string }>
    /** Capture a region of this window (the stage) as a PNG. */
    capture(rect: Rect, suggestedName: string): Promise<{ path?: string; error?: string }>
  }

  /** Claude-powered agent sessions: plan → approve → execute in the workspace. */
  agents: {
    /** Start planning a task; resolves to the new session id. Attachments are
     *  passed to the model as explicit, named context. */
    start(task: string, attachments?: import('./agents').AgentAttachment[]): Promise<string>
    approve(id: string): Promise<void>
    reject(id: string): Promise<void>
    stop(id: string): Promise<void>
    /** Replace the plan while it awaits approval (6.4). */
    updatePlan(id: string, steps: import('./agents').PlanStep[]): Promise<void>
    /** Continue a session an app restart interrupted (6.7). */
    resume(id: string): Promise<void>
    list(): Promise<import('./agents').AgentSessionInfo[]>
    keyStatus(): Promise<import('./agents').AgentKeyStatus>
    setKey(key: string): Promise<import('./agents').AgentKeyStatus>
    /** Choose the Claude model the agent runs. */
    setModel(model: string): Promise<import('./agents').AgentKeyStatus>
    /** Open a finished session's execution report in a browser tab. */
    openReport(id: string): Promise<void>
    /** Remove every finished session and its stored artifacts. */
    clearFinished(): Promise<void>
    /** Rename a conversation. The agent still works from the original task. */
    rename(id: string, title: string): Promise<void>
    /** Delete one conversation and its artifacts. */
    remove(id: string): Promise<void>
    /** Write the transcript to the session's artifact directory. */
    export(id: string, format: 'md' | 'json'): Promise<{ path?: string; error?: string }>
    /** Fired whenever any session's plan, log, or status changes. */
    onUpdate(listener: (session: import('./agents').AgentSessionInfo) => void): () => void
    /** Fired after bulk removal: the authoritative remaining session list. */
    onReset(listener: (sessions: import('./agents').AgentSessionInfo[]) => void): () => void
  }

  /**
   * Debugging over DAP (task 12.4). The adapter is js-debug, vendored at
   * install; main owns the process and the socket, the renderer speaks DAP.
   */
  debug: {
    /** False when the adapter was not vendored (offline install). */
    available(): Promise<boolean>
    start(): Promise<{ error?: string }>
    /** Open a child connection for a `startDebugging` reverse request. */
    attachChild(sessionId: string): Promise<{ error?: string }>
    send(sessionId: string, message: unknown): void
    stop(): Promise<void>
    /** Adapter-to-client DAP messages, tagged with their session. */
    onMessage(listener: (payload: { sessionId: string; message: unknown }) => void): () => void
    /** The adapter exited — the session is over. */
    onExit(listener: () => void): () => void
  }

  /**
   * Settings and keybindings (task 12.6). Documents are exchanged as text so
   * the user's own JSON — comments included — survives a round trip.
   */
  settings: {
    read(): Promise<{ user: string; workspace: string; keybindings: string }>
    write(scope: 'user' | 'workspace' | 'keybindings', text: string): Promise<{ error?: string }>
    /** Pick an existing VS Code settings.json / keybindings.json and read it. */
    import(): Promise<{ text?: string; error?: string }>
  }

  /** package.json scripts and tasks.json entries (task 12.5). */
  tasks: {
    list(): Promise<import('./tasks').TaskDefinition[]>
    /** Starts the task and returns as soon as its terminal exists. */
    run(name: string): Promise<import('./tasks').TaskRun>
    stop(name: string): Promise<void>
    runs(): Promise<import('./tasks').TaskRun[]>
    /** Fired when a run starts and again when it exits with its problems. */
    onUpdate(listener: (run: import('./tasks').TaskRun) => void): () => void
  }

  /** Source control over the system `git` (task 12.3). */
  git: {
    status(): Promise<import('./git').GitStatus>
    /** Both sides of one file's change; `staged` picks HEAD→index over index→worktree. */
    diff(path: string, staged: boolean): Promise<import('./git').GitFileDiff>
    stage(paths: string[]): Promise<{ error?: string }>
    unstage(paths: string[]): Promise<{ error?: string }>
    commit(message: string): Promise<{ error?: string }>
    branches(): Promise<{ current: string; branches: string[] }>
    checkout(branch: string): Promise<{ error?: string }>
    blame(path: string): Promise<{ lines: import('./git').GitBlameLine[]; error?: string }>
  }

  /**
   * Language servers (task 12.2). The renderer speaks LSP; main owns the child
   * process and the stdio framing. `unknown` is the message type here because
   * the JSON-RPC shapes live in the renderer's language client, and the bridge
   * only forwards them.
   */
  lsp: {
    /** Start a server for a language id; a no-op if it is already running. */
    start(id: string): Promise<{ error?: string }>
    /** Forward one client message to the server. */
    send(id: string, message: unknown): void
    stop(id: string): Promise<void>
    /** Server-to-client messages, tagged with the server they came from. */
    onMessage(listener: (id: string, message: unknown) => void): () => void
    /** The server process exited — the client should treat it as closed. */
    onExit(listener: (id: string) => void): () => void
  }

  /** Unpacked MV3 Chrome extensions in the browser session (see README limits). */
  extensions: {
    /** Show a directory picker and load the chosen unpacked extension. */
    load(): Promise<{ extension?: ExtensionInfo; error?: string }>
    /** Pick a packed .crx/.zip extension, extract it, and load it. */
    loadPacked(): Promise<{ extension?: ExtensionInfo; error?: string }>
    /** Load an unpacked extension from a known directory (tests, restores). */
    loadPath(path: string): Promise<{ extension?: ExtensionInfo; error?: string }>
    list(): Promise<ExtensionInfo[]>
    remove(id: string): Promise<void>
  }

  /** Dev-preview embed proxy: strips X-Frame-Options / frame-ancestors for
   *  allowlisted dev origins so local dev servers can be embedded. Off by
   *  default, never persisted — it must be re-enabled per run. */
  embedProxy: {
    status(): Promise<EmbedProxyStatus>
    setEnabled(enabled: boolean): Promise<EmbedProxyStatus>
  }

  /** Downloads from browser tabs, saved under the OS downloads directory. */
  downloads: {
    list(): Promise<DownloadInfo[]>
    /** Reveal a finished download in the OS file manager. */
    show(id: string): Promise<void>
    /** Drop finished/cancelled entries from the list. */
    clear(): Promise<void>
    onUpdate(listener: (download: DownloadInfo) => void): () => void
  }

  /** Web permission prompts (geolocation, notifications, media…). */
  permissions: {
    respond(id: string, allow: boolean, remember: boolean): Promise<void>
    onRequest(listener: (request: PermissionRequestInfo) => void): () => void
  }

  /** Workspace dev server for the Preview block: the detected package.json
   *  dev script, or a built-in static file server for plain sites. */
  devServer: {
    start(mode: 'script' | 'static'): Promise<DevServerStatus>
    stop(): Promise<DevServerStatus>
    status(): Promise<DevServerStatus>
    onUpdate(listener: (status: DevServerStatus) => void): () => void
  }

  /** Reveal.js slide decks: *.slides.md files render as presentations in a
   *  browser tab, live-reloading as the markdown changes on disk. */
  slides: {
    open(rel: string): Promise<{ url?: string; error?: string }>
  }

  /** Shell shortcuts pressed while a browser view had focus (P1-14). */
  onShellShortcut(listener: (combo: string) => void): () => void

  /** Permission policy: modes gate agent file writes, commands, navigation. */
  policy: {
    get(): Promise<PolicyStatus>
    setMode(mode: PermissionMode): Promise<PolicyStatus>
    setCustom(rules: CustomPolicyRules): Promise<PolicyStatus>
    /** Record a standing decision for one site (subdomains included). */
    setSite(host: string, decision: 'allow' | 'deny'): Promise<PolicyStatus>
    /** Forget a site's standing decision, returning it to the mode. */
    clearSite(host: string): Promise<PolicyStatus>
    /** Ask before acting on high-consequence sites, even under full autonomy. */
    setSensitive(enabled: boolean): Promise<PolicyStatus>
    /**
     * Answer a pending action prompt. For a navigation, `always` records a
     * standing decision for THAT SITE — not a blanket grant for the session.
     */
    respond(id: string, allow: boolean, always: boolean): Promise<void>
    onPrompt(listener: (prompt: PolicyPromptInfo) => void): () => void
    /** Policy mode/rules changed (possibly in another window). */
    onChanged(listener: (status: PolicyStatus) => void): () => void
    /** An agent action was denied — surface it so the block isn't silent. */
    onDenied(listener: (info: PolicyDeniedInfo) => void): () => void
  }

  /** WebDeck Sync: settings sync via a local-first file. */
  sync: {
    status(): Promise<SyncStatus>
    /** Open the native picker to choose/create the sync file; returns new status. */
    chooseFile(): Promise<SyncStatus>
    setEnabled(enabled: boolean): Promise<SyncStatus>
    pushNow(): Promise<SyncStatus>
    pullNow(): Promise<SyncStatus>
    onChanged(listener: (status: SyncStatus) => void): () => void
    /** A pull just applied newer settings — re-read anything cached in the UI. */
    onPulled(listener: () => void): () => void
  }

  /** A synced theme change arrived from another device — adopt it in the store. */
  onThemeChanged(listener: (theme: 'light' | 'dark') => void): () => void

  /** Terminal sessions, keyed by block id; they outlive renderer mounts. */
  terminal: {
    create(id: string, cols: number, rows: number): Promise<void>
    input(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    dispose(id: string): Promise<void>
    /** Kill the process but keep the session and its scrollback. */
    stop(id: string): Promise<void>
    attach(id: string): Promise<{ buffer: string; running: boolean }>
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, code: number) => void): () => void
    /** An agent started a command in its own pty; show it as a Terminal block. */
    onAdopt(listener: (id: string, title: string) => void): () => void
  }
}
