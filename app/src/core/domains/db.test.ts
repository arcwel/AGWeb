import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, runQuery, close, isOpenablePath, toBindValue, fromResultValue } from './db'

/**
 * db.ts implements the DB block's SAFETY contract: user SQL is always run through
 * prepared statements with bound parameters (never string-concatenated), a
 * connection is read-only unless the caller opts out, every error comes back as
 * `{ error }` rather than a throw, and a runaway SELECT is capped at MAX_ROWS.
 * These are regression tests for exactly those properties.
 *
 * The cap MAX_ROWS is module-private (5000); the truncation test drives real
 * behaviour by exceeding it rather than reading the constant.
 */
const MAX_ROWS = 5000

describe('isOpenablePath', () => {
  it('rejects an empty or whitespace-only path', () => {
    // Arrange / Act / Assert
    expect(isOpenablePath('')).toBe(false)
    expect(isOpenablePath('   ')).toBe(false)
  })

  it('rejects the :memory: sentinel in any case', () => {
    expect(isOpenablePath(':memory:')).toBe(false)
    expect(isOpenablePath(':MEMORY:')).toBe(false)
    expect(isOpenablePath('  :Memory:  ')).toBe(false)
  })

  it('rejects a file: URI that opens an in-memory database', () => {
    expect(isOpenablePath('file:foo?mode=memory')).toBe(false)
    expect(isOpenablePath('FILE:bar?MODE=MEMORY&cache=shared')).toBe(false)
  })

  it('accepts a real filesystem path', () => {
    expect(isOpenablePath('/tmp/real.db')).toBe(true)
    expect(isOpenablePath('./data/app.sqlite')).toBe(true)
  })
})

describe('toBindValue', () => {
  it('passes strings, numbers, and bigints through unchanged', () => {
    expect(toBindValue('hello')).toBe('hello')
    expect(toBindValue(42)).toBe(42)
    expect(toBindValue(9007199254740993n)).toBe(9007199254740993n)
  })

  it('converts booleans to 1 / 0', () => {
    expect(toBindValue(true)).toBe(1)
    expect(toBindValue(false)).toBe(0)
  })

  it('maps null and undefined to null', () => {
    expect(toBindValue(null)).toBeNull()
    expect(toBindValue(undefined)).toBeNull()
  })

  it('passes a typed array (ArrayBuffer view) through as-is', () => {
    // Arrange
    const view = new Uint8Array([1, 2, 3])

    // Act
    const bound = toBindValue(view)

    // Assert: same instance, not stringified
    expect(bound).toBe(view)
  })

  it('wraps a raw ArrayBuffer as a Buffer blob, not the "[object ArrayBuffer]" string', () => {
    // Arrange
    const buffer = new Uint8Array([10, 20, 30]).buffer

    // Act
    const bound = toBindValue(buffer)

    // Assert: this is the recently-fixed branch — it must become bindable bytes
    expect(Buffer.isBuffer(bound)).toBe(true)
    expect(bound).not.toBe('[object ArrayBuffer]')
    expect(Array.from(bound as Buffer)).toEqual([10, 20, 30])
  })

  it('stringifies objects and arrays (still a bound parameter)', () => {
    expect(toBindValue({ a: 1 })).toBe('[object Object]')
    expect(toBindValue([1, 2, 3])).toBe('1,2,3')
  })
})

