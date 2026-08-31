import { contextBridge, ipcRenderer } from 'electron'
import { createAgwebApi, type IpcLike } from './api'

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Exposes the typed AgwebApi surface — nothing else from Node or Electron.
 *
 * The surface itself is built in `api.ts` from an injected transport, so the
 * Chromium fork's WebUI can construct the identical API over a socket.
 */
contextBridge.exposeInMainWorld(
  'agweb',
  createAgwebApi(ipcRenderer as unknown as IpcLike, {
    kind: 'electron',
    // Electron hands us an empty window, so WebDeck draws the browser itself.
    ownsBrowserChrome: false,
    ownsBrowserFeatures: false,
    canOpenWindows: true,
    canPickPaths: true,
    canExport: true
  })
)
