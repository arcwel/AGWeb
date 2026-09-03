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

/**
 * The omnibox "Ask AI" feature (roadmap A1): a one-shot, streamed answer the
 * user gets inline under the address bar, without leaving the page they're on.
 *
 * Distinct from the Mission-Control agent sessions above — no plan, no tools,
 * no workspace writes. Just a grounded answer and the links it referenced.
 */

/** Page context handed to an ask so the model can ground "this page" questions. */
export interface AskContext {
  /** The active tab's URL, when it's a real page (not about:blank). */
  url?: string
  /** The active tab's title. */
  title?: string
}

/** One link the answer referenced, surfaced as a source row under the answer. */
export interface AskSource {
  title: string
  url: string
}

/** The settled result of an ask. Tokens stream separately via agentAskToken;
 *  this is the whole text plus the links it referenced, or an error string. */
export interface AskResult {
  text: string
  sources: AskSource[]
  error?: string
  /** Set when the user cancelled: the backend stream was aborted. The partial
   *  text already reached the renderer via token events, so `text` may be empty
   *  — the caller keeps what it received and settles into an idle state. */
  cancelled?: boolean
}

/**
 * Inline AI code edit (roadmap A3): the editor's Cursor-style ⌘I edit-a-selection.
 *
 * Like the omnibox ask, this is a one-shot streamed transform, not an agent
 * session — no plan, no tools, no workspace writes. The model is handed a code
 * selection plus an instruction and streams back ONLY the replacement code.
 * Tokens arrive on agentEditToken keyed by `editId`; this is the settled
 * replacement (fences stripped), or an error string the caller renders inline.
 */
export interface EditCodeResult {
  /** The proposed replacement code for the selection. Empty when `error` is set. */
  text: string
  error?: string
  /** Set when the user cancelled: the backend stream was aborted. The partial
   *  replacement already reached the renderer via token events; the caller
   *  settles into an idle state rather than surfacing an error. */
  cancelled?: boolean
}

/**
 * "Chat with this page" (roadmap A4): a one-shot, streamed answer about the
 * user's ACTIVE page. Like the omnibox ask this is deliberately NOT an agent
 * session — no plan, no tools, no workspace writes, no policy gate. The Page
 * Assistant block hands the model the page's visible text (read over the Mojo
 * Shell) plus the question, and the model answers using ONLY that text. Tokens
 * arrive on chatPageToken keyed by `chatId`; this is the settled answer, or an
 * error string the block renders inline.
 *
 * Distinct from the Mission-Control agent (which drives isolated agent tabs):
 * this reads the tab the user is looking at and never acts.
 */
export interface ChatPageResult {
  /** The settled answer in Markdown. Empty when `error` is set. */
  text: string
  error?: string
  /** Set when the user cancelled: the backend stream was aborted. The partial
   *  answer already reached the renderer via token events; the block settles
   *  into an idle state rather than surfacing an error. */
  cancelled?: boolean
}
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

/** An Open VSX search hit (task 12.8). */
export interface VsxExtension {
  /** "publisher.name" — the id the install call takes. */
  id: string
  namespace: string
  name: string
  version: string
  displayName: string
  description: string
  downloadCount: number
  verified: boolean
  icon?: string
}

/** An installed editor extension, as the core keeps it on disk. */
/**
 * The agent driving the editor (task 12.8): a request the main/core side pushes
 * to the shell, which owns VS Code's services, and the shell's answer.
 * `list` enumerates the commands that apply right now; `run` executes one.
 */
export interface EditorCommandRequest {
  id: string
  op: 'list' | 'run'
  /** `run`: the VS Code command id, e.g. `editor.action.formatDocument`. */
  command?: string
  args?: unknown[]
  /** `list`: substring filter on id/title. */
  query?: string
}

export interface EditorCommandInfo {
  id: string
  title: string
  /** The extension it comes from, when it is not built in. */
  source?: string
  shortcut?: string
}

export interface EditorCommandResponse {
  ok: boolean
  value?: unknown
  error?: string
}

export interface VsxInstalled {
  id: string
  /** Install directory name under editor-extensions/, used by vsx:read. */
  dir: string
  version: string
  displayName: string
  description: string
  /** The extension's package.json — VS Code's manifest, registered as-is. */
  manifest: Record<string, unknown>
  /** Every file in the extension, relative to its root. */
  files: string[]
}

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

