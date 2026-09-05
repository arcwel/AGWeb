import { statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { IpcChannels, type RecentProject, type WorkspaceInfo } from '@shared/ipc'
import { coreEnv } from '../env'
import { core } from '../rpc'
import { asString } from '../coerce'
import { JsonStore } from './json-store'

const MAX_RECENT = 20

interface WorkspaceState {
  recent: RecentProject[]
}

const store = new JsonStore<WorkspaceState>('workspaces', { recent: [] })

let current: WorkspaceInfo | null = null

/**
 * Additional folders the user has explicitly granted this session (task 3B.4).
 *
 * Deliberately **not** persisted and not restored on launch. A grant is a
 * decision about this session; silently re-granting yesterday's folders at
 * startup would widen the agent's reach without anyone deciding to. VS Code
 * persists them because VS Code has no autonomous agent inside it.
 *
 * The primary workspace is not in this list — `workspaceRoots()` puts it first.
 */
let extraRoots: WorkspaceInfo[] = []

/**
 * Individual files the user attached through a picker (task 3B.4 follow-up).
 *
 * A narrower grant than a root: attaching one file from the Desktop should not
 * hand the agent the Desktop. The only way to add one is a gesture the user
 * drove — a native dialog, or dropping the file onto the window. Unlike roots,
 * files opened that way are remembered across launches (file-grants.ts), so a
 * restored tab on one can read it; a folder never is.
 */
const grantedFiles = new Set<string>()

export function grantFile(path: string): void {
  grantedFiles.add(resolve(path))
}

export function isGrantedFile(path: string): boolean {
  return grantedFiles.has(resolve(path))
}

export function getCurrentWorkspace(): WorkspaceInfo | null {
  return current
}

/**
 * Every folder any path may resolve inside, primary first.
 *
 * This is the whole allowlist: `fs.ts` refuses anything that is not inside one
 * of these, which is what keeps "multi-root" from meaning "the filesystem".
 */
export function workspaceRoots(): WorkspaceInfo[] {
  return current ? [current, ...extraRoots] : []
}

/** Add a folder to the session. Returns the new root list. */
export function addWorkspaceRoot(rawPath: string): WorkspaceInfo[] {
  const path = resolve(rawPath)
  try {
    if (!statSync(path).isDirectory()) return workspaceRoots()
  } catch {
    return workspaceRoots()
  }
  // A folder already covered by an existing root adds nothing but ambiguity.
  if (workspaceRoots().some((root) => path === root.path || path.startsWith(root.path + sep))) {
    return workspaceRoots()
  }
  extraRoots = [...extraRoots, { path, name: basename(path) }]
  return workspaceRoots()
}

export function removeWorkspaceRoot(rawPath: string): WorkspaceInfo[] {
  const path = resolve(rawPath)
  extraRoots = extraRoots.filter((root) => root.path !== path)
  return workspaceRoots()
}

export function getRecentProjects(): RecentProject[] {
  // Drop entries whose directory no longer exists.
  return store.read().recent.filter((p) => {
    try {
      return statSync(p.path).isDirectory()
    } catch {
      return false
    }
  })
}

/**
 * Expand a leading `~` to the user's home directory.
 *
 * `resolve()` treats `~` as an ordinary directory name, so `~/code/thing` came
 * out as `<cwd>/~/code/thing` and the open failed. Under Electron that never
 * showed, because nobody types a path — they use the folder picker. On the fork
 * there is no picker, so typing the path *is* the way in, and both fallbacks
 * (StartPage, FilesTree) prompt with `~/code/my-project`.
 *
 * Only a leading `~` on its own or before a separator: `~someone` is a different
 * user's home on Unix and not ours to guess at.
 */
export function expandHome(rawPath: string, home: string): string {
  if (rawPath === '~') return home
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) return join(home, rawPath.slice(2))
  return rawPath
}

