/** Dev Deck domain types, shared by main and every renderer window. */

export type BlockType =
  | 'editor'
  | 'files'
  | 'terminal'
  | 'agents'
  | 'logs'
  | 'search'
  | 'preview'
  | 'scm'
  | 'tasks'
  | 'settings'
  | 'debug'
  | 'chat'
  | 'gitgraph'
  | 'rest'
  | 'db'
  | 'jupyter'
  | 'extensions'
  // A view container an installed VS Code extension contributes, rendered by
  // VS Code's own pane machinery inside a block (12.8). Which one is in the
  // block's payload; one block per container, its views as stacked panes.
  | 'extview'

/** Zones a group can dock into inside a window. */
export type DockZone = 'left' | 'right' | 'bottom'
/** A group can also float in its own OS window. */
export type DeckZone = DockZone | 'floating'
export type DeckMode = 'attached' | 'detached'
export type DeckPreset = 'browsing' | 'building' | 'debugging'

/** One instance of a dev feature. Blocks are peers: any type can have many. */
export interface BlockInstance {
  id: string
  type: BlockType
  title: string
  /** Type-specific data. `extview`: which extension view container to render. */
  payload?: { containerId: string; extensionId?: string }
}

/** A tabbed stack of blocks. One block is the active tab. */
export interface BlockGroup {
  id: string
  zone: DeckZone
  blockIds: string[]
  activeBlockId: string
}

/** A block collapsed to the rail, remembering where to restore it (P3-6). */
export interface RailEntry {
  blockId: string
  /** The zone it came from — including `floating`, so a floated block returns floating. */
  prevZone: DeckZone
  /** Its group's position among all groups, so restore lands in the same spot,
   *  not appended at the end. Absent on rail entries persisted before P3-6. */
  index?: number
}

/** User-resizable deck dimensions (2B.3), in px. */
export interface DeckSizes {
  colWidth: number
  /** Width of the left block column; 0 until something is dropped there. */
  leftWidth: number
  dockHeight: number
  /** Bottom-dock widths in px, keyed by group id. Every block in the dock is
   *  resizable, not just the first — a missing entry means "share what is
   *  left", which is how a newly dropped group starts. */
  dockWidths: Record<string, number>
}

/** The layout slice mirrored across windows (browser, deck, floats). */
export interface DeckSyncState {
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]
  deckMode: DeckMode
  deckSizes: DeckSizes
  /** Open editor documents (workspace-relative paths) and the focused one. */
  editorTabs: string[]
  activeEditorPath: string | null
}
