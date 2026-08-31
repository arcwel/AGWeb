/**
 * The `chrome://webdeck` side of the bridge.
 *
 * Under Electron the renderer reaches the main process through a preload that
 * exposes `invoke(channel, ...args)` and `on(event, handler)`. Under the
 * Chromium fork there is no preload and no Electron IPC: the WebUI page connects
 * to `webdeck-core` over a localhost WebSocket instead. This client provides the
 * *same two primitives* over that socket, so the renderer's API object can be
 * rebuilt on it verbatim — the UI code above it doesn't change at all.
 *
 * It speaks the frame format `socket.ts` defines: `{id, method, args}` requests
 * answered by `{id, result|error}`, plus `{type:'event', channel, payload}`
 * pushes for the reverse direction.
 *
 * Written against the standard `WebSocket` interface (no Node imports), so it
 * runs in the WebUI page and, in tests, under the `ws` package's compatible
 * implementation.
 */

import { coreAuthSubprotocol } from './auth'

/** The minimal WebSocket surface this client needs — DOM and `ws` both satisfy it. */
export interface WsLike {
  send(data: string): void
  close(): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
}

export interface CoreClientOptions {
  /** Build the socket. Injected so the page and tests can supply their own. */
  connect: () => WsLike
  /** How long a request waits for its reply before rejecting. */
  timeoutMs?: number
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: unknown }

const DEFAULT_TIMEOUT_MS = 30_000

export class CoreClient {
  private socket: WsLike | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()
  private readonly options: CoreClientOptions
  private closed = false

  constructor(options: CoreClientOptions) {
    this.options = options
  }

  /** Connect (idempotent). Requests call this implicitly. */
  connect(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const socket = this.options.connect()
      this.socket = socket
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('error', () => reject(new Error('webdeck-core connection failed')))
      socket.addEventListener('close', () => this.handleClose())
      socket.addEventListener('message', (event) => this.handleMessage(event.data))
    })
    return this.ready
  }

  private handleMessage(data: unknown): void {
    let frame: {
      id?: number
      result?: unknown
      error?: string
      type?: string
      channel?: string
      payload?: unknown
      method?: string
      args?: unknown[]
    }
    try {
      frame = JSON.parse(String(data))
    } catch {
      return // a frame we can't parse is not ours to act on
    }

    // Server-pushed event (the reverse bridge).
    if (frame.type === 'event' && typeof frame.channel === 'string') {
      for (const listener of this.listeners.get(frame.channel) ?? []) {
        try {
          listener(frame.payload)
        } catch {
          // one bad listener must not stop the others
        }
      }
      return
    }

    // A request FROM the server (the reverse direction).
    //
    // The core needs to call the page, not only answer it: the page is the only
    // participant that can reach the browser's own tabs, so "drive a tab" has to
    // travel core -> page. The frame shape is already symmetric, so this is the
    // same envelope with the roles swapped.
    if (typeof frame.id === 'number' && typeof frame.method === 'string') {
      void this.serveRequest(frame.id, frame.method, frame.args ?? [])
      return
    }

    // Request reply.
    if (typeof frame.id !== 'number') return
    const waiter = this.pending.get(frame.id)
    if (!waiter) return
    this.pending.delete(frame.id)
    clearTimeout(waiter.timer as ReturnType<typeof setTimeout>)
    if (frame.error) waiter.reject(new Error(frame.error))
    else waiter.resolve(frame.result)
  }

  /** The socket dropped: fail everything in flight rather than leaving the UI hanging. */
  private handleClose(): void {
    this.ready = null
    this.socket = null
    for (const [id, waiter] of [...this.pending]) {
      this.pending.delete(id)
      clearTimeout(waiter.timer as ReturnType<typeof setTimeout>)
      waiter.reject(new Error('webdeck-core disconnected'))
    }
  }

  /** The preload's `invoke` equivalent: call a CORE method, await its result. */
  async invoke(method: string, ...args: unknown[]): Promise<unknown> {
    if (this.closed) throw new Error('client closed')
    await this.connect()
    const socket = this.socket
    if (!socket) throw new Error('webdeck-core disconnected')
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`webdeck-core timed out: ${method}`))
      }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, args }))
    })
  }

  /** Fire-and-forget stream frame (the registry's notify path). */
  async notify(method: string, ...args: unknown[]): Promise<void> {
    await this.connect()
    this.socket?.send(JSON.stringify({ method, args, notify: true }))
  }

  /** The preload's `on` equivalent. Returns an unsubscribe, like the Electron one. */
  /** Methods this client will answer when the core calls it. */
  private readonly served = new Map<string, (...args: unknown[]) => unknown>()

  /**
   * Register a method the core may invoke on this client.
   *
   * This is how the agent reaches the user's own tabs: the agent domain runs in
   * the core, the tabs are reachable only from the browser, and the page sits on
   * the browser side of that line.
   */
  serve(method: string, handler: (...args: unknown[]) => unknown): void {
    this.served.set(method, handler)
  }

  private async serveRequest(id: number, method: string, args: unknown[]): Promise<void> {
    const handler = this.served.get(method)
    if (!handler) {
      this.send({ id, error: `no client handler for "${method}"` })
      return
    }
    try {
      this.send({ id, result: await handler(...args) })
    } catch (err) {
      this.send({ id, error: (err as Error).message })
    }
  }

  private send(frame: Record<string, unknown>): void {
    try {
      this.socket?.send(JSON.stringify(frame))
    } catch {
      // the socket went away mid-reply; the core's request will time out
    }
  }

  on(channel: string, listener: (payload: unknown) => void): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(channel)
    }
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.handleClose()
  }
}

/**
 * Discover the core's port and open a client, for the WebUI page.
 *
 * The port is ephemeral, so the fork's WebUI host injects it — as
 * `window.WEBDECK_CORE_PORT`, or a `?corePort=` on the chrome://webdeck URL.
 *
 * The connection token comes the same way, as `window.WEBDECK_CORE_TOKEN`, and
 * ONLY that way: it is deliberately not readable from the query string, because
 * a URL is the part of a request that gets logged, copied and forwarded. It is
 * passed as the WebSocket subprotocol (see auth.ts) — the one carrier a page can
 * actually set, since browsers do not let script add request headers here.
 *
 * A missing token is not substituted or defaulted: the socket is opened without
 * one and the core refuses it, which is the correct outcome and produces an
 * honest failure rather than a silently unauthenticated session.
 */
export function coreClientForWebUI(globals: {
  port?: number
  token?: string
  search?: string
  makeSocket: (url: string, protocols: string[]) => WsLike
}): CoreClient {
  const fromSearch = globals.search
    ? Number(new URLSearchParams(globals.search).get('corePort'))
    : NaN
  const port = globals.port ?? (Number.isFinite(fromSearch) ? fromSearch : NaN)
  if (!Number.isFinite(port)) {
    throw new Error('webdeck-core port not provided by the WebUI host')
  }
  const protocols = globals.token ? [coreAuthSubprotocol(globals.token)] : []
  return new CoreClient({ connect: () => globals.makeSocket(`ws://127.0.0.1:${port}`, protocols) })
}