export function openWorkspacePath(rawPath: string): WorkspaceInfo | null {
  // Normalize (leading `~`, trailing slashes, '..'): the fs layer's
  // inside-workspace prefix check assumes a canonical root. The `~` test comes
  // first so that a path without one never needs the host env at all.
  const path = resolve(rawPath.startsWith('~') ? expandHome(rawPath, coreEnv().homeDir) : rawPath)
  try {
    if (!statSync(path).isDirectory()) return null
  } catch {
    return null
  }
  // Switching projects drops the previous session's extra grants: they were
  // granted against that project, not this one.
  if (current?.path !== path) {
    extraRoots = []
    grantedFiles.clear()
  }
  current = { path, name: basename(path) }
  const recent = getRecentProjects().filter((p) => p.path !== path)
  recent.unshift({ ...current, lastOpenedAt: new Date().toISOString() })
  store.write({ recent: recent.slice(0, MAX_RECENT) })
  return current
}

/**
 * A host folder-picker: returns the chosen absolute path, or null if cancelled.
 * Injected by the shell (Electron's `dialog` today; the Chromium fork's host
 * later) so this CORE domain imports no Electron — the picker is the only reason
 * it ever did.
 */
export type FolderPicker = () => Promise<string | null>

let folderPicker: FolderPicker | null = null

/** Wire the host folder-picker. Call once at startup, before open-workspace. */
export function setWorkspaceFolderPicker(pick: FolderPicker): void {
  folderPicker = pick
}

/**
 * Fired after a project is opened, so the host can run its own side effects
 * (re-arm the file watcher, stop the previous project's dev server, update the
 * native menu). Injected, because those differ per host — but *opening* the
 * project is core logic and must work headless, or the fork cannot open a
 * project at all.
 */
let onOpened: ((workspace: WorkspaceInfo) => void) | null = null
export function setWorkspaceOpenedHook(fn: (workspace: WorkspaceInfo) => void): void {
  onOpened = fn
}

/** Open a project by path and fire the host's side effects. */
export function openWorkspaceAndNotify(path: string): WorkspaceInfo | null {
  const workspace = openWorkspacePath(path)
  if (workspace) onOpened?.(workspace)
  return workspace
}

export async function openWorkspaceDialog(): Promise<WorkspaceInfo | null> {
  if (!folderPicker) {
    throw new Error('folder picker not wired — call setWorkspaceFolderPicker() at startup')
  }
  const path = await folderPicker()
  if (!path) return null
  return openWorkspacePath(path)
}

/** Register the workspace *read* surface with webdeck-core (P1).
 *
 * Reads are pure core. The workspace *mutations* (open/addRoot/removeRoot) stay
 * shell-side: they orchestrate a native picker plus shell side-effects — a
 * broadcast, stopping the dev server, re-arming the file watcher — so the shell
 * calls these state functions and then fires those effects.
 */
export function registerWorkspaceRpc(): void {
  core.register(IpcChannels.workspaceOpenPath, (path) => {
    const p = asString(path)
    return p ? openWorkspaceAndNotify(p) : null
  })
  core.register(IpcChannels.workspaceCurrent, () => getCurrentWorkspace())
  core.register(IpcChannels.workspaceRoots, () => workspaceRoots())
  core.register(IpcChannels.workspaceRecent, () => getRecentProjects())
  // Multi-root, by path. Electron reached these through a native folder picker
  // and so they were treated as host-only — but only the PICKER needed the
  // host: granting and revoking a root are plain path operations the core has
  // always been able to do. Taking the path as an argument makes them work on
  // both hosts, and leaves the picker (or a path box) as a UI concern.
  core.register(IpcChannels.workspaceAddRoot, (path) => {
    const p = asString(path)
    return p ? addWorkspaceRoot(expandHome(p, coreEnv().homeDir)) : workspaceRoots()
  })
  core.register(IpcChannels.workspaceRemoveRoot, (path) => {
    const p = asString(path)
    return p ? removeWorkspaceRoot(p) : workspaceRoots()
  })
}