/**
 * Git Graph (roadmap C9): one commit as returned by `git log --all`.
 *
 * `parents` drives the lane edges — the first parent continues a commit's lane,
 * any others are merge branches. `refs` is git's raw `%D` decoration
 * ("HEAD -> main, origin/main, tag: v1"), parsed into chips in the renderer.
 */
export interface GitCommit {
  hash: string
  short: string
  parents: string[]
  author: string
  /** Author time, epoch seconds (git `%at`). */
  timestamp: number
  /** Raw ref decoration (git `%D`); empty when the commit carries no ref. */
  refs: string
  subject: string
}

/** The whole graph, or a reason it could not be read. Degrades like GitStatus. */
export interface GitGraphResult {
  /** False when the workspace is not a git repository, or git is missing. */
  repository: boolean
  /** Newest first, capped at the requested limit. */
  commits: GitCommit[]
  error?: string
}

/**
 * One file a commit changed, as before/after blobs — the exact shape the Monaco
 * diff component (task 3.5) consumes, so click-to-view reuses that path.
 */
export interface GitCommitFile {
  path: string
  /** git name-status letter: A (added), M (modified), D (deleted). */
  status: string
  /** The file at the parent commit; empty for an added file. */
  original: string
  /** The file at this commit; empty for a deleted file. */
  modified: string
}

/** One commit's metadata and its changed files, for the commit-diff overlay. */
export interface GitCommitDetail {
  hash: string
  short: string
  author: string
  timestamp: number
  subject: string
  files: GitCommitFile[]
  /** Set when the commit touches more files than the per-commit cap. */
  truncated?: boolean
  error?: string
}

/**
 * REST client (roadmap C7): a request the core executes with Node's global
 * `fetch` (undici) and streams back.
 *
 * The request runs in the core, not the renderer, because `chrome://webdeck`
 * lives under a strict CSP: it cannot fetch arbitrary cross-origin URLs, set
 * arbitrary headers, or use arbitrary methods. The core has none of those
 * limits, so the block builds the request here and the core does the sending.
 *
 * `headers` is a flat name→value map — the block collapses its key/value rows
 * into one before sending, and the core hands the same shape straight to fetch.
 */
export interface RestRequest {
  /** GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS. Coerced/validated in the core. */
  method: string
  /** Absolute http/https URL; other schemes (file:, data:) are refused. */
  url: string
  headers: Record<string, string>
  /** Text or JSON body; ignored for methods that take none (GET/HEAD). */
  body?: string
}

/**
 * The settled result of a REST send. Never a rejection: a network failure,
 * timeout, or a bad URL comes back as `error` so the block renders it inline
 * rather than catching a throw.
 */
export interface RestResponse {
  status: number
  statusText: string
  /** Response headers, lower-cased names, as a flat map. */
  headers: Record<string, string>
  /** The response body as text (capped — see `truncated`). */
  body: string
  /** Wall-clock time from send to fully read, in milliseconds. */
  timeMs: number
  /** Bytes received on the wire (may exceed body length when truncated). */
  size: number
  /** Set when the body hit the size cap and was cut short. */
  truncated?: boolean
  /** Set when the request never produced a response (network, timeout, bad URL). */
  error?: string
}

/**
 * Database client (roadmap C8): the core runs SQL against a SQLite file (Node's
 * built-in node:sqlite) — always with parameterized statements, read-only by
 * default — and returns columns + rows. Never rejects: failures arrive as `error`.
 */
export interface DbQueryResult {
  columns: string[]
  rows: unknown[][]
  /** Rows returned (after the cap), for SELECT/PRAGMA. */
  rowCount: number
  /** Rows changed, for INSERT/UPDATE/DELETE. */
  rowsAffected: number
  timeMs: number
  /** Set when the result hit the row cap and was cut short. */
  truncated?: boolean
  error?: string
}

/** One schema object listed in the DB block's sidebar. */
export interface DbTable {
  name: string
  type: 'table' | 'view'
}

/**
 * Jupyter notebook (roadmap C10): the core connects to a running Jupyter Server
 * over its REST + kernel-WebSocket API and runs code cells for the Notebook block.
 *
 * The renderer's CSP (`chrome://webdeck`) forbids arbitrary cross-origin fetches
 * and sockets, so the core owns the connection: it validates the server, starts
 * and opens a kernel, and relays each cell's outputs back as `JupyterOutput`
 * events keyed by the execId the block minted. There is no `@jupyterlab/services`
 * dependency — the v5.3 messaging protocol is spoken directly (see
 * `src/core/domains/jupyter.ts`). Never rejects: failures arrive as `error` on a result.
 */

