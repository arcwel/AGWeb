#!/usr/bin/env node
// Fetches the official Node runtime that `webdeck-core` is built on top of.
//
// WHY NOT THE DEVELOPER'S OWN NODE: a Single Executable Application is a copy
// of a `node` binary with our bundle injected into it, so whatever `node` we
// start from is what ships. Homebrew's `node` is a 68 KB stub that dlopens
// twenty-odd dylibs out of /opt/homebrew (`otool -L` proves it). Injecting into
// that produces an executable that (a) will not run on a machine without
// Homebrew and (b) cannot pass library validation, since those dylibs carry
// somebody else's signature. The official nodejs.org build links only against
// system frameworks, so it is the only correct base.
//
// The download is checksum-verified against the release's own SHASUMS256.txt
// and cached under out/.node-runtime, which is already gitignored.
//
// Usage: node scripts/fetch-node-runtime.mjs [--json]
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Pinned deliberately. Bumping this changes the runtime every user runs, so it
 * is a decision, not a floating "latest". Krypton is the current LTS line.
 */
export const NODE_VERSION = 'v24.20.0'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cacheRoot = join(root, 'out', '.node-runtime')

/** Node's own naming for a release tarball, e.g. node-v24.20.0-darwin-arm64. */
function releaseName(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'win' : platform
  return `node-${NODE_VERSION}-${os}-${arch}`
}

/** Where the extracted `node` binary lives once fetched. */
export function nodeRuntimePath(platform = process.platform, arch = process.arch) {
  return join(cacheRoot, releaseName(platform, arch), 'bin', 'node')
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Downloads and verifies the runtime, or returns the cached one.
 * Returns the absolute path of the `node` executable.
 */
export async function ensureNodeRuntime({ quiet = false } = {}) {
  if (process.platform !== 'darwin') {
    // Not a refusal to support other platforms — just an honest boundary: the
    // signing story below is macOS-specific and nothing else has been tested.
    console.warn(`fetch-node-runtime: ${process.platform} is untested; proceeding anyway`)
  }

  const target = nodeRuntimePath()
  if (existsSync(target)) {
    if (!quiet) console.log(`node runtime (cached) -> ${target}`)
    return target
  }

  const name = releaseName()
  const base = `https://nodejs.org/dist/${NODE_VERSION}`
  const tarball = `${name}.tar.gz`
  if (!quiet) console.log(`fetching ${base}/${tarball}…`)

  const [archive, sums] = await Promise.all([
    download(`${base}/${tarball}`),
    download(`${base}/SHASUMS256.txt`).then((b) => b.toString('utf8'))
  ])

  const expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === tarball)?.[0]
  if (!expected) throw new Error(`${tarball} is not listed in SHASUMS256.txt`)

  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${tarball}: got ${actual}, expected ${expected}`)
  }

  mkdirSync(cacheRoot, { recursive: true })
  const scratch = join(cacheRoot, tarball)
  writeFileSync(scratch, archive)
  try {
    // tar(1) rather than a JS extractor: it is on every macOS box, and it
    // preserves the execute bit, which this repo has already been bitten by
    // (see scripts/postinstall.mjs on Google Drive stripping mode bits).
    execFileSync('tar', ['xzf', scratch, '-C', cacheRoot], { stdio: 'inherit' })
  } finally {
    rmSync(scratch, { force: true })
  }

  if (!existsSync(target)) throw new Error(`extracted archive has no ${target}`)
  chmodSync(target, 0o755)
  if (!quiet) console.log(`node runtime -> ${target}`)
  return target
}

/** The version string the fetched runtime actually reports, for provenance. */
export function nodeRuntimeVersion(binary) {
  return execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
}

// Run directly (`node scripts/fetch-node-runtime.mjs`), not when imported by
// build-core.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json')
  const binary = await ensureNodeRuntime({ quiet: json })
  if (json) {
    console.log(JSON.stringify({ version: nodeRuntimeVersion(binary), path: binary }))
  }
}
