// One request in, one response out.
//
// The browser POSTs a ClientToServerMessage and expects a ClientToServerResponse
// on the same connection. There are two kinds that matter: GET_UPDATES ("what
// has changed since this token") and COMMIT ("here is what I changed"). This is
// the whole conversation; everything else in the protocol hangs off those two.
//
// Modelled on Chromium's own components/sync/test/fake_server.cc, which is the
// only complete description of the server side that exists. Where this differs,
// it is because fake_server serves one in-process test and this serves real
// clients over time — it persists, and it keeps a version counter rather than
// rebuilding state per run.
import { decodeRequest, encodeResponse, datatypeOf } from './protocol.mjs'

/**
 * Protocol constants, read from the .proto rather than copied out of it.
 *
 * These numbers are not stable across versions — SUCCESS is 1 for a commit
 * response and 0 for an error code, and NOT_MY_BIRTHDAY has moved. Every one
 * of them written out by hand here is a chance to be subtly wrong in a way
 * that shows up as a client that syncs nothing and says why in no log.
 */
function constants(root) {
  const contents = root.lookupEnum('sync_pb.ClientToServerMessage.Contents').values
  const commit = root.lookupEnum('sync_pb.CommitResponse.ResponseType').values
  const errors = root.lookupEnum('sync_pb.SyncEnums.ErrorType').values
  return {
    GET_UPDATES: contents.GET_UPDATES,
    COMMIT: contents.COMMIT,
    COMMIT_SUCCESS: commit.SUCCESS,
    COMMIT_INVALID: commit.INVALID_MESSAGE,
    NO_ERROR: errors.SUCCESS,
    NOT_MY_BIRTHDAY: errors.NOT_MY_BIRTHDAY
  }
}

/**
 * A progress marker's token is ours to define.
 *
 * The client treats it as opaque and hands it straight back, so the simplest
 * honest token is the account version the client has caught up to. Written as
 * a string because the field is bytes and a number would have to be encoded
 * anyway.
 */
const tokenFor = (version) => Buffer.from(String(version), 'utf8')
const versionFrom = (token) => {
  if (!token || token.length === 0) return 0
  const parsed = Number.parseInt(Buffer.from(token).toString('utf8'), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * Which datatype a progress marker is about.
 *
 * The client identifies datatypes by their field number in EntitySpecifics,
 * which is what data_type_id is. Mapping it back through the loaded protocol
 * means no table here goes stale when upstream adds a datatype.
 */
function datatypeById(root, id) {
  const specifics = root.lookupType('sync_pb.EntitySpecifics')
  for (const field of Object.values(specifics.fields)) {
    if (field.id === id) return field.name
  }
  return null
}

/** Turn a stored row into the SyncEntity the client expects. */
function toSyncEntity(row, root) {
  const specifics = root.lookupType('sync_pb.EntitySpecifics')
  return {
    id_string: row.id,
    parent_id_string: row.parent_id || undefined,
    version: row.version,
    name: row.name || undefined,
    non_unique_name: row.name || undefined,
    client_tag_hash: row.client_tag ?? undefined,
    server_defined_unique_tag: row.server_tag ?? undefined,
    deleted: row.deleted === 1,
    mtime: row.mtime,
    ctime: row.ctime,
    // A tombstone carries no specifics: the client is being told the entity is
    // gone, and the old contents are not its business.
    specifics: row.deleted === 1 ? {} : specifics.decode(row.specifics)
  }
}

export function handleGetUpdates(store, root, accountId, message) {
  const request = message.get_updates ?? {}
  const markers = request.from_progress_marker ?? []
  const entries = []
  const newMarkers = []

  for (const marker of markers) {
    const datatype = datatypeById(root, marker.data_type_id)
    if (!datatype) continue
    const since = versionFrom(marker.token)
    const rows = store.updatesSince(accountId, datatype, since)
    for (const row of rows) entries.push(toSyncEntity(row, root))
    // Caught up to the account's high-water mark, not just to the last row we
    // sent: a datatype with no changes must still advance, or the client asks
    // for the same nothing forever.
    newMarkers.push({
      data_type_id: marker.data_type_id,
      token: tokenFor(store.latestVersion(accountId))
    })
  }

  return {
    get_updates: {
      entries,
      changes_remaining: 0,
      new_progress_marker: newMarkers
    }
  }
}

export function handleCommit(store, root, accountId, message) {
  const K = constants(root)
  const specifics = root.lookupType('sync_pb.EntitySpecifics')
  const entries = message.commit?.entries ?? []
  const responses = []

  for (const entry of entries) {
    const datatype = datatypeOf(entry.specifics)
    if (!datatype && !entry.deleted) {
      // Nothing identifies what this is, so there is nowhere to put it. Say so
      // rather than inventing a datatype.
      responses.push({ response_type: K.COMMIT_INVALID, error_message: 'entity has no specifics' })
      continue
    }
    const stored = store.commit(accountId, {
      id: entry.id_string?.startsWith('server-') ? entry.id_string : undefined,
      datatype: datatype ?? 'unknown',
      deleted: Boolean(entry.deleted),
      name: entry.name ?? entry.non_unique_name ?? '',
      parentId: entry.parent_id_string ?? '',
      clientTag: entry.client_tag_hash ?? null,
      serverTag: entry.server_defined_unique_tag ?? null,
      specifics: entry.specifics
        ? Buffer.from(specifics.encode(specifics.fromObject(entry.specifics)).finish())
        : Buffer.alloc(0)
    })
    // The client pairs responses with what it sent by position, so one goes
    // back for every entry, in order, including the ones that failed.
    responses.push({
      response_type: K.COMMIT_SUCCESS,
      id_string: stored.id,
      version: stored.version,
      mtime: stored.mtime
    })
  }

  return { commit: { entryResponse: responses } }
}

/**
 * The whole exchange: request bytes in, response bytes out.
 *
 * `accountFor` resolves the caller to an account id. Identity is deliberately
 * not decided here — see auth.mjs — so that this file stays about the protocol.
 */
export function handleRequest(store, root, requestBytes, accountId) {
  const K = constants(root)
  const message = decodeRequest(requestBytes)
  const account = store.account(accountId)

  // The client sends back the birthday we gave it. A mismatch means its data
  // and ours are about different histories, and the only safe answer is to
  // tell it to start over rather than to merge two unrelated worlds.
  const sent = message.store_birthday ? Buffer.from(message.store_birthday).toString('utf8') : ''
  if (sent && sent !== account.birthday) {
    return {
      bytes: encodeResponse({ error_code: K.NOT_MY_BIRTHDAY, store_birthday: account.birthday }),
      kind: 'not-my-birthday'
    }
  }

  let response
  let kind
  switch (message.message_contents) {
    case K.GET_UPDATES:
      response = handleGetUpdates(store, root, accountId, message)
      kind = 'get-updates'
      break
    case K.COMMIT:
      response = handleCommit(store, root, accountId, message)
      kind = 'commit'
      break
    default:
      // An exchange we do not implement yet. Answering with a clean, empty
      // response beats an error the client cannot act on, and the kind is
      // reported so an unhandled type shows up in the log instead of silently
      // being treated as normal traffic.
      response = {}
      kind = `unhandled:${message.message_contents}`
  }

  return {
    bytes: encodeResponse({
      ...response,
      error_code: K.NO_ERROR,
      store_birthday: account.birthday
    }),
    kind
  }
}
