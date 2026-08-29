import { BrowserWindow, screen } from 'electron'
import { JsonStore } from './json-store'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULTS: WindowState = { width: 1440, height: 900, isMaximized: false }

const store = new JsonStore<WindowState>('window-state', DEFAULTS)

/** Restore the last window bounds, clamped to a currently attached display. */
export function restoreWindowState(): WindowState {
  const state = store.read()
  if (state.x !== undefined && state.y !== undefined) {
    const onScreen = screen.getAllDisplays().some(({ workArea }) => {
      return (
        state.x! >= workArea.x - state.width &&
        state.x! <= workArea.x + workArea.width &&
        state.y! >= workArea.y &&
        state.y! <= workArea.y + workArea.height
      )
    })
    if (!onScreen) return DEFAULTS
  }
  return state
}

export function trackWindowState(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isDestroyed()) return
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? store.read() : win.getBounds()
    store.write({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width ?? DEFAULTS.width,
      height: bounds.height ?? DEFAULTS.height,
      isMaximized
    })
  }
  win.on('resized', save)
  win.on('moved', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)
}
