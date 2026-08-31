import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { CoreRegistry } from '../rpc'
import { CORE_AUTH_SUBPROTOCOL_PREFIX, tokenFromSubprotocolHeader } from './auth'
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
 * returned, and written to a handoff file the WebUI reads at startup, because
 * the port is ephemeral by default.
 *
 * TWO CHECKS GUARD EVERY CONNECTION, and both run at the HTTP upgrade so an
 * unauthorized caller never gets a socket at all:
 *
 * 1. **The per-boot token** (see auth.ts), which stops any *local process* from
 *    driving the core. Loopback is not a boundary: every process running as this
 *    user can reach this port, and everything behind it — the user's files,
 *    terminals, the agent's provider key, the policy that gates the agent — is
 *    worth stealing. The secret is minted here and published only through the
 *    0600 handoff file, which is the same channel the browser already reads the
 *    port from.
 * 2. **The Origin** (see `allowedOrigins`), which stops any *web page* the user
 *    happens to open from driving the core. `ws://127.0.0.1:<port>` is reachable
 *    from any page in the browser, and WebSocket is not subject to the same
 *    origin policy — but a page cannot forge `Origin`, so an origin we don't
 *    know is a page that has no business here.
 *
 * Both fail closed: absent is refused exactly like wrong.
 */

/** The only origin the core answers: the WebUI page itself. */
const WEBUI_ORIGIN = 'chrome://webdeck'

/**
 * Mint a per-boot connection secret.
 *
 * 256 bits from the CSPRNG, base64url so it is usable verbatim as an HTTP token
 * in the `Sec-WebSocket-Protocol` header (see auth.ts).
 */
export function generateCoreToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Constant-time token comparison — a wrong token must not be guessable byte by byte. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // timingSafeEqual throws on a length mismatch, and the length of a fixed-width
  // secret is not itself a secret — a wrong length is simply a wrong token.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The handoff file: how the browser learns where the core is AND how to prove it
 * may connect.
 *
 * 0600 because the token is a full-privilege credential and the file usually
 * lives in a world-readable temp directory. `mode` only applies when the file is
 * created, so an explicit chmod covers a file a previous run left behind.
 */
function writeHandoffFile(path: string, port: number, token: string): void {
  writeFileSync(path, JSON.stringify({ port, token }), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows has no POSIX mode bits to set; the ACL inherited from the
    // per-user runtime directory is what protects the file there.
  }
}

export interface WsServerOptions {
  /**
   * The per-boot secret every client must present. REQUIRED, and required
   * without a default on purpose: a server that can be started without one is a
   * server someone will start without one.
   */
  authToken: string
  /** 0 (default) asks the OS for a free port; read it from the returned handle. */
  port?: number
  /** Loopback only, by design. */
  host?: string
  /**
   * If set, the port and token are written here as JSON `{ "port": N, "token": S }`
   * with mode 0600, for the WebUI host to read. A write failure is fatal: this
   * file is the only channel through which a legitimate client learns the token.
   */
  portFile?: string
  /**
   * Browser origins allowed to connect. Defaults to the WebUI page and nothing
   * else. A connection with no `Origin` at all is not a browser and is judged on
   * its token alone — pages cannot omit the header, so nothing is lost.
   */
  allowedOrigins?: readonly string[]
  /** Called whenever a client connects or disconnects, with the live count. Lets
   *  the core react to "no one is listening" (e.g. fail pending prompts closed). */
  onClientsChanged?: (openClients: number) => void
}

export interface WsServerHandle {
  port: number
  /** The secret a client must present to connect. Also written to the port file. */
  token: string
  /** Live client connections — for server→client pushes (events). */
  readonly clients: Set<WebSocket>
  /**
   * Call a method ON a connected client and await its result.
   *
   * The reverse of the normal direction, and the only way the core reaches the
   * browser's own tabs: the agent runs here, the tabs are reachable only from
   * the page, so "drive this tab" has to travel core → page.
   */
  requestFromClient(method: string, args: unknown[], timeoutMs: number): Promise<unknown>
  close(): Promise<void>
}

