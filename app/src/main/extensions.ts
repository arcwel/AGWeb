import { dialog, session } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionInfo } from '@shared/ipc'
import { JsonStore } from './json-store'

/**
 * Unpacked MV3 Chrome extensions in the browser session (Phase 2.4).
 * Loaded paths persist in userData and reload on boot. Limitations are
 * documented in the README: no Web Store installs, and only the subset of
 * chrome.* APIs Electron implements (content scripts, storage, tabs basics —
 * no identity, no action popup toolbar UI).
 */

const BROWSER_PARTITION = 'persist:agweb-browser'

const store = new JsonStore<{ paths: string[] }>('extensions', { paths: [] })

/** Electron 35+ exposes ses.extensions; fall back to the legacy methods. */
interface ExtensionsApi {
  loadExtension(path: string, options?: { allowFileAccess?: boolean }): Promise<LoadedExtension>
  removeExtension(id: string): void
  getAllExtensions(): LoadedExtension[]
}

interface LoadedExtension {
  id: string
  name: string
  path: string
  manifest: { version?: string }
}

function extensionsApi(): ExtensionsApi {
  const ses = session.fromPartition(BROWSER_PARTITION) as unknown as {
    extensions?: ExtensionsApi
  } & ExtensionsApi
  return ses.extensions ?? ses
}

function toInfo(ext: LoadedExtension): ExtensionInfo {
  return { id: ext.id, name: ext.name, version: ext.manifest.version ?? '', path: ext.path }
}

export async function loadExtensionFromPath(
  path: string
): Promise<{ extension?: ExtensionInfo; error?: string }> {
  const manifestPath = join(path, 'manifest.json')
  if (!existsSync(manifestPath)) return { error: 'No manifest.json in that directory' }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      manifest_version?: number
    }
    if (manifest.manifest_version !== 3) {
      return { error: 'Only Manifest V3 extensions are supported' }
    }
    const already = extensionsApi()
      .getAllExtensions()
      .find((e) => e.path === path)
    if (already) return { extension: toInfo(already) }
    const ext = await extensionsApi().loadExtension(path, { allowFileAccess: false })
    const saved = store.read()
    if (!saved.paths.includes(path)) store.write({ paths: [...saved.paths, path] })
    return { extension: toInfo(ext) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load extension' }
  }
}

export async function loadExtensionDialog(): Promise<{
  extension?: ExtensionInfo
  error?: string
}> {
  const result = await dialog.showOpenDialog({
    title: 'Load unpacked extension',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return {}
  return loadExtensionFromPath(result.filePaths[0])
}

export function listExtensions(): ExtensionInfo[] {
  return extensionsApi().getAllExtensions().map(toInfo)
}

export function removeExtension(id: string): void {
  const ext = extensionsApi()
    .getAllExtensions()
    .find((e) => e.id === id)
  if (!ext) return
  extensionsApi().removeExtension(id)
  const saved = store.read()
  store.write({ paths: saved.paths.filter((p) => p !== ext.path) })
}

/** Reload every previously loaded extension; drop paths that no longer load. */
export async function restoreExtensions(): Promise<void> {
  const saved = store.read()
  const kept: string[] = []
  for (const path of saved.paths) {
    const { extension } = await loadExtensionFromPath(path)
    if (extension) kept.push(path)
  }
  if (kept.length !== saved.paths.length) store.write({ paths: kept })
}
