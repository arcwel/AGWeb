import { MonacoLanguageClient } from 'monaco-languageclient'
import { CloseAction, ErrorAction } from 'vscode-languageclient'
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  type DataCallback,
  type Disposable,
  type Message,
  type MessageReader,
  type MessageWriter
} from 'vscode-jsonrpc'
import { Uri } from 'vscode'
import { ensureWorkspaceRoot, monacoReady } from '@/monaco'

/**
 * Language intelligence over LSP (task 12.2).
 *
 * Completion, go-to-definition, find-references, rename, hover, diagnostics and
 * code actions all arrive through this one client — the capability Monaco's
 * bundled per-language workers only ever approximated, and which they no longer
 * provide at all now that VS Code's service layer is underneath (task 12.1).
 *
 * The server itself runs in the main process, which owns the child process and
 * the stdio framing. Here we only need a reader and a writer over the IPC
 * bridge; everything above that is `vscode-languageclient` doing what it does
 * inside VS Code.
 */

/** Which language ids each server is responsible for. */
const SERVER_LANGUAGES: Record<string, string[]> = {
  typescript: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']
}

/**
 * Per-server initialization options.
 *
 * `useSyntaxServer: 'never'` is load-bearing, not a preference. tsserver
 * normally forks a second "syntax" process, and that fork fails under the
 * Electron-as-node runtime the server is launched with — the language server
 * starts, answers `initialize`, and then silently returns nothing for every
 * request. Keeping tsserver in single-process mode makes diagnostics,
 * completion and the rest actually arrive.
 */
const INIT_OPTIONS: Record<string, unknown> = {
  typescript: { tsserver: { useSyntaxServer: 'never' } }
}

/** The server that handles a language id, if any. */
export function serverForLanguage(language: string): string | null {
  for (const [id, languages] of Object.entries(SERVER_LANGUAGES)) {
    if (languages.includes(language)) return id
  }
  return null
}

class IpcMessageReader extends AbstractMessageReader implements MessageReader {
  private unsubscribe: (() => void) | null = null

  constructor(private readonly id: string) {
    super()
  }

  listen(callback: DataCallback): Disposable {
    this.unsubscribe = window.agweb.lsp.onMessage((id, message) => {
      // One IPC channel carries every server, so each reader filters to its own.
      if (id === this.id) callback(message as Message)
    })
    return { dispose: () => this.dispose() }
  }

  override dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    super.dispose()
  }
}

class IpcMessageWriter extends AbstractMessageWriter implements MessageWriter {
  constructor(private readonly id: string) {
    super()
  }

  async write(message: Message): Promise<void> {
    window.agweb.lsp.send(this.id, message)
  }

  end(): void {
    // Nothing to flush: IPC sends are already individual messages.
  }
}

const clients = new Map<string, MonacoLanguageClient>()
const starting = new Map<string, Promise<void>>()

/**
 * Start the language server for a language, once.
 *
 * Failure is deliberately quiet at the call site: a language with no server, or
 * a server that will not start, should leave the editor working without
 * IntelliSense rather than break opening the file. The reason is returned so a
 * caller that wants to surface it can.
 */
export async function ensureLanguageClient(language: string): Promise<{ error?: string }> {
  const id = serverForLanguage(language)
  if (!id) return {}
  if (clients.has(id)) return {}

  const inFlight = starting.get(id)
  if (inFlight) {
    await inFlight
    return {}
  }

  const run = (async (): Promise<void> => {
    await monacoReady
    const root = await ensureWorkspaceRoot()
    if (!root) throw new Error('No workspace open.')

    const started = await window.agweb.lsp.start(id)
    if (started.error) throw new Error(started.error)

    const client = new MonacoLanguageClient({
      name: `WebDeck ${id} language server`,
      clientOptions: {
        documentSelector: SERVER_LANGUAGES[id],
        initializationOptions: INIT_OPTIONS[id],
        workspaceFolder: { uri: Uri.file(root), name: 'workspace', index: 0 },
        // The server process is main's to manage; if it goes away, close the
        // client rather than having the client try to respawn something it
        // does not own.
        errorHandler: {
          error: () => ({ action: ErrorAction.Continue }),
          closed: () => ({ action: CloseAction.DoNotRestart })
        }
      },
      messageTransports: {
        reader: new IpcMessageReader(id),
        writer: new IpcMessageWriter(id)
      }
    })

    await client.start()
    clients.set(id, client)
  })()

  starting.set(id, run)
  try {
    await run
    return {}
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e) }
  } finally {
    starting.delete(id)
  }
}

/** A symbol in the outline, flattened to what the breadcrumb bar needs. */
export interface OutlineSymbol {
  name: string
  /** LSP SymbolKind, used to pick the glyph. */
  kind: number
  /** Zero-based start line, for revealing the symbol in the editor. */
  line: number
  /** Nesting depth, so the outline can indent without a tree structure. */
  depth: number
}

interface RawSymbol {
  name: string
  kind: number
  range?: { start: { line: number } }
  location?: { range: { start: { line: number } } }
  children?: RawSymbol[]
}

function flatten(symbols: RawSymbol[], depth: number, into: OutlineSymbol[]): void {
  for (const symbol of symbols) {
    const line = symbol.range?.start.line ?? symbol.location?.range.start.line ?? 0
    into.push({ name: symbol.name, kind: symbol.kind, line, depth })
    if (symbol.children?.length) flatten(symbol.children, depth + 1, into)
  }
}

/**
 * Document symbols for a file (task 12.7).
 *
 * Servers may answer with either the hierarchical `DocumentSymbol[]` or the
 * flat `SymbolInformation[]`; both are flattened to one list here so callers
 * never have to care which shape arrived.
 */
export async function documentSymbols(language: string, uri: string): Promise<OutlineSymbol[]> {
  const id = serverForLanguage(language)
  const client = id ? clients.get(id) : undefined
  if (!client) return []
  try {
    const result = await client.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri }
    })
    if (!Array.isArray(result)) return []
    const out: OutlineSymbol[] = []
    flatten(result as RawSymbol[], 0, out)
    return out
  } catch {
    // The server may not implement it, or may still be indexing. An empty
    // outline is the honest answer; breadcrumbs just stay hidden.
    return []
  }
}
