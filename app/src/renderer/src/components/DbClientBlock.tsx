import { useCallback, useRef, useState } from 'react'
import type { DbQueryResult, DbTable } from '@shared/ipc'
import { useVirtualRows } from '@/virtual'

/**
 * Database client (roadmap C8): a SQLite console as a Deck block.
 *
 * Pure UI. It never touches a database directly — `chrome://webdeck` has no file
 * access — but hands every operation to the core over `window.agweb.db`, which
 * runs them through Node's built-in `node:sqlite` in the main process (see
 * `app/src/main/db.ts`). The core opens read-only by default, always binds query
 * parameters, and returns errors as data, so this block only has to build the
 * request and render what comes back.
 *
 * Flow: choose a `.db` file and connect → the sidebar lists tables/views → click
 * one to drop a `SELECT` into the editor and run it → results land in a
 * virtualized grid with a status line (rows, time, truncation, read-only badge).
 */

/** The db surface (typed on window.agweb.db in @shared/ipc). */
function getDb(): typeof window.agweb.db {
  return window.agweb.db
}

const ROW_HEIGHT = 29
const PREVIEW_LIMIT = 100

/** Quote a SQLite identifier, doubling any embedded quote. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function DbClientBlock(): React.JSX.Element {
  const [path, setPath] = useState('')
  const [readonly, setReadonly] = useState(true)

  const [connId, setConnId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const [tables, setTables] = useState<DbTable[]>([])
  const [tablesError, setTablesError] = useState<string | null>(null)
  const [activeTable, setActiveTable] = useState<string | null>(null)

  const [sql, setSql] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DbQueryResult | null>(null)

  // A monotonically-rising token bumped on every connect/disconnect. A query
  // captures it at start and drops its result if the token has moved — so a
  // slow query on a connection the user has since dropped (or swapped for a
  // different DB) can never overwrite the current connection's state.
  const connGenRef = useRef(0)

  const connected = connId !== null

  const loadTables = useCallback(async (id: string): Promise<void> => {
    const res = await getDb().tables(id)
    setTables(res.tables)
    setTablesError(res.error ?? null)
  }, [])

  const browse = useCallback(async (): Promise<void> => {
    const picked = await window.agweb.pickPaths('file')
    if (picked.length > 0) setPath(picked[0])
  }, [])

  const connect = useCallback(async (): Promise<void> => {
    const target = path.trim()
    if (!target || connecting) return
    setConnecting(true)
    setConnectError(null)
    const res = await getDb().connect(target, readonly)
    setConnecting(false)
    if (res.error || !res.id) {
      setConnectError(res.error ?? 'Could not open the database.')
      return
    }
    connGenRef.current += 1
    setConnId(res.id)
    setResult(null)
    setActiveTable(null)
    await loadTables(res.id)
  }, [path, readonly, connecting, loadTables])

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connId) return
    connGenRef.current += 1
    await getDb().close(connId)
    setConnId(null)
    setTables([])
    setTablesError(null)
    setActiveTable(null)
    setResult(null)
    setRunning(false)
  }, [connId])

  const run = useCallback(
    async (text: string): Promise<void> => {
      if (!connId || running) return
      const trimmed = text.trim()
      if (!trimmed) return
      const gen = connGenRef.current
      setRunning(true)
      setResult(null)
      const res = await getDb().query(connId, trimmed, [])
      // A disconnect/reconnect landed while the query was in flight — drop this
      // now-stale result rather than painting it over the current connection.
      if (connGenRef.current !== gen) return
      setResult(res)
      setRunning(false)
    },
    [connId, running]
  )

  const openTable = useCallback(
    (table: DbTable): void => {
      const next = `SELECT * FROM ${quoteIdent(table.name)} LIMIT ${PREVIEW_LIMIT}`
      setSql(next)
      setActiveTable(table.name)
      void run(next)
    },
    [run]
  )

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <ConnectionBar
        path={path}
        readonly={readonly}
        connected={connected}
        connecting={connecting}
        onPath={setPath}
        onReadonly={setReadonly}
        onBrowse={() => void browse()}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
      />
      {connectError && (
        <div className="flex-none border-b border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-600 dark:text-rose-300">
          {connectError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SchemaSidebar
          connected={connected}
          tables={tables}
          error={tablesError}
          active={activeTable}
          onOpen={openTable}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <SqlEditor
            value={sql}
            disabled={!connected}
            running={running}
            onChange={setSql}
            onRun={() => void run(sql)}
          />
          <ResultView connected={connected} running={running} readonly={readonly} result={result} />
        </div>
      </div>
    </div>
  )
}

function ConnectionBar({
  path,
  readonly,
  connected,
  connecting,
  onPath,
  onReadonly,
  onBrowse,
  onConnect,
  onDisconnect
}: {
  path: string
  readonly: boolean
  connected: boolean
  connecting: boolean
  onPath: (path: string) => void
  onReadonly: (readonly: boolean) => void
  onBrowse: () => void
  onConnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  const canConnect = path.trim().length > 0 && !connecting
  return (
    <div className="flex flex-none items-center gap-1.5 border-b border-slate-200 p-2 dark:border-slate-800">
      <DatabaseIcon size={14} />
      <input
        value={path}
        onChange={(e) => onPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canConnect && !connected) onConnect()
        }}
        placeholder="/path/to/database.db"
        aria-label="Database file path"
        spellCheck={false}
        disabled={connected}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] outline-none focus:border-sky-500 disabled:opacity-60 dark:border-slate-700 dark:bg-[#0b0f14]"
      />
      {!connected && (
        <button
          onClick={onBrowse}
          className="flex-none rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Browse…
        </button>
      )}
      <label
        title="Open the database in read-only mode"
        className={`flex flex-none items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold ${
          connected ? 'opacity-60' : 'cursor-pointer'
        }`}
      >
        <input
          type="checkbox"
          checked={readonly}
          disabled={connected}
          onChange={(e) => onReadonly(e.target.checked)}
          className="accent-sky-600"
        />
        Read-only
      </label>
      {connected ? (
        <button
          onClick={onDisconnect}
          data-testid="db-disconnect"
          className="flex-none rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={!canConnect}
          data-testid="db-connect"
          className="flex flex-none items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {connecting ? <Spinner /> : null}
          {connecting ? 'Connecting' : 'Connect'}
        </button>
      )}
    </div>
  )
}

function SchemaSidebar({
  connected,
  tables,
  error,
  active,
  onOpen
}: {
  connected: boolean
  tables: DbTable[]
  error: string | null
  active: string | null
  onOpen: (table: DbTable) => void
}): React.JSX.Element {
  return (
    <div className="flex w-48 flex-none flex-col border-r border-slate-200 dark:border-slate-800">
      <div className="flex-none border-b border-slate-200 px-2.5 py-1.5 font-semibold text-slate-500 dark:border-slate-800">
        Schema
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!connected ? (
          <div className="p-3 text-[10px] text-slate-400">
            Connect to a database to browse its tables.
          </div>
        ) : error ? (
          <div className="p-3 text-[10px] text-rose-500">{error}</div>
        ) : tables.length === 0 ? (
          <div className="p-3 text-[10px] text-slate-400">No tables or views.</div>
        ) : (
          tables.map((table) => (
            <button
              key={`${table.type}:${table.name}`}
              onClick={() => onOpen(table)}
              title={`${table.name} (${table.type})`}
              className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left hover:bg-slate-500/10 ${
                active === table.name ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : ''
              }`}
            >
              <TableIcon size={12} view={table.type === 'view'} />
              <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-300">
                {table.name}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function SqlEditor({
  value,
  disabled,
  running,
  onChange,
  onRun
}: {
  value: string
  disabled: boolean
  running: boolean
  onChange: (value: string) => void
  onRun: () => void
}): React.JSX.Element {
  const canRun = !disabled && !running && value.trim().length > 0
  return (
    <div className="flex flex-none flex-col border-b border-slate-200 dark:border-slate-800">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // ⌘↵ / Ctrl↵ runs the statement.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canRun) {
            e.preventDefault()
            onRun()
          }
        }}
        placeholder={disabled ? 'Connect to a database to run SQL.' : 'SELECT * FROM …'}
        aria-label="SQL editor"
        spellCheck={false}
        disabled={disabled}
        className="h-24 w-full resize-none bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed outline-none disabled:opacity-60"
      />
      <div className="flex flex-none items-center gap-2 px-3 py-1.5">
        <button
          onClick={onRun}
          disabled={!canRun}
          data-testid="db-run"
          className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {running ? <Spinner /> : <PlayIcon size={12} />}
          {running ? 'Running' : 'Run'}
        </button>
        <span className="text-[10px] text-slate-400">⌘↵ to run</span>
      </div>
    </div>
  )
}

function ResultView({
  connected,
  running,
  readonly,
  result
}: {
  connected: boolean
  running: boolean
  readonly: boolean
  result: DbQueryResult | null
}): React.JSX.Element {
  if (!connected) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-slate-400">
        No database connected.
      </div>
    )
  }
  if (running && !result) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-slate-400">
        <Spinner />
        <span>Running query…</span>
      </div>
    )
  }
  if (!result) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-slate-400">
        Run a query or pick a table to see results.
      </div>
    )
  }
  if (result.error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <StatusLine readonly={readonly} result={result} />
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-4">
          <span className="font-semibold text-rose-500">Query failed</span>
          <span className="whitespace-pre-wrap break-words leading-relaxed text-slate-500">
            {result.error}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatusLine readonly={readonly} result={result} />
      {result.columns.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-slate-400">
          {result.rowsAffected === 1
            ? '1 row affected.'
            : `${result.rowsAffected.toLocaleString()} rows affected.`}
        </div>
      ) : (
        <ResultGrid columns={result.columns} rows={result.rows} />
      )}
    </div>
  )
}

function StatusLine({
  readonly,
  result
}: {
  readonly: boolean
  result: DbQueryResult
}): React.JSX.Element {
  return (
    <div className="flex flex-none flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
          readonly
            ? 'bg-slate-500/15 text-slate-500'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        }`}
      >
        {readonly ? 'Read-only' : 'Writable'}
      </span>
      {result.columns.length > 0 && (
        <span className="text-[10px] text-slate-500">
          {result.rowCount.toLocaleString()} {result.rowCount === 1 ? 'row' : 'rows'}
        </span>
      )}
      <span className="text-[10px] text-slate-400">{result.timeMs} ms</span>
      {result.truncated && (
        <span className="text-[10px] font-semibold text-amber-500">truncated</span>
      )}
    </div>
  )
}

/** Column + row grid with fixed-row windowing — the CsvTable approach. */
function ResultGrid({
  columns,
  rows
}: {
  columns: string[]
  rows: unknown[][]
}): React.JSX.Element {
  const { containerRef, onScroll, start, end, padTop, padBottom } = useVirtualRows(
    rows.length,
    ROW_HEIGHT
  )
  return (
    <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#101827]">
          <tr>
            {columns.map((name, c) => (
              <th
                key={c}
                className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr style={{ height: padTop }} />}
          {rows.slice(start, end).map((row, r) => (
            <tr
              key={start + r}
              style={{ height: ROW_HEIGHT }}
              className="odd:bg-slate-50 dark:odd:bg-[#0d131d]"
            >
              {columns.map((_, c) => (
                <Cell key={c} value={row[c]} />
              ))}
            </tr>
          ))}
          {padBottom > 0 && <tr style={{ height: padBottom }} />}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ value }: { value: unknown }): React.JSX.Element {
  if (value === null || value === undefined) {
    return (
      <td className="max-w-96 truncate border-b border-slate-100 px-3 py-1.5 text-slate-400 italic dark:border-slate-800/60">
        NULL
      </td>
    )
  }
  return (
    <td className="max-w-96 truncate border-b border-slate-100 px-3 py-1.5 font-mono text-slate-700 dark:border-slate-800/60 dark:text-slate-300">
      {String(value)}
    </td>
  )
}

function DatabaseIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-slate-500"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  )
}

function TableIcon({
  size = 12,
  view = false
}: {
  size?: number
  view?: boolean
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none ${view ? 'text-violet-500' : 'text-sky-500'}`}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
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
