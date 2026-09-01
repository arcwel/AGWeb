import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncCtor, SQLInputValue, SQLOutputValue } from 'node:sqlite'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'
import { IpcChannels, type DbQueryResult, type DbTable } from '@shared/ipc'

// node:sqlite is loaded through a runtime require, not a static import: Vite (the
// test bundler) does not recognise this new Node builtin and tries to resolve a
// bare `sqlite` package, breaking any test that transitively imports this module.
// A `createRequire` call is opaque to Vite's static analysis, and esbuild/Node
// resolve the builtin natively at runtime (the SEA ships Node 24+). Types stay as
// erased type-only imports above.
const nodeRequire = createRequire(import.meta.url)
let cachedDatabaseSync: typeof DatabaseSyncCtor | undefined
function databaseSync(): typeof DatabaseSyncCtor {
  cachedDatabaseSync ??= (nodeRequire('node:sqlite') as typeof import('node:sqlite')).DatabaseSync
  return cachedDatabaseSync
}

/**
 * Database client (roadmap C8).
 *
 * Connects to a SQLite database and runs queries for the Database Deck block.
 * The engine is Node's built-in `node:sqlite` (`DatabaseSync`), which ships with
 * the SEA's Node 24+ runtime — there is no native addon to compile or bundle,
 * and nothing to install.
 *
 * Three rules shape everything here:
 *
 *  1. **Parameterized queries, always.** User SQL is handed to `db.prepare()`
 *     and user values are bound as statement parameters (`stmt.all(...params)`
 *     / `stmt.run(...params)`). No user input is ever concatenated into a SQL
 *     string. This is the single most important property of this file.
 *  2. **Read-only by default.** A connection opens with `{ readOnly: true }`
 *     unless the caller explicitly passes `readonly=false`. A write against a
 *     read-only handle fails at the SQLite layer and comes back as `{ error }`,
 *     which is exactly the guard rail the block wants.
 *  3. **Never throw across the RPC boundary.** Every SQL or connection error is
 *     caught and returned as `{ error }` — the renderer shows it, the process
 *     stays up.
 *
 * Like `git.ts`, these are the *user's* own clicks (they chose the file, typed
 * the SQL), so they are not routed through the agent policy engine.
 *
 * --- Scaffold: Postgres / MySQL ---
 * A future "server database" mode would add Postgres and MySQL. Those need real
 * npm dependencies (`pg`, `mysql2` — both with native/optional-native parts) and
 * a connection string rather than a file path, but they can implement the same
 * four operations behind the same result shapes (`DbQueryResult`, `DbTable`).
 * The connection registry below would key on a driver tag, and `runQuery` would
 * dispatch to a driver-specific prepare/execute. Deliberately NOT added now: no
 * new dependencies for the SQLite milestone.
 */

/** A live connection plus the mode it was opened in. */
interface Connection {
  db: DatabaseSyncCtor
  readonly: boolean
  path: string
}

/** Cap on rows returned to the renderer — a huge SELECT must not blow up heap. */
const MAX_ROWS = 5000

/** Open connections, keyed by the id handed back to the renderer. */
const connections = new Map<string, Connection>()

/**
 * Cap on simultaneously open connections (connection-leak safety net).
 *
 * The registry only drops entries on explicit `close()` or process exit, so a
 * renderer that opens handles without closing them would grow it without bound.
 * When a new `connect()` would exceed this cap, the oldest handles are closed.
 */
const MAX_CONNECTIONS = 8

let connectionSeq = 0

/**
 * Close and forget the oldest connections until at most `keep` remain.
 * `Map` preserves insertion order, so its first keys are the oldest handles.
 */
function evictOldestConnections(keep: number): void {
  while (connections.size > keep) {
    const oldest = connections.keys().next().value
    if (oldest === undefined) break
    close(oldest)
  }
}

