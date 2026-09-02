import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { IpcChannels, type SyncStatus } from '@shared/ipc'
import { core } from '../rpc'
import { JsonStore } from './json-store'
import {
  emptyDoc,
  mergeLocalIntoDoc,
  normalizeDoc,
  sectionsToApply,
  seenFromDoc,
  type SyncDoc
} from './sync-merge'

/**
 * WebDeck Sync — settings sync via a local-first file (v0).
 *
 * The user keeps a single JSON document in a folder they already sync (iCloud,
 * Drive, Dropbox). Each registered *section* (browser settings, policy, AI
 * model, theme…) contributes its value to that doc and adopts newer values from
 * it. There is no server: every device reads the file on start and when it
 * changes, and writes its own edits back, with last-writer-wins per section (see
 * `sync-merge.ts`). This module is Electron-free — it runs the same under the
 * Chromium fork; the shell only injects a status broadcaster and hands it a file
 * path chosen through the host picker.
 */

/** A syncable unit of settings. Domains register one; the engine never knows the shape. */
export interface SyncSection {
  key: string
  /** The current local value to publish. */
  read: () => unknown
  /** Adopt an incoming value locally (and fire whatever local side-effects show it). */
  apply: (value: unknown) => void
}

interface SyncMeta {
  enabled: boolean
  filePath: string | null
  /** Per-section `updatedAt` this device has already published or applied. */
  seen: Record<string, number>
  lastSyncedAt: string | null
}

const metaStore = new JsonStore<SyncMeta>('sync-meta', {
  enabled: false,
  filePath: null,
  seen: {},
  lastSyncedAt: null
})

const sections = new Map<string, SyncSection>()
const DEVICE = hostname()
const DEBOUNCE_MS = 300

let watcher: FSWatcher | null = null
let broadcaster: ((status: SyncStatus) => void) | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
let lastError: string | null = null

/** Register a syncable section. Call at startup, before initSync(). */
export function registerSyncSection(section: SyncSection): void {
  sections.set(section.key, section)
}

/** Inject the status broadcaster (shell fans it out to every window). */
export function setSyncBroadcaster(fn: (status: SyncStatus) => void): void {
  broadcaster = fn
}

/** The current sync status (for the shell's cancel paths and boot reads). */
export function getSyncStatus(): SyncStatus {
  return status()
}

function status(): SyncStatus {
  const meta = metaStore.read()
  return {
    enabled: meta.enabled,
    filePath: meta.filePath,
    lastSyncedAt: meta.lastSyncedAt,
    error: lastError,
    sections: [...sections.keys()]
  }
}

function emitStatus(): void {
  broadcaster?.(status())
}

function readDoc(path: string): SyncDoc {
  if (!existsSync(path)) return emptyDoc()
  try {
    return normalizeDoc(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    lastError = `could not read sync file: ${(err as Error).message}`
    return emptyDoc()
  }
}

/**
 * Atomic write: temp file + rename, so a crash never leaves a half-written doc.
 * The temp name is randomized and opened with `wx` (O_CREAT|O_EXCL, which does
 * not follow symlinks) so a pre-planted symlink in the (possibly shared) sync
 * folder can't redirect the write onto an arbitrary file.
 */
function writeDoc(path: string, doc: SyncDoc): void {
  const tmp = join(dirname(path), `.${DEVICE}.${randomBytes(6).toString('hex')}.sync.tmp`)
  writeFileSync(tmp, JSON.stringify(doc, null, 2), { encoding: 'utf8', flag: 'wx' })
  renameSync(tmp, path)
}

/** Publish this device's local values into the file (last-writer-wins per section). */
export function pushNow(): SyncStatus {
  const meta = metaStore.read()
  if (!meta.filePath) return status()
  try {
    const current = readDoc(meta.filePath)
    const locals: Record<string, unknown> = {}
    // Isolate each section's read, so one broken section can't stall sync for
    // every other (mirrors the per-section guard in pullNow).
    let sectionError: string | null = null
    for (const [key, section] of sections) {
      try {
        locals[key] = section.read()
      } catch (err) {
        sectionError = `could not read "${key}": ${(err as Error).message}`
      }
    }
    const { doc, changed } = mergeLocalIntoDoc(current, locals, Date.now(), DEVICE)
    if (changed.length > 0 || !existsSync(meta.filePath)) writeDoc(meta.filePath, doc)
    metaStore.write({ ...meta, seen: seenFromDoc(doc), lastSyncedAt: new Date().toISOString() })
    // A section that failed to read did NOT sync, even though the push as a
    // whole succeeded. Clearing the error unconditionally here reported "all
    // good" while that section silently stopped syncing — and one of the
    // sections is the agent's permission policy, so the failure that matters
    // most is the one that looked healthiest.
    lastError = sectionError
    ensureWatching() // the file now exists — begin watching if we weren't
  } catch (err) {
    lastError = `sync push failed: ${(err as Error).message}`
  }
  emitStatus()
  return status()
}

/** Adopt any sections the file has that are newer than what we last applied. */
export function pullNow(): SyncStatus {
  const meta = metaStore.read()
  if (!meta.filePath) return status()
  try {
    const doc = readDoc(meta.filePath)
    const toApply = sectionsToApply(doc, meta.seen)
    const seen = { ...meta.seen }
    let appliedAny = false
    for (const { key, value, updatedAt } of toApply) {
      const section = sections.get(key)
      if (!section) continue // a section this build doesn't know — leave it in the file
      try {
        section.apply(value)
        seen[key] = updatedAt
        appliedAny = true
      } catch (err) {
        lastError = `could not apply "${key}": ${(err as Error).message}`
      }
    }
    metaStore.write({ ...meta, seen, lastSyncedAt: new Date().toISOString() })
    if (appliedAny) emitPulled()
  } catch (err) {
    lastError = `sync pull failed: ${(err as Error).message}`
  }
  emitStatus()
  return status()
}

let pulledNotifier: (() => void) | null = null
/** Inject a "just pulled" notifier (shell tells renderers to re-read settings). */
export function setSyncPulledNotifier(fn: () => void): void {
  pulledNotifier = fn
}
function emitPulled(): void {
  pulledNotifier?.()
}

/** Debounced auto-push, called by domains after a local settings change. */
export function syncTouch(): void {
  const meta = metaStore.read()
  if (!meta.enabled || !meta.filePath) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => pushNow(), DEBOUNCE_MS)
}

