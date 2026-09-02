#!/usr/bin/env node
// The auto-update CHANNEL for the fork (TASKS.md 10.2).
//
// Chromium's own updater is Google-infrastructure-bound, so a fork has to bring
// its own. This is the client half: given a SIGNED update manifest (an
// "appcast") the release process publishes, decide whether a newer build exists
// for our channel — and refuse to act on a manifest whose signature does not
// verify against a pinned key, because an unsigned update channel is a
// remote-code-execution channel (13.7c). Downloading and swapping the binary,
// and the in-product prompt, are 13.7c/13.7d and are deliberately NOT here — a
// wrong "update available" is cheap, a wrong "installed" is not.
//
// It is also the release half: `--genkey` mints the Ed25519 keypair (public key
// committed, private key kept by whoever signs releases), and `--sign` turns a
// plain manifest into the signed appcast this check consumes. One tool so the
// canonicalisation used to sign is exactly the one used to verify — a mismatch
// there is a silent "nothing verifies" failure.
//
// Dependency-free (node:crypto, node:https) so it runs from a release box or an
// updater with nothing installed but Node.
//
// Usage:
//   node scripts/update-check.mjs --manifest <url|path> [--current <ver>] \
//        [--pubkey <path>] [--channel stable] [--json]
//   node scripts/update-check.mjs --genkey <dir>
//   node scripts/update-check.mjs --sign <manifest.json> --key <private.pem> \
//        [--key-id <id>] [--out <appcast.json>]
import { Buffer } from 'node:buffer'
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { get } from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compareVersions } from './upstream-check.mjs'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export const EXIT_UP_TO_DATE = 0
// 1 = an update is available. Not an error — the same "there is an action to
// take" meaning exit 1 carries in upstream-check. A caller that wants only
// hard failures to be non-zero should branch on the JSON `status`, not `$?`.
export const EXIT_UPDATE = 1
export const EXIT_ERROR = 2
// 3 is its OWN code on purpose: a forged or corrupt manifest must be
// distinguishable from "no update", so a fail-closed updater never treats a
// signature failure as "nothing to do".
export const EXIT_INSECURE = 3

const FETCH_TIMEOUT_MS = 15000
const DEFAULT_PUBKEY = join(appRoot, 'release', 'update-pubkey.pem')

const HELP = `update-check — is a newer, SIGNED build available on our channel? (TASKS.md 10.2)

Usage
  npm run update:check -- --manifest <url|path> [options]     # client: check
  node scripts/update-check.mjs --genkey <dir>                 # release: mint keys
  node scripts/update-check.mjs --sign <manifest.json> --key <private.pem>  # release: sign

Check options
  --manifest <url|path>   The signed appcast to read (https URL or local file). Required.
  --current <version>     The installed version. Default: "version" in app/package.json.
  --channel <name>        Only accept a manifest for this channel. Default: stable.
  --pubkey <path>         Ed25519 public key (PEM) the manifest must verify against.
                          Default: app/release/update-pubkey.pem.
  --json                  Emit the result as JSON on stdout.

Release options
  --genkey <dir>          Write update-signing-key.pem (PRIVATE — keep it secret,
                          it is gitignored) and update-pubkey.pem (commit it) to <dir>.
  --sign <manifest.json>  Sign a plain manifest, printing the appcast to sign with.
  --key <private.pem>     The private key for --sign. Required with --sign.
  --key-id <id>           Label recorded in the appcast (default: "wd-release").
  --out <path>            Write the signed appcast here instead of stdout.

  --help, -h              This text.

Exit: 0 up to date · 1 update available · 2 could not run · 3 manifest failed to verify`

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

// ── versions ────────────────────────────────────────────────────────────────
// The app is semver (x.y.z), not a 4-part Chromium version, so it needs its own
// parser (upstream-check's requires exactly four parts). A pre-release or build
// suffix (0.2.0-rc.1, 0.2.0+sha) is dropped before comparing — we order by the
// release numbers only. Unparseable → null, which buildResult turns into an
// error rather than a silent miscompare.
export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const core = text.trim().split(/[-+]/)[0]
  const parts = core.split('.')
  if (parts.length === 0 || parts.length > 4) return null
  if (!parts.every((p) => /^\d+$/.test(p))) return null
  return parts.map(Number)
}

