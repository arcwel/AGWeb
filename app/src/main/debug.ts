import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { coreEnv } from '../core/env'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import type { Message } from 'vscode-jsonrpc'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import { broadcast } from './windows'
import { getCurrentWorkspace } from './workspace'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'

/**
 * Debugging over DAP (task 12.4).
 *
 * The adapter is Microsoft's **js-debug**, vendored at install time from its
 * GitHub release (MIT). The Open VSX vsix could not be used: it packages the
 * *extension*, which needs an extension host to run — and ours is blocked on
 * origin isolation (task 12.8). The standalone `dapDebugServer.js` in the
 * release has no such dependency, which is what makes debugging shippable now.
 *
 * It covers `pwa-node` (Node and TypeScript, with source maps) and
 * `pwa-chrome` / `pwa-msedge` (the browser), so one adapter serves both halves
 * of an "IDE and browser" app.
 *
 * **Multiple connections, one adapter.** js-debug is a parent/child debugger:
 * the connection that handles `launch` does not own the debuggee. It sends a
 * `startDebugging` *reverse request* asking the client to open another
 * connection for the child session, and it is the child that hits breakpoints
 * and reports stack frames. A client that ignores that request connects, runs,
 * and never stops anywhere — so this module keeps a map of connections rather
 * than a single one, and tags every message with the connection it belongs to.
 *
 * Transport: main owns the process and the sockets and forwards decoded
 * messages to the renderer over IPC, the same shape as the language client in
 * task 12.2. The renderer never sees a socket or a Content-Length header.
 */

interface Connection {
  socket: Socket
  reader: StreamMessageReader
  writer: StreamMessageWriter
}

let adapter: ChildProcess | null = null
let adapterPort = 0
const connections = new Map<string, Connection>()

/** Where the vendored adapter lives, packaged or in development. */
function adapterPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'js-debug', 'src', 'dapDebugServer.js'),
    join(coreEnv().appDir, 'resources', 'js-debug', 'src', 'dapDebugServer.js'),
    join(process.cwd(), 'resources', 'js-debug', 'src', 'dapDebugServer.js')
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

export function isDebuggerAvailable(): boolean {
  return adapterPath() !== null
}

/** Wait for the adapter to print its listening banner, then read the port. */
function waitForPort(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the debug adapter did not start')), timeoutMs)
    let buffered = ''
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString()
      // "Debug server listening at 127.0.0.1:58321"
      const match = /listening at [^:]+:(\d+)/i.exec(buffered)
      if (!match) return
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      resolve(Number(match[1]))
    }
    child.stdout?.on('data', onData)
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('the debug adapter exited before it was ready'))
    })
  })
}

/** Open one DAP connection to the running adapter under the given id. */
function openConnection(id: string): Connection {
  const socket = connect(adapterPort, '127.0.0.1')
  const reader = new StreamMessageReader(socket)
  const writer = new StreamMessageWriter(socket)

  reader.listen((message: Message) =>
    broadcast(IpcEvents.debugMessage, { sessionId: id, message }, null)
  )
  reader.onError(() => closeConnection(id))
  socket.on('error', () => closeConnection(id))

  const connection: Connection = { socket, reader, writer }
  connections.set(id, connection)
  return connection
}

function closeConnection(id: string): void {
  const connection = connections.get(id)
  if (!connection) return
  connections.delete(id)
  connection.reader.dispose()
  connection.writer.dispose()
  connection.socket.destroy()
}

/**
 * Start the adapter and open the root connection.
 *
 * One adapter process at a time: a second Start replaces the first rather than
 * leaving an orphan holding a port and a debuggee.
 */
export async function startDebugSession(): Promise<{ error?: string }> {
  stopDebugSession()

  const path = adapterPath()
  if (!path) {
    return { error: 'The debug adapter is not installed. Run scripts/fetch-js-debug.mjs.' }
  }
  const cwd = getCurrentWorkspace()?.path
  if (!cwd) return { error: 'No workspace open.' }

  // Port 0 lets the adapter pick a free port and tell us which.
  const child = spawn(process.execPath, [path, '0', '127.0.0.1'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.error(`[dap] ${text}`)
  })

  try {
    adapterPort = await waitForPort(child, 20000)
  } catch (error) {
    child.kill()
    return { error: String(error instanceof Error ? error.message : error) }
  }

  child.on('exit', () => {
    adapter = null
    for (const id of [...connections.keys()]) closeConnection(id)
    broadcast(IpcEvents.debugExit, null, null)
  })

  adapter = child
  openConnection('root')
  return {}
}

/**
 * Open a child session (the `startDebugging` reverse request).
 *
 * The child connects to the same adapter; js-debug matches it to the pending
 * target carried in the configuration the renderer echoes back.
 */
export function attachDebugChild(id: string): { error?: string } {
  if (!adapter) return { error: 'No debug session is running.' }
  if (connections.has(id)) return {}
  openConnection(id)
  return {}
}

export function sendToDebugAdapter(sessionId: string, message: Message): void {
  const connection = connections.get(sessionId)
  if (!connection) return
  void connection.writer.write(message).catch(() => {
    // The adapter died between the check and the write; the exit handler has
    // already told the renderer.
  })
}

export function stopDebugSession(): void {
  for (const id of [...connections.keys()]) closeConnection(id)
  const child = adapter
  adapter = null
  adapterPort = 0
  child?.kill()
}

/** Register the debugger domain with webdeck-core (P1). `debugSend` stays a
 *  streaming ipcMain.on channel until the transport gains a notify path. */
export function registerDebugRpc(): void {
  core.register(IpcChannels.debugAvailable, () => isDebuggerAvailable())
  core.register(IpcChannels.debugStart, () => startDebugSession())
  core.register(IpcChannels.debugAttachChild, (sessionId) => {
    const id = asString(sessionId)
    return id ? attachDebugChild(id) : { error: 'bad arguments' }
  })
  core.register(IpcChannels.debugStop, () => stopDebugSession())
  core.registerNotify(IpcChannels.debugSend, (sessionId, message) => {
    const id = asString(sessionId)
    if (id && message && typeof message === 'object') {
      sendToDebugAdapter(id, message as Parameters<typeof sendToDebugAdapter>[1])
    }
  })
}
