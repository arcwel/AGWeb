import { create } from 'zustand'
import type { BrowserTabState, WorkspaceInfo } from '@shared/ipc'
import type { AgentAttachment, AgentSessionInfo } from '@shared/agents'
import type {
  BlockGroup,
  BlockInstance,
  BlockType,
  DeckMode,
  DeckPreset,
  DeckSizes,
  DeckSyncState,
  DeckZone,
  RailEntry
} from '@shared/deck'

export type { BlockGroup, BlockInstance, BlockType, DeckMode, DeckPreset, DeckZone, RailEntry }

export type Theme = 'light' | 'dark'

/** A browser tab in the tab strip. Page state lives in `browserStates`. */
export interface BrowserTab {
  id: string
  /** 'web' hosts a Chromium view; 'doc' renders a Document Studio view. */
  kind: 'web' | 'doc'
  title: string
  /** For tabs opened from a link: the URL to load on first mount. */
  initialUrl?: string
  /** The page's favicon as a data: URL, mirrored from browser state. */
  favicon?: string
  /** Document Studio tabs: the workspace-relative file being rendered. */
  docPath?: string
  /** True once a WebContentsView exists for this tab (first navigation). */
  hasContent: boolean
  /** Tab group this belongs to, if any (Chrome-style grouping). */
  groupId?: string
}

/** A named, coloured run of tabs. Groups keep their tabs adjacent. */
export interface TabGroup {
  id: string
  name: string
  color: TabGroupColor
  collapsed: boolean
}

export type TabGroupColor = 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate'

export const TAB_GROUP_COLORS: Record<TabGroupColor, { dot: string; chip: string }> = {
  sky: { dot: 'bg-sky-500', chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  emerald: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  rose: { dot: 'bg-rose-500', chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  slate: { dot: 'bg-slate-500', chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' }
}

// Canonical in @shared/ipc so the main process (browser-navigation interception)
// and the renderer agree on what counts as a doc; re-exported here for the many
// existing `@/store` importers.
export { DOC_EXTENSIONS, isDocFile, isSlidesFile } from '@shared/ipc'

/** Where a dragged block or group is dropped. */
export type DropTarget =
  | { kind: 'stack'; groupId: string }
  | { kind: 'before'; groupId: string }
  | { kind: 'zone'; zone: DeckZone }

export const BLOCK_LABELS: Record<BlockType, string> = {
  editor: 'Editor',
  files: 'Files',
  terminal: 'Terminal',
  agents: 'Agents',
  logs: 'Logs',
  search: 'Search',
  preview: 'Preview',
  scm: 'Source Control',
  tasks: 'Tasks',
  settings: 'Settings',
  debug: 'Debug'
}

/** Which shell window this renderer is: the browser, the detached deck, or a float. */
export function getWindowRole(): { kind: 'main' | 'deck' | 'float'; groupId?: string } {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'deck') return { kind: 'deck' }
  if (hash.startsWith('float:')) return { kind: 'float', groupId: hash.slice('float:'.length) }
  return { kind: 'main' }
}

/** Terminals are always numbered (Terminal 1, Terminal 2); others only from 2. */
let blockCounts: Partial<Record<BlockType, number>> = {}
let nextBlockId = 1
let nextGroupId = 1

function makeBlock(type: BlockType): BlockInstance {
  const n = (blockCounts[type] = (blockCounts[type] ?? 0) + 1)
  const numbered = type === 'terminal' || n > 1
  return {
    id: `block-${nextBlockId++}`,
    type,
    title: numbered ? `${BLOCK_LABELS[type]} ${n}` : BLOCK_LABELS[type]
  }
}

function makeGroup(zone: DeckZone, members: BlockInstance[]): BlockGroup {
  return {
    id: `group-${nextGroupId++}`,
    zone,
    blockIds: members.map((b) => b.id),
    activeBlockId: members[members.length - 1]?.id ?? ''
  }
}

let nextTabId = 1
let nextTabGroupId = 1
function makeTab(initialUrl?: string): BrowserTab {
  return { id: `tab-${nextTabId++}`, kind: 'web', title: 'New Tab', initialUrl, hasContent: false }
}

function makeDocTab(docPath: string): BrowserTab {
  return {
    id: `tab-${nextTabId++}`,
    kind: 'doc',
    title: docPath.split('/').pop() ?? docPath,
    docPath,
    hasContent: false
  }
}

interface DeckLayout {
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]
  deckSizes?: DeckSizes
  /** Persisted so a renderer crash-reload doesn't close a detached deck. */
  deckMode?: DeckMode
}

function defaultDeck(): DeckLayout {
  const editor = makeBlock('editor')
  const files = makeBlock('files')
  const terminal = makeBlock('terminal')
  const agents = makeBlock('agents')
  return {
    blocks: {
      [editor.id]: editor,
      [files.id]: files,
      [terminal.id]: terminal,
      [agents.id]: agents
    },
    // Agents opens as the entire right column: the largest block by default
    // and deliberately not grouped with Terminal. It stays an ordinary block —
    // draggable, floatable, railable, closable like any other.
    groups: [
      makeGroup('right', [agents]),
      makeGroup('bottom', [editor]),
      makeGroup('bottom', [terminal]),
      makeGroup('bottom', [files])
    ],
    rail: []
  }
}

/* ---- Per-project layout persistence (localStorage) ---- */

// Only the main (browser) window restores or saves persisted layout. Child
// windows (deck/float) receive the live layout via the boot-time sync request;
// restoring localStorage there would broadcast a stale snapshot that clobbers
// the live state — e.g. un-floating the very group a float window was opened
// for, which closes that window immediately.
const isLayoutAuthority = getWindowRole().kind === 'main'

const DEFAULT_DECK_SIZES: DeckSizes = {
  colWidth: 436,
  // The left column starts closed: it exists as a drop target, and only takes
  // space once something is actually put there.
  leftWidth: 0,
  dockHeight: 248,
  dockWidths: {}
}

/** Keep resizes within sane, on-screen bounds. */
export function clampDeckSizes(sizes: DeckSizes): DeckSizes {
  return {
    colWidth: Math.min(820, Math.max(280, Math.round(sizes.colWidth))),
    // 0 is meaningful (closed); anything open gets a usable minimum.
    leftWidth: sizes.leftWidth <= 0 ? 0 : Math.min(820, Math.max(220, Math.round(sizes.leftWidth))),
    dockHeight: Math.min(520, Math.max(140, Math.round(sizes.dockHeight))),
    dockWidths: Object.fromEntries(
      Object.entries(sizes.dockWidths ?? {}).map(([id, width]) => [
        id,
        Math.min(1400, Math.max(220, Math.round(width)))
      ])
    )
  }
}

interface LayoutSnapshot extends DeckLayout {
  deckSizes?: DeckSizes
  counters: {
    nextBlockId: number
    nextGroupId: number
    blockCounts: Partial<Record<BlockType, number>>
  }
}

const layoutKey = (workspacePath: string | null): string =>
  `agweb.layout:${workspacePath ?? 'default'}`

function loadLayout(workspacePath: string | null): DeckLayout | null {
  if (!isLayoutAuthority) return null
  try {
    const raw = localStorage.getItem(layoutKey(workspacePath))
    if (!raw) return null
    const snap = JSON.parse(raw) as LayoutSnapshot
    if (!snap.groups || !snap.blocks) return null
    nextBlockId = Math.max(nextBlockId, snap.counters?.nextBlockId ?? 1)
    nextGroupId = Math.max(nextGroupId, snap.counters?.nextGroupId ?? 1)
    blockCounts = { ...blockCounts, ...snap.counters?.blockCounts }
    return {
      blocks: snap.blocks,
      groups: snap.groups,
      rail: snap.rail ?? [],
      deckSizes: clampDeckSizes(snap.deckSizes ?? DEFAULT_DECK_SIZES),
      deckMode: snap.deckMode === 'detached' ? 'detached' : 'attached'
    }
  } catch {
    return null
  }
}

function saveLayout(state: {
  workspace: WorkspaceInfo | null
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]
  deckSizes: DeckSizes
  deckMode: DeckMode
}): void {
  if (!isLayoutAuthority) return
  try {
    const snap: LayoutSnapshot = {
      blocks: state.blocks,
      groups: state.groups,
      rail: state.rail,
      deckSizes: state.deckSizes,
      deckMode: state.deckMode,
      counters: { nextBlockId, nextGroupId, blockCounts }
    }
    localStorage.setItem(layoutKey(state.workspace?.path ?? null), JSON.stringify(snap))
  } catch {
    // storage unavailable — layout just won't persist
  }
}

