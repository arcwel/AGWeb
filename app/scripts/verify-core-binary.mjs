#!/usr/bin/env node
// Verifies the shipped `webdeck-core` executable for real: build it, prove it
// is a signable Mach-O, run it as a separate process with NO Node anywhere on
// its PATH and nothing of this repo in its environment, connect over WebSocket,
// and drive actual domain calls. This is the fork's launch path end to end — a
// build that imports Electron, needs a Node install, fails to boot, or serves
// nothing fails here rather than on someone's machine.
//
// Usage: node scripts/verify-core-binary.mjs
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const exe = join(root, 'out', 'core', 'webdeck-core')
const dataDir = mkdtempSync(join(tmpdir(), 'webdeck-core-verify-'))

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

console.log('[1/5] building webdeck-core…')
execFileSync('node', [join(root, 'scripts', 'build-core.mjs')], { cwd: root, stdio: 'inherit' })
if (!existsSync(exe)) {
  console.error(`the build produced no executable at ${exe}`)
  process.exit(1)
}

console.log('[2/5] checking it is a signable Mach-O…')
// `file` rather than parsing the header ourselves: the failure mode being
// guarded against is a regression back to a shell script, which `file` names
// unambiguously.
const kind = execFileSync('file', ['-b', exe], { encoding: 'utf8' }).trim()
if (!/Mach-O.*executable/.test(kind)) {
  fail(`webdeck-core is "${kind}", not a Mach-O executable — it cannot be notarized`)
}
// Signed ad-hoc by the build. A real Developer ID signature comes later from
// Chromium's sign_chrome.py; what matters here is that the binary is
// well-formed enough for codesign to seal and verify at all.
try {
  execFileSync('codesign', ['--verify', '--strict', exe], { stdio: 'pipe' })
} catch (error) {
  fail(`codesign --verify rejected the executable: ${error.stderr?.toString().trim()}`)
}
// Nothing outside the OS may be linked in: a dylib from Homebrew (or anywhere
// else on the build machine) both breaks on a tester's Mac and fails library
// validation under the hardened runtime.
const linked = execFileSync('otool', ['-L', exe], { encoding: 'utf8' })
  .split('\n')
  .slice(1)
  .map((line) => line.trim().split(' ')[0])
  .filter(Boolean)
  .filter((path) => !/^(\/usr\/lib\/|\/System\/Library\/)/.test(path))
if (linked.length > 0) {
  fail(`webdeck-core links against non-system libraries: ${linked.join(', ')}`)
}

console.log('[3/5] booting it with no Node available…')
// The point of the whole exercise: a tester has no Node, and certainly not the
// Homebrew one this repo was built against. Hand the child a scrubbed
// environment with a PATH that provably contains no `node`, and no npm/nvm
// variables that could smuggle one in.
const cleanPath = '/usr/bin:/bin:/usr/sbin:/sbin'
for (const dir of cleanPath.split(':')) {
  if (existsSync(join(dir, 'node'))) {
    fail(`${dir}/node exists, so this check would not prove anything`)
  }
}
const child = spawn(exe, ['--user-data', dataDir, '--port', '0'], {
  // Deliberately NOT the repo: the executable must not be able to reach this
  // checkout's node_modules by way of the working directory.
  cwd: tmpdir(),
  env: { PATH: cleanPath, HOME: dataDir, TMPDIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stderr.on('data', (d) => (stderr += d.toString()))

const startedAt = Date.now()
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`core never reported ready. stderr:\n${stderr}`)),
    20000
  )
  let buffered = ''
  child.stdout.on('data', (data) => {
    buffered += data.toString()
    for (const line of buffered.split('\n')) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.ready && parsed.port) {
          clearTimeout(timer)
          resolve(parsed.port)
          return
        }
      } catch {
        // partial line; keep buffering
      }
    }
  })
  child.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`core exited early (${code}). stderr:\n${stderr}`))
  })
})
const bootMs = Date.now() - startedAt

