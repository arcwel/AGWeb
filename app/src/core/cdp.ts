import { WebSocket } from 'ws'

/**
 * A minimal Chrome DevTools Protocol client.
 *
 * Under Electron the agent drove tabs through `webContents`, which is an API
 * the shell hands us. The fork has no such object in the core process — the
 * browser is a separate program — so the core speaks the protocol Chromium
 * already exposes for exactly this.
 *
 * Deliberately small: one socket per target, promise-per-command, events to
 * subscribers. No dependency on a CDP library, because the surface we need is
 * about a dozen commands and a library would pull in a browser launcher, a
 * protocol schema, and a version-matching problem we do not have.
 */

export interface CdpEvent {
  method: string
  params: unknown
}

export interface CdpSession {
  /** Send a command and resolve with its result. Rejects on protocol errors. */
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribe to protocol events. Returns an unsubscribe function. */
  on(listener: (event: CdpEvent) => void): () => void
  /** Whether the socket is still usable. */
  readonly open: boolean
  close(): void
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Connect to a CDP target's WebSocket URL. */
export async function connectCdp(
  webSocketDebuggerUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CdpSession> {
  // Screenshots and page text arrive as one big frame; the default 100 MB cap
  // is fine but the default 16 KB *fragment* handling is not, so be explicit.
  const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })

  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(new Error(`could not connect to the browser: ${err.message}`))
    }
    const timer = setTimeout(() => {
      cleanup()
      ws.terminate()
      reject(new Error(`timed out connecting to the browser after ${timeoutMs}ms`))
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      ws.removeListener('open', onOpen)
      ws.removeListener('error', onError)
    }
    ws.once('open', onOpen)
    ws.once('error', onError)
  })

  const pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >()
  const listeners = new Set<(event: CdpEvent) => void>()
  let nextId = 0
  let open = true

  /** Reject everything in flight — a closed socket will never answer them. */
  const failAll = (reason: string): void => {
    open = false
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    pending.clear()
  }

  ws.on('message', (raw) => {
    let msg: { id?: number; error?: { message?: string }; result?: unknown; method?: string }
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return // a frame we cannot parse is not worth crashing the agent over
    }
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) entry.reject(new Error(msg.error.message ?? 'CDP error'))
      else entry.resolve(msg.result as never)
      return
    }
    if (msg.method) {
      const event = { method: msg.method, params: (msg as { params?: unknown }).params }
      // A throwing listener must not take down the socket or the other listeners.
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // best-effort: vision aggregation is never worth failing a command for
        }
      }
    }
  })

  ws.on('close', () => failAll('the browser connection closed'))
  ws.on('error', (err) => failAll(`the browser connection failed: ${err.message}`))

  return {
    get open() {
      return open
    },
    send<T = Record<string, unknown>>(
      method: string,
      params: Record<string, unknown> = {}
    ): Promise<T> {
      if (!open) return Promise.reject(new Error('the browser connection is closed'))
      const id = ++nextId
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`${method} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(id, {
          resolve: resolve as (value: never) => void,
          reject,
          timer
        })
        try {
          ws.send(JSON.stringify({ id, method, params }))
        } catch (err) {
          pending.delete(id)
          clearTimeout(timer)
          reject(new Error(`could not send ${method}: ${(err as Error).message}`))
        }
      })
    },
    on(listener: (event: CdpEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close(): void {
      failAll('the browser connection was closed locally')
      try {
        ws.close()
      } catch {
        // already gone
      }
    }
  }
}

/** A target as reported by the browser's /json/list endpoint. */
export interface CdpTarget {
  id: string
  type: string
  url: string
  title: string
  webSocketDebuggerUrl: string
}

/** Ask a browser on `port` for its open targets. */
export async function listTargets(port: number): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`the browser's target list returned ${res.status}`)
  return (await res.json()) as CdpTarget[]
}

/** Ask a browser on `port` to open a new tab, and return its target. */
export async function createTarget(port: number, url: string): Promise<CdpTarget> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT'
  })
  if (!res.ok) throw new Error(`the browser refused to open a tab (${res.status})`)
  return (await res.json()) as CdpTarget
}

/** Ask a browser on `port` to close a target. */
export async function closeTarget(port: number, targetId: string): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {})
}
