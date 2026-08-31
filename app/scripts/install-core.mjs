#!/usr/bin/env node
// Places the built webdeck-core executable, and the runtime it needs beside it,
// into a WebDeck .app bundle.
//
// The browser spawns webdeck-core out of base::DIR_MODULE, which on macOS is
// the directory of the running executable — Contents/MacOS. So the core goes
// there, next to the main binary, and its runtime directory (node-pty's native
// addon, reveal.js's data files, the js-debug adapter) goes right beside it,
// which is where main.ts looks for it.
//
// This replaces the dev shim: a 281-byte shell script that ran the developer's
// Homebrew Node against a .cjs at an absolute path in their home directory. That
// script is why the bundle could not be handed to anyone or notarized.
//
// It does NOT sign anything — package-fork.mjs owns the signature, because the
// runtime's native Mach-O files (pty.node, spawn-helper) have to be sealed too,
// and signing is one job done once over the whole bundle rather than piecemeal.
//
// Usage: node scripts/install-core.mjs --app "<path to .app>" [--core <dir>] [--json]
import { chmodSync, cpSync, existsSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const asJson = process.argv.includes('--json')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`install-core — put webdeck-core into a WebDeck .app

  --app <path>   the .app bundle to install into (required)
  --core <dir>   directory holding the built core (default: out/core)
  --json         machine-readable result

Build the core first: npm run build:core`)
  process.exit(0)
}

function fail(reason) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason }, null, 2))
  else console.error(`install-core: ${reason}`)
  process.exit(1)
}

const appPath = arg('app')
if (!appPath) fail('pass --app <path to the .app bundle>')
if (!existsSync(appPath)) fail(`no bundle at ${appPath}`)

const coreDir = arg('core', join(root, 'out', 'core'))
const coreBinary = join(coreDir, 'webdeck-core')
const coreRuntime = join(coreDir, 'webdeck-core-runtime')

if (!existsSync(coreBinary)) fail(`no core executable at ${coreBinary} — run: npm run build:core`)
if (!existsSync(coreRuntime)) fail(`no runtime at ${coreRuntime} — run: npm run build:core`)

// A shell script here is the dev shim, and packaging it is the bug this fixes.
// Reading the first two bytes is enough to tell a Mach-O from a `#!`.
try {
  const { readFileSync } = await import('node:fs')
  const head = readFileSync(coreBinary).subarray(0, 2).toString('latin1')
  if (head === '#!')
    fail(`${coreBinary} is a script, not an executable — build:core did not produce a SEA`)
} catch (err) {
  fail(`could not read the core: ${err.message}`)
}

const macos = join(appPath, 'Contents', 'MacOS')
if (!existsSync(macos)) fail(`${appPath} has no Contents/MacOS — is this a real .app?`)

const destBinary = join(macos, 'webdeck-core')
const destRuntime = join(macos, 'webdeck-core-runtime')

// Replace whatever is there (the dev shim, or a stale copy).
for (const stale of [destBinary, destRuntime]) {
  if (existsSync(stale)) rmSync(stale, { recursive: true, force: true })
}

cpSync(coreBinary, destBinary)
chmodSync(destBinary, 0o755)
// verbatimSymlinks so node_modules' internal links are preserved rather than
// followed into duplicated trees.
cpSync(coreRuntime, destRuntime, { recursive: true, verbatimSymlinks: true })

const sizeMb = (statSync(destBinary).size / (1024 * 1024)).toFixed(1)
const result = {
  status: 'installed',
  binary: destBinary,
  runtime: destRuntime,
  sizeMb: Number(sizeMb)
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`webdeck-core installed into the bundle`)
  console.log(`  ${destBinary} (${sizeMb} MB)`)
  console.log(`  ${destRuntime}/`)
  console.log(`\nSign the bundle next: it must seal the core and the native files in its runtime.`)
}
