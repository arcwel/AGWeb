#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
// webdeck-sync — run and inspect the sync service.
//
// The shebang carries --no-warnings=ExperimentalWarning because node:sqlite
// announces itself on every run, before any code here can install a filter:
// the warning is emitted while Node links the builtin, which happens before
// the first module body executes. Running this as `node src/cli.mjs` skips the
// shebang and the notice comes back; `npm run sync -- <command>` carries the
// same flag.
//
// Agent-native by default: every command takes flags rather than prompts,
// --json prints a machine-readable result, and the exit code says what
// happened. See ../README.md for pointing a browser at it.
import { protocol, knownDatatypes } from './protocol.mjs'
import { SyncStore } from './store.mjs'
import { startSyncServer } from './server.mjs'
import { AUTH_MODE } from './auth.mjs'
import { IdentityStore, gaiaConfig } from './identity.mjs'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)
const asJson = has('json')

const USAGE = `webdeck-sync — a sync service that speaks Chromium's own protocol

  serve      run the service
    --port <n>        port to listen on (default 8384; 0 asks the OS)
    --data <path>     SQLite file (default ./webdeck-sync.db; :memory: for none)
    --host <addr>     interface (default 127.0.0.1 — see below)
    --quiet           do not log each exchange

  status     what the service holds
    --data <path>     SQLite file to read
    --account <id>    one account instead of all

  reset      throw one account's data away and mint a new birthday
    --data <path>     SQLite file
    --account <id>    required
    --dry-run         say what would go, change nothing

  account    add or list the accounts this service knows
    --data <path>     SQLite file
    --add <email>     create one and print its refresh token
    --name <name>     display name for --add

  config     write the gaia-config.json that points a browser here
    --url <origin>    where the service is (default http://127.0.0.1:8384)
    --out <path>      file to write (default ./gaia-config.json)

  datatypes  every datatype this protocol version carries

  Global: --json for machine-readable output, --help for this text.

Binding: the service authenticates by trusting the bearer token as an account
id (mode "${AUTH_MODE}"), so anyone who can reach the port can name any
account. It refuses to bind anywhere but loopback until that changes.

Exit: 0 ok · 1 refused or not found · 2 could not run`

function out(result, human) {
  if (asJson) console.log(JSON.stringify(result, null, 2))
  else console.log(human)
}
function fail(message, code = 2) {
  if (asJson) console.log(JSON.stringify({ status: 'error', error: message }, null, 2))
  else console.error(`webdeck-sync: ${message}`)
  process.exit(code)
}

