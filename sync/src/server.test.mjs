// The service, exercised the way the browser exercises it: real protobuf
// bytes over real HTTP. Nothing here mocks the protocol, because the protocol
// is the only part that has to be right.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startSyncServer } from './server.mjs'
import { protocol, messageType, CLIENT_TO_SERVER, SERVER_TO_CLIENT } from './protocol.mjs'

const root = protocol()
const C2S = messageType(CLIENT_TO_SERVER)
const S2C = messageType(SERVER_TO_CLIENT)
const CONTENTS = root.lookupEnum('sync_pb.ClientToServerMessage.Contents').values
const RESPONSE = root.lookupEnum('sync_pb.CommitResponse.ResponseType').values
const ERRORS = root.lookupEnum('sync_pb.SyncEnums.ErrorType').values
const BOOKMARK_ID = root.lookupType('sync_pb.EntitySpecifics').fields.bookmark.id

let service

before(async () => {
  service = await startSyncServer({ port: 0, dbPath: ':memory:' })
})
after(async () => {
  await service.close()
})

/** POST a message the way the sync engine does, and decode what comes back. */
async function exchange(message, { token = 'test-account-token' } = {}) {
  const body = Buffer.from(C2S.encode(C2S.fromObject(message)).finish())
  const response = await fetch(`${service.url}/command/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body
  })
  if (!response.ok) return { status: response.status }
  return { status: response.status, message: S2C.decode(new Uint8Array(await response.arrayBuffer())) }
}

const bookmark = (title, url, tag) => ({
  name: title,
  non_unique_name: title,
  client_tag_hash: tag,
  specifics: { bookmark: { url, legacy_canonicalized_title: title } }
})

const commitOf = (...entries) => ({
  share: 'test',
  protocol_version: 0,
  message_contents: CONTENTS.COMMIT,
  commit: { cache_guid: 'test-guid', entries }
})

const getUpdatesFrom = (token, birthday) => ({
  share: 'test',
  protocol_version: 0,
  message_contents: CONTENTS.GET_UPDATES,
  ...(birthday ? { store_birthday: birthday } : {}),
  get_updates: {
    from_progress_marker: [{ data_type_id: BOOKMARK_ID, token: Buffer.from(String(token)) }]
  }
})

describe('the sync endpoint', () => {
  test('refuses a request with no bearer token', async () => {
    // No default account: a service that guesses who you are will eventually
    // merge two people's bookmarks.
    const { status } = await exchange(getUpdatesFrom(0), { token: null })
    assert.equal(status, 401)
  })

  test('commits an entity and gives it a server id and a version', async () => {
    const { message } = await exchange(commitOf(bookmark('Anthropic', 'https://anthropic.com', 't1')))
    const [entry] = message.commit.entryResponse

    assert.equal(entry.response_type, RESPONSE.SUCCESS)
    assert.ok(entry.id_string.length > 0, 'the server names what the client created')
    assert.ok(Number(entry.version) > 0)
    assert.ok(message.store_birthday.length > 0, 'a birthday comes back on every exchange')
  })

  test('returns that entity to a client starting from nothing', async () => {
    const { message } = await exchange(getUpdatesFrom(0))
    const found = message.get_updates.entries.find((e) => e.name === 'Anthropic')

    assert.ok(found, 'the committed bookmark comes back')
    assert.equal(found.specifics.bookmark.url, 'https://anthropic.com')
  })

  test('returns nothing to a client that is already caught up', async () => {
    const first = await exchange(getUpdatesFrom(0))
    const caughtUp = Buffer.from(first.message.get_updates.new_progress_marker[0].token).toString()

    const second = await exchange(getUpdatesFrom(caughtUp))

    // The token has to be honoured or every sync re-downloads everything.
    assert.equal(second.message.get_updates.entries.length, 0)
  })

  test('advances the progress marker even when nothing changed', async () => {
    const { message } = await exchange(getUpdatesFrom(0))
    const token = Buffer.from(message.get_updates.new_progress_marker[0].token).toString()

    assert.ok(Number(token) > 0, 'a marker that never advances asks for the same nothing forever')
  })

  test('keeps one row when the same client tag is committed twice', async () => {
    const again = bookmark('Anthropic (renamed)', 'https://anthropic.com', 't1')
    const { message } = await exchange(commitOf(again))
    const [entry] = message.commit.entryResponse

    const updates = await exchange(getUpdatesFrom(0))
    const matching = updates.message.get_updates.entries.filter((e) => e.client_tag_hash === 't1')

    assert.equal(entry.response_type, RESPONSE.SUCCESS)
    assert.equal(matching.length, 1, 'a re-commit updates the entity rather than twinning it')
    assert.equal(matching[0].name, 'Anthropic (renamed)')
  })

  test('sends a tombstone, not silence, when an entity is deleted', async () => {
    const before = await exchange(getUpdatesFrom(0))
    const target = before.message.get_updates.entries.find((e) => e.client_tag_hash === 't1')

    await exchange(commitOf({ id_string: target.id_string, client_tag_hash: 't1', deleted: true }))
    const after = await exchange(getUpdatesFrom(0))
    const found = after.message.get_updates.entries.find((e) => e.id_string === target.id_string)

    // A dropped row would look like an entity that never existed, and the
    // other clients would keep their copies forever.
    assert.ok(found, 'the deletion is delivered as an entity')
    assert.equal(found.deleted, true)
  })

  test('rejects an entity that says nothing about what it is', async () => {
    const { message } = await exchange(commitOf({ name: 'nothing', non_unique_name: 'nothing' }))
    const [entry] = message.commit.entryResponse

    assert.equal(entry.response_type, RESPONSE.INVALID_MESSAGE)
  })

  test('tells a client with the wrong birthday to start over', async () => {
    const { message } = await exchange(getUpdatesFrom(0, Buffer.from('some-other-birthday')))

    // The client's data and ours are about different histories; merging them
    // would be worse than asking it to re-download.
    assert.equal(message.error_code, ERRORS.NOT_MY_BIRTHDAY)
  })

  test('keeps accounts apart', async () => {
    const other = await exchange(getUpdatesFrom(0), { token: 'a-different-account' })

    assert.equal(other.message.get_updates.entries.length, 0)
  })

  test('answers a health check without a protocol client', async () => {
    const response = await fetch(`${service.url}/health`)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.status, 'ok')
  })

  test('404s anything that is not the command endpoint', async () => {
    const response = await fetch(`${service.url}/`, { method: 'POST' })
    assert.equal(response.status, 404)
  })
})
