/**
 * The reverse bridge: CORE → shell events (the fire-and-forget push side).
 *
 * CORE domains emit events (agent updates, task progress, terminal data, fs
 * changes, LSP/DAP messages) that the UI listens for. On Electron that's
 * `BrowserWindow.webContents.send`; under the Chromium fork it's a WebSocket
 * push to the `chrome://webdeck` client. The domains must not know which — so
 * they call `coreBroadcast()` here, and the host injects the concrete sink once
 * at startup via `setCoreBroadcaster()`.
 *
 * The signature mirrors the Electron `broadcast(channel, payload, senderId)`
 * exactly, so migrating a domain is a pure import swap. The default is a no-op,
 * which is correct for a headless core with no connected client and safe if a
 * domain emits before the host is wired.
 *
 * This file imports nothing platform-specific — it runs anywhere Node does.
 */

export type CoreBroadcaster = (channel: string, payload: unknown, senderId: number | null) => void

let broadcaster: CoreBroadcaster = () => {}

/** Wire the concrete event sink (Electron `broadcast`, or a WS push). Call once. */
export function setCoreBroadcaster(fn: CoreBroadcaster): void {
  broadcaster = fn
}

/** Emit a CORE event to the shell/UI. `senderId` (Electron webContents id) is
 *  honored by the Electron sink to skip echoing to the origin window; other
 *  transports ignore it. */
export function coreBroadcast(
  channel: string,
  payload: unknown,
  senderId: number | null = null
): void {
  broadcaster(channel, payload, senderId)
}
