import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { core } from '../rpc'
import { asString } from '../coerce'
import { coreBroadcast } from '../notify'
import {
  IpcChannels,
  IpcEvents,
  type JupyterConnectResult,
  type JupyterExecuteResult,
  type JupyterKernelInfo,
  type JupyterOutput,
  type JupyterOutputData,
  type JupyterStartResult
} from '@shared/ipc'

/**
 * Jupyter notebook (roadmap C10): the core connects to a *running* Jupyter
 * Server the user points it at (URL + token) and runs code cells for the
 * Notebook block.
 *
 * There is no ZMQ and no spawned kernel here — the core talks to Jupyter Server
 * over the transports it already exposes: REST for lifecycle (list/start/interrupt
 * a kernel) and one WebSocket per kernel for the Jupyter messaging protocol
 * (v5.3). We speak that protocol by hand because there is no `@jupyterlab/services`
 * in the SEA; the wire shapes are small and stable.
 *
 * Why the core and not the renderer: `chrome://webdeck` runs under a strict CSP
 * that forbids arbitrary cross-origin fetches and sockets, and cannot set the
 * `Authorization` header Jupyter wants. The core (Node, undici `fetch`, `ws`)
 * has none of those limits. Like `rest.ts`/`db.ts` this is the *user's* own
 * click — they typed the URL and token — so it is not routed through the agent
 * policy engine; it never throws across the RPC boundary; failures come back as
 * `{ error }`.
 *
 * State is deliberately singular: one connection (base URL + token) and one open
 * kernel socket at a time, which is all the v1 block drives. Reconnecting or
 * starting another kernel replaces what came before.
 *
 * SSRF note: same posture as `rest.ts`. A localhost/LAN Jupyter is the expected
 * target and is allowed on purpose; only non-http(s) schemes and the well-known
 * cloud metadata hosts are refused.
 */

/** Abort a REST call that never answers, so a dead server can't wedge the block. */
const REST_TIMEOUT_MS = 15_000
/** Cap on how long we wait for the kernel socket to open before giving up. */
const SOCKET_OPEN_TIMEOUT_MS = 15_000
/** Kernel output (a rendered image, say) can be large — lift the ws payload cap. */
const MAX_WS_PAYLOAD = 64 * 1024 * 1024

/**
 * Cloud/CI metadata endpoints, refused so a connect inside a cloud sandbox can't
 * be aimed at the IAM service. Mirrors `rest.ts` (a hostname/literal-IP blocklist,
 * not a resolved-IP check — the same accepted gap for a local dev tool).
 */
const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  'fd00:ec2::254',
  '[fd00:ec2::254]',
  '100.100.100.200'
])

/** A validated server the block is connected to. */
interface Connection {
  /** Origin + optional base path, no trailing slash (e.g. `http://localhost:8888`). */
  baseUrl: string
  token: string
}

/** The single open kernel socket and the state that correlates its replies. */
interface KernelSession {
  kernelId: string
  socket: WebSocket
  /** The Jupyter session id threaded through every message header. */
  session: string
  /** In-flight executions, keyed by the shell `execute_request` msg_id. */
  pending: Map<string, PendingExec>
}

/** One awaited `execute()`, resolved when its kernel returns to idle. */
interface PendingExec {
  /** The renderer-minted id every output for this run is tagged with. */
  execId: string
  resolve: (result: JupyterExecuteResult) => void
  settled: boolean
  /** Captured from any reply that carries it, reported on the `done` event. */
  executionCount?: number
}

let connection: Connection | null = null
let kernel: KernelSession | null = null

/** Turn any thrown value into a readable message. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** Trim a trailing slash so path joins don't double up. */
function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Reject a base URL that isn't a plain http(s) address, or that points at a
 * cloud metadata host. Returns the parsed URL on success, an error string on
 * failure — never throws.
 */
function validateBase(baseUrl: string): { url?: URL; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return { error: 'Enter the Jupyter server URL (e.g. http://localhost:8888).' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `Only http and https URLs are allowed, not ${parsed.protocol}` }
  }
  if (BLOCKED_METADATA_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { error: 'Connections to cloud metadata endpoints are blocked.' }
  }
  return { url: parsed }
}

/**
 * Derive the kernel-channel WebSocket URL from a server base URL.
 *
 * `http` → `ws`, `https` → `wss`; the host, port and any base path are kept, the
 * kernel-channels path is appended, and the token (when present) rides as a
 * query param — the ws handshake cannot carry the `Authorization` header the
 * REST calls use.
 */