/* ---- Bookmarks (localStorage, shared across projects) ---- */

/** Bookmarks are per profile, so switching profile switches the set (Chrome). */
function bmKey(profileId: string): string {
  return `agweb.bookmarks:${profileId}`
}

function loadBookmarks(profileId: string): Array<{ url: string; title: string }> {
  try {
    // One-time migration: the old global bookmarks become the default profile's.
    const legacy = localStorage.getItem('agweb.bookmarks')
    if (legacy !== null && localStorage.getItem(bmKey('default')) === null) {
      localStorage.setItem(bmKey('default'), legacy)
      localStorage.removeItem('agweb.bookmarks')
    }
    const raw = localStorage.getItem(bmKey(profileId))
    return raw ? (JSON.parse(raw) as Array<{ url: string; title: string }>) : []
  } catch {
    return []
  }
}

function saveBookmarks(profileId: string, bookmarks: Array<{ url: string; title: string }>): void {
  try {
    localStorage.setItem(bmKey(profileId), JSON.stringify(bookmarks))
  } catch {
    // storage unavailable — bookmarks just won't persist
  }
}

/* ---- Per-project tab-session persistence (localStorage) ---- */

interface TabSessionSnapshot {
  tabs: Array<{ kind: 'web' | 'doc'; title: string; url?: string; docPath?: string }>
  activeIndex: number
}

const tabsKey = (workspacePath: string | null): string => `agweb.tabs:${workspacePath ?? 'default'}`

function saveTabSession(state: {
  workspace: WorkspaceInfo | null
  tabs: BrowserTab[]
  activeTabId: string
  browserStates: Record<string, BrowserTabState>
}): void {
  if (!isLayoutAuthority) return
  try {
    const snap: TabSessionSnapshot = {
      tabs: state.tabs.map((tab) =>
        tab.kind === 'doc'
          ? { kind: 'doc', title: tab.title, docPath: tab.docPath }
          : {
              kind: 'web',
              title: tab.title,
              url: state.browserStates[tab.id]?.url ?? tab.initialUrl
            }
      ),
      activeIndex: Math.max(
        0,
        state.tabs.findIndex((t) => t.id === state.activeTabId)
      )
    }
    localStorage.setItem(tabsKey(state.workspace?.path ?? null), JSON.stringify(snap))
  } catch {
    // storage unavailable — the session just won't persist
  }
}