if (!command || has('help') || command === 'help') {
  console.log(USAGE)
  process.exit(0)
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

switch (command) {
  case 'serve': {
    const host = flag('host', '127.0.0.1')
    if (!LOOPBACK.has(host)) {
      // Refusing beats a warning: the failure mode is other people's data in
      // your account, and it would not look like a failure from here.
      fail(
        `refusing to bind to ${host}: auth mode "${AUTH_MODE}" trusts the bearer token, ` +
          'so the service is only safe on loopback'
      )
    }
    const port = Number.parseInt(flag('port', '8384'), 10)
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`not a port: ${flag('port')}`)
    const dbPath = flag('data', 'webdeck-sync.db')
    const quiet = has('quiet')

    let service
    try {
      service = await startSyncServer({
        port,
        host,
        dbPath,
        log: (record) => {
          if (quiet) return
          if (asJson) console.log(JSON.stringify(record))
          else
            console.log(
              `${record.kind.padEnd(16)} ${String(record.account ?? '-').slice(0, 24).padEnd(24)} ${record.ms}ms`
            )
        }
      })
    } catch (error) {
      // The two that actually happen, each with the thing to do about it.
      if (error.code === 'EADDRINUSE') {
        fail(
          `port ${port} is already in use — another webdeck-sync is probably running.\n` +
            `  see which:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
            '  or run on a free port:  --port 0'
        )
      }
      if (error.code === 'EACCES') {
        fail(`not allowed to listen on port ${port}. Ports below 1024 need root; pick a higher one.`)
      }
      fail(error.message)
    }
    out(
      { status: 'listening', url: service.url, syncUrl: service.url, data: dbPath, auth: AUTH_MODE },
      `webdeck-sync listening on ${service.url}\n` +
        `  data: ${dbPath}\n` +
        `  point a browser at it: --sync-url=${service.url}`
    )
    const stop = () => {
      void service.close().then(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    break
  }

  case 'status': {
    const store = new SyncStore(flag('data', 'webdeck-sync.db'))
    const one = flag('account')
    const accounts = one ? [{ id: one }] : store.accounts()
    const result = accounts.map((a) => store.summary(a.id))
    store.close()
    out(
      { status: 'ok', accounts: result },
      result.length === 0
        ? 'no accounts yet'
        : result
            .map(
              (a) =>
                `${a.account} (version ${a.version})\n` +
                (a.datatypes.length === 0
                  ? '  nothing synced yet'
                  : a.datatypes
                      .map(
                        (d) =>
                          `  ${d.datatype.padEnd(28)} ${String(d.entities).padStart(5)} entities` +
                          (d.tombstones ? ` (${d.tombstones} deleted)` : '')
                      )
                      .join('\n'))
            )
            .join('\n\n')
    )
    break
  }

  case 'reset': {
    const account = flag('account')
    if (!account) fail('reset needs --account <id>', 1)
    const store = new SyncStore(flag('data', 'webdeck-sync.db'))
    const before = store.summary(account)
    const total = before.datatypes.reduce((n, d) => n + d.entities, 0)
    if (has('dry-run')) {
      store.close()
      out(
        { status: 'dry-run', account, wouldDelete: total },
        `would delete ${total} entities for ${account} and mint a new birthday`
      )
      break
    }
    const fresh = store.reset(account)
    store.close()
    out(
      { status: 'reset', account, deleted: total, birthday: fresh.birthday },
      `reset ${account}: ${total} entities deleted, new birthday minted\n` +
        'every client will re-download from empty on its next sync'
    )
    break
  }

  case 'account': {
    const store = new SyncStore(flag('data', 'webdeck-sync.db'))
    const identities = new IdentityStore(store.db)
    const email = flag('add')
    if (email) {
      const account = identities.addAccount(email, flag('name', email.split('@')[0]))
      store.close()
      out(
        { status: 'ok', account: { id: account.id, email: account.email }, refreshToken: account.refresh_token },
        `${account.email}\n  id:            ${account.id}\n  refresh token: ${account.refresh_token}\n\n` +
          'That token is this account\'s password. Give it to a browser once and it\n' +
          'exchanges it for access tokens from then on.'
      )
      break
    }
    const accounts = identities.accounts()
    store.close()
    out(
      { status: 'ok', accounts },
      accounts.length === 0
        ? 'no accounts yet — add one with --add <email>'
        : accounts.map((a) => `${a.email.padEnd(32)} ${a.id}`).join('\n')
    )
    break
  }

  case 'config': {
    const origin = flag('url', 'http://127.0.0.1:8384').replace(/\/$/, '')
    const target = resolve(flag('out', 'gaia-config.json'))
    const config = gaiaConfig(origin)
    writeFileSync(target, JSON.stringify(config, null, 2))
    out(
      { status: 'written', path: target, origin, urls: Object.keys(config.urls).length },
      `wrote ${target}\n` +
        `  ${Object.keys(config.urls).length} identity URLs pointed at ${origin}\n\n` +
        'Launch a browser with it:\n' +
        `  --gaia-config=${target} --sync-url=${origin}`
    )
    break
  }

  case 'datatypes': {
    protocol()
    const types = knownDatatypes()
    out({ status: 'ok', count: types.length, datatypes: types }, types.join('\n'))
    break
  }

  default:
    fail(`unknown command: ${command}. Try --help`, 1)
}