export function wsUrlFromBase(baseUrl: string, kernelId: string, token: string): string {
  const url = new URL(normalizeBase(baseUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = url.pathname.replace(/\/+$/, '')
  url.pathname = `${base}/api/kernels/${kernelId}/channels`
  url.search = token ? `?token=${encodeURIComponent(token)}` : ''
  return url.toString()
}

/**
 * Build a v5.3 `execute_request` for the shell channel. The `msg_id` is fresh on
 * every call (that is what replies are correlated by); `session` threads the
 * connection's session id through the header.
 */
export function buildExecuteRequest(code: string, session: string): Record<string, unknown> {
  return {
    header: {
      msg_id: randomUUID(),
      session,
      username: 'webdeck',
      msg_type: 'execute_request',
      version: '5.3',
      date: new Date().toISOString()
    },
    parent_header: {},
    metadata: {},
    content: {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true
    },
    channel: 'shell'
  }
}

/** Read `parent_header.msg_id` off an untrusted message, or null if absent. */
function parentMsgId(msg: unknown): string | null {
  if (!msg || typeof msg !== 'object') return null
  const parent = (msg as { parent_header?: unknown }).parent_header
  if (!parent || typeof parent !== 'object') return null
  const id = (parent as { msg_id?: unknown }).msg_id
  return typeof id === 'string' ? id : null
}

/** True when `msg` is a reply whose parent is the request we sent as `msgId`. */
export function isReplyTo(msg: unknown, msgId: string): boolean {
  return parentMsgId(msg) === msgId
}

/** Pull the string fields out of an untrusted MIME bundle we know how to render. */
function pickMimeData(data: unknown): JupyterOutputData {
  const bundle = (data ?? {}) as Record<string, unknown>
  const out: JupyterOutputData = {}
  if (typeof bundle['text/plain'] === 'string') out['text/plain'] = bundle['text/plain']
  if (typeof bundle['image/png'] === 'string') out['image/png'] = bundle['image/png']
  if (typeof bundle['text/html'] === 'string') out['text/html'] = bundle['text/html']
  return out
}

/**
 * Map one iopub message to a typed `JupyterOutput`, or null when it carries
 * nothing the block renders (busy/starting status, execute_input, comms, an
 * unknown type, an unparseable frame).
 *
 * Accepts either a raw ws frame (string/Buffer) or an already-parsed object, so
 * it is trivial to unit-test. Correlation to a specific run is *not* done here —
 * that is `isReplyTo`'s job — so a caller pairs the two.
 */
export function parseIopubMessage(raw: unknown): JupyterOutput | null {
  let msg: unknown = raw
  if (typeof raw === 'string' || raw instanceof Buffer || raw instanceof Uint8Array) {
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return null
    }
  }
  if (!msg || typeof msg !== 'object') return null

  const header = (msg as { header?: unknown }).header
  const msgType =
    header && typeof header === 'object' ? (header as { msg_type?: unknown }).msg_type : undefined
  const content = ((msg as { content?: unknown }).content ?? {}) as Record<string, unknown>

  switch (msgType) {
    case 'stream':
      return {
        kind: 'stream',
        name: typeof content.name === 'string' ? content.name : 'stdout',
        text: typeof content.text === 'string' ? content.text : ''
      }
    case 'execute_result':
    case 'display_data':
      return { kind: 'result', data: pickMimeData(content.data) }
    case 'error':
      return {
        kind: 'error',
        ename: typeof content.ename === 'string' ? content.ename : '',
        evalue: typeof content.evalue === 'string' ? content.evalue : '',
        traceback: Array.isArray(content.traceback)
          ? content.traceback.filter((line): line is string => typeof line === 'string')
          : []
      }
    case 'status':
      // Idle is the terminal signal for a run: the kernel is done with our
      // request. Busy/starting are ignored (they produce no cell output).
      return content.execution_state === 'idle' ? { kind: 'done' } : null
    default:
      return null
  }
}

/** Read a numeric `execution_count` off a reply's content, if present. */
function executionCountOf(msg: unknown): number | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const content = (msg as { content?: unknown }).content
  if (!content || typeof content !== 'object') return undefined
  const count = (content as { execution_count?: unknown }).execution_count
  return typeof count === 'number' ? count : undefined
}

/** Whether a message is the shell `execute_reply` that ends a run. */
function isExecuteReply(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const header = (msg as { header?: unknown }).header
  if (!header || typeof header !== 'object') return false
  return (header as { msg_type?: unknown }).msg_type === 'execute_reply'
}

/**
 * Settle one pending execution exactly once: emit its terminal `done` event
 * (with the execution count we saw) and resolve the awaiting RPC.
 */