/** One kernel as listed by the server, or the one we started. */
export interface JupyterKernelInfo {
  id: string
  name: string
}

/** Result of validating a server URL + token — a GET of its kernel list. */
export interface JupyterConnectResult {
  ok: boolean
  kernels?: JupyterKernelInfo[]
  error?: string
}

/** Result of starting a kernel and opening its WebSocket. */
export interface JupyterStartResult {
  kernel?: JupyterKernelInfo
  error?: string
}

/**
 * Settled result of one `execute()`. Resolves when the kernel returns to idle;
 * the cell's outputs arrive separately as `JupyterOutput` events, so this only
 * signals completion (or a transport-level failure the block renders inline).
 */
export interface JupyterExecuteResult {
  error?: string
}

/**
 * The MIME bundle surfaced from an `execute_result` / `display_data` message.
 * Only the representations the block renders are carried; `text/html` is shown
 * as escaped text (never executed) to keep untrusted kernel output inert.
 */
export interface JupyterOutputData {
  'text/plain'?: string
  'image/png'?: string
  'text/html'?: string
}

/**
 * One rendered output from a running cell, streamed to the block and appended in
 * order. `done` is the terminal message for an execId (kernel back to idle), and
 * carries the cell's execution count when the kernel reported one.
 */
export type JupyterOutput =
  | { kind: 'stream'; name: string; text: string }
  | { kind: 'result'; data: JupyterOutputData }
  | { kind: 'error'; ename: string; evalue: string; traceback: string[] }
  | { kind: 'done'; executionCount?: number }

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
  // WebDeck split view (fork only, over the Mojo Shell): stage two tabs side by
  // side on the one shell backdrop. setSplit binds the two tabs; the secondary
  // stage rect is streamed separately. See SPLIT_VIEW_PLAN.md and webui/shell.ts.
  browserSetSplit: 'browser:set-split',
  browserSetSecondaryBounds: 'browser:set-secondary-bounds',
  // Toggle Picture-in-Picture for a tab (fork only, over the Mojo Shell).
  browserPictureInPicture: 'browser:picture-in-picture',
  // Read the active (staged) tab's rendered visible text over the Mojo Shell —
  // the "Chat with this page" assistant (roadmap A4) grounds on it. Fork-only;
  // see webui/shell.ts pageText facade and PageAssistantBlock.tsx.
  browserGetPageText: 'browser:get-page-text',
  // Browser-level Chromium preferences, reached over the Mojo Shell because a
  // WebDeck window blocks chrome://settings. Fork-only; see BrowserSettings.tsx
  // and BROWSER_PREFS_PLAN.md.
  browserGetCookieBlock: 'browser:get-cookie-block',
  browserSetCookieBlock: 'browser:set-cookie-block',
  browserGetDnt: 'browser:get-dnt',
  browserSetDnt: 'browser:set-dnt',
  browserGetHttpsOnly: 'browser:get-https-only',
  browserSetHttpsOnly: 'browser:set-https-only',
  browserGetPreload: 'browser:get-preload',
  browserSetPreload: 'browser:set-preload',
  browserGetAdblock: 'browser:get-adblock',
  browserSetAdblock: 'browser:set-adblock',
  browserGetAdblockCount: 'browser:get-adblock-count',
  browserClearData: 'browser:clear-browsing-data',
  browserDefaultStatus: 'browser:default-status',
  browserMakeDefault: 'browser:make-default',
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
  windowClosed: 'window:closed',
  shellRequestSync: 'shell:request-sync',
  deckOpen: 'deck:open',
  deckClose: 'deck:close',
  deckFocus: 'deck:focus',
  floatSync: 'float:sync',
  shellBroadcast: 'shell:broadcast',
  fsList: 'fs:list',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsWriteBase64: 'fs:write-base64',
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
  agentAsk: 'agent:ask',
  chatPage: 'chat:page',
  agentEditCode: 'agent:edit-code',
  // Abort an in-flight one-shot streamed call (ask/chatPage/editCode) by its id.
  // Registered via core.register, so the coverage boundary test treats it as
  // core-served — it must NOT be listed in HOST_OWNED/SHELL_OWNED.
  agentCancel: 'agent:cancel',
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
  gitLogGraph: 'git:log-graph',
  gitShow: 'git:show',
  restSend: 'rest:send',
  dbConnect: 'db:connect',
  dbQuery: 'db:query',
  dbTables: 'db:tables',
  dbClose: 'db:close',
  jupyterConnect: 'jupyter:connect',
  jupyterStartKernel: 'jupyter:start-kernel',
  jupyterExecute: 'jupyter:execute',
  jupyterInterrupt: 'jupyter:interrupt',
  jupyterDisconnect: 'jupyter:disconnect',
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
  // VS Code editor extensions from Open VSX (12.8) — distinct from ext:* above,
  // which is the browser's MV3 extensions.
  vsxSearch: 'vsx:search',
  vsxInstall: 'vsx:install',
  vsxUninstall: 'vsx:uninstall',
  vsxList: 'vsx:list',
  vsxRead: 'vsx:read',
  vsxHostOrigin: 'vsx:host-origin',
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
  editorCommandRespond: 'editor:command-respond',
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
  /** A shell-owned browser command from the native menu / a key equivalent. */
  browserCommand: 'event:browser-command',
  shellSync: 'event:shell-sync',
  requestSync: 'event:request-sync',
  deckWindowClosed: 'event:deck-window-closed',
  floatWindowClosed: 'event:float-window-closed',
  fsChanged: 'event:fs-changed',
  termData: 'event:term-data',
  termExit: 'event:term-exit',
  agentUpdate: 'event:agent-update',
  agentAskToken: 'event:agent-ask-token',
  chatPageToken: 'event:chat-page-token',
  agentEditToken: 'event:agent-edit-token',
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
  editorCommandRequest: 'event:editor-command-request',
  policyChanged: 'event:policy-changed',
  policyDenied: 'event:policy-denied',
  openDoc: 'event:open-doc',
  shellShortcut: 'event:shell-shortcut',
  terminalAdopt: 'event:terminal-adopt',
  syncStatusChanged: 'event:sync-status',
  syncPulled: 'event:sync-pulled',
  themeChanged: 'event:theme-changed',
  jupyterOutput: 'event:jupyter-output'
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
  'tsv',
  'xml',
  'svg'
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
  /** VS Code editor extensions from Open VSX (task 12.8). */
  editor: {
    /** Answer an agent's editor command request (the shell runs it, main/core waits). */
    respondCommand(id: string, response: EditorCommandResponse): Promise<void>
    onCommandRequest(listener: (request: EditorCommandRequest) => void): () => void
  }
  vsx: {
    search(query: string): Promise<VsxExtension[]>
    /** Policy-gated (a `command`-class action). Resolves to the installed record. */
    install(id: string): Promise<VsxInstalled>
    uninstall(id: string): Promise<boolean>
    list(): Promise<VsxInstalled[]>
    /** One extension file as base64, path-contained to that extension. */
    read(dir: string, rel: string): Promise<{ base64: string } | null>
    /** The loopback origin the extension host is served from, or null if unavailable. */
    hostOrigin(): Promise<string | null>
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
    /**
     * A shell-owned command from the browser's native menu or a key equivalent
     * that fired while the page had focus: 'app:new-tab', 'app:close-tab',
     * 'app:toggle-deck', … (the `app:*` vocabulary of commands.ts).
     */
    onCommand(listener: (command: string) => void): () => void
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
    /** A deck or float window booted: ask the main window to broadcast its state. */
    requestSync(): Promise<void>
    /** A deck or float window is closing (its page is unloading). */
    notifyClosed(role: 'deck' | 'float', groupId?: string): Promise<void>
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
    /** Write bytes the page already holds (a picked attachment), base64 on the wire. */
    writeBase64(rel: string, base64: string): Promise<{ error?: string }>
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
    /**
     * One-shot streamed answer for the omnibox "Ask AI" affordance (A1). Not a
     * session: no plan, no tools, no workspace writes. Tokens arrive on
     * onAskToken keyed by `askId`; the promise settles with the whole answer and
     * the links it referenced (or an error string, never a rejection for the
     * expected "no key"/"declined" cases).
     */
    ask(askId: string, prompt: string, context?: AskContext): Promise<AskResult>
    /** Subscribe to streamed answer tokens; filter by the askId you passed to ask(). */
    onAskToken(listener: (payload: { askId: string; token: string }) => void): () => void
    /**
     * "Chat with this page" (roadmap A4): a one-shot streamed answer about the
     * user's ACTIVE page. Not a session — no plan, no tools, no writes. The
     * caller passes the page's visible text (read via getPageText) plus the
     * question; the model answers using ONLY that text (page content is data,
     * never instructions). Tokens arrive on onChatPageToken keyed by `chatId`;
     * the promise settles with the whole answer (or an error string, never a
     * rejection for the expected "no key"/"declined" cases).
     */
    chatPage(
      chatId: string,
      question: string,
      pageText: string,
      url?: string,
      title?: string
    ): Promise<ChatPageResult>
    /** Subscribe to streamed page-chat tokens; filter by the chatId you passed to chatPage(). */
    onChatPageToken(listener: (payload: { chatId: string; token: string }) => void): () => void
    /**
     * Inline code edit for the editor's ⌘I (roadmap A3). Not a session: no plan,
     * no tools, no workspace writes — the model transforms `code` per `instruction`
     * and streams the replacement. Tokens arrive on onEditToken keyed by `editId`;
     * the promise settles with the settled replacement (or an error string, never
     * a rejection for the expected "no key"/"declined" cases). The caller applies
     * the result to the buffer itself, so nothing is written until the user accepts.
     */
    editCode(
      editId: string,
      instruction: string,
      code: string,
      language: string
    ): Promise<EditCodeResult>
    /** Subscribe to streamed edit tokens; filter by the editId you passed to editCode(). */
    onEditToken(listener: (payload: { editId: string; token: string }) => void): () => void
    /**
     * Abort an in-flight one-shot streamed call — an ask, a page chat, or an
     * inline edit — by the id it was started with (askId | chatId | editId, one
     * shared id space). The backend stops the SDK stream so it no longer burns
     * tokens; the call's promise then settles with `cancelled: true`. A no-op if
     * the id is unknown or already settled.
     */
    cancel(id: string): Promise<void>
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
    /** Commit graph across all refs (roadmap C9), newest first, capped at `limit`. */
    logGraph(limit?: number): Promise<GitGraphResult>
    /** One commit's changed files as before/after blobs, for the diff overlay. */
    show(hash: string): Promise<GitCommitDetail>
  }

  /**
   * REST client (roadmap C7). The core runs the request with Node's `fetch`
   * (undici) — the renderer's CSP forbids arbitrary cross-origin calls — and
   * streams the response back. Never rejects: failures arrive as `error`.
   */
  rest: {
    send(request: RestRequest): Promise<RestResponse>
  }

  /**
   * Database client (roadmap C8). The core opens a SQLite file and runs
   * parameterized queries; read-only unless `readonly` is explicitly false.
   * Never rejects — failures arrive as `error` on the result.
   */
  db: {
    connect(path: string, readonly: boolean): Promise<{ id: string; error?: string }>
    query(id: string, sql: string, params: unknown[]): Promise<DbQueryResult>
    tables(id: string): Promise<{ tables: DbTable[]; error?: string }>
    close(id: string): Promise<void>
  }

  /**
   * Jupyter notebook (roadmap C10). The core connects to a running Jupyter
   * Server over REST + a kernel WebSocket and runs code cells; outputs stream
   * back on `onOutput` keyed by the execId passed to `execute()`. Never rejects
   * — failures arrive as `error` on the result.
   */
  jupyter: {
    /** Validate a server URL + token by listing its kernels. */
    connect(baseUrl: string, token: string): Promise<JupyterConnectResult>
    /** Start a kernel (defaults to `python3`) and open its socket. */
    startKernel(name?: string): Promise<JupyterStartResult>
    /**
     * Run code on the open kernel. Resolves when the kernel returns to idle;
     * the cell's outputs arrive via `onOutput` keyed by `execId` meanwhile.
     */
    execute(execId: string, code: string): Promise<JupyterExecuteResult>
    /** Interrupt the running kernel (a long cell, an infinite loop). */
    interrupt(): Promise<{ error?: string }>
    /** Close our kernel socket. The kernel keeps running server-side (v1). */
    disconnect(): Promise<void>
    /** Subscribe to streamed cell outputs; filter by the execId you passed to execute(). */
    onOutput(listener: (payload: { execId: string; output: JupyterOutput }) => void): () => void
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