/** Rebuild a saved tab strip with fresh ids; pages lazy-load on activation. */
function loadTabSession(
  workspacePath: string | null
): { tabs: BrowserTab[]; activeTabId: string } | null {
  if (!isLayoutAuthority) return null
  // Honour the "Restore tabs on launch" setting — off means start fresh.
  try {
    if (!window.agweb.appSettings.readSync().restoreTabs) return null
  } catch {
    // Settings unreadable (e.g. very early boot): fall back to restoring.
  }
  try {
    const raw = localStorage.getItem(tabsKey(workspacePath))
    if (!raw) return null
    const snap = JSON.parse(raw) as TabSessionSnapshot
    if (!Array.isArray(snap.tabs) || snap.tabs.length === 0) return null
    const tabs = snap.tabs.map((t) => {
      if (t.kind === 'doc' && t.docPath) return makeDocTab(t.docPath)
      const tab = makeTab(t.url)
      return t.url ? { ...tab, title: t.title || tab.title } : tab
    })
    const active = tabs[Math.min(Math.max(snap.activeIndex ?? 0, 0), tabs.length - 1)]
    return { tabs, activeTabId: active.id }
  } catch {
    return null
  }
}

/* ---- Group surgery helpers (pure) ---- */

/** Remove a block from whichever group holds it; dissolve emptied groups. */
function withoutBlock(groups: BlockGroup[], blockId: string): BlockGroup[] {
  return groups
    .map((g) => {
      if (!g.blockIds.includes(blockId)) return g
      const blockIds = g.blockIds.filter((id) => id !== blockId)
      const activeBlockId =
        g.activeBlockId === blockId ? (blockIds[blockIds.length - 1] ?? '') : g.activeBlockId
      return { ...g, blockIds, activeBlockId }
    })
    .filter((g) => g.blockIds.length > 0)
}

/** A transient notification shown by the ToastHost (P2-13 and general use). */
export type ToastTone = 'info' | 'warn' | 'error'
export interface Toast {
  id: string
  message: string
  tone: ToastTone
}
let nextToastId = 1

interface ShellState {
  workspace: WorkspaceInfo | null
  theme: Theme

  tabs: BrowserTab[]
  activeTabId: string
  browserStates: Record<string, BrowserTabState>