function finish(entry: PendingExec, msgId: string): void {
  if (entry.settled) return
  entry.settled = true
  const done: JupyterOutput =
    entry.executionCount === undefined
      ? { kind: 'done' }
      : { kind: 'done', executionCount: entry.executionCount }
  coreBroadcast(IpcEvents.jupyterOutput, { execId: entry.execId, output: done }, null)
  kernel?.pending.delete(msgId)
  entry.resolve({})
}

/** Route one incoming ws frame to the run it belongs to, streaming its output. */
function handleKernelMessage(raw: unknown): void {
  const current = kernel
  if (!current) return
  let msg: unknown
  try {
    const text =
      typeof raw === 'string' || raw instanceof Buffer || raw instanceof Uint8Array
        ? raw.toString()
        : ''
    msg = text ? JSON.parse(text) : null
  } catch {
    return // a frame we cannot parse is not worth crashing the core over
  }
  if (!msg) return

  for (const [msgId, entry] of current.pending) {
    if (!isReplyTo(msg, msgId)) continue

    const count = executionCountOf(msg)
    if (count !== undefined) entry.executionCount = count

    // The shell reply and the idle status both mark completion; take whichever
    // arrives first (the `settled` guard makes the second a no-op).
    if (isExecuteReply(msg)) {
      finish(entry, msgId)
      return
    }

    const output = parseIopubMessage(msg)
    if (!output) return
    if (output.kind === 'done') {
      finish(entry, msgId)
    } else {
      coreBroadcast(IpcEvents.jupyterOutput, { execId: entry.execId, output }, null)
    }
    return
  }
}

/**
 * Validate a server URL + token by listing its kernels. On success the
 * connection is remembered for `startKernel`/`execute`; on failure nothing is
 * stored and the reason comes back as `error`.
 */
export async function connect(baseUrl: string, token: string): Promise<JupyterConnectResult> {
  const normalized = normalizeBase(baseUrl)
  const { url, error } = validateBase(normalized)
  if (!url) return { ok: false, error }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS)
  try {
    const response = await fetch(`${normalized}/api/kernels`, {
      headers: token ? { Authorization: `token ${token}` } : {},
      signal: controller.signal
    })
    if (!response.ok) {
      const detail =
        response.status === 403
          ? 'the token was rejected'
          : `the server returned ${response.status}`
      return { ok: false, error: `Could not connect: ${detail}.` }
    }
    const body: unknown = await response.json()
    const kernels: JupyterKernelInfo[] = Array.isArray(body)
      ? body.flatMap((k) => {
          const obj = (k ?? {}) as Record<string, unknown>
          const id = obj.id
          const name = obj.name
          return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : []
        })
      : []
    connection = { baseUrl: normalized, token }
    return { ok: true, kernels }
  } catch (e) {
    if (controller.signal.aborted) {
      return { ok: false, error: `Connection timed out after ${REST_TIMEOUT_MS / 1000}s.` }
    }
    const err = e as { cause?: { message?: string }; message?: string }
    return { ok: false, error: (err.cause?.message || err.message || String(e)).trim() }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start a kernel and open its channel socket. Requires a prior `connect`. Any
 * previously open kernel socket is closed first — the block drives one at a time.
 */
export async function startKernel(name = 'python3'): Promise<JupyterStartResult> {
  if (!connection) return { error: 'Connect to a Jupyter server first.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS)
  try {
    const response = await fetch(`${connection.baseUrl}/api/kernels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(connection.token ? { Authorization: `token ${connection.token}` } : {})
      },
      body: JSON.stringify({ name }),
      signal: controller.signal
    })
    if (!response.ok) {
      return { error: `Could not start a kernel (${response.status}).` }
    }
    const body = (await response.json()) as Record<string, unknown>
    const kernelId = typeof body.id === 'string' ? body.id : ''
    if (!kernelId) return { error: 'The server did not return a kernel id.' }
    const kernelName = typeof body.name === 'string' ? body.name : name

    await openKernelSocket(kernelId)
    return { kernel: { id: kernelId, name: kernelName } }
  } catch (e) {
    if (controller.signal.aborted) {
      return { error: `Starting a kernel timed out after ${REST_TIMEOUT_MS / 1000}s.` }
    }
    return { error: errorMessage(e) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Open the kernel-channels WebSocket and wait for it to be usable. Replaces any
 * existing kernel session. Rejects on a connection failure or timeout — callers
 * translate that into `{ error }`.
 */
export async function openKernelSocket(kernelId: string): Promise<void> {
  if (!connection) throw new Error('Not connected to a Jupyter server.')
  closeSocket()

  const url = wsUrlFromBase(connection.baseUrl, kernelId, connection.token)
  const socket = new WebSocket(url, { maxPayload: MAX_WS_PAYLOAD })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      socket.terminate()
      reject(new Error(`Timed out opening the kernel socket after ${SOCKET_OPEN_TIMEOUT_MS}ms.`))
    }, SOCKET_OPEN_TIMEOUT_MS)
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(new Error(`Could not open the kernel socket: ${err.message}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('open', onOpen)
      socket.removeListener('error', onError)
    }
    socket.once('open', onOpen)
    socket.once('error', onError)
  })

  const session: KernelSession = {
    kernelId,
    socket,
    session: randomUUID(),
    pending: new Map()
  }
  socket.on('message', handleKernelMessage)
  // A dropped socket must not leave executions hanging forever.
  socket.on('close', () => failPending('The kernel connection closed.'))
  socket.on('error', () => failPending('The kernel connection failed.'))
  kernel = session
}

/**
 * Run code on the open kernel. Resolves when the kernel returns to idle; the
 * cell's outputs stream out on `jupyterOutput` keyed by `execId` in the meantime.
 */
export function execute(execId: string, code: string): Promise<JupyterExecuteResult> {
  const current = kernel
  if (!current || current.socket.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ error: 'No kernel is running. Connect and start a kernel first.' })
  }
  const request = buildExecuteRequest(code, current.session)
  const msgId = (request.header as { msg_id: string }).msg_id

  return new Promise<JupyterExecuteResult>((resolve) => {
    current.pending.set(msgId, { execId, resolve, settled: false })
    try {
      current.socket.send(JSON.stringify(request))
    } catch (e) {
      current.pending.delete(msgId)
      resolve({ error: `Could not send code to the kernel: ${errorMessage(e)}` })
    }
  })
}

