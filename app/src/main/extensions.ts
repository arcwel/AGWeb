import { app, dialog } from 'electron'
import type { Session } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionInfo } from '@shared/ipc'
import { JsonStore } from './json-store'

/**
 * MV3 Chrome extensions, per browser profile (Phase 2.4).
 *
 * Each profile keeps its own set — like Chrome, where extensions belong to a
 * person, not the whole browser. A profile's stored paths load into its own
 * session as it is configured (registerExtensionSession), and load/list/remove
 * all act on the *active* profile (the caller passes its id).
 *
 * Electron can only load an **unpacked** extension directory; it cannot install
 * from the Chrome Web Store, and the store won't serve a download to anything
 * that isn't Chrome. So "Web Store" means *browse* the store in a tab, and a
 * `.crx` (or packed `.zip`) is supported by extracting it to a directory first
 * and loading that. Limitations are in the README.
 */

interface Store {
  byProfile: Record<string, string[]>
  /** Legacy flat list, migrated into byProfile.default on first read. */
  paths?: string[]
}
const store = new JsonStore<Store>('extensions', { byProfile: {} })

/** Read state, migrating the old single-list format into the default profile. */
function read(): Record<string, string[]> {
  const raw = store.read()
  if (raw.paths && raw.paths.length > 0) {
    const byProfile = {
      ...raw.byProfile,
      default: [...(raw.byProfile.default ?? []), ...raw.paths]
    }
    store.write({ byProfile })
    return byProfile
  }
  return raw.byProfile
}

function pathsFor(profileId: string): string[] {
  return read()[profileId] ?? []
}

function writePaths(profileId: string, paths: string[]): void {
  store.write({ byProfile: { ...read(), [profileId]: paths } })
}

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

/** profileId → its browser session, tracked so we can act on the right one. */
const sessionByProfile = new Map<string, Session>()

function apiFor(ses: Session): ExtensionsApi {
  const s = ses as unknown as { extensions?: ExtensionsApi } & ExtensionsApi
  return s.extensions ?? s
}

function apiForProfile(profileId: string): ExtensionsApi | null {
  const ses = sessionByProfile.get(profileId)
  return ses ? apiFor(ses) : null
}

/** Register a profile's session and load *that profile's* extensions into it. */
export function registerExtensionSession(ses: Session, profileId: string): void {
  sessionByProfile.set(profileId, ses)
  const api = apiFor(ses)
  for (const path of pathsFor(profileId)) {
    if (existsSync(path)) void api.loadExtension(path, { allowFileAccess: false }).catch(() => {})
  }
}

function toInfo(ext: LoadedExtension): ExtensionInfo {
  return { id: ext.id, name: ext.name, version: ext.manifest.version ?? '', path: ext.path }
}

export async function loadExtensionFromPath(
  path: string,
  profileId: string
): Promise<{ extension?: ExtensionInfo; error?: string }> {
  const manifestPath = join(path, 'manifest.json')
  if (!existsSync(manifestPath)) return { error: 'No manifest.json in that directory' }
  const api = apiForProfile(profileId)
  if (!api) return { error: 'This profile has no browser session yet — open a tab first.' }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { manifest_version?: number }
    if (manifest.manifest_version !== 3)
      return { error: 'Only Manifest V3 extensions are supported' }
    const already = api.getAllExtensions().find((e) => e.path === path)
    if (already) return { extension: toInfo(already) }
    const ext = await api.loadExtension(path, { allowFileAccess: false })
    const paths = pathsFor(profileId)
    if (!paths.includes(path)) writePaths(profileId, [...paths, path])
    return { extension: toInfo(ext) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load extension' }
  }
}

export async function loadExtensionDialog(
  profileId: string
): Promise<{ extension?: ExtensionInfo; error?: string }> {
  const result = await dialog.showOpenDialog({
    title: 'Load unpacked extension',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return {}
  return loadExtensionFromPath(result.filePaths[0], profileId)
}

/**
 * The bytes of a `.crx` after its signature header — i.e. the embedded ZIP.
 *
 * CRX3 (`Cr24`, version 3): a 12-byte prefix plus a protobuf header, then the
 * zip. CRX2 (version 2): a 16-byte prefix plus the public key and signature.
 * A plain `.zip` (`PK`) is passed through.
 */
function crxToZip(buf: Buffer): Buffer | null {
  if (buf.length >= 2 && buf.toString('latin1', 0, 2) === 'PK') return buf
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') return null
  const version = buf.readUInt32LE(4)
  if (version === 2) {
    const pubLen = buf.readUInt32LE(8)
    const sigLen = buf.readUInt32LE(12)
    return buf.subarray(16 + pubLen + sigLen)
  }
  if (version === 3) {
    const headerLen = buf.readUInt32LE(8)
    return buf.subarray(12 + headerLen)
  }
  return null
}

/**
 * Load a packed extension (`.crx` or `.zip`) by extracting it and loading the
 * result as unpacked. Electron has no CRX installer, so this is the honest way
 * to run a packed extension you already have.
 */
export async function loadPackedExtension(
  profileId: string
): Promise<{ extension?: ExtensionInfo; error?: string }> {
  const result = await dialog.showOpenDialog({
    title: 'Load a packed extension',
    properties: ['openFile'],
    filters: [{ name: 'Chrome extension', extensions: ['crx', 'zip'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return {}
  const crxPath = result.filePaths[0]
  try {
    const zip = crxToZip(readFileSync(crxPath))
    if (!zip) return { error: 'That file is not a recognisable .crx or .zip extension.' }

    const root = join(app.getPath('userData'), 'unpacked-extensions')
    mkdirSync(root, { recursive: true })
    const stem =
      crxPath
        .split('/')
        .pop()
        ?.replace(/\.(crx|zip)$/i, '') || 'extension'
    const dest = join(root, `${stem}-${Date.now().toString(36)}`)
    const zipPath = `${dest}.zip`
    mkdirSync(dest, { recursive: true })
    writeFileSync(zipPath, zip)

    // Node has no built-in unzip; use the platform tool. macOS/Linux ship
    // `unzip`; that is where this build runs.
    const unzip = spawnSync('unzip', ['-o', '-q', zipPath, '-d', dest])
    rmSync(zipPath, { force: true })
    if (unzip.status !== 0) {
      return { error: 'Could not unpack the extension (no `unzip` available on this system).' }
    }
    return loadExtensionFromPath(dest, profileId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load packed extension' }
  }
}

export function listExtensions(profileId: string): ExtensionInfo[] {
  return apiForProfile(profileId)?.getAllExtensions().map(toInfo) ?? []
}

export function removeExtension(id: string, profileId: string): void {
  const api = apiForProfile(profileId)
  const ext = api?.getAllExtensions().find((e) => e.id === id)
  if (!api || !ext) return
  api.removeExtension(id)
  writePaths(
    profileId,
    pathsFor(profileId).filter((p) => p !== ext.path)
  )
}

/** Drop stored paths that no longer exist; loading is done at registration. */
export async function restoreExtensions(): Promise<void> {
  const byProfile = read()
  let changed = false
  const next: Record<string, string[]> = {}
  for (const [profileId, paths] of Object.entries(byProfile)) {
    const kept = paths.filter((p) => existsSync(p))
    if (kept.length !== paths.length) changed = true
    next[profileId] = kept
  }
  if (changed) store.write({ byProfile: next })
}
