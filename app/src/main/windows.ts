import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IpcEvents } from '@shared/ipc'

/**
 * Child windows of the shell: the detached Deck window (all dev blocks as a
 * standalone IDE) and per-group float windows. The browser window's renderer
 * decides what should exist; this module reconciles OS windows to match.
 */

let host: BrowserWindow | null = null
let deckWindow: BrowserWindow | null = null
const floatWindows = new Map<string, BrowserWindow>()

export function initWindows(main: BrowserWindow): void {
  host = main
}

function createShellWindow(
  hash: string,
  options: Electron.BrowserWindowConstructorOptions
): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    ...options
  })
  win.once('ready-to-show', () => win.show())
  // A fresh window boots from possibly-stale persisted state: ask the main
  // (browser) window to broadcast the live layout once this one is ready.
  win.webContents.on('did-finish-load', () => {
    if (host && !host.isDestroyed()) host.webContents.send(IpcEvents.requestSync)
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
  return win
}

export function openDeckWindow(): void {
  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.focus()
    return
  }
  deckWindow = createShellWindow('deck', {
    width: 980,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: 'WebDeck — Dev Deck'
  })
  deckWindow.on('closed', () => {
    deckWindow = null
    broadcast(IpcEvents.deckWindowClosed, null, null)
  })
}

export function closeDeckWindow(): void {
  if (deckWindow && !deckWindow.isDestroyed()) deckWindow.close()
}

export function focusDeckWindow(): void {
  if (!deckWindow || deckWindow.isDestroyed()) return
  if (deckWindow.isMinimized()) deckWindow.restore()
  deckWindow.focus()
}

export function syncFloatWindows(groupIds: string[]): void {
  for (const [id, win] of [...floatWindows]) {
    if (!groupIds.includes(id)) {
      // Delete first: the 'closed' handler reads this map to tell a
      // reconcile-driven close apart from a user closing the window.
      floatWindows.delete(id)
      if (!win.isDestroyed()) win.close()
    }
  }
  groupIds.forEach((id, index) => {
    if (floatWindows.has(id)) return
    const win = createShellWindow(`float:${id}`, {
      width: 480,
      height: 380,
      minWidth: 320,
      minHeight: 220,
      x: 120 + index * 40,
      y: 120 + index * 40,
      parent: host && !host.isDestroyed() ? host : undefined,
      title: 'WebDeck — Block'
    })
    win.on('closed', () => {
      // Only tell the renderer when the close came from the OS/title bar: a
      // reconcile-driven close already reflects the renderer's own state.
      const reconciling = !floatWindows.has(id)
      floatWindows.delete(id)
      if (!reconciling) broadcast(IpcEvents.floatWindowClosed, id, null)
    })
    floatWindows.set(id, win)
  })
}

export function closeAllChildWindows(): void {
  closeDeckWindow()
  for (const win of floatWindows.values()) {
    if (!win.isDestroyed()) win.close()
  }
  floatWindows.clear()
}

/** Send `payload` on `channel` to every shell window except `senderId`. */
export function broadcast(channel: string, payload: unknown, senderId: number | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (senderId !== null && win.webContents.id === senderId) continue
    win.webContents.send(channel, payload)
  }
}