/** Interrupt the running kernel via REST (POST …/interrupt). */
export async function interrupt(): Promise<{ error?: string }> {
  if (!connection || !kernel) return { error: 'No kernel is running.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS)
  try {
    const response = await fetch(`${connection.baseUrl}/api/kernels/${kernel.kernelId}/interrupt`, {
      method: 'POST',
      headers: connection.token ? { Authorization: `token ${connection.token}` } : {},
      signal: controller.signal
    })
    return response.ok ? {} : { error: `Interrupt failed (${response.status}).` }
  } catch (e) {
    if (controller.signal.aborted) return { error: 'Interrupt timed out.' }
    return { error: errorMessage(e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve every in-flight execution with an error — the socket is gone. */
function failPending(reason: string): void {
  if (!kernel) return
  for (const [msgId, entry] of kernel.pending) {
    if (entry.settled) continue
    entry.settled = true
    entry.resolve({ error: reason })
    kernel.pending.delete(msgId)
  }
}

/** Close and forget the current kernel socket, failing anything in flight. */
function closeSocket(): void {
  if (!kernel) return
  failPending('The kernel connection was closed.')
  try {
    kernel.socket.removeAllListeners('message')
    kernel.socket.close()
  } catch {
    // already gone — close must not throw
  }
  kernel = null
}

/**
 * Close our kernel socket. The kernel keeps running server-side (v1: we never
 * shut it down for the user), so reconnecting can pick it back up.
 */
export function disconnect(): void {
  closeSocket()
  connection = null
}

/** Best-effort teardown when the process is going away. */
process.once('exit', () => {
  try {
    kernel?.socket.terminate()
  } catch {
    // shutting down
  }
})

/** Register the Jupyter notebook domain with webdeck-core (roadmap C10). */
export function registerJupyterRpc(): void {
  core.register(IpcChannels.jupyterConnect, (baseUrl, token) => {
    const url = asString(baseUrl)
    if (url === null) return { ok: false, error: 'bad arguments' }
    return connect(url, asString(token) ?? '')
  })
  core.register(IpcChannels.jupyterStartKernel, (name) => {
    const kernelName = asString(name)
    return startKernel(kernelName && kernelName.trim() ? kernelName : 'python3')
  })
  core.register(IpcChannels.jupyterExecute, (execId, code) => {
    const id = asString(execId)
    const text = asString(code)
    if (id === null || text === null) return { error: 'bad arguments' }
    return execute(id, text)
  })
  core.register(IpcChannels.jupyterInterrupt, () => interrupt())
  core.register(IpcChannels.jupyterDisconnect, () => {
    disconnect()
  })
}
