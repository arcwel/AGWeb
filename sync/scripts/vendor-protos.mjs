#!/usr/bin/env node
// Copy Chromium's sync protocol definitions into this package.
//
// The wire format is not ours to invent: it is whatever the browser we ship
// speaks, and that is defined by components/sync/protocol/*.proto in the
// checkout named by chromium/fork.json. Vendoring them means the server is
// built against the same definitions as the client, and that a protocol change
// on an upstream bump shows up as a diff here rather than as a sync that
// silently stops working.
//
// Usage: node scripts/vendor-protos.mjs [--checkout <src>] [--check] [--json]
// Exit: 0 in sync (or copied) · 1 out of date with --check · 2 could not run
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(packageRoot)
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const asJson = process.argv.includes('--json')
const checkOnly = process.argv.includes('--check')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`vendor-protos — copy Chromium's sync .proto files into this package

  --checkout <path>  Chromium src dir (default: the one in chromium/fork.json)
  --check            report drift instead of copying
  --json             machine-readable result

Exit: 0 in sync · 1 out of date (--check) · 2 could not run`)
  process.exit(0)
}

function cannotRun(reason) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason }))
  else console.error(`cannot run: ${reason}`)
  process.exit(2)
}

let checkout = arg('checkout')
if (!checkout) {
  const forkPath = join(repoRoot, 'chromium', 'fork.json')
  if (!existsSync(forkPath)) cannotRun(`no --checkout and no ${forkPath}`)
  try {
    checkout = JSON.parse(readFileSync(forkPath, 'utf8')).checkout
  } catch (error) {
    cannotRun(`fork.json is not valid JSON: ${error.message}`)
  }
}
const source = resolve(checkout ?? '', 'components/sync/protocol')
if (!existsSync(source)) cannotRun(`no sync protocol directory at ${source}`)

const dest = join(packageRoot, 'protocol')
const wanted = readdirSync(source)
  .filter((name) => name.endsWith('.proto'))
  .sort()

const changed = []
for (const name of wanted) {
  const from = join(source, name)
  const to = join(dest, name)
  const before = existsSync(to) ? readFileSync(to) : null
  if (before && before.equals(readFileSync(from))) continue
  changed.push(name)
  if (!checkOnly) {
    mkdirSync(dest, { recursive: true })
    copyFileSync(from, to)
  }
}
// One vendored proto imports google/protobuf/descriptor.proto. Take that from
// the same checkout rather than from whatever a library happens to bundle, so
// every definition on this wire comes from the browser we ship.
const COMMON = [['third_party/protobuf/src/google/protobuf/descriptor.proto', 'google/protobuf']]
for (const [relative, subdir] of COMMON) {
  const from = resolve(checkout ?? '', relative)
  if (!existsSync(from)) cannotRun(`no ${relative} in ${checkout}`)
  const to = join(dest, subdir, relative.split('/').pop())
  const before = existsSync(to) ? readFileSync(to) : null
  if (before && before.equals(readFileSync(from))) continue
  changed.push(join(subdir, relative.split('/').pop()))
  if (!checkOnly) {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
}

// A proto that went away upstream is drift too: leaving it behind would let the
// server keep compiling against a message the browser no longer sends.
const stale = existsSync(dest)
  ? readdirSync(dest).filter((n) => n.endsWith('.proto') && !wanted.includes(n))
  : []
for (const name of stale) {
  changed.push(`${name} (removed upstream)`)
  if (!checkOnly) rmSync(join(dest, name))
}

let version = 'unknown'
try {
  version = execFileSync('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
} catch {
  // A checkout without git history still vendors fine; only the note is lost.
}

const result = {
  status: changed.length === 0 ? 'in-sync' : checkOnly ? 'out-of-date' : 'copied',
  files: wanted.length + COMMON.length,
  changed,
  checkout,
  chromium: version
}
if (asJson) console.log(JSON.stringify(result, null, 2))
else if (changed.length === 0) console.log(`protocol in sync — ${wanted.length} files (${version})`)
else if (checkOnly) console.log(`out of date — ${changed.length} file(s):\n  ${changed.join('\n  ')}`)
else console.log(`vendored ${wanted.length} .proto files from ${version}\n  ${changed.length} changed`)

process.exit(checkOnly && changed.length > 0 ? 1 : 0)
