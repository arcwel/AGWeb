// Where synced entities live.
//
// One SQLite file per service, on node:sqlite so the server needs nothing
// installed. The shape is the protocol's, not a datatype's: the server does
// not know what a bookmark is, only that an entity of some datatype has a
// version and some opaque bytes. That is deliberate — a datatype added
// upstream must not need a schema change here, and the server never has to
// understand, or be trusted with, what it is storing.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Versions are a single counter per account, not per entity.
 *
 * The protocol asks for "everything newer than this token" and the client
 * replays that token back, so the counter has to be monotonic across the whole
 * account or an update can be skipped. One counter is the simplest thing that
 * cannot go backwards.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  birthday      TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  account_id    TEXT NOT NULL,
  id            TEXT NOT NULL,
  datatype      TEXT NOT NULL,
  version       INTEGER NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL DEFAULT '',
  parent_id     TEXT NOT NULL DEFAULT '',
  client_tag    TEXT,
  server_tag    TEXT,
  specifics     BLOB NOT NULL,
  mtime         INTEGER NOT NULL,
  ctime         INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS entities_by_version
  ON entities (account_id, datatype, version);
CREATE UNIQUE INDEX IF NOT EXISTS entities_by_client_tag
  ON entities (account_id, datatype, client_tag) WHERE client_tag IS NOT NULL;
`

export class SyncStore {
  #db

  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    this.#db.exec('PRAGMA journal_mode = WAL')
    this.#db.exec('PRAGMA foreign_keys = ON')
    this.#db.exec(SCHEMA)
  }

  /** The open database, so identity can keep its accounts beside the data. */
  get db() {
    return this.#db
  }

  close() {
    this.#db.close()
  }

  /**
   * The account's store birthday, minted on first contact.
   *
   * The client sends its birthday back on every request. A mismatch is the
   * protocol's way of saying "this account was reset, throw away what you
   * have" — so it must be stable for the life of the data and change only when
   * the data does not survive.
   */
  account(accountId) {
    const found = this.#db
      .prepare('SELECT id, birthday, version FROM accounts WHERE id = ?')
      .get(accountId)
    if (found) return found
    const created = {
      id: accountId,
      birthday: randomUUID(),
      version: 1,
      created_at: new Date().toISOString()
    }
    this.#db
      .prepare('INSERT INTO accounts (id, birthday, version, created_at) VALUES (?, ?, ?, ?)')
      .run(created.id, created.birthday, created.version, created.created_at)
    return created
  }

  /** Throw the account's data away and mint a new birthday. */
  reset(accountId) {
    this.#db.prepare('DELETE FROM entities WHERE account_id = ?').run(accountId)
    this.#db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
    return this.account(accountId)
  }

  /** The next version for this account. Monotonic, never reused. */
  #bumpVersion(accountId) {
    this.#db.prepare('UPDATE accounts SET version = version + 1 WHERE id = ?').run(accountId)
    return this.#db.prepare('SELECT version FROM accounts WHERE id = ?').get(accountId).version
  }

  /** Everything in `datatype` newer than `sinceVersion`, oldest first. */
  updatesSince(accountId, datatype, sinceVersion, limit = 500) {
    return this.#db
      .prepare(
        `SELECT * FROM entities
          WHERE account_id = ? AND datatype = ? AND version > ?
          ORDER BY version ASC LIMIT ?`
      )
      .all(accountId, datatype, sinceVersion, limit)
  }

  /** The highest version in the account, which is what a client catches up to. */
  latestVersion(accountId) {
    return this.#db.prepare('SELECT version FROM accounts WHERE id = ?').get(accountId)?.version ?? 1
  }

  /**
   * Write one entity and return it with its new version.
   *
   * `id` empty means the client is creating something and expects the server
   * to name it. A client tag, where the datatype has one, is the identity the
   * client dedupes on, so a second create with the same tag must land on the
   * same row rather than making a twin.
   */
  commit(accountId, entity) {
    const existing =
      (entity.id && this.#get(accountId, entity.id)) ||
      (entity.clientTag && this.#getByClientTag(accountId, entity.datatype, entity.clientTag)) ||
      null
    const version = this.#bumpVersion(accountId)
    const now = Date.now()
    const row = {
      account_id: accountId,
      id: existing?.id ?? entity.id ?? `server-${randomUUID()}`,
      datatype: entity.datatype,
      version,
      deleted: entity.deleted ? 1 : 0,
      name: entity.name ?? existing?.name ?? '',
      parent_id: entity.parentId ?? existing?.parent_id ?? '',
      client_tag: entity.clientTag ?? existing?.client_tag ?? null,
      server_tag: entity.serverTag ?? existing?.server_tag ?? null,
      // A delete keeps the row as a tombstone: other clients learn of it by
      // receiving the entity with deleted set, and a dropped row would just
      // look like an entity that never existed.
      specifics: entity.deleted ? (existing?.specifics ?? Buffer.alloc(0)) : entity.specifics,
      mtime: now,
      ctime: existing?.ctime ?? now
    }
    this.#db
      .prepare(
        `INSERT INTO entities
           (account_id, id, datatype, version, deleted, name, parent_id,
            client_tag, server_tag, specifics, mtime, ctime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, id) DO UPDATE SET
           version = excluded.version, deleted = excluded.deleted,
           name = excluded.name, parent_id = excluded.parent_id,
           client_tag = excluded.client_tag, server_tag = excluded.server_tag,
           specifics = excluded.specifics, mtime = excluded.mtime`
      )
      .run(
        row.account_id,
        row.id,
        row.datatype,
        row.version,
        row.deleted,
        row.name,
        row.parent_id,
        row.client_tag,
        row.server_tag,
        row.specifics,
        row.mtime,
        row.ctime
      )
    return row
  }

  #get(accountId, id) {
    return this.#db
      .prepare('SELECT * FROM entities WHERE account_id = ? AND id = ?')
      .get(accountId, id)
  }

  #getByClientTag(accountId, datatype, clientTag) {
    return this.#db
      .prepare(
        'SELECT * FROM entities WHERE account_id = ? AND datatype = ? AND client_tag = ?'
      )
      .get(accountId, datatype, clientTag)
  }

  /** What the account holds, for `webdeck-sync status`. */
  summary(accountId) {
    const rows = this.#db
      .prepare(
        `SELECT datatype, COUNT(*) AS entities, SUM(deleted) AS tombstones
           FROM entities WHERE account_id = ? GROUP BY datatype ORDER BY datatype`
      )
      .all(accountId)
    return {
      account: accountId,
      version: this.latestVersion(accountId),
      datatypes: rows.map((r) => ({
        datatype: r.datatype,
        entities: Number(r.entities),
        tombstones: Number(r.tombstones ?? 0)
      }))
    }
  }

  /** Every account this service holds. */
  accounts() {
    return this.#db.prepare('SELECT id, created_at, version FROM accounts ORDER BY id').all()
  }
}