describe('fromResultValue', () => {
  it('narrows a bigint in safe-integer range to a number', () => {
    expect(fromResultValue(123n)).toBe(123)
    expect(fromResultValue(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
    expect(fromResultValue(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER)
  })

  it('keeps a bigint outside safe-integer range as a lossless string', () => {
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 10n
    expect(fromResultValue(tooBig)).toBe(tooBig.toString())

    const tooSmall = BigInt(Number.MIN_SAFE_INTEGER) - 10n
    expect(fromResultValue(tooSmall)).toBe(tooSmall.toString())
  })

  it('summarizes a blob rather than shipping its bytes', () => {
    expect(fromResultValue(new Uint8Array([1, 2, 3, 4]))).toBe('<blob 4 bytes>')
    expect(fromResultValue(new Uint8Array(0))).toBe('<blob 0 bytes>')
  })

  it('passes plain string / number values through', () => {
    expect(fromResultValue('text')).toBe('text')
    expect(fromResultValue(3.14)).toBe(3.14)
  })
})

describe('connect + runQuery against a real SQLite file', () => {
  let dir: string
  let dbPath: string
  let writableId: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wd-db-test-'))
    dbPath = join(dir, 'test.db')

    // A writable connection succeeds when readonly=false and the file is created.
    const opened = connect(dbPath, false)
    expect(opened.error).toBeUndefined()
    expect(opened.id).toBeTruthy()
    writableId = opened.id

    const created = runQuery(
      writableId,
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
      []
    )
    expect(created.error).toBeUndefined()
  })

  afterAll(() => {
    close(writableId)
    rmSync(dir, { recursive: true, force: true })
  })

  it('opens a writable connection to a real path without error', () => {
    // Proven in beforeAll; assert the handle is registered by running a trivial read.
    const result = runQuery(writableId, 'SELECT 1 AS one', [])
    expect(result.error).toBeUndefined()
    expect(result.columns).toEqual(['one'])
    expect(result.rows).toEqual([[1]])
  })

  it('reports rowsAffected (not rows) for a write statement', () => {
    // Act
    const result = runQuery(writableId, 'INSERT INTO users (id, name) VALUES (?, ?)', [1, 'Ada'])

    // Assert: a write has no result columns — it reports changes, not a row set.
    expect(result.error).toBeUndefined()
    expect(result.rowsAffected).toBe(1)
    expect(result.columns).toEqual([])
    expect(result.rows).toEqual([])
    expect(result.rowCount).toBe(0)
  })

  it('returns columns and rows for a SELECT', () => {
    const result = runQuery(writableId, 'SELECT id, name FROM users ORDER BY id', [])
    expect(result.error).toBeUndefined()
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toEqual([[1, 'Ada']])
    expect(result.rowCount).toBe(1)
  })

  it('binds a parameter containing a quote safely (no SQL injection)', () => {
    // Arrange: a value that would break out of the string if concatenated.
    const nasty = "Robert'); DROP TABLE users;--"

    // Act: the value is a bound parameter, so it is stored verbatim.
    const write = runQuery(writableId, 'INSERT INTO users (id, name) VALUES (?, ?)', [2, nasty])
    expect(write.error).toBeUndefined()

    // Assert: the table still exists and the exact string round-trips.
    const read = runQuery(writableId, 'SELECT name FROM users WHERE id = ?', [2])
    expect(read.error).toBeUndefined()
    expect(read.rows).toEqual([[nasty]])

    // And the injection did not fire: the table is intact with both rows.
    const count = runQuery(writableId, 'SELECT COUNT(*) AS n FROM users', [])
    expect(count.rows).toEqual([[2]])
  })

  it('returns { error } (not a throw) when writing on a read-only connection', () => {
    // Arrange: a second, read-only handle to the same file.
    const ro = connect(dbPath, true)
    expect(ro.error).toBeUndefined()

    try {
      // Act: any write must be rejected at the SQLite layer.
      const result = runQuery(ro.id, 'INSERT INTO users (id, name) VALUES (?, ?)', [99, 'Nope'])

      // Assert: comes back as an error, process stays up.
      expect(result.error).toBeTruthy()
      expect(result.rowsAffected).toBe(0)
    } finally {
      close(ro.id)
    }

    // The write never landed on the underlying file.
    const check = runQuery(writableId, 'SELECT COUNT(*) AS n FROM users WHERE id = 99', [])
    expect(check.rows).toEqual([[0]])
  })

  it('caps a large SELECT at MAX_ROWS and flags truncated', () => {
    // Arrange: a fresh table with more rows than the cap.
    runQuery(writableId, 'CREATE TABLE big (n INTEGER)', [])
    runQuery(writableId, 'BEGIN', [])
    for (let i = 0; i < MAX_ROWS + 1; i++) {
      runQuery(writableId, 'INSERT INTO big (n) VALUES (?)', [i])
    }
    runQuery(writableId, 'COMMIT', [])

    // Act
    const result = runQuery(writableId, 'SELECT n FROM big', [])

    // Assert: exactly the cap is returned and the truncation flag is set.
    expect(result.error).toBeUndefined()
    expect(result.rowCount).toBe(MAX_ROWS)
    expect(result.rows).toHaveLength(MAX_ROWS)
    expect(result.truncated).toBe(true)
  })

  it('returns an error for an unknown connection id', () => {
    const result = runQuery('db-does-not-exist', 'SELECT 1', [])
    expect(result.error).toBeTruthy()
    expect(result.rows).toEqual([])
  })

  it('refuses to connect to a non-openable path', () => {
    const result = connect(':memory:', false)
    expect(result.id).toBe('')
    expect(result.error).toBeTruthy()
  })
})
