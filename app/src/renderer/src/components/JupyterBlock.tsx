import { useCallback, useEffect, useRef, useState } from 'react'
import type { JupyterKernelInfo, JupyterOutput } from '@shared/ipc'
import { CloseIcon } from '@/components/icons'

/**
 * Jupyter notebook (roadmap C10): a notebook-style Deck block.
 *
 * Pure UI. It never opens a socket itself — `chrome://webdeck` runs under a CSP
 * that forbids it — but hands every operation to the core over
 * `window.agweb.jupyter`, which connects to a running Jupyter Server over REST +
 * a kernel WebSocket (see `src/main/jupyter.ts`). Cell outputs stream back on
 * `onOutput`, keyed by an execId the block mints per run.
 *
 * Flow: enter the server URL + token and Connect → the core validates the server
 * and starts a python3 kernel → add code cells and Run them (button or ⇧↵) →
 * each cell's outputs land in its own output area, tagged by execId.
 *
 * Safety: kernel output is untrusted. `text/plain`, `stream` and error
 * tracebacks are rendered as ANSI-stripped preformatted text; `image/png` as a
 * data-URI `<img>`; `text/html` is shown as ESCAPED text (never
 * dangerouslySetInnerHTML) so a crafted HTML result cannot run script here.
 */

const LAST_URL_KEY = 'agweb.jupyter.lastUrl'
const DEFAULT_URL = 'http://localhost:8888'

/** ANSI SGR/escape sequences kernels emit around tracebacks and stream text. */
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function loadLastUrl(): string {
  try {
    return localStorage.getItem(LAST_URL_KEY) ?? DEFAULT_URL
  } catch {
    return DEFAULT_URL
  }
}
function saveLastUrl(url: string): void {
  try {
    localStorage.setItem(LAST_URL_KEY, url)
  } catch {
    // storage unavailable — the URL just won't persist
  }
}

type ConnStatus = 'idle' | 'connecting' | 'connected'

/** One notebook cell. `execId` tags the run its streamed outputs belong to. */
interface Cell {
  id: string
  code: string
  outputs: JupyterOutput[]
  running: boolean
  execId: string | null
  executionCount: number | null
}

let nextCellId = 1
const makeCell = (code = ''): Cell => ({
  id: `cell-${nextCellId++}`,
  code,
  outputs: [],
  running: false,
  execId: null,
  executionCount: null
})

