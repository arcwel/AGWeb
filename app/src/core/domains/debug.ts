import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { coreEnv } from '../env'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import type { Message } from 'vscode-jsonrpc'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import { coreBroadcast } from '../notify'
import { getCurrentWorkspace } from './workspace'
import { core } from '../rpc'
import { asString } from '../coerce'

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

/** Where the vendored adapter lives: the core runtime dir, or the dev checkout. */
function adapterPath(): string | null {
  const candidates = [
    join(coreEnv().appDir, 'resources', 'js-debug', 'src', 'dapDebugServer.js'),
    join(process.cwd(), 'resources', 'js-debug', 'src', 'dapDebugServer.js')
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

export function isDebuggerAvailable(): boolean {
  return adapterPath() !== null
}

/**
 * Debug adapters by language id.
 *
 * Only `node` (Microsoft js-debug, covering pwa-node / pwa-chrome / pwa-msedge)
 * is fully wired into the socket transport below: it is vendored, Node-based,
 * and rides the `ELECTRON_RUN_AS_NODE` path that lets a spawned script run
 * inside the SEA, so it is shippable today. The other entries are launch recipes
 * for adapters whose toolchain we do not bundle. `resolveDebugAdapter` reports
 * how — and whether — each one can start on this machine, so the remaining
 * transport work does not have to re-derive the spawn command. Adding a language
 * is one entry here plus its transport wiring.
 */
type AdapterKind = 'bundled-node' | 'system-python' | 'todo'

interface DebugAdapterSpec {
  kind: AdapterKind
  /** DAP transport the adapter speaks (js-debug opens a TCP socket; debugpy
   *  speaks DAP over the adapter process's own stdio). */
  transport: 'socket' | 'stdio'
  /** Human-readable summary for logs and docs. */
  note: string
}

const ADAPTERS: Record<string, DebugAdapterSpec> = {
  node: {
    kind: 'bundled-node',
    transport: 'socket',
    note: 'Microsoft js-debug (pwa-node / pwa-chrome / pwa-msedge), vendored and Node-based.'
  },
  // Python via debugpy. debugpy is a *Python* program, not a Node one, so it
  // cannot ride the ELECTRON_RUN_AS_NODE path the other adapters use and is not
  // bundled — it launches against the user's own interpreter as
  // `python3 -m debugpy.adapter` (stdio DAP) and requires `pip install debugpy`.
  python: {
    kind: 'system-python',
    transport: 'stdio',
    note: 'debugpy.adapter via system python3 (interpreter dependency, not bundled).'
  },
  // TODO(go): Delve. Large native binary — do NOT bundle here; vendor per
  // docs/LANGUAGE_SUPPORT.md, then wire the stdio transport.
  go: {
    kind: 'todo',
    transport: 'stdio',
    note: 'TODO: vendor Delve (`dlv dap`) — see docs/LANGUAGE_SUPPORT.md.'
  },
  // TODO(rust): codelldb. Large native binary — do NOT bundle here; vendor per
  // docs/LANGUAGE_SUPPORT.md, then wire the stdio transport.
  rust: {
    kind: 'todo',
    transport: 'stdio',
    note: 'TODO: vendor codelldb (`codelldb --port`) — see docs/LANGUAGE_SUPPORT.md.'
  }
}

/** Locate a system Python 3 interpreter, or null. Unlike the Node adapters,
 *  debugpy needs a real interpreter on the host; probe the usual names rather
 *  than assume one is installed. */
function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return candidate
  }
  return null
}

/**
 * Resolve how a language's debug adapter would launch, or a clear reason it
 * cannot on this machine.
 *
 * Non-throwing, mirroring the language-server resolver: a missing toolchain must
 * degrade to "no debugging for this language", never crash the service. Today
 * only the `node` (js-debug) recipe is consumed by startDebugSession; the Python
 * recipe is returned guarded (debugpy present on a discoverable python3) and the
 * go/rust entries report as not-yet-available.
 */
export function resolveDebugAdapter(
  id: string
): { command: string; args: string[]; transport: 'socket' | 'stdio' } | { error: string } {
  const spec = ADAPTERS[id]
  if (!spec) return { error: `No debug adapter configured for '${id}'.` }

  if (spec.kind === 'bundled-node') {
    const path = adapterPath()
    if (!path)
      return { error: 'The debug adapter is not installed. Run scripts/fetch-js-debug.mjs.' }
    // Same argv js-debug's own start path uses: port 0 = pick a free port.
    return { command: process.execPath, args: [path, '0', '127.0.0.1'], transport: 'socket' }
  }

  if (spec.kind === 'system-python') {
    const python = findPython()
    if (!python) {
      return {
        error:
          'Python debugging needs a system Python 3 with debugpy installed ' +
          '(`pip install debugpy`); no python3 was found on PATH.'
      }
    }
    return { command: python, args: ['-m', 'debugpy.adapter'], transport: 'stdio' }
  }

  return { error: `Debugging for '${id}' is not vendored yet. See docs/LANGUAGE_SUPPORT.md.` }
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
    coreBroadcast(IpcEvents.debugMessage, { sessionId: id, message }, null)
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
    coreBroadcast(IpcEvents.debugExit, null, null)
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
