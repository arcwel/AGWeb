/** Task domain types, shared by main and every renderer (12.5). */

export interface TaskDefinition {
  /** Unique within a workspace; also what the user sees. */
  name: string
  /** The shell command actually run. */
  command: string
  /** Where the definition came from, so the UI can group and explain. */
  source: 'package.json' | 'tasks.json'
  /** Problem matcher id, e.g. `$tsc`. Absent means output is not parsed. */
  matcher?: string
}

export interface TaskProblem {
  /** Workspace-relative path. */
  path: string
  /** One-based, as every compiler reports them. */
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
  /** Rule or error code, when the tool gives one (TS2322, no-unused-vars). */
  code?: string
}

export interface TaskRun {
  task: string
  /** The pty session, so the run is visible as a terminal like any other. */
  terminalId: string
  /** Undefined while running. */
  exitCode?: number
  problems: TaskProblem[]
  /** Set when the task could not be started at all. */
  error?: string
}