  deckRevealed: boolean
  deckMode: DeckMode
  deckSizes: DeckSizes
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]

  /** Open editor documents (workspace-relative paths), shared by all editors. */
  editorTabs: string[]
  activeEditorPath: string | null
  dirtyFiles: Record<string, boolean>

  /** Agent sessions, pushed from main (every window gets agentUpdate events). */
  agentSessions: Record<string, AgentSessionInfo>
  upsertAgentSession(session: AgentSessionInfo): void
  setAgentSessions(sessions: AgentSessionInfo[]): void

  setWorkspace(workspace: WorkspaceInfo | null): void
  setTheme(theme: Theme): void

  newTab(initialUrl?: string): string
  /** Adopt a browser view an agent created in main as a live tab. */
  adoptBrowserTab(id: string): void
  /** Open (or focus) a Document Studio tab for a workspace file. */
  openDoc(path: string): void
  closeTab(id: string): void
  activateTab(id: string): void
  /** Drag-and-drop: move a tab before `beforeId` (or to the end when null). */
  moveTab(id: string, beforeId: string | null): void
  markTabHasContent(id: string): void
  updateBrowserState(state: BrowserTabState): void

  /** Renderer popovers open over the stage. Native WebContentsViews paint
   *  above the DOM, so the active view is hidden while any overlay is up. */
  overlayCount: number
  setOverlayOpen(open: boolean): void
  /** The Settings surface opens as its own overlay over the stage, not as a
   *  Dev Deck block — Settings is not part of the developer workspace. */
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
  toggleDeck(): void
  /** Pop the whole deck out into its own IDE window. */
  detachDeck(): void
  /** Merge the detached deck back into the browser window. */
  attachDeck(): void
  activateBlock(groupId: string, blockId: string): void
  /** Open another instance of `type` as a new tab in `groupId`. */
  addBlockToGroup(groupId: string, type: BlockType): void
  closeBlock(blockId: string): void
  /** Drag-and-drop: move one block (tab) to a target. */
  moveBlock(blockId: string, target: DropTarget): void
  /** Drag-and-drop: move a whole group (stack) to a target. */
  moveGroup(groupId: string, target: DropTarget): void
  /** Collapse a block to the rail; restore puts it back in its old zone. */
  /** Edge-resize (2B.3): set the deck column width / dock height. */
  setDeckSizes(sizes: Partial<DeckSizes>): void
  /** Pin bottom-dock block widths (merged, so one drag can set both sides). */
  setDockWidths(widths: Record<string, number>): void
  sendToRail(blockId: string): void
  restoreFromRail(blockId: string): void
  applyPreset(preset: DeckPreset): void

  openFile(path: string, line?: number): void

  /** A turn handed back to the composer for editing before it is sent again
   *  (task 11.13). Null once the composer has picked it up. */
  /** Tab groups, keyed by id. Tabs point at these by `groupId`. */
  tabGroups: Record<string, TabGroup>
  /** Group the given tabs together, creating the group. Returns its id. */
  groupTabs(tabIds: string[], name?: string): string
  ungroupTab(tabId: string): void
  renameTabGroup(groupId: string, name: string): void
  setTabGroupColor(groupId: string, color: TabGroupColor): void
  toggleTabGroup(groupId: string): void
  /** Dissolve the group, leaving its tabs in place. */
  removeTabGroup(groupId: string): void

  /**
   * Split view: a second tab shown beside the active one (feedback item 5).
   * This is a *page* split — two live web views side by side — not a deck
   * layout, which is what the Split view tool used to do by mistake.
   */
  splitTabId: string | null
  /** 0..1 — where the divider sits between the two pages. */
  splitRatio: number
  setSplit(tabId: string | null): void
  setSplitRatio(ratio: number): void
  /** Show the next tab beside this one, or close the split if one is open. */
  toggleSplit(): void
  /** URLs of recently closed web tabs, newest last (⌘⇧T). */
  closedTabs: string[]
  reopenTab(): void

  /** Embed proxy state, shared so the toolbar indicator and the menu that
   *  toggles it can never disagree. */
  embedProxyEnabled: boolean
  setEmbedProxyEnabled(enabled: boolean): void

  /** The summonable utilities/favourites bar (design canvas). */
  utilitiesOpen: boolean
  utilitiesLocked: boolean
  setUtilitiesOpen(open: boolean): void
  setUtilitiesLocked(locked: boolean): void

  /** The active browser profile id, mirrored from main so bookmarks follow it. */
  activeProfileId: string
  /** Switch the renderer to a profile: reload its bookmarks. */
  syncProfile(profileId: string): void
  /** Bookmarked pages for the active profile, newest first. */
  bookmarks: Array<{ url: string; title: string }>
  addBookmark(url: string, title: string): void
  removeBookmark(url: string): void
  /** Merge an imported set into the active profile's bookmarks (deduped). */
  importBookmarks(items: Array<{ url: string; title: string }>): number
  /** The page the Home button goes to. */
  homeUrl: string
  setHomeUrl(url: string): void

  /** Breakpoints by workspace-relative path, one-based lines (task 12.4). */
  breakpoints: Record<string, number[]>
  toggleBreakpoint(path: string, line: number): void

  composerDraft: { text: string; attachments: AgentAttachment[] } | null
  loadDraft(text: string, attachments: AgentAttachment[]): void
  clearDraft(): void
  closeEditorTab(path: string): void
  setFileDirty(path: string, dirty: boolean): void
  /** Line the editor should scroll to after opening activeEditorPath. */
  pendingRevealLine: number | null
  clearPendingReveal(): void
  toasts: Toast[]
  pushToast(message: string, tone?: ToastTone): void
  dismissToast(id: string): void
  /** Add a fresh block of `type` to the deck as its own group. */
  addBlock(type: BlockType): void
  /** An agent started a command in its own pty — surface it as a Terminal
   *  block whose id IS the pty session id, so the user watches it live. */
  adoptTerminal(sessionId: string, title: string): void
}

const initialTab = makeTab()
const initialDeck = loadLayout(null) ?? defaultDeck()

