import { dialog } from 'electron'
import { statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'
import type { RecentProject, WorkspaceInfo } from '@shared/ipc'
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
 * hand the agent the Desktop. Like roots these last one session and are never
 * persisted, and like roots the only way to add one is a native dialog the
 * user drove.
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

export function openWorkspacePath(rawPath: string): WorkspaceInfo | null {
  // Normalize (trailing slashes, '..'): the fs layer's inside-workspace
  // prefix check assumes a canonical root.
  const path = resolve(rawPath)
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

export async function openWorkspaceDialog(): Promise<WorkspaceInfo | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open Project Folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return openWorkspacePath(result.filePaths[0])
}
