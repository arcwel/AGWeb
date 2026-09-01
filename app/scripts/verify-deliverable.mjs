#!/usr/bin/env node
// Does this .app actually work on a machine that has never seen the build tree?
//
// Every other gate in this repo runs against the developer's own checkout, on
// the machine that produced the binary. That machine has the Chromium source at
// /Volumes/BG_Dev, Homebrew Node on PATH, and a gen/ directory full of
// resources — and a build can lean on any of them without anyone noticing. A
// tester has none of it.
//
// So this copies the bundle somewhere else, strips the environment down to what
// a fresh Mac has, and runs it there. What it is really asking is: is anything
// still reaching back into the developer's machine?
//
// Usage:
//   node scripts/verify-deliverable.mjs --app "<path to .app>" [--json] [--keep]
// Exit codes: 0 deliverable · 1 not deliverable · 2 could not check
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)
const asJson = flag('json')

if (flag('help') || flag('h')) {
  console.log(`verify-deliverable — would this build work on someone else's Mac?

  --app <path>   the .app bundle to test (required)
  --json         machine-readable result
  --keep         leave the copied bundle in place for inspection

Exit: 0 deliverable · 1 not deliverable · 2 could not check`)
  process.exit(0)
}

const checks = []
const record = (name, ok, detail) => checks.push({ name, ok, detail })

function cannotCheck(reason) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason }, null, 2))
  else console.error(`cannot check: ${reason}`)
  process.exit(2)
}

const appPath = arg('app')
if (!appPath) cannotCheck('pass --app <path to the .app bundle>')
if (!existsSync(appPath)) cannotCheck(`no bundle at ${appPath}`)

// A copy, somewhere unrelated. Running it in place would let it find the build
// directory by relative path and pass for the wrong reason.
const stage = mkdtempSync(join(tmpdir(), 'webdeck-deliverable-'))
const staged = join(stage, basename(appPath))

let exitCode = 0
try {
  cpSync(appPath, staged, { recursive: true, verbatimSymlinks: true })
  record('bundle copies away from the build tree', true, staged)
} catch (err) {
  cannotCheck(`could not copy the bundle: ${err.message}`)
}

const binary = join(staged, 'Contents', 'MacOS', 'Arcwel WebDeck')
if (!existsSync(binary)) {
  cannotCheck(`no executable at Contents/MacOS/Arcwel WebDeck inside ${staged}`)
}

/**
 * Libraries this file needs that the bundle does not contain.
 *
 * @rpath entries are NOT waved through. That was the first version of this
 * check and it reported a clean bill of health for a component build — the one
 * case that matters most, where the app links 500-odd dylibs that live in the
 * build directory and simply are not in the bundle. An @rpath entry is only
 * fine if it actually resolves inside the app, so each one is looked for.
 */
function missingLinkage(file, bundleRoot) {
  let out
  try {
    out = execFileSync('otool', ['-L', file], { encoding: 'utf8' })
  } catch {
    return []
  }
  const missing = []
  for (const line of out.split('\n').slice(1)) {
    const lib = line.trim().split(' ')[0]
    if (!lib) continue
    if (lib.startsWith('/usr/lib/') || lib.startsWith('/System/')) continue
    if (lib.startsWith('@executable_path') || lib.startsWith('@loader_path')) continue
    if (lib.startsWith('@rpath/')) {
      // Is it anywhere in the bundle at all?
      const name = lib.slice('@rpath/'.length)
      if (!bundleContains(bundleRoot, name)) missing.push(`${lib} (not in the bundle)`)
      continue
    }
    // An absolute path outside the bundle is a hard dependency on this machine.
    if (!lib.startsWith(bundleRoot)) missing.push(lib)
  }
  return missing
}

/** Cheap recursive search for a filename inside the bundle. */
function bundleContains(root, name) {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === name) return true
      if (entry.isDirectory()) stack.push(join(dir, entry.name))
    }
  }
  return false
}

// 1. Nothing in the bundle links against a path on this developer's machine.
//    A component build linking to dylibs in out/webdeck is the classic case:
//    it runs perfectly here and not at all anywhere else.
const strays = missingLinkage(binary, staged)
record(
  'every library the app needs is inside it',
  strays.length === 0,
  strays.length ? `${strays.length} missing, e.g. ${strays.slice(0, 3).join(', ')}` : 'all present'
)
if (strays.length) exitCode = 1