/** Turn any thrown value into a readable message. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * Reject paths that are not a real, user-chosen file.
 *
 * The block always passes a concrete file path. Empty input and the in-memory
 * sentinels (`:memory:`, `file:...mode=memory`) are refused so a stray value
 * can't silently spin up a throwaway database that looks connected but isn't.
 */
export function isOpenablePath(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed) return false
  if (trimmed.toLowerCase() === ':memory:') return false
  if (/^file:/i.test(trimmed) && /mode=memory/i.test(trimmed)) return false
  return true
}

/**
 * Open a connection to a SQLite file.
 *
 * Read-only is the default: the caller must pass `readonly === false` to get a
 * writable handle. A read-only open of a missing file fails at the SQLite layer,
 * and that failure is returned rather than thrown.
 */
export function connect(path: string, readonly: boolean): { id: string; error?: string } {
  if (!isOpenablePath(path)) {
    return { id: '', error: 'Choose a database file to open.' }
  }
  try {
    // Connection-leak safety net: make room before opening a new handle.
    evictOldestConnections(MAX_CONNECTIONS - 1)
    const db = new (databaseSync())(path, { readOnly: readonly })
    // Bound the time a write can block the *synchronous* node:sqlite engine (and
    // therefore the whole core) waiting on a locked database: wait up to this many
    // ms for the lock, then fail with SQLITE_BUSY rather than blocking forever.
    db.exec('PRAGMA busy_timeout = 5000')
    const id = `db-${++connectionSeq}`
    connections.set(id, { db, readonly, path })
    return { id }
  } catch (e) {
    return { id: '', error: errorMessage(e) }
  }
}

/**
 * Coerce a renderer-supplied value into something SQLite can bind.
 *
 * Values arrive as `unknown` over IPC. Only the shapes SQLite accepts are let
 * through as-is; everything else is stringified. Crucially, these are *bound*
 * parameters — never spliced into the SQL text — so an odd value can at worst
 * be a wrong argument, never an injection.
 */
export function toBindValue(value: unknown): SQLInputValue {
  if (value === null || value === undefined) return null
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'bigint') {
    return value as string | number | bigint
  }
  if (t === 'boolean') return value ? 1 : 0
  if (ArrayBuffer.isView(value)) return value as SQLInputValue
  // A raw ArrayBuffer is not a view, so ArrayBuffer.isView is false for it; without
  // this branch it would fall through and stringify to "[object ArrayBuffer]". Wrap
  // it as a Buffer so SQLite binds it as a blob (still a bound parameter).
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  // Objects/arrays and anything else: stringify. Still a bound parameter.
  return String(value)
}

/**
 * Convert a SQLite output value into something safe to serialize and display.
 *
 * BigInts that fit in a JS number become numbers; larger ones become strings so
 * no precision is lost. Blobs are summarized rather than shipped whole.
 */
