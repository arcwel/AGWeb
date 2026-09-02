// Vendors native-binary language servers (roadmap C1): rust-analyzer and gopls.
//
// Unlike typescript-language-server and pyright — Node scripts that ship inside
// webdeck-core via RUNTIME_PACKAGES and ride the ELECTRON_RUN_AS_NODE path — these
// are standalone executables written in Rust and Go. They cannot be require()d;
// lsp.ts spawns them directly. They ship under
//   resources/lsp-bin/<tool>/<platform>-<arch>/<bin>
// which build-core.mjs copies into the runtime's resources/, located at spawn via
// coreEnv().appDir — exactly how js-debug is handled.
//
// Only the *current* platform-arch is fetched, so no foreign Mach-O/ELF/PE lands
// in the bundle (the same concern that makes build-core prune js-debug's foreign
// .node addons — a foreign executable inside a macOS app is not a Mach-O codesign
// can seal, and complicates notarization).
//
// NETWORK FAILURE MUST NOT FAIL THE BUILD. A missing binary degrades that one
// language to "not installed" (lsp.ts resolveNativeCommand → null → graceful
// error); the framework ships regardless. Every step warns and continues.
//
// Licences: rust-analyzer is MIT/Apache-2.0 (rust-lang/rust-analyzer); gopls is
// BSD-3-Clause (golang.org/x/tools). Neither is redistributed in the repo — both
// are fetched/built at vendor time, like js-debug.
//
// Usage: node scripts/fetch-lsp-bins.mjs
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'

const PLATFORM_ARCH = `${process.platform}-${process.arch}`
const LSP_BIN = join('resources', 'lsp-bin')

/* ---------------- rust-analyzer (prebuilt download) ---------------- */

// Pinned so a release cannot change under us (rust-analyzer keeps dated releases;
// bump deliberately). rust-analyzer speaks LSP on stdio with no flags.
const RA_VERSION = '2026-08-31'
// sha256 of the release .gz per platform, pinned with the version (13.8d). A
// platform with no pin is refused rather than trusted — add the digest here.
const RA_SHA256 = {
  'darwin-arm64': '5de5c20b8b49bdc9339ef537b4029af7f97214fb88d6fc86af57ab9344467625'
}

/**
 * The rust-analyzer release-asset target triple for this platform-arch, or null
 * where no `.gz` asset exists (Windows ships a `.zip`, unsupported by this path).
 * Verified against the release assets: `rust-analyzer-aarch64-apple-darwin.gz`,
 * `rust-analyzer-x86_64-apple-darwin.gz`, and the linux `-unknown-linux-gnu`
 * variants.
 */
function rustAnalyzerTriple() {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : null
  if (!arch) return null
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`
  return null
}

function vendorRustAnalyzer() {
  const triple = rustAnalyzerTriple()
  const destDir = join(LSP_BIN, 'rust-analyzer', PLATFORM_ARCH)
  mkdirSync(destDir, { recursive: true })
  const destBin = join(destDir, 'rust-analyzer')
  const stamp = join(destDir, '.version')

  if (!triple) {
    console.warn(
      `rust-analyzer: no prebuilt .gz asset for ${PLATFORM_ARCH} — download manually ` +
        `from https://github.com/rust-lang/rust-analyzer/releases and place it at ${destBin}`
    )
    return
  }

  if (
    existsSync(destBin) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8').startsWith(RA_VERSION)
  ) {
    console.log(`rust-analyzer ${RA_VERSION} already vendored (${PLATFORM_ARCH})`)
    return
  }

  const asset = `rust-analyzer-${triple}.gz`
  const url = `https://github.com/rust-lang/rust-analyzer/releases/download/${RA_VERSION}/${asset}`
  const gz = join(destDir, asset)

  try {
    execFileSync('curl', ['-sL', '--fail', '--max-time', '300', '-o', gz, url], {
      stdio: ['ignore', 'ignore', 'inherit']
    })
    const packed = readFileSync(gz)
    const digest = createHash('sha256').update(packed).digest('hex')
    const expected = RA_SHA256[PLATFORM_ARCH]
    if (!expected)
      throw new Error(
        `no pinned sha256 for rust-analyzer on ${PLATFORM_ARCH}; refusing an unverified binary`
      )
    if (digest !== expected) {
      throw new Error(`rust-analyzer  download does not match the pinned sha256 (got )`)
    }
    const binary = gunzipSync(packed)
    writeFileSync(destBin, binary)
    // Google Drive / CloudStorage mounts strip the execute bit; the server is
    // exec'd, so set it explicitly (same reason postinstall.mjs fixes node-pty).
    chmodSync(destBin, 0o755)
    rmSync(gz, { force: true })
    writeFileSync(stamp, `${RA_VERSION}\n${digest}\n`)
    console.log(
      `rust-analyzer ${RA_VERSION} vendored → ${destBin} ` +
        `(${(binary.length / 1e6).toFixed(1)} MB, sha256 ${digest.slice(0, 16)}…)`
    )
  } catch (error) {
    rmSync(gz, { force: true })
    console.warn(
      `rust-analyzer could not be vendored — Rust IntelliSense will be unavailable. ${error}\n` +
        `  Manual: curl -sL ${url} | gunzip > ${destBin} && chmod +x ${destBin}`
    )
  }
}

/* ---------------- gopls (built with the Go toolchain) ---------------- */

// gopls has NO official prebuilt binary — the supported install is
// `go install golang.org/x/tools/gopls@latest`, which needs a Go toolchain. When
// one is present we build into the vendor dir; otherwise we scaffold the path and
// document the manual step. gopls speaks LSP on stdio with no flags.
const GOPLS_VERSION = 'latest'

function hasGoToolchain() {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function vendorGopls() {
  const destDir = join(LSP_BIN, 'gopls', PLATFORM_ARCH)
  // Scaffold the path unconditionally so the layout is discoverable even without
  // a toolchain (and so a manual copy has an obvious home).
  mkdirSync(destDir, { recursive: true })
  const destBin = join(destDir, 'gopls')

  if (existsSync(destBin)) {
    console.log(`gopls already vendored (${PLATFORM_ARCH})`)
    return
  }

  if (!hasGoToolchain()) {
    console.warn(
      `gopls: no Go toolchain found — Go IntelliSense will be unavailable.\n` +
        `  Manual: GOBIN=${resolve(destDir)} go install golang.org/x/tools/gopls@${GOPLS_VERSION}`
    )
    return
  }

  try {
    // GOBIN must be absolute; `go install` drops the binary there named `gopls`.
    execFileSync('go', ['install', `golang.org/x/tools/gopls@${GOPLS_VERSION}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, GOBIN: resolve(destDir) }
    })
    if (existsSync(destBin)) {
      chmodSync(destBin, 0o755)
      console.log(`gopls vendored → ${destBin} (built with local Go toolchain)`)
    } else {
      console.warn(`gopls: \`go install\` completed but ${destBin} is missing — check GOBIN/GOOS.`)
    }
  } catch (error) {
    console.warn(
      `gopls could not be built — Go IntelliSense will be unavailable. ${error}\n` +
        `  Manual: GOBIN=${resolve(destDir)} go install golang.org/x/tools/gopls@${GOPLS_VERSION}`
    )
  }
}

/* ---------------- run ---------------- */

mkdirSync(LSP_BIN, { recursive: true })
vendorRustAnalyzer()
vendorGopls()