export const useShellStore = create<ShellState>((set) => ({
  workspace: null,
  theme: 'dark',

  tabs: [initialTab],
  activeTabId: initialTab.id,
  browserStates: {},

  overlayCount: 0,
  deckRevealed: false,
  deckMode: initialDeck.deckMode ?? 'attached',
  deckSizes: initialDeck.deckSizes ?? DEFAULT_DECK_SIZES,
  blocks: initialDeck.blocks,
  groups: initialDeck.groups,
  rail: initialDeck.rail,
  editorTabs: [],
  activeEditorPath: null,
  tabGroups: {},

  groupTabs: (tabIds, name) => {
    if (tabIds.length === 0) return ''
    // The id is minted outside `set` so it can be returned: zustand's setter
    // has no return value, and callers need the group they just made.
    const id = `tabgroup-${nextTabGroupId++}`
    set((state) => {
      const used = Object.values(state.tabGroups).length
      const palette = Object.keys(TAB_GROUP_COLORS) as TabGroupColor[]
      const group: TabGroup = {
        id,
        name: name ?? `Group ${used + 1}`,
        color: palette[used % palette.length],
        collapsed: false
      }
      // Grouped tabs are kept adjacent, the way Chrome does it: a group split
      // across the strip is unreadable and makes collapsing meaningless.
      const members = state.tabs.filter((t) => tabIds.includes(t.id))
      const rest = state.tabs.filter((t) => !tabIds.includes(t.id))
      const anchor = state.tabs.findIndex((t) => t.id === tabIds[0])
      const before = rest.slice(0, Math.max(0, anchor))
      const after = rest.slice(Math.max(0, anchor))
      return {
        tabGroups: { ...state.tabGroups, [id]: group },
        tabs: [...before, ...members.map((t) => ({ ...t, groupId: id })), ...after]
      }
    })
    return id
  },

  ungroupTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, groupId: undefined } : t))
    })),

  renameTabGroup: (groupId, name) =>
    set((state) => {
      const group = state.tabGroups[groupId]
      if (!group) return {}
      return { tabGroups: { ...state.tabGroups, [groupId]: { ...group, name } } }
    }),

  setTabGroupColor: (groupId, color) =>
    set((state) => {
      const group = state.tabGroups[groupId]
      if (!group) return {}
      return { tabGroups: { ...state.tabGroups, [groupId]: { ...group, color } } }
    }),

  toggleTabGroup: (groupId) =>
    set((state) => {
      const group = state.tabGroups[groupId]
      if (!group) return {}
      return {
        tabGroups: { ...state.tabGroups, [groupId]: { ...group, collapsed: !group.collapsed } }
      }
    }),

  removeTabGroup: (groupId) =>
    set((state) => {
      const tabGroups = { ...state.tabGroups }
      delete tabGroups[groupId]
      return {
        tabGroups,
        tabs: state.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t))
      }
    }),

  splitTabId: null,
  splitRatio: 0.5,
  setSplit: (tabId) => set({ splitTabId: tabId }),
  setSplitRatio: (ratio) => set({ splitRatio: Math.min(0.85, Math.max(0.15, ratio)) }),
  toggleSplit: () =>
    set((state) => {
      if (state.splitTabId) return { splitTabId: null }
      // Split against another web tab. A doc tab can't back a browser pane, and
      // the active tab can't be its own companion.
      const companion = state.tabs.find((t) => t.id !== state.activeTabId && t.kind === 'web')
      if (companion) return { splitTabId: companion.id }
      // Nothing to split against — open a fresh tab and split against it, so the
      // command always does something rather than silently no-op'ing.
      const tab = makeTab()
      return { tabs: [...state.tabs, tab], splitTabId: tab.id }
    }),

  embedProxyEnabled: false,
  setEmbedProxyEnabled: (enabled) => set({ embedProxyEnabled: enabled }),

  utilitiesOpen: false,
  utilitiesLocked: localStorage.getItem('agweb.utilitiesLocked') === '1',
  setUtilitiesOpen: (open) => set({ utilitiesOpen: open }),
  setUtilitiesLocked: (locked) => {
    try {
      localStorage.setItem('agweb.utilitiesLocked', locked ? '1' : '0')
    } catch {
      // storage unavailable — the pin just won't persist
    }
    set({ utilitiesLocked: locked })
  },

  activeProfileId: 'default',
  syncProfile: (profileId) =>
    set({ activeProfileId: profileId, bookmarks: loadBookmarks(profileId) }),
  bookmarks: loadBookmarks('default'),
  addBookmark: (url, title) =>
    set((state) => {
      if (!url || state.bookmarks.some((b) => b.url === url)) return {}
      const bookmarks = [{ url, title: title || url }, ...state.bookmarks].slice(0, 500)
      saveBookmarks(state.activeProfileId, bookmarks)
      return { bookmarks }
    }),
  removeBookmark: (url) =>
    set((state) => {
      const bookmarks = state.bookmarks.filter((b) => b.url !== url)
      saveBookmarks(state.activeProfileId, bookmarks)
      return { bookmarks }
    }),
  importBookmarks: (items) => {
    let added = 0
    set((state) => {
      const seen = new Set(state.bookmarks.map((b) => b.url))
      const fresh = items.filter((i) => i.url && !seen.has(i.url))
      added = fresh.length
      if (fresh.length === 0) return {}
      const bookmarks = [...state.bookmarks, ...fresh].slice(0, 2000)
      saveBookmarks(state.activeProfileId, bookmarks)
      return { bookmarks }
    })
    return added
  },
  homeUrl: localStorage.getItem('agweb.home') ?? 'https://duckduckgo.com',
  setHomeUrl: (url) => {
    try {
      localStorage.setItem('agweb.home', url)
    } catch {
      // storage unavailable — the home page just won't persist
    }
    set({ homeUrl: url })
  },

  breakpoints: {},
  toggleBreakpoint: (path, line) =>
    set((state) => {
      const lines = state.breakpoints[path] ?? []
      const next = lines.includes(line)
        ? lines.filter((l) => l !== line)
        : [...lines, line].sort((a, b) => a - b)
      return { breakpoints: { ...state.breakpoints, [path]: next } }
    }),

  composerDraft: null,
  loadDraft: (text, attachments) =>
    set({ composerDraft: { text, attachments }, deckRevealed: true }),
  clearDraft: () => set({ composerDraft: null }),
  dirtyFiles: {},
  agentSessions: {},

  upsertAgentSession: (session) =>
    set((state) => ({ agentSessions: { ...state.agentSessions, [session.id]: session } })),

  setAgentSessions: (sessions) =>
    set({ agentSessions: Object.fromEntries(sessions.map((s) => [s.id, s])) }),

  setWorkspace: (workspace) =>
    set((state) => {
      if (workspace?.path === state.workspace?.path) return { workspace }
      const layout = loadLayout(workspace?.path ?? null)
      const session = loadTabSession(workspace?.path ?? null)
      if (session) {
        // Leaving a workspace: flush its final tab set, then drop its views —
        // the restored strip owns the stage from here.
        saveTabSession(state)
        for (const tab of state.tabs) {
          if (tab.kind === 'web' && tab.hasContent) void window.agweb.browser.destroy(tab.id)
        }
      }
      return {
        workspace,
        ...(layout ?? {}),
        ...(session ? { ...session, browserStates: {} } : {})
      }
    }),

  setTheme: (theme) => set({ theme }),

  newTab: (initialUrl) => {
    const tab = makeTab(initialUrl)
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    return tab.id
  },

  adoptBrowserTab: (id) =>
    set((state) => {
      if (state.tabs.some((t) => t.id === id)) return { activeTabId: id }
      // The view already exists in main, so the tab starts with content; its
      // title arrives with the first browserState push.
      const tab: BrowserTab = { id, kind: 'web', title: 'Agent tab', hasContent: true }
      return { tabs: [...state.tabs, tab], activeTabId: id }
    }),

  openDoc: (path) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.kind === 'doc' && t.docPath === path)
      if (existing) return { activeTabId: existing.id }
      const tab = makeDocTab(path)
      return { tabs: [...state.tabs, tab], activeTabId: tab.id }
    }),

  closedTabs: [],

  reopenTab: () =>
    set((state) => {
      const url = state.closedTabs[state.closedTabs.length - 1]
      if (!url) return {}
      const tab = makeTab(url)
      return {
        closedTabs: state.closedTabs.slice(0, -1),
        tabs: [...state.tabs, tab],
        activeTabId: tab.id
      }
    }),

  closeTab: (id) =>
    set((state) => {
      const closing = state.tabs.find((t) => t.id === id)
      if (closing?.kind === 'web' && closing.hasContent) void window.agweb.browser.destroy(id)
      // Remember where the tab was so ⌘⇧T can bring it back. Capped, because
      // this is a convenience, not a history feature.
      const closedUrl = closing?.kind === 'web' ? state.browserStates[id]?.url : undefined
      const closedTabs =
        closedUrl && closedUrl !== 'about:blank'
          ? [...state.closedTabs, closedUrl].slice(-25)
          : state.closedTabs
      const browserStates = { ...state.browserStates }
      delete browserStates[id]

      const tabs = state.tabs.filter((t) => t.id !== id)
      if (tabs.length === 0) {
        const fresh = makeTab()
        return { tabs: [fresh], activeTabId: fresh.id, browserStates, closedTabs, splitTabId: null }
      }
      const activeTabId =
        state.activeTabId === id ? tabs[Math.max(0, tabs.length - 1)].id : state.activeTabId
      // A split needs two distinct live tabs. Collapse it if the companion is
      // the tab being closed, or if the new active tab is the companion —
      // otherwise the stage keeps sizing a pane to a destroyed view.
      const splitTabId =
        state.splitTabId === id || state.splitTabId === activeTabId ? null : state.splitTabId
      return { tabs, activeTabId, browserStates, closedTabs, splitTabId }
    }),

  activateTab: (id) => set({ activeTabId: id }),

  moveTab: (id, beforeId) =>
    set((state) => {
      if (id === beforeId) return {}
      const moving = state.tabs.find((t) => t.id === id)
      if (!moving) return {}
      const rest = state.tabs.filter((t) => t.id !== id)
      const index = beforeId ? rest.findIndex((t) => t.id === beforeId) : rest.length
      if (index < 0) return {}
      return { tabs: [...rest.slice(0, index), moving, ...rest.slice(index)] }
    }),

  markTabHasContent: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasContent: true } : t))
    })),

  updateBrowserState: (browserState) =>
    set((state) => ({
      browserStates: { ...state.browserStates, [browserState.tabId]: browserState },
      tabs: state.tabs.map((tab) => {
        if (tab.id !== browserState.tabId) return tab
        const title = browserState.title || hostOf(browserState.url) || 'New Tab'
        return { ...tab, title, favicon: browserState.favicon, hasContent: true }
      })
    })),

  setOverlayOpen: (open) =>
    set((state) => ({ overlayCount: Math.max(0, state.overlayCount + (open ? 1 : -1)) })),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  toggleDeck: () => set((state) => ({ deckRevealed: !state.deckRevealed })),

  setDeckSizes: (sizes) =>
    set((state) => ({ deckSizes: clampDeckSizes({ ...state.deckSizes, ...sizes }) })),

  setDockWidths: (widths) =>
    set((state) => ({
      deckSizes: clampDeckSizes({
        ...state.deckSizes,
        dockWidths: { ...state.deckSizes.dockWidths, ...widths }
      })
    })),

  detachDeck: () => set({ deckMode: 'detached', deckRevealed: false }),

  attachDeck: () => set({ deckMode: 'attached', deckRevealed: true }),

  activateBlock: (groupId, blockId) =>
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, activeBlockId: blockId } : g))
    })),

  addBlockToGroup: (groupId, type) =>
    set((state) => {
      const block = makeBlock(type)
      return {
        blocks: { ...state.blocks, [block.id]: block },
        groups: state.groups.map((g) =>
          g.id === groupId
            ? { ...g, blockIds: [...g.blockIds, block.id], activeBlockId: block.id }
            : g
        )
      }
    }),

  closeBlock: (blockId) =>
    set((state) => {
      if (state.blocks[blockId]?.type === 'terminal') void window.agweb.terminal.dispose(blockId)
      const blocks = { ...state.blocks }
      delete blocks[blockId]
      return {
        blocks,
        groups: withoutBlock(state.groups, blockId),
        rail: state.rail.filter((r) => r.blockId !== blockId)
      }
    }),

  moveBlock: (blockId, target) =>
    set((state) => {
      const source = state.groups.find((g) => g.blockIds.includes(blockId))
      if (!source) return {}
      if (target.kind === 'stack' && target.groupId === source.id) return {}

      let groups = withoutBlock(state.groups, blockId)
      if (target.kind === 'stack') {
        groups = groups.map((g) =>
          g.id === target.groupId
            ? { ...g, blockIds: [...g.blockIds, blockId], activeBlockId: blockId }
            : g
        )
        if (!groups.some((g) => g.blockIds.includes(blockId))) {
          groups = [
            ...groups,
            { ...makeGroup(source.zone, []), blockIds: [blockId], activeBlockId: blockId }
          ]
        }
      } else if (target.kind === 'before') {
        const index = groups.findIndex((g) => g.id === target.groupId)
        const zone = groups[index]?.zone ?? source.zone
        const fresh = { ...makeGroup(zone, []), blockIds: [blockId], activeBlockId: blockId }
        if (index < 0) groups = [...groups, fresh]
        else groups = [...groups.slice(0, index), fresh, ...groups.slice(index)]
      } else {
        if (source.blockIds.length === 1 && source.zone === target.zone) return {}
        groups = [
          ...groups,
          { ...makeGroup(target.zone, []), blockIds: [blockId], activeBlockId: blockId }
        ]
      }
      return { groups }
    }),

  moveGroup: (groupId, target) =>
    set((state) => {
      const source = state.groups.find((g) => g.id === groupId)
      if (!source) return {}
      if (target.kind === 'stack') {
        if (target.groupId === groupId) return {}
        const groups = state.groups
          .filter((g) => g.id !== groupId)
          .map((g) =>
            g.id === target.groupId
              ? {
                  ...g,
                  blockIds: [...g.blockIds, ...source.blockIds],
                  activeBlockId: source.activeBlockId
                }
              : g
          )
        return { groups }
      }
      if (target.kind === 'before') {
        if (target.groupId === groupId) return {}
        const rest = state.groups.filter((g) => g.id !== groupId)
        const index = rest.findIndex((g) => g.id === target.groupId)
        if (index < 0) return {}
        const moved = { ...source, zone: rest[index].zone }
        return { groups: [...rest.slice(0, index), moved, ...rest.slice(index)] }
      }
      if (source.zone === target.zone && target.zone !== 'floating') {
        const rest = state.groups.filter((g) => g.id !== groupId)
        return { groups: [...rest, source] }
      }
      return {
        groups: [...state.groups.filter((g) => g.id !== groupId), { ...source, zone: target.zone }]
      }
    }),

  sendToRail: (blockId) =>
    set((state) => {
      const source = state.groups.find((g) => g.blockIds.includes(blockId))
      if (!source) return {}
      // Remember the real zone (floating included) and the group's position, so a
      // restore returns the block exactly where it was, not appended as 'right' (P3-6).
      return {
        groups: withoutBlock(state.groups, blockId),
        rail: [
          ...state.rail,
          { blockId, prevZone: source.zone, index: state.groups.indexOf(source) }
        ]
      }
    }),

  restoreFromRail: (blockId) =>
    set((state) => {
      const entry = state.rail.find((r) => r.blockId === blockId)
      if (!entry) return {}
      const restored: BlockGroup = {
        ...makeGroup(entry.prevZone, []),
        blockIds: [blockId],
        activeBlockId: blockId
      }
      const groups = [...state.groups]
      const at = Math.max(0, Math.min(entry.index ?? groups.length, groups.length))
      groups.splice(at, 0, restored)
      return { rail: state.rail.filter((r) => r.blockId !== blockId), groups }
    }),

  pendingRevealLine: null,
  clearPendingReveal: () => set({ pendingRevealLine: null }),

  toasts: [],
  pushToast: (message, tone = 'info') =>
    set((state) => ({
      // Cap the stack so a burst of denials can't grow it without bound.
      toasts: [...state.toasts, { id: `toast-${nextToastId++}`, message, tone }].slice(-4)
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  openFile: (path, line) =>
    set((state) => ({
      editorTabs: state.editorTabs.includes(path) ? state.editorTabs : [...state.editorTabs, path],
      activeEditorPath: path,
      pendingRevealLine: line ?? null,
      deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
    })),

  adoptTerminal: (sessionId, title) =>
    set((state) => {
      if (state.blocks[sessionId]) return { deckRevealed: true }
      const block: BlockInstance = { id: sessionId, type: 'terminal', title: `▸ ${title}` }
      const bottom = state.groups.filter((g) => g.zone === 'bottom')
      // Join the existing bottom group if there is one, so an agent's commands
      // stack as tabs beside the user's own terminals rather than splitting.
      const target = bottom.find((g) =>
        g.blockIds.some((id) => state.blocks[id]?.type === 'terminal')
      )
      const groups = target
        ? state.groups.map((g) =>
            g.id === target.id
              ? { ...g, blockIds: [...g.blockIds, block.id], activeBlockId: block.id }
              : g
          )
        : [...state.groups, makeGroup('bottom', [block])]
      return {
        blocks: { ...state.blocks, [block.id]: block },
        groups,
        deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
      }
    }),

  addBlock: (type) =>
    set((state) => {
      const block = makeBlock(type)
      const zone: DeckZone = type === 'terminal' || type === 'logs' ? 'bottom' : 'right'
      return {
        blocks: { ...state.blocks, [block.id]: block },
        groups: [
          ...state.groups,
          { ...makeGroup(zone, []), blockIds: [block.id], activeBlockId: block.id }
        ],
        deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
      }
    }),

  closeEditorTab: (path) =>
    set((state) => {
      const editorTabs = state.editorTabs.filter((p) => p !== path)
      const dirtyFiles = { ...state.dirtyFiles }
      delete dirtyFiles[path]
      const activeEditorPath =
        state.activeEditorPath === path
          ? (editorTabs[editorTabs.length - 1] ?? null)
          : state.activeEditorPath
      return { editorTabs, activeEditorPath, dirtyFiles }
    }),

  setFileDirty: (path, dirty) =>
    set((state) => ({ dirtyFiles: { ...state.dirtyFiles, [path]: dirty } })),

  applyPreset: (preset) =>
    set((state) => {
      if (preset === 'browsing') return { deckRevealed: false }

      const blocks = { ...state.blocks }
      const ofType = (type: BlockType): BlockInstance[] =>
        Object.values(blocks).filter((b) => b.type === type)
      const need = (type: BlockType): BlockInstance[] => {
        const existing = ofType(type)
        if (existing.length > 0) return existing
        const fresh = makeBlock(type)
        blocks[fresh.id] = fresh
        return [fresh]
      }

      const groups =
        preset === 'building'
          ? [
              makeGroup('right', need('editor')),
              makeGroup('right', need('files')),
              makeGroup('bottom', need('terminal')),
              makeGroup('bottom', need('agents'))
            ]
          : [
              makeGroup('right', need('editor')),
              makeGroup('right', need('files')),
              makeGroup('bottom', [...need('terminal'), ...need('logs')]),
              makeGroup('bottom', need('agents'))
            ]

      // Blocks outside the preset's types (Search, Logs under Building…)
      // must not be orphaned: keep each as its own group in a sensible zone.
      const placed = new Set(groups.flatMap((g) => g.blockIds))
      for (const block of Object.values(blocks)) {
        if (placed.has(block.id)) continue
        const zone: DeckZone =
          block.type === 'terminal' || block.type === 'logs' ? 'bottom' : 'right'
        groups.push({ ...makeGroup(zone, []), blockIds: [block.id], activeBlockId: block.id })
      }

      return { blocks, groups, rail: [], deckRevealed: true }
    })
}))

