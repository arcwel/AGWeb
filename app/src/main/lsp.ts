import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import type { Message } from 'vscode-jsonrpc'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import { coreBroadcast } from '../core/notify'
import { getCurrentWorkspace } from './workspace'
import { coreEnv } from '../core/env'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'

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

/**
 * A native-binary language server (gopls, rust-analyzer): a standalone
 * executable, not a Node script. It ships under the runtime's
 * `resources/lsp-bin/<tool>/<platform>-<arch>/<bin>` (the same way js-debug is
 * vendored) and is spawned directly — no `process.execPath`, no
 * `ELECTRON_RUN_AS_NODE`, no require-anchor. The exact on-disk path depends on
 * `coreEnv().appDir`, so it is described here as a locator and resolved at spawn.
 */
interface NativeCommand {
  /** Vendor directory under resources/lsp-bin (e.g. 'rust-analyzer', 'gopls'). */
  tool: string
  /** Executable file name inside the platform-arch directory. */
  bin: string
}

interface ServerSpec {
  /**
   * Node-script server: the package whose bin is the entry point. Resolved
   * through the runtime-anchored `createRequire` and spawned as
   * `process.execPath [entry, ...args]` under `ELECTRON_RUN_AS_NODE`.
   * Mutually exclusive with `command`.
   */
  module?: string
  /**
   * Native-binary server: a standalone executable spawned directly. The
   * alternative to `module` for tools not written in Node (Go, Rust).
   */
  command?: NativeCommand
  args: string[]
}

/**
 * Servers by id. Adding a Node-script language is a line here plus its npm
 * dependency (shipped via RUNTIME_PACKAGES); a native-binary language is a line
 * here plus a vendored binary under resources/lsp-bin (see fetch-lsp-bins.mjs).
 * The transport below is language-agnostic.
 */
const SERVERS: Record<string, ServerSpec> = {
  typescript: { module: 'typescript-language-server/lib/cli.mjs', args: ['--stdio'] },
  // Pyright's stdio language server. The entry MUST be the top-level
  // langserver.index.js, not dist/pyright-langserver.js directly: it sets
  // global.__rootDirectory to dist/ before requiring the bundle, which is how
  // pyright finds its bundled typeshed-fallback stdlib stubs. Pyright pre-bundles
  // every dependency into dist/ (its package.json declares no runtime deps, only
  // optional fsevents), so — exactly like typescript-language-server — the single
  // package is the whole closure. Shipped via RUNTIME_PACKAGES in build-core.mjs.
  python: { module: 'pyright/langserver.index.js', args: ['--stdio'] },
  // rust-analyzer speaks LSP on stdio by default (no flag). Native binary,
  // vendored per-platform under resources/lsp-bin/rust-analyzer/. Absent binary
  // → resolveNativeCommand returns null → graceful "not installed".
  rust: { command: { tool: 'rust-analyzer', bin: 'rust-analyzer' }, args: [] },
  // gopls speaks LSP on stdio by default (no flag). Native binary, vendored
  // under resources/lsp-bin/gopls/ (built with `go install` — no official
  // prebuilt download; see fetch-lsp-bins.mjs).
  go: { command: { tool: 'gopls', bin: 'gopls' }, args: [] }
}

interface Running {
  child: ChildProcess
  writer: StreamMessageWriter
  reader: StreamMessageReader
}

const running = new Map<string, Running>()

// Anchor resolution where the language-server packages actually live. In the
// webdeck-core SEA, import.meta.url is the embedded main path (node_modules is
// unreachable from there), so anchor at the unpacked runtime dir instead; under
// Electron/dev, import.meta.url already sits beside node_modules. Same fix as
// terminal.ts — without it every server reads as "not installed" on the fork.
const require_ = createRequire(
  process.env.WEBDECK_CORE_RUNTIME
    ? join(process.env.WEBDECK_CORE_RUNTIME, 'noop.cjs')
    : import.meta.url
)

/** Resolve a Node-script server's entry script inside our own node_modules. */
function resolveServer(module: string): string | null {
  try {
    return require_.resolve(module)
  } catch {
    return null
  }
}

/**
 * Resolve a native-binary server's executable on disk, or null if it was not
 * vendored for this platform. Mirrors debug.ts's `adapterPath`: packaged
 * (`process.resourcesPath`), core runtime (`coreEnv().appDir`), and dev
 * (`process.cwd()`), tried in that order.
 */
function resolveNativeCommand(cmd: NativeCommand): string | null {
  const rel = join('lsp-bin', cmd.tool, `${process.platform}-${process.arch}`, cmd.bin)
  let appResources = ''
  try {
    // coreEnv() throws before setCoreEnv() runs; that is a startup bug elsewhere,
    // but a language server must never take the editor down, so tolerate it and
    // fall through to the other candidates (appResources stays empty).
    appResources = join(coreEnv().appDir, 'resources', rel)
  } catch {
    // Intentionally empty: the empty appResources is filtered out below.
  }
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, rel) : '',
    appResources,
    join(process.cwd(), 'resources', rel)
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
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

  // Two spawn models. A native binary (gopls, rust-analyzer) is launched
  // directly. A Node-script server rides Electron's bundled Node — this path is
  // kept byte-for-byte identical to before so typescript/python are unaffected.
  let child: ChildProcess
  if (spec.command) {
    const bin = resolveNativeCommand(spec.command)
    if (!bin) return { error: `Language server '${id}' is not installed.` }
    child = spawn(bin, spec.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } else if (spec.module) {
    const entry = resolveServer(spec.module)
    if (!entry) return { error: `Language server '${id}' is not installed.` }
    child = spawn(process.execPath, [entry, ...spec.args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Run Electron's bundled Node rather than requiring a system install.
        ELECTRON_RUN_AS_NODE: '1'
      }
    })
  } else {
    return { error: `Language server '${id}' is misconfigured.` }
  }

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
    coreBroadcast(IpcEvents.lspMessage, { id, message }, null)
  })
  reader.onError(() => {
    // A framing error means the stream is no longer trustworthy; drop the
    // server so the next open starts a clean one.
    stopLanguageServer(id)
  })

  // A spawn failure (a missing or non-executable binary — Google Drive strips
  // exec bits, and rust-analyzer/gopls live there) emits 'error'. Without a
  // listener that is an unhandled event that takes the whole core down; mirror
  // terminal.ts's getHost() and degrade the server to "not installed" instead.
  child.on('error', (err) => {
    running.delete(id)
    coreBroadcast(IpcEvents.lspExit, { id }, null)
    console.error(`[lsp:${id}] failed to start: ${err}`)
  })

  child.on('exit', () => {
    running.delete(id)
    coreBroadcast(IpcEvents.lspExit, { id }, null)
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

/** Register the language-server domain with webdeck-core (P1). `lspSend` stays a
 *  streaming ipcMain.on channel until the transport gains a notify path. */
export function registerLspRpc(): void {
  core.register(IpcChannels.lspStart, (id) => {
    const s = asString(id)
    if (!s) return { error: 'No language given.' }
    const workspace = getCurrentWorkspace()
    if (!workspace?.path) return { error: 'No workspace open.' }
    return startLanguageServer(s, workspace.path)
  })
  core.register(IpcChannels.lspStop, (id) => {
    const s = asString(id)
    if (s) stopLanguageServer(s)
  })
  core.registerNotify(IpcChannels.lspSend, (id, message) => {
    const s = asString(id)
    if (s && message && typeof message === 'object') {
      sendToLanguageServer(s, message as Parameters<typeof sendToLanguageServer>[1])
    }
  })
}