// 2. The core ships inside the bundle, and is a real executable rather than a
//    script pointing at someone's Node.
const coreCandidates = ['Contents/Helpers/webdeck-core', 'Contents/MacOS/webdeck-core']
const corePath = coreCandidates.map((rel) => join(staged, rel)).find((p) => existsSync(p))
if (!corePath) {
  record('webdeck-core ships inside the bundle', false, `not at ${coreCandidates.join(' or ')}`)
  exitCode = 1
} else {
  let head
  try {
    head = execFileSync('file', ['-b', corePath], { encoding: 'utf8' }).trim()
  } catch {
    head = 'unreadable'
  }
  const isMachO = /Mach-O/.test(head)
  record('webdeck-core is a real executable', isMachO, head)
  if (!isMachO) exitCode = 1

  const coreStrays = missingLinkage(corePath, staged)
  record(
    'every library the core needs is inside the app',
    coreStrays.length === 0,
    coreStrays.length ? coreStrays.slice(0, 3).join(', ') : 'all present'
  )
  if (coreStrays.length) exitCode = 1
}

// 3. It runs with a stripped environment. No Homebrew on PATH, no HOME full of
//    the developer's dotfiles, nothing inherited from this shell.
const cleanEnv = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: join(stage, 'home')
}
try {
  const version = execFileSync(binary, ['--version'], {
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 60_000
  }).trim()
  record('runs with a stripped environment', Boolean(version), version || '(no output)')
  if (!version) exitCode = 1
} catch (err) {
  record('runs with a stripped environment', false, String(err.message).split('\n')[0])
  exitCode = 1
}

// 4. It actually starts and serves chrome://webdeck from inside the copy —
//    which is the whole product. --version proves the binary loads; it does not
//    prove the resources shipped.
const debugPort = 9502
let child
try {
  child = spawn(
    binary,
    [
      `--remote-debugging-port=${debugPort}`,
      '--allow-chrome-scheme-url',
      '--no-first-run',
      '--no-default-browser-check',
      // The stripped HOME below has no login keychain, so the browser's OSCrypt
      // "Safe Storage" access would BLOCK forever waiting for a keychain that
      // isn't there — hanging the shell's boot before it can connect to the
      // core. A real tester always has a login keychain; the keychain is a
      // runtime OS resource, not a build-machine dependency, so mock it here so
      // this check tests what it means to (no build-tree deps), not the keychain.
      '--use-mock-keychain',
      `--user-data-dir=${join(stage, 'profile')}`
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv }
  )

  const deadline = Date.now() + 60_000
  let up = false
  while (Date.now() < deadline && !up) {
    up = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((r) => r.ok)
      .catch(() => false)
    if (!up) await sleep(500)
  }
  record('starts from the copied bundle', up, up ? 'DevTools answering' : 'never came up')
  if (!up) throw new Error('browser did not start')

  await fetch(`http://127.0.0.1:${debugPort}/json/new?chrome://webdeck`, { method: 'PUT' })
  let page = null
  const pageDeadline = Date.now() + 60_000
  while (Date.now() < pageDeadline && !page) {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    page = targets.find((t) => String(t.url).startsWith('chrome://webdeck')) ?? null
    if (!page) await sleep(500)
  }
  record('chrome://webdeck exists', Boolean(page), page ? page.url : 'never appeared')
  if (!page) throw new Error('no webdeck page')

  // The UI and the core both have to be inside the bundle for this to answer.
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  let id = 0
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const messageId = ++id
      const onMessage = (raw) => {
        const frame = JSON.parse(String(raw))
        if (frame.id !== messageId) return
        ws.off('message', onMessage)
        resolve(frame.result?.result?.value)
      }
      ws.on('message', onMessage)
      ws.send(
        JSON.stringify({
          id: messageId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
    })

  const mounted = await evaluate(
    'new Promise(r => { const t = setInterval(() => { if (document.querySelector(".wd-shell")) { clearInterval(t); r(true) } }, 200); setTimeout(() => r(false), 45000) })'
  )
  record(
    'the UI bundle is inside the app',
    Boolean(mounted),
    mounted ? '.wd-shell mounted' : 'never mounted'
  )
  if (!mounted) exitCode = 1

  const info = await evaluate(
    'window.agweb.getAppInfo().then(i => JSON.stringify(i)).catch(e => "FAILED: " + e.message)'
  )
  const coreOk = typeof info === 'string' && info.startsWith('{')
  record('the core starts from inside the app', coreOk, String(info))
  if (!coreOk) exitCode = 1

  ws.close()
} catch (err) {
  record('runs standalone', false, String(err.message).split('\n')[0])
  exitCode = 1
} finally {
  try {
    child?.kill()
  } catch {
    // already gone
  }
}

if (!flag('keep')) rmSync(stage, { recursive: true, force: true })

if (asJson) {
  console.log(
    JSON.stringify({ status: exitCode === 0 ? 'deliverable' : 'not-deliverable', checks }, null, 2)
  )
} else {
  console.log(`Arcwel WebDeck — is this build deliverable?\n`)
  for (const check of checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}\n      ${check.detail}`)
  }
  console.log(
    exitCode === 0
      ? '\nThis build runs on a machine that has never seen the build tree.'
      : '\nNOT deliverable — the ✗ lines are things a tester would hit and you would not.'
  )
}
process.exit(exitCode)