export function fromResultValue(value: SQLOutputValue): unknown {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  }
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`
  return value
}

/**
 * Run one prepared statement with bound parameters.
 *
 * Classification is by the statement's own column metadata: a prepared
 * statement that declares result columns (SELECT, PRAGMA that reads, anything
 * with RETURNING) is read with a capped `iterate()`; one that declares none is
 * executed with `run()` and reports `rowsAffected`. This is more reliable than
 * sniffing the leading keyword and handles RETURNING for free.
 */
export function runQuery(id: string, sql: string, params: unknown[]): DbQueryResult {
  const empty: DbQueryResult = { columns: [], rows: [], rowCount: 0, rowsAffected: 0, timeMs: 0 }
  const conn = connections.get(id)
  if (!conn) return { ...empty, error: 'No open connection.' }
  if (!sql.trim()) return { ...empty, error: 'Enter a SQL statement to run.' }

  const bind = params.map(toBindValue)
  const started = performance.now()
  try {
    const stmt = conn.db.prepare(sql)
    const columns = stmt.columns().map((c) => c.name)

    // No result columns → a write/DDL statement. Execute and report changes.
    //
    // Risk: node:sqlite is synchronous, so a runaway interactive write (an
    // unbounded DELETE/UPDATE, or one blocked on a lock) stalls the whole core
    // for its duration. There is no row cap here — a write has no result set to
    // cap with iterate() as the read branch does. The `PRAGMA busy_timeout` set
    // in connect() caps the *lock-wait* portion; node:sqlite exposes no stable
    // progress/interrupt handler to cap the execution itself, so that timeout
    // plus this note is the accepted scope. (Moving runQuery off-thread would
    // remove the stall entirely but is deliberately out of scope here.)
    if (columns.length === 0) {
      const changes = stmt.run(...bind)
      const affected =
        typeof changes.changes === 'bigint' ? Number(changes.changes) : changes.changes
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        rowsAffected: affected,
        timeMs: elapsed(started)
      }
    }

    // Result columns → read rows, capped. Pull one past the cap to know if the
    // real result was larger than what is returned.
    const rows: unknown[][] = []
    let truncated = false
    const iterator = stmt.iterate(...bind)
    for (const row of iterator) {
      if (rows.length >= MAX_ROWS) {
        truncated = true
        if (typeof iterator.return === 'function') iterator.return()
        break
      }
      rows.push(columns.map((name) => fromResultValue(row[name])))
    }

    return {
      columns,
      rows,
      rowCount: rows.length,
      rowsAffected: 0,
      timeMs: elapsed(started),
      truncated: truncated || undefined
    }
  } catch (e) {
    return { ...empty, timeMs: elapsed(started), error: errorMessage(e) }
  }
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100
}

/**
 * List the tables and views for the schema sidebar.
 *
 * A fixed, parameter-free query against `sqlite_master` — no user input reaches
 * it at all.
 */
export function listTables(id: string): { tables: DbTable[]; error?: string } {
  const conn = connections.get(id)
  if (!conn) return { tables: [], error: 'No open connection.' }
  try {
    const stmt = conn.db.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name"
    )
    const tables: DbTable[] = []
    for (const row of stmt.all()) {
      const name = row.name
      const type = row.type
      if (typeof name === 'string' && (type === 'table' || type === 'view')) {
        tables.push({ name, type })
      }
    }
    return { tables }
  } catch (e) {
    return { tables: [], error: errorMessage(e) }
  }
}

/** Close and forget a connection. Closing an unknown id is a no-op. */
export function close(id: string): void {
  const conn = connections.get(id)
  if (!conn) return
  try {
    conn.db.close()
  } catch {
    // Already closed or mid-failure — nothing useful to do, and close must not throw.
  }
  connections.delete(id)
}

/** Best-effort close of every open handle when the process is going away. */
function closeAll(): void {
  for (const [, conn] of connections) {
    try {
      conn.db.close()
    } catch {
      // ignore — shutting down
    }
  }
  connections.clear()
}

process.once('exit', closeAll)

/** Register the database domain with webdeck-core (P1). */
export function registerDbRpc(): void {
  core.register(IpcChannels.dbConnect, (path, readonly) => {
    const p = asString(path)
    if (p === null) return { id: '', error: 'bad arguments' }
    // Read-only unless the caller explicitly opts out.
    return connect(p, readonly !== false)
  })
  core.register(IpcChannels.dbQuery, (id, sql, params) => {
    const connId = asString(id)
    const text = asString(sql)
    if (connId === null || text === null) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        rowsAffected: 0,
        timeMs: 0,
        error: 'bad arguments'
      }
    }
    return runQuery(connId, text, Array.isArray(params) ? params : [])
  })
  core.register(IpcChannels.dbTables, (id) => {
    const connId = asString(id)
    return connId === null ? { tables: [], error: 'bad arguments' } : listTables(connId)
  })
  core.register(IpcChannels.dbClose, (id) => {
    const connId = asString(id)
    if (connId !== null) close(connId)
  })
}
