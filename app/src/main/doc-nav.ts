import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDocFile, isSlidesFile } from '@shared/ipc'

/**
 * Decide whether a browser navigation should open Document Studio instead of
 * loading raw source (P3-3).
 *
 * Returns the workspace-relative path of a `file:` URL that points at a document
 * *inside* the open workspace — and nothing else. Out-of-workspace URLs, path
 * traversal, non-`file:` schemes, slide decks (they have their own runtime), and
 * non-doc files all return null and load in the browser as before. Because it
 * only ever yields paths that resolve within the workspace, it can never be used
 * to surface an arbitrary local file. Pure and Electron-free so it is unit-tested
 * directly.
 */
export function docNavTarget(url: string, workspacePath: string | null): string | null {
  if (!url.startsWith('file:') || !workspacePath) return null
  let abs: string
  try {
    abs = fileURLToPath(url)
  } catch {
    return null
  }
  if (abs !== workspacePath && !abs.startsWith(workspacePath + sep)) return null
  const rel = relative(workspacePath, abs)
  if (!rel || rel.startsWith('..') || rel.includes('\0')) return null
  if (isSlidesFile(rel) || !isDocFile(rel)) return null
  return rel
}