function schedulePull(): void {
  if (pullTimer) clearTimeout(pullTimer)
  pullTimer = setTimeout(() => pullNow(), DEBOUNCE_MS)
}

/**
 * Watch for external changes to the sync file. We watch the *directory*, not the
 * file: cloud clients (and our own atomic write) replace the file by renaming a
 * new inode over it, and a file-level `fs.watch` stops firing after the first
 * such replace. Watching the stable directory inode and filtering by filename
 * survives every replace. Idempotent, and re-attempted after each push/pull.
 */
function ensureWatching(): void {
  const meta = metaStore.read()
  if (watcher || !meta.filePath) return
  const dir = dirname(meta.filePath)
  const base = basename(meta.filePath)
  if (!existsSync(dir)) return
  try {
    watcher = watch(dir, (_event, filename) => {
      // filename is null on some platforms — pull on any dir change then.
      if (!filename || filename === base) schedulePull()
    })
    // An FSWatcher emits 'error' (watch-limit exhaustion, the volume dropping,
    // a cloud placeholder going offline). Unhandled, that throws and crashes the
    // main process — degrade sync instead.
    watcher.on('error', (err) => {
      lastError = `sync watch stopped: ${(err as Error).message}`
      stopWatching()
      emitStatus()
    })
  } catch {
    // Some cloud filesystems don't support watch; manual/startup sync still works.
  }
}

function stopWatching(): void {
  watcher?.close()
  watcher = null
}

/** Point sync at a file (chosen via the host picker in the shell). */
export function setSyncFile(path: string | null): SyncStatus {
  const meta = metaStore.read()
  // A new file is a fresh horizon: forget what we'd seen so its contents apply.
  metaStore.write({ ...meta, filePath: path, seen: path === meta.filePath ? meta.seen : {} })
  lastError = null
  if (path) {
    pullNow()
    if (metaStore.read().enabled) pushNow()
    ensureWatching() // in case the file already existed (pull/push may not have created it)
  } else {
    stopWatching()
  }
  emitStatus()
  return status()
}

export function setSyncEnabled(enabled: boolean): SyncStatus {
  const meta = metaStore.read()
  metaStore.write({ ...meta, enabled })
  if (enabled && meta.filePath) {
    pullNow()
    pushNow() // creates the file if absent, which ensureWatching() then picks up
  }
  emitStatus()
  return status()
}

/** Start sync at app boot: begin watching and do an initial pull→push. */
export function initSync(): void {
  // Test/dev hook: point sync at a file and turn it on without the native
  // picker, so the smoke test can drive the whole loop headlessly.
  const envFile = process.env.AGWEB_SYNC_FILE
  if (envFile) {
    setSyncFile(envFile)
    setSyncEnabled(true)
    return
  }
  const meta = metaStore.read()
  if (!meta.filePath) return
  ensureWatching()
  if (meta.enabled) {
    pullNow()
    pushNow()
  }
}

/** Register the sync request/response surface with webdeck-core. */
export function registerSyncRpc(): void {
  core.register(IpcChannels.syncStatus, () => status())
  core.register(IpcChannels.syncSetEnabled, (enabled) => setSyncEnabled(enabled === true))
  core.register(IpcChannels.syncPushNow, () => pushNow())
  core.register(IpcChannels.syncPullNow, () => pullNow())
  // syncChooseFile is handled shell-side (native picker) and calls setSyncFile.
}
