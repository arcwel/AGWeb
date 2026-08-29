import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import type { Message } from 'vscode-jsonrpc'
import { IpcEvents } from '@shared/ipc'
import { broadcast } from './windows'

/**
 * Language servers (task 12.2).
 *
 * The single biggest capability gap between "Monaco in a window" and an IDE is
 * language intelligence — completion, go-to-definition, find-references,
 * rename, hover, diagnostics, code actions. Monaco's bundled workers only ever
 * approximated that for four languages; a real language server does it properly
 * for any language that has one.
 *
 * The server runs here, in main, because it is a Node process that needs the
 * real filesystem. The renderer speaks LSP to it through IPC: main owns the
 * child process and the stdio framing, and forwards decoded messages both ways,
 * so the renderer never sees a pipe or a Content-Length header.
 *
 * Servers are spawned with Electron's own binary in Node mode rather than a
 * system `node`, so language support does not depend on what the user happens
 * to have installed.
 */

interface ServerSpec {
  /** Package whose bin is the server entry point. */
  module: string
  args: string[]
}

/**
 * Servers by id. Adding a language is a line here plus its npm dependency —
 * the transport below is language-agnostic.
 */
const SERVERS: Record<string, ServerSpec> = {
  typescript: { module: 'typescript-language-server/lib/cli.mjs', args: ['--stdio'] }
}

interface Running {
  child: ChildProcess
  writer: StreamMessageWriter
  reader: StreamMessageReader
}

const running = new Map<string, Running>()

const require_ = createRequire(import.meta.url)

/** Resolve a server's entry script inside our own node_modules. */
function resolveServer(spec: ServerSpec): string | null {
  try {
    return require_.resolve(spec.module)
  } catch {
    return null
  }
}

/**
 * Start a language server, or do nothing if it is already up.
 *
 * Returns an error string rather than throwing: a missing language server
 * should degrade the editor to no-IntelliSense, never break opening a file.
 */
export function startLanguageServer(id: string, cwd: string): { error?: string } {
  if (running.has(id)) return {}
  const spec = SERVERS[id]
  if (!spec) return { error: `No language server configured for '${id}'.` }

  const entry = resolveServer(spec)
  if (!entry) return { error: `Language server '${id}' is not installed.` }

  const child = spawn(process.execPath, [entry, ...spec.args], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Run Electron's bundled Node rather than requiring a system install.
      ELECTRON_RUN_AS_NODE: '1'
    }
  })

  if (!child.stdout || !child.stdin) {
    child.kill()
    return { error: `Language server '${id}' produced no usable pipes.` }
  }

  // The server's own diagnostics. Without this a server that starts but cannot
  // work — a missing tsserver, an unreadable tsconfig — fails invisibly.
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.error(`[lsp:${id}] ${text}`)
  })

  const reader = new StreamMessageReader(child.stdout)
  const writer = new StreamMessageWriter(child.stdin)

  reader.listen((message: Message) => {
    broadcast(IpcEvents.lspMessage, { id, message }, null)
  })
  reader.onError(() => {
    // A framing error means the stream is no longer trustworthy; drop the
    // server so the next open starts a clean one.
    stopLanguageServer(id)
  })

  child.on('exit', () => {
    running.delete(id)
    broadcast(IpcEvents.lspExit, { id }, null)
  })

  running.set(id, { child, writer, reader })
  return {}
}

/** Forward one client message to the server. */
export function sendToLanguageServer(id: string, message: Message): void {
  const server = running.get(id)
  if (!server) return
  void server.writer.write(message).catch(() => {
    // The server died between our check and the write; the exit handler has
    // already told the renderer.
  })
}

export function stopLanguageServer(id: string): void {
  const server = running.get(id)
  if (!server) return
  running.delete(id)
  server.reader.dispose()
  server.writer.dispose()
  server.child.kill()
}

/** Shut every server down — app quit, or the workspace changing under them. */
export function stopAllLanguageServers(): void {
  for (const id of [...running.keys()]) stopLanguageServer(id)
}
