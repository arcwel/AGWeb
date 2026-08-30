import type { CoreRegistry } from '../rpc'

/**
 * The socket message layer — webdeck-core's second transport.
 *
 * Under the Chromium fork there is no Electron IPC, so the browser reaches the
 * service over a local socket. Whatever actually moves the bytes (a WebSocket,
 * a Unix domain socket, or Chromium's Mojo) is a thin shell around one pure
 * function: take a request frame, dispatch it through the same `CoreRegistry`
 * every other transport uses, hand back a response frame.
 *
 * Keeping the framing here — with no dependency on a socket library and no
 * Electron — means the whole request path is unit-testable today, long before
 * the fork exists, and proves the registry is genuinely transport-independent:
 * the exact invariant the migration rests on.
 */

export interface RpcRequest {
  /** Correlates the response; echoed back verbatim. Omitted on notifications. */
  id?: number | string
  method: string
  args?: unknown[]
  /** A fire-and-forget stream frame: dispatched to a notifier, no reply. */
  notify?: boolean
}

export interface RpcResponse {
  id: number | string | null
  result?: unknown
  error?: string
}

/**
 * Dispatch one request frame and produce its response frame.
 *
 * Never throws: a bad frame or a handler error becomes an `error` response, so
 * the byte layer above only ever has to write the string back.
 */
export async function handleRpcMessage(registry: CoreRegistry, raw: string): Promise<string> {
  let req: RpcRequest
  try {
    req = JSON.parse(raw) as RpcRequest
  } catch {
    return JSON.stringify({ id: null, error: 'malformed request' } satisfies RpcResponse)
  }
  if (typeof req?.method !== 'string') {
    return JSON.stringify({ id: req?.id ?? null, error: 'missing method' } satisfies RpcResponse)
  }
  // A notification is fire-and-forget: dispatch it, write nothing back.
  if (req.notify === true) {
    registry.notify(req.method, req.args ?? [])
    return ''
  }
  try {
    const result = await registry.dispatch(req.method, req.args ?? [])
    return JSON.stringify({ id: req.id ?? null, result } satisfies RpcResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'handler error'
    return JSON.stringify({ id: req.id ?? null, error: message } satisfies RpcResponse)
  }
}
