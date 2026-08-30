import { ipcMain } from 'electron'
import type { CoreHandler, CoreTransport } from '../rpc'

/**
 * The Electron transport for webdeck-core.
 *
 * Binds registered core methods onto `ipcMain.handle`, so the existing preload
 * bridge and `window.agweb` surface reach them exactly as before — the renderer
 * doesn't know or care that the handler now lives behind the registry. This is
 * the only file in the core stack that imports Electron; under the Chromium
 * fork it is swapped for a socket transport and nothing else moves.
 */
export const electronTransport: CoreTransport = {
  handle(method: string, handler: CoreHandler): void {
    ipcMain.handle(method, (_event, ...args: unknown[]) => handler(...args))
  },
  // Streams (no reply) arrive over ipcRenderer.send → ipcMain.on.
  notify(method: string, handler: CoreHandler): void {
    ipcMain.on(method, (_event, ...args: unknown[]) => handler(...args))
  }
}
