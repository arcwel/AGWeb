import { app, shell } from 'electron'
import type { BrowserWindow, DownloadItem, Session } from 'electron'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IpcEvents } from '@shared/ipc'
import type { DownloadInfo } from '@shared/ipc'
import { readAppSettings } from './app-settings'

/**
 * Download handling for browser tabs (Phase 2.7). Files save under the
 * configured download directory (Settings → Application) or the OS downloads
 * directory, with collision-safe names; progress streams to the renderer.
 *
 * The `will-download` handler is attached per browser-profile session (via
 * attachDownloadHandler, called from profiles.ts) so a download started in any
 * profile is captured — not only the default one.
 */

let host: BrowserWindow | null = null
let nextDownloadId = 1
const downloads = new Map<string, DownloadInfo>()

function downloadDir(): string {
  // A user-set location wins when it still exists; otherwise the OS downloads
  // dir (or the test override). "Empty" in settings means "use the default".
  const configured = readAppSettings().downloadPath
  if (configured && existsSync(configured)) return configured
  return process.env.AGWEB_DOWNLOAD_DIR ?? app.getPath('downloads')
}

/** hello.txt → hello (2).txt until the name is free. */
function availablePath(dir: string, filename: string): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  let candidate = join(dir, filename)
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

function push(info: DownloadInfo): void {
  downloads.set(info.id, info)
  if (host && !host.isDestroyed()) host.webContents.send(IpcEvents.downloadUpdate, info)
}

function stateOf(item: DownloadItem): DownloadInfo['state'] {
  const state = item.getState()
  if (state === 'progressing') return 'progressing'
  if (state === 'completed') return 'completed'
  if (state === 'cancelled') return 'cancelled'
  return 'interrupted'
}

export function initDownloads(window: BrowserWindow): void {
  host = window
}

const hookedSessions = new WeakSet<Session>()

/** Capture downloads for one profile session. Idempotent per session. */
export function attachDownloadHandler(ses: Session): void {
  if (hookedSessions.has(ses)) return
  hookedSessions.add(ses)
  ses.on('will-download', (_event, item) => {
    const id = `download-${nextDownloadId++}`
    const savePath = availablePath(downloadDir(), item.getFilename() || 'download')
    item.setSavePath(savePath)

    const snapshot = (): DownloadInfo => ({
      id,
      filename: basename(savePath),
      url: item.getURL(),
      path: savePath,
      state: stateOf(item),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes()
    })

    push(snapshot())
    item.on('updated', () => push(snapshot()))
    item.once('done', (_e, doneState) =>
      push({
        ...snapshot(),
        state: doneState === 'completed' ? 'completed' : doneState
      })
    )
  })
}

export function listDownloads(): DownloadInfo[] {
  return [...downloads.values()]
}

export function showDownload(id: string): void {
  const info = downloads.get(id)
  if (info?.state === 'completed' && existsSync(info.path)) shell.showItemInFolder(info.path)
}

/** Drop finished entries; in-flight downloads stay listed. */
export function clearDownloads(): void {
  for (const [id, info] of [...downloads]) {
    if (info.state !== 'progressing') downloads.delete(id)
  }
}