export function JupyterBlock(): React.JSX.Element {
  const [serverUrl, setServerUrl] = useState<string>(() => loadLastUrl())
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<ConnStatus>('idle')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [kernelInfo, setKernelInfo] = useState<JupyterKernelInfo | null>(null)

  const [cells, setCells] = useState<Cell[]>(() => [makeCell()])
  // Kept in sync so a run can read the current cell without listing `cells` as a
  // callback dependency (which would rebuild every handler on each keystroke).
  // Synced in an effect, not during render (the repo forbids ref writes there).
  const cellsRef = useRef(cells)
  useEffect(() => {
    cellsRef.current = cells
  }, [cells])

  // Bumped on every connect/disconnect. A connect captures it and drops its
  // result if the token moved — so a slow connect the user has since cancelled
  // (or replaced) can't land against the current state.
  const connGenRef = useRef(0)

  const connected = status === 'connected'

  // One subscription for the block's lifetime; outputs route to the matching
  // cell by execId via a functional update, so there is no stale-closure risk.
  useEffect(() => {
    const unsubscribe = window.agweb.jupyter.onOutput(({ execId, output }) => {
      setCells((prev) =>
        prev.map((cell) => {
          if (cell.execId !== execId) return cell
          if (output.kind === 'done') {
            return {
              ...cell,
              running: false,
              executionCount: output.executionCount ?? cell.executionCount
            }
          }
          return { ...cell, outputs: [...cell.outputs, output] }
        })
      )
    })
    return unsubscribe
  }, [])

  const connect = useCallback(async (): Promise<void> => {
    const url = serverUrl.trim()
    if (!url || status === 'connecting') return
    setStatus('connecting')
    setConnectError(null)
    const gen = ++connGenRef.current
    saveLastUrl(url)

    const res = await window.agweb.jupyter.connect(url, token.trim())
    if (connGenRef.current !== gen) return
    if (!res.ok) {
      setStatus('idle')
      setConnectError(res.error ?? 'Could not connect to the Jupyter server.')
      return
    }
    const started = await window.agweb.jupyter.startKernel('python3')
    if (connGenRef.current !== gen) return
    if (started.error || !started.kernel) {
      setStatus('idle')
      setConnectError(started.error ?? 'Could not start a kernel.')
      return
    }
    setKernelInfo(started.kernel)
    setStatus('connected')
  }, [serverUrl, token, status])

  const disconnect = useCallback(async (): Promise<void> => {
    connGenRef.current += 1
    await window.agweb.jupyter.disconnect()
    setStatus('idle')
    setKernelInfo(null)
    setCells((prev) => prev.map((cell) => ({ ...cell, running: false, execId: null })))
  }, [])

  const interrupt = useCallback((): void => {
    void window.agweb.jupyter.interrupt()
  }, [])

  const runCell = useCallback(async (cellId: string): Promise<void> => {
    const cell = cellsRef.current.find((c) => c.id === cellId)
    if (!cell || !cell.code.trim() || cell.running) return
    const execId = crypto.randomUUID()
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId ? { ...c, running: true, outputs: [], execId, executionCount: null } : c
      )
    )
    const result = await window.agweb.jupyter.execute(execId, cell.code)
    // Completion normally arrives as a `done` output event; a transport-level
    // failure surfaces only on the promise, so render it and stop the spinner.
    if (result.error) {
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId && c.execId === execId
            ? {
                ...c,
                running: false,
                outputs: [{ kind: 'error', ename: '', evalue: result.error ?? '', traceback: [] }]
              }
            : c
        )
      )
      return
    }
    // Belt-and-suspenders: if the done event was missed, clear the spinner.
    setCells((prev) =>
      prev.map((c) => (c.id === cellId && c.execId === execId ? { ...c, running: false } : c))
    )
  }, [])

  const setCellCode = useCallback((cellId: string, code: string): void => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, code } : c)))
  }, [])

  const addCell = useCallback((): void => {
    setCells((prev) => [...prev, makeCell()])
  }, [])

  const removeCell = useCallback((cellId: string): void => {
    setCells((prev) => {
      const next = prev.filter((c) => c.id !== cellId)
      return next.length ? next : [makeCell()]
    })
  }, [])

  const moveCell = useCallback((cellId: string, delta: -1 | 1): void => {
    setCells((prev) => {
      const index = prev.findIndex((c) => c.id === cellId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <ConnectionBar
        serverUrl={serverUrl}
        token={token}
        status={status}
        kernelInfo={kernelInfo}
        onServerUrl={setServerUrl}
        onToken={setToken}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
        onInterrupt={interrupt}
      />
      {connectError && (
        <div className="flex-none border-b border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-600 dark:text-rose-300">
          {connectError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="flex flex-col gap-2">
          {cells.map((cell, index) => (
            <CellView
              key={cell.id}
              cell={cell}
              index={index}
              total={cells.length}
              connected={connected}
              onCode={(code) => setCellCode(cell.id, code)}
              onRun={() => void runCell(cell.id)}
              onRemove={() => removeCell(cell.id)}
              onMove={(delta) => moveCell(cell.id, delta)}
            />
          ))}
        </div>
        <button
          onClick={addCell}
          className="mt-2 rounded px-2 py-0.5 text-[11px] font-semibold text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
        >
          + Add cell
        </button>
      </div>
    </div>
  )
}

function ConnectionBar({
  serverUrl,
  token,
  status,
  kernelInfo,
  onServerUrl,
  onToken,
  onConnect,
  onDisconnect,
  onInterrupt
}: {
  serverUrl: string
  token: string
  status: ConnStatus
  kernelInfo: JupyterKernelInfo | null
  onServerUrl: (url: string) => void
  onToken: (token: string) => void
  onConnect: () => void
  onDisconnect: () => void
  onInterrupt: () => void
}): React.JSX.Element {
  const connected = status === 'connected'
  const connecting = status === 'connecting'
  const canConnect = serverUrl.trim().length > 0 && !connecting
  const field =
    'min-w-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] outline-none focus:border-sky-500 disabled:opacity-60 dark:border-slate-700 dark:bg-[#0b0f14]'
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-slate-200 p-2 dark:border-slate-800">
      <input
        value={serverUrl}
        onChange={(e) => onServerUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canConnect && !connected) onConnect()
        }}
        placeholder="http://localhost:8888"
        aria-label="Jupyter server URL"
        spellCheck={false}
        disabled={connected}
        className={`${field} flex-1`}
      />
      <input
        value={token}
        onChange={(e) => onToken(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canConnect && !connected) onConnect()
        }}
        placeholder="token"
        aria-label="Jupyter server token"
        type="password"
        spellCheck={false}
        disabled={connected}
        className={`${field} w-28 flex-none`}
      />
      {connected ? (
        <>
          <span className="flex-none rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {kernelInfo ? kernelInfo.name : 'connected'}
          </span>
          <button
            onClick={onInterrupt}
            title="Interrupt the kernel"
            className="flex-none rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Interrupt
          </button>
          <button
            onClick={onDisconnect}
            data-testid="jupyter-disconnect"
            className="flex-none rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          onClick={onConnect}
          disabled={!canConnect}
          data-testid="jupyter-connect"
          className="flex flex-none items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {connecting ? <Spinner /> : null}
          {connecting ? 'Connecting' : 'Connect'}
        </button>
      )}
    </div>
  )
}

function CellView({
  cell,
  index,
  total,
  connected,
  onCode,
  onRun,
  onRemove,
  onMove
}: {
  cell: Cell
  index: number
  total: number
  connected: boolean
  onCode: (code: string) => void
  onRun: () => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}): React.JSX.Element {
  const canRun = connected && !cell.running && cell.code.trim().length > 0
  const gutterLabel = cell.running
    ? '[*]'
    : cell.executionCount !== null
      ? `[${cell.executionCount}]`
      : '[ ]'
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
      <div className="flex items-stretch">
        <div className="flex w-10 flex-none flex-col items-center gap-1 border-r border-slate-200 bg-slate-50 py-1.5 font-mono text-[10px] text-slate-400 dark:border-slate-800 dark:bg-[#0b0f14]">
          <span title="Execution count">{gutterLabel}</span>
          <button
            onClick={onRun}
            disabled={!canRun}
            title="Run cell (⇧↵)"
            data-testid="jupyter-run"
            aria-label="Run cell"
            className="rounded p-0.5 text-sky-600 hover:bg-sky-500/10 disabled:opacity-30 dark:text-sky-400"
          >
            {cell.running ? <Spinner /> : <PlayIcon size={13} />}
          </button>
        </div>
        <textarea
          value={cell.code}
          onChange={(e) => onCode(e.target.value)}
          onKeyDown={(e) => {
            // Shift+Enter runs the cell (the notebook convention).
            if (e.key === 'Enter' && e.shiftKey && canRun) {
              e.preventDefault()
              onRun()
            }
          }}
          placeholder={connected ? 'print("hello")' : 'Connect to a kernel to run code.'}
          aria-label={`Code cell ${index + 1}`}
          spellCheck={false}
          rows={Math.min(12, Math.max(2, cell.code.split('\n').length))}
          className="min-w-0 flex-1 resize-none bg-transparent px-3 py-1.5 font-mono text-[12px] leading-relaxed outline-none"
        />
        <div className="flex flex-none flex-col items-center gap-0.5 border-l border-slate-200 px-0.5 py-1 dark:border-slate-800">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move cell up"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move cell down"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
          >
            ▼
          </button>
          <button
            onClick={onRemove}
            aria-label="Delete cell"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800"
          >
            <CloseIcon size={11} />
          </button>
        </div>
      </div>
      {cell.outputs.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-[#0b0f14]/60">
          {cell.outputs.map((output, i) => (
            <OutputView key={i} output={output} />
          ))}
        </div>
      )}
    </div>
  )
}

function OutputView({ output }: { output: JupyterOutput }): React.JSX.Element {
  if (output.kind === 'stream') {
    const isErr = output.name === 'stderr'
    return (
      <pre
        className={`overflow-auto whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-[11px] ${
          isErr ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'
        }`}
      >
        {stripAnsi(output.text)}
      </pre>
    )
  }
  if (output.kind === 'error') {
    const text = output.traceback.length
      ? output.traceback.join('\n')
      : `${output.ename}: ${output.evalue}`
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-[11px] text-rose-600 dark:text-rose-400">
        {stripAnsi(text)}
      </pre>
    )
  }
  // A `done` output never reaches here (it is not appended to a cell's outputs),
  // but narrow explicitly so `output.data` is available to TypeScript.
  if (output.kind !== 'result') return <></>
  const { data } = output
  if (data['image/png']) {
    return (
      <div className="px-3 py-1.5">
        <img
          src={`data:image/png;base64,${data['image/png']}`}
          alt="Cell output"
          className="max-w-full"
        />
      </div>
    )
  }
  if (data['text/html'] !== undefined) {
    // Rendered as ESCAPED text, never executed — a curly-brace string is
    // auto-escaped by React, so no HTML from the kernel runs here.
    return (
      <div className="px-3 py-1.5">
        <div className="mb-1 text-[10px] text-slate-400">HTML output (shown as text):</div>
        <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700 dark:text-slate-300">
          {data['text/html']}
        </pre>
      </div>
    )
  }
  return (
    <pre className="overflow-auto whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
      {stripAnsi(data['text/plain'] ?? '')}
    </pre>
  )
}

function PlayIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function Spinner(): React.JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