// ── canonical JSON ──────────────────────────────────────────────────────────
// The bytes that get signed and verified. Object keys are sorted recursively so
// the same manifest always serialises identically regardless of key order — the
// signer and the verifier MUST agree on this exactly or every signature fails.
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// ── signature ───────────────────────────────────────────────────────────────
/** Sign a manifest object with an Ed25519 private key. Returns base64. */
export function signManifest(manifest, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem)
  return cryptoSign(null, Buffer.from(canonicalize(manifest), 'utf8'), key).toString('base64')
}

/**
 * Verify a signed appcast against a pinned public key. FAIL CLOSED: any missing
 * field, malformed key, or bad signature returns { ok: false } with a reason —
 * never throws, so a caller cannot accidentally treat a crash as "verified".
 */
export function verifyAppcast(appcast, publicKeyPem) {
  try {
    if (!appcast || typeof appcast !== 'object')
      return { ok: false, reason: 'appcast is not an object' }
    const { manifest, signature } = appcast
    if (!manifest || typeof manifest !== 'object')
      return { ok: false, reason: 'no manifest object' }
    if (typeof signature !== 'string' || signature.length === 0)
      return { ok: false, reason: 'no signature' }
    const key = createPublicKey(publicKeyPem)
    const ok = cryptoVerify(
      null,
      Buffer.from(canonicalize(manifest), 'utf8'),
      key,
      Buffer.from(signature, 'base64')
    )
    return ok ? { ok: true } : { ok: false, reason: 'signature does not match the pinned key' }
  } catch (err) {
    return { ok: false, reason: `verification error: ${err.message}` }
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
/**
 * The pure verdict: given the installed version, a VERIFIED manifest, and the
 * channel we asked for, what should happen? No I/O, no crypto — those are done
 * by the caller and their outcome passed in as `verified`.
 */
export function buildResult({ current, manifest, channel, verified }) {
  if (!verified) {
    return { status: 'insecure', reason: 'manifest failed signature verification', current }
  }
  if (manifest.channel && channel && manifest.channel !== channel) {
    return {
      status: 'error',
      reason: `manifest is for channel "${manifest.channel}", asked for "${channel}"`,
      current
    }
  }
  const cur = parseVersion(current)
  const latest = parseVersion(manifest.version)
  if (!cur || !latest) {
    return {
      status: 'error',
      reason: `unparseable version (current="${current}", manifest="${manifest.version}")`,
      current
    }
  }
  const newer = compareVersions(latest, cur) > 0
  return {
    status: newer ? 'update-available' : 'up-to-date',
    current,
    latest: manifest.version,
    channel: manifest.channel ?? channel ?? 'stable',
    ...(newer
      ? {
          url: manifest.url,
          sha256: manifest.sha256,
          size: manifest.size,
          notes: manifest.notes,
          critical: Boolean(manifest.critical),
          pubDate: manifest.pubDate
        }
      : {})
  }
}

export function exitCodeFor(result) {
  switch (result.status) {
    case 'up-to-date':
      return EXIT_UP_TO_DATE
    case 'update-available':
      return EXIT_UPDATE
    case 'insecure':
      return EXIT_INSECURE
    default:
      return EXIT_ERROR
  }
}

// ── I/O ─────────────────────────────────────────────────────────────────────
function readManifestSource(source) {
  if (/^https:\/\//.test(source)) {
    return new Promise((res, rej) => {
      const req = get(source, (r) => {
        if (r.statusCode !== 200) {
          r.resume()
          return rej(new Error(`fetch ${source} -> HTTP ${r.statusCode}`))
        }
        let body = ''
        r.setEncoding('utf8')
        r.on('data', (c) => (body += c))
        r.on('end', () => res(body))
      })
      req.on('error', rej)
      req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('fetch timed out')))
    })
  }
  if (/^http:\/\//.test(source)) {
    // An update manifest fetched over plaintext http can be swapped in flight.
    // The signature still protects the payload, but refuse it so nobody wires a
    // channel that leans on http and a lapsed check.
    return Promise.reject(new Error('refusing an http:// manifest — use https or a local path'))
  }
  return Promise.resolve(readFileSync(resolve(source), 'utf8'))
}

