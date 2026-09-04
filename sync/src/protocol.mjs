// The wire format, read from Chromium's own .proto files.
//
// Every message on this wire is defined by components/sync/protocol in the
// browser we ship, vendored into ../protocol by scripts/vendor-protos.mjs. The
// server parses those files at startup rather than carrying a hand-written
// transcription of them: a transcription is a second source of truth that goes
// quietly wrong on an upstream bump, and "sync stopped working after a rebase"
// is the worst bug to go looking for.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
export const PROTOCOL_DIR = join(packageRoot, 'protocol')

/** The two messages the whole protocol is carried in. */
export const CLIENT_TO_SERVER = 'sync_pb.ClientToServerMessage'
export const SERVER_TO_CLIENT = 'sync_pb.ClientToServerResponse'

let cached = null

/**
 * Load every vendored proto once.
 *
 * They import each other, so they are loaded as one set rather than
 * individually; protobufjs resolves the imports against the same directory.
 */
export function protocol() {
  if (cached) return cached
  const root = new protobuf.Root()
  const vendored = new Set(readdirSync(PROTOCOL_DIR).filter((name) => name.endsWith('.proto')))
  // Upstream writes imports as "components/sync/protocol/x.proto", and the
  // files sit flat here, so a sync proto resolves to its basename. Anything
  // else — google/protobuf/descriptor.proto — is vendored at its own relative
  // path, and resolves there. Nothing is looked for outside this directory:
  // every definition on this wire comes from the browser we ship.
  root.resolvePath = (_origin, target) => {
    const name = target.split('/').pop()
    return vendored.has(name) ? join(PROTOCOL_DIR, name) : join(PROTOCOL_DIR, target)
  }
  const files = readdirSync(PROTOCOL_DIR)
    .filter((name) => name.endsWith('.proto'))
    .sort()
    .map((name) => join(PROTOCOL_DIR, name))
  root.loadSync(files, { keepCase: true })
  cached = root
  return root
}

/** A message type by fully-qualified name, e.g. "sync_pb.SyncEntity". */
export function messageType(name) {
  return protocol().lookupType(name)
}

/** Decode a request body the browser POSTed. */
export function decodeRequest(bytes) {
  return messageType(CLIENT_TO_SERVER).decode(bytes)
}

/** Encode a response for the browser. */
export function encodeResponse(response) {
  const type = messageType(SERVER_TO_CLIENT)
  const message = type.fromObject(response)
  const invalid = type.verify(message)
  // Refuse to put a malformed message on the wire: the browser would reject it
  // with an error that names nothing, and the reason would be here.
  if (invalid) throw new Error(`response does not match ${SERVER_TO_CLIENT}: ${invalid}`)
  return Buffer.from(type.encode(message).finish())
}

/**
 * The datatype a SyncEntity carries, as its specifics field name.
 *
 * EntitySpecifics is a big one-of-everything message with one field per
 * datatype, so which field is set IS the datatype. Reading it back this way
 * means a datatype added upstream needs no list here to be recognised.
 */
export function datatypeOf(specifics) {
  if (!specifics) return null
  for (const [field, value] of Object.entries(specifics)) {
    if (value !== null && value !== undefined) return field
  }
  return null
}

/** Every datatype name this protocol version knows, for diagnostics. */
export function knownDatatypes() {
  return Object.keys(messageType('sync_pb.EntitySpecifics').fields).sort()
}