/* ---- Cross-window sync + persistence ---- */

let applyingRemote = false

/** Apply a layout slice broadcast by another shell window. */
export function applyRemoteState(state: DeckSyncState): void {
  applyingRemote = true
  try {
    useShellStore.setState(state)
  } finally {
    applyingRemote = false
  }
}

export function currentSyncState(): DeckSyncState {
  const s = useShellStore.getState()
  return {
    blocks: s.blocks,
    groups: s.groups,
    rail: s.rail,
    deckMode: s.deckMode,
    deckSizes: s.deckSizes,
    editorTabs: s.editorTabs,
    activeEditorPath: s.activeEditorPath
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
// Seed with the boot state so unrelated changes (workspace, tabs, theme)
// never broadcast — a fresh window broadcasting its stale persisted layout
// would clobber the live state in every other window.
let lastSlice: DeckSyncState = currentSyncState()
useShellStore.subscribe((state) => {
  const changed =
    lastSlice.blocks !== state.blocks ||
    lastSlice.groups !== state.groups ||
    lastSlice.rail !== state.rail ||
    lastSlice.deckMode !== state.deckMode ||
    lastSlice.deckSizes !== state.deckSizes ||
    lastSlice.editorTabs !== state.editorTabs ||
    lastSlice.activeEditorPath !== state.activeEditorPath
  if (!changed) return
  lastSlice = {
    blocks: state.blocks,
    groups: state.groups,
    rail: state.rail,
    deckMode: state.deckMode,
    deckSizes: state.deckSizes,
    editorTabs: state.editorTabs,
    activeEditorPath: state.activeEditorPath
  }
  if (!applyingRemote) void window.agweb.windows.broadcastState(lastSlice)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveLayout(useShellStore.getState()), 400)
})

// Tab sessions persist per workspace (main window only). Titles and urls are
// saved so a restored strip renders instantly; pages lazy-load on activation.
if (isLayoutAuthority) {
  let lastTabSlice = {
    tabs: useShellStore.getState().tabs,
    activeTabId: useShellStore.getState().activeTabId,
    browserStates: useShellStore.getState().browserStates
  }
  let tabSaveTimer: ReturnType<typeof setTimeout> | null = null
  useShellStore.subscribe((state) => {
    const changed =
      lastTabSlice.tabs !== state.tabs ||
      lastTabSlice.activeTabId !== state.activeTabId ||
      lastTabSlice.browserStates !== state.browserStates
    if (!changed) return
    lastTabSlice = {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      browserStates: state.browserStates
    }
    if (tabSaveTimer) clearTimeout(tabSaveTimer)
    tabSaveTimer = setTimeout(() => saveTabSession(useShellStore.getState()), 400)
  })
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}