function currentVersion() {
  const fromFlag = arg('current')
  if (fromFlag) return fromFlag
  return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
}

// ── release-side modes ──────────────────────────────────────────────────────
function doGenkey(dir) {
  const out = resolve(dir)
  mkdirSync(out, { recursive: true })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const privPath = join(out, 'update-signing-key.pem')
  const pubPath = join(out, 'update-pubkey.pem')
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }))
  console.error(`wrote PRIVATE key -> ${privPath}  (keep secret; it is gitignored)`)
  console.error(`wrote PUBLIC  key -> ${pubPath}  (commit this; the updater pins it)`)
  console.error('Next: move update-pubkey.pem to app/release/ and commit it.')
  return EXIT_UP_TO_DATE
}

function doSign(manifestPath, keyPath) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
  const privateKeyPem = readFileSync(resolve(keyPath), 'utf8')
  const appcast = {
    manifest,
    signature: signManifest(manifest, privateKeyPem),
    keyId: arg('key-id', 'wd-release')
  }
  const text = JSON.stringify(appcast, null, 2)
  const outPath = arg('out')
  if (outPath) {
    writeFileSync(resolve(outPath), text + '\n')
    console.error(`wrote signed appcast -> ${resolve(outPath)}`)
  } else {
    console.log(text)
  }
  return EXIT_UP_TO_DATE
}

// ── check (default) ─────────────────────────────────────────────────────────
async function doCheck() {
  const asJson = flag('json')
  const channel = arg('channel', 'stable')
  const manifestSource = arg('manifest')
  const pubkeyPath = resolve(arg('pubkey', DEFAULT_PUBKEY))

  const fail = (reason, code = EXIT_ERROR) => {
    const result = { status: code === EXIT_INSECURE ? 'insecure' : 'error', reason }
    if (asJson) console.log(JSON.stringify(result, null, 2))
    else console.error(`update-check: ${reason}`)
    return code
  }

  if (!manifestSource) return fail('no --manifest given (a URL or a local path)')
  if (!existsSync(pubkeyPath))
    return fail(
      `no public key at ${pubkeyPath} — run "--genkey <dir>" once, commit ` +
        `update-pubkey.pem to app/release/, or pass --pubkey`
    )

  let appcast
  try {
    appcast = JSON.parse(await readManifestSource(manifestSource))
  } catch (err) {
    return fail(`could not read the manifest: ${err.message}`)
  }

  const publicKeyPem = readFileSync(pubkeyPath, 'utf8')
  const verified = verifyAppcast(appcast, publicKeyPem)
  if (!verified.ok) return fail(`manifest did not verify: ${verified.reason}`, EXIT_INSECURE)

  const result = buildResult({
    current: currentVersion(),
    manifest: appcast.manifest,
    channel,
    verified: true
  })
  const code = exitCodeFor(result)

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.status === 'up-to-date') {
    console.log(`up to date — ${result.current} is current on the ${result.channel} channel`)
  } else if (result.status === 'update-available') {
    console.log(
      `update available: ${result.current} -> ${result.latest} (${result.channel})` +
        (result.critical ? '  [SECURITY/CRITICAL]' : '')
    )
    if (result.url) console.log(`  ${result.url}`)
    if (result.notes) console.log(`  notes: ${result.notes}`)
  } else {
    console.error(`update-check: ${result.reason}`)
  }
  return code
}

async function main() {
  if (flag('help') || flag('h')) {
    console.log(HELP)
    return EXIT_UP_TO_DATE
  }
  const genkeyDir = arg('genkey')
  if (genkeyDir) return doGenkey(genkeyDir)
  const signPath = arg('sign')
  if (signPath) {
    const keyPath = arg('key')
    if (!keyPath) {
      console.error('update-check: --sign needs --key <private.pem>')
      return EXIT_ERROR
    }
    return doSign(signPath, keyPath)
  }
  return doCheck()
}

// Only run when invoked directly, so the test file can import the pure helpers.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`update-check: ${err.message}`)
      process.exit(EXIT_ERROR)
    })
}
