import { writeFileSync } from 'node:fs'
import { WebSocketServer, type WebSocket } from 'ws'
import type { CoreRegistry } from '../rpc'
import { handleRpcMessage } from './socket'

/**
 * The webdeck-core WebSocket server — the real bridge behind the socket layer.
 *
 * Under the Chromium fork there is no Electron IPC: the `chrome://webdeck` WebUI
 * reaches this Node service over a localhost WebSocket. Each incoming frame is
 * run through the same `CoreRegistry` every transport uses (via
 * `handleRpcMessage`), and its reply — if any — is sent back. Notify frames get
 * no reply. This is the P0 spike deliverable: a running server that round-trips
 * a request from a socket client to a registered handler and back.
 *
 * Bound to loopback by default (never a public interface). The chosen port is
 * returned, and optionally written to a discovery file the WebUI reads at
 * startup, because the port is ephemeral by default.
 */

export interface WsServerOptions {
  /** 0 (default) asks the OS for a free port; read it from the returned handle. */
  port?: number
  /** Loopback only, by design. */
  host?: string
  /** If set, the chosen port is written here as JSON `{ "port": N }` for the WebUI to read. */
  portFile?: string
}

export interface WsServerHandle {
  port: number
  /** Live client connections — for a future server→client push (events). */
  readonly clients: Set<WebSocket>
  close(): Promise<void>
}

export function serveCoreOverWebSocket(
  registry: CoreRegistry,
  options: WsServerOptions = {}
): Promise<WsServerHandle> {
  const host = options.host ?? '127.0.0.1'
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host, port: options.port ?? 0 })

    wss.on('error', reject)

    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        void handleRpcMessage(registry, data.toString()).then((reply) => {
          // An empty reply is a notify frame — nothing to send back.
          if (reply !== '' && socket.readyState === socket.OPEN) socket.send(reply)
        })
      })
    })

    wss.on('listening', () => {
      const address = wss.address()
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 0)
      if (options.portFile) {
        try {
          writeFileSync(options.portFile, JSON.stringify({ port }), 'utf8')
        } catch {
          // The WebUI can fall back to a default port; not fatal to serving.
        }
      }
      resolve({
        port,
        clients: wss.clients,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate()
            wss.close(() => res())
          })
      })
    })
  })
}