export function serveCoreOverWebSocket(
  registry: CoreRegistry,
  options: WsServerOptions
): Promise<WsServerHandle> {
  const host = options.host ?? '127.0.0.1'
  const allowedOrigins = options.allowedOrigins ?? [WEBUI_ORIGIN]
  const token = options.authToken

  /**
   * The gate. Runs before the upgrade completes, so a caller that fails it never
   * holds a socket — `ws` answers 401 and closes.
   */
  const isAuthorized = (req: IncomingMessage): boolean => {
    // Only a browser sets Origin, and a page cannot forge or omit it. An absent
    // Origin therefore means a native local client, which the token alone must
    // (and does) hold off.
    const origin = req.headers.origin
    if (origin !== undefined && !allowedOrigins.includes(origin)) return false
    const presented = tokenFromSubprotocolHeader(req.headers['sec-websocket-protocol'])
    return presented !== null && tokenMatches(presented, token)
  }

  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host,
      port: options.port ?? 0,
      verifyClient: (info: { req: IncomingMessage }) => isAuthorized(info.req),
      // Echo the credential subprotocol back. A browser that offered one and got
      // no answer fails the connection, so this is not cosmetic.
      handleProtocols: (protocols: Set<string>) => {
        for (const offered of protocols) {
          if (offered.startsWith(CORE_AUTH_SUBPROTOCOL_PREFIX)) return offered
        }
        return false
      }
    })

    wss.on('error', reject)

    const countOpen = (): number => [...wss.clients].filter((c) => c.readyState === c.OPEN).length

    // Requests the CORE has sent to a client, awaiting their replies. The page
    // is the only participant that can reach the browser's own tabs, so the
    // agent's browser tools travel in this direction.
    const outbound = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
    >()
    let nextOutboundId = -1 // negative ids, so they cannot collide with a client's

    wss.on('connection', (socket) => {
      options.onClientsChanged?.(countOpen())
      socket.on('message', (data) => {
        const raw = data.toString()
        // A reply to something the core asked, rather than a new request.
        try {
          const frame = JSON.parse(raw) as { id?: number; result?: unknown; error?: string }
          if (typeof frame.id === 'number' && frame.id < 0) {
            const waiter = outbound.get(frame.id)
            if (waiter) {
              outbound.delete(frame.id)
              clearTimeout(waiter.timer)
              if (frame.error) waiter.reject(new Error(frame.error))
              else waiter.resolve(frame.result)
            }
            return
          }
        } catch {
          // Not JSON, or not ours — fall through to the normal request path,
          // which produces a proper error frame.
        }
        void handleRpcMessage(registry, raw).then((reply) => {
          // An empty reply is a notify frame — nothing to send back.
          if (reply !== '' && socket.readyState === socket.OPEN) socket.send(reply)
        })
      })
      socket.on('close', () => {
        options.onClientsChanged?.(countOpen())
        // Anything still waiting on this client will never be answered.
        for (const [id, waiter] of outbound) {
          if (countOpen() !== 0) break
          outbound.delete(id)
          clearTimeout(waiter.timer)
          waiter.reject(new Error('the browser disconnected before answering'))
        }
      })
    })

    /** Ask a connected client to run `method`, and wait for its reply. */
    const requestFromClient = (
      method: string,
      args: unknown[],
      timeoutMs: number
    ): Promise<unknown> => {
      const socket = [...wss.clients].find((c) => c.readyState === c.OPEN)
      if (!socket) {
        return Promise.reject(
          new Error('no browser window is connected — open WebDeck and try again')
        )
      }
      const id = nextOutboundId--
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          outbound.delete(id)
          rej(new Error(`the browser did not answer "${method}" within ${timeoutMs}ms`))
        }, timeoutMs)
        outbound.set(id, { resolve: res, reject: rej, timer })
        socket.send(JSON.stringify({ id, method, args }))
      })
    }

    wss.on('listening', () => {
      const address = wss.address()
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 0)
      if (options.portFile) {
        try {
          writeHandoffFile(options.portFile, port, token)
        } catch (error) {
          // This used to be swallowed: the WebUI could still guess a port. It
          // cannot guess the token, so a server whose handoff file never landed
          // is a server nobody can talk to. Say so at boot instead of serving a
          // port that will refuse every connection.
          wss.close(() =>
            reject(
              new Error(
                `webdeck-core could not write its handoff file (${options.portFile}): ` +
                  `${(error as Error).message}`
              )
            )
          )
          return
        }
      }
      resolve({
        port,
        token,
        clients: wss.clients,
        requestFromClient,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate()
            wss.close(() => res())
          })
      })
    })
  })
}