// The core now refuses an unauthenticated connection, so this has to present
// the same credential the browser does: the per-boot token from the handoff
// file, offered as a WebSocket subprotocol. Reading it here is also a check in
// its own right — if the handoff were ever written without a token, this fails
// rather than quietly connecting to a core that stopped requiring one.
const handoff = JSON.parse(readFileSync(join(dataDir, 'core-port.json'), 'utf8'))
if (!handoff.token) {
  console.error('the core published no token — its socket would be open to any local process')
  process.exit(1)
}

console.log(`[4/5] driving real domain calls on port ${port} (ready in ${bootMs} ms)…`)
const ws = new WebSocket(`ws://127.0.0.1:${port}`, [`webdeck.token.v1.${handoff.token}`])
const replies = new Map()
let nextId = 1

function call(method, args = []) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    replies.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, args }))
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 5000)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

ws.on('message', (data) => {
  const res = JSON.parse(data.toString())
  const waiter = replies.get(res.id)
  if (!waiter) return
  replies.delete(res.id)
  if (res.error) waiter.reject(new Error(res.error))
  else waiter.resolve(res.result)
})

try {
  await new Promise((r) => ws.on('open', r))

  const policy = await call('policy:get')
  if (!policy?.mode) fail('policy:get returned no mode')

  const settings = await call('app-settings:write', [{ doNotTrack: true }])
  if (settings?.doNotTrack !== true) fail('app-settings:write did not persist')

  const sessions = await call('agent:list')
  if (!Array.isArray(sessions)) fail('agent:list did not return a list')

  const sync = await call('sync:status')
  if (typeof sync?.enabled !== 'boolean') fail('sync:status malformed')

  let rejected = false
  await call('agent:start', ['']).catch(() => (rejected = true))
  if (!rejected) fail('agent:start accepted an empty task')

  // Secrets: the standalone core must be able to STORE a provider key (it
  // refuses plaintext, so this only passes with a working keystore), and must
  // never hand the plaintext back over the wire.
  const stored = await call('secrets:set', ['anthropic', 'sk-ant-verify-000'])
  if (stored !== true) fail('secrets:set failed — the core cannot store a key')
  const providers = await call('secrets:list')
  if (providers?.encryptionAvailable !== true) fail('the core reports no working keystore')
  if (providers?.configured?.anthropic !== true) fail('secrets:list did not report the stored key')
  const onDisk = readFileSync(join(dataDir, 'secrets.json'), 'utf8')
  if (onDisk.includes('sk-ant-verify-000')) fail('the API key was written in plaintext')
  if (JSON.stringify(providers).includes('sk-ant-verify-000')) {
    fail('secrets:list leaked the plaintext key to the client')
  }

  // The terminal is the one domain that needs a NATIVE module (node-pty), which
  // cannot be sealed inside the executable and has to be dlopen'd from the
  // runtime directory beside it. Nothing else in this file would notice if that
  // stopped working, and a browser with no terminal is not shippable — so drive
  // a real pty and read its output back.
  console.log('[5/5] driving a real pty (node-pty, the one native dependency)…')
  const marker = `pty-ok-${Date.now()}`
  await call('term:create', ['verify-term', 80, 24])
  await sleep(500)
  await call('term:input', ['verify-term', `echo ${marker}\n`])
  let sawMarker = false
  for (let attempt = 0; attempt < 40 && !sawMarker; attempt++) {
    await sleep(150)
    const attached = await call('term:attach', ['verify-term'])
    if (!attached?.running && attempt > 2) break
    // The echoed command line contains the marker too; require it twice, which
    // only happens once the shell has actually run it.
    sawMarker = (attached?.buffer?.split(marker).length ?? 0) > 2
  }
  if (!sawMarker) {
    fail('the terminal produced no output — node-pty did not load in the executable')
  }
  await call('term:dispose', ['verify-term']).catch(() => {})

  if (process.exitCode) throw new Error('one or more checks failed')
  console.log(
    'webdeck-core executable OK — Mach-O, codesign-verified, links only system libraries, ' +
      'boots with no Node installed, serves the CORE domains, and runs a real pty'
  )
} finally {
  ws.close()
  child.kill()
  rmSync(dataDir, { recursive: true, force: true })
}
