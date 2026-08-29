/** Source control domain types, shared by main and every renderer (12.3). */

export interface GitStatusEntry {
  /** Workspace-relative path. */
  path: string
  /** For a rename or copy, where it came from. */
  original?: string
  /** Porcelain v1 index column. */
  index: string
  /** Porcelain v1 worktree column. */
  worktree: string
  untracked: boolean
  staged: boolean
}

export interface GitStatus {
  /** False when the workspace is not a git repository, or git is missing. */
  repository: boolean
  branch: string
  ahead: number
  behind: number
  files: GitStatusEntry[]
  error?: string
}

/** The two sides of a file's change, rendered by the Monaco diff component. */
export interface GitFileDiff {
  original: string
  modified: string
  error?: string
}

export interface GitBlameLine {
  commit: string
  author: string
  /** Author time, epoch milliseconds. */
  time: number
  summary: string
}
