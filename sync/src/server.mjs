// The HTTP surface the browser talks to.
//
// The sync engine POSTs a serialized ClientToServerMessage to <sync-url>/command/
// and reads a ClientToServerResponse back. That is the entire API; everything
// else here exists so the service can be run and looked at.
import { createServer } from 'node:http'
import { protocol } from './protocol.mjs'
import { SyncStore } from './store.mjs'
import { handleRequest } from './handler.mjs'
import { accountForRequest } from './auth.mjs'
import { IdentityStore, handleIdentity, isIdentityPath } from './identity.mjs'

/** The path the sync engine appends to whatever --sync-url it was given. */
const COMMAND_PATH = '/command/'

/** Larger than any single sync exchange; smaller than a memory problem. */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/** Route one identity request: read its body, then answer. */
function handleIdentityRequest(request, response, url, identities, log, started) {
  readBody(request)
    .then((body) => {
      handleIdentity({ request, response, url, body, identities, log })
      log({ kind: `identity${url.pathname}`, ms: Date.now() - started })
    })
    .catch(() => {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('bad request\n')
    })
}

function readBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`request body over ${limit} bytes`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

/**
 * Start the service.
 *
 * `log` is called once per exchange with a small record — what kind it was,
 * for whom, how big, how long. A sync server that cannot say what it did is
 * impossible to debug from the client side, where all you see is "syncing" or
 * nothing at all.
 */
export function startSyncServer({
  port = 0,
  host = '127.0.0.1',
  dbPath = ':memory:',
  log = () => {}
} = {}) {
  const root = protocol()
  const store = new SyncStore(dbPath)
  // Identity shares the database and the port: the browser is pointed at one
  // origin for both, and keeping accounts beside the data they own means a
  // reset cannot leave a token pointing at nothing.
  const identities = new IdentityStore(store.db)

  const server = createServer((request, response) => {
    const started = Date.now()
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`)

    // A liveness check that does not need a protocol client, so "is it up?"
    // never requires running a browser.
    if (request.method === 'GET' && url.pathname === '/health') {
      const body = JSON.stringify({ status: 'ok', accounts: store.accounts().length })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
      return
    }

    // Identity owns a fixed set of paths; sync owns exactly one.
    if (isIdentityPath(url.pathname)) {
      handleIdentityRequest(request, response, url, identities, log, started)
      return
    }

    if (request.method !== 'POST' || !url.pathname.endsWith(COMMAND_PATH)) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found\n')
      return
    }

    const account = accountForRequest(request)
    if (!account) {
      // The engine treats 401 as "get a fresh token and retry", which is the
      // honest answer when we cannot tell who is calling.
      response.writeHead(401, { 'content-type': 'text/plain' })
      response.end('unauthenticated\n')
      log({ kind: 'unauthenticated', account: null, ms: Date.now() - started })
      return
    }

    readBody(request)
      .then((body) => {
        const { bytes, kind } = handleRequest(store, root, body, account)
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': bytes.length
        })
        response.end(bytes)
        log({ kind, account, requestBytes: body.length, responseBytes: bytes.length, ms: Date.now() - started })
      })
      .catch((error) => {
        // A malformed message is the client's problem to retry, not ours to
        // crash on; say which so a protocol change is visible in the log.
        response.writeHead(400, { 'content-type': 'text/plain' })
        response.end('bad request\n')
        log({ kind: 'bad-request', account, error: error.message, ms: Date.now() - started })
      })
  })

  return new Promise((resolve, reject) => {
    // listen() reports failure as an 'error' event, not a thrown error. Without
    // this the common ones — a port already in use, a port needing root — reach
    // the user as an unhandled event and a Node stack trace.
    server.once('error', (error) => {
      store.close()
      reject(error)
    })
    server.listen(port, host, () => {
      const address = server.address()
      resolve({
        port: address.port,
        host: address.address,
        url: `http://${host}:${address.port}`,
        store,
        identities,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              store.close()
              done()
            })
          })
      })
    })
  })
}
