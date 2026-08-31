#!/usr/bin/env node
// Turns a built Chromium fork into a .dmg a tester can mount, and says out loud
// what is wrong with the one it just made.
//
// The point is NOT to sign for distribution — this script never touches a
// keychain and never sees an Apple credential. It ad-hoc signs (`codesign -s -`)
// so the *mechanics* are exercised end to end: inside-out signing order, the
// sealed resource set, the entitlements file, hdiutil, the mount. Everything a
// real release needs beyond that is printed as a command for a human with a
// Developer ID to run. See chromium/RELEASING.md.
//
// It refuses builds that cannot honestly be packaged. The one that matters is
// `is_component_build = true`: that build's Framework binary is a 16 KB stub
// that reexports 520 dylibs sitting loose in the build directory. A .dmg of it
// looks exactly like a real one and is not — so it takes an explicit
// --allow-component-build, and everything it produces is named DEV.
//
// Usage:
//   node scripts/package-fork.mjs [--build-dir <dir>] [--out <dir>] [--json]
//                                 [--allow-component-build] [--skip-dmg]
//                                 [--format UDZO|UDBZ|UDRO] [--no-verify]
//                                 [--keep-stage]
// Exit codes: 0 packaged · 1 the build is unfit, or packaging failed · 2 could not run
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const DEFAULT_BUILD_DIR = '/Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck'

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`package-fork — assemble the built fork into a mountable .dmg

  --build-dir <dir>          the gn out dir to package (default: the BG_Dev
                             component build). READ ONLY — nothing is built and
                             nothing in it is modified.
  --out <dir>               where to write (default: <build-dir>-package, so the
                             ~1 GB of a component build never lands on a synced
                             drive)
  --allow-component-build   package an is_component_build=true tree anyway. The
                             result is labelled DEV and is not distributable.
  --skip-dmg                stage and sign only, no disk image
  --format <fmt>            UDZO (default, zlib) · UDBZ (bzip2, smaller/slower)
                             · UDRO (uncompressed, fastest)
  --no-verify               skip the mount-and-launch check of the finished dmg
  --keep-stage              keep the staging tree next to the dmg
  --json                    machine-readable result

Signing is ALWAYS ad-hoc. There is no --identity: real signing and notarization
need an Apple Developer credential and are documented, not automated. See
chromium/RELEASING.md.

Exit: 0 packaged · 1 build unfit or packaging failed · 2 could not run`)
  process.exit(0)
}

const buildDir = resolve(arg('build-dir', DEFAULT_BUILD_DIR))
const outDir = resolve(arg('out', `${buildDir}-package`))
const dmgFormat = arg('format', 'UDZO')
const asJson = flag('json')

// ── the result ledger ───────────────────────────────────────────────────────
// ok    measured, the property holds
// warn  measured, holds, but a human should read it
// fail  measured, does NOT hold → the build is unfit → exit 1
const checks = []
const ok = (name, detail) => checks.push({ name, status: 'ok', detail })
const warn = (name, detail) => checks.push({ name, status: 'warn', detail })
const fail = (name, detail) => checks.push({ name, status: 'fail', detail })

// Reasons the artifact must not be handed to anyone outside this machine.
// These are findings, not errors: the run still produces a dmg, clearly labelled.
const blockers = []
const blocker = (title, detail) => blockers.push({ title, detail })

/** Fail with exit 2: we could not run at all, which is NOT a pass. */
function cannotRun(message) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason: message, checks }, null, 2))
  else console.error(`cannot run: ${message}`)
  process.exit(2)
}

/** Run a command, never throwing. Returns { code, out, err }. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.error) return { code: -1, out: '', err: r.error.message }
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' }
}

/** Run a command and throw with its stderr if it fails. */
function must(cmd, args, what) {
  const r = run(cmd, args)
  if (r.code !== 0)
    throw new Error(`${what}: ${(r.err || r.out).trim().split('\n').slice(-3).join(' / ')}`)
  return r.out
}

// ── 0. can this machine do the job at all ───────────────────────────────────

if (process.platform !== 'darwin') cannotRun('macOS only — codesign and hdiutil are not portable')
for (const tool of ['codesign', 'hdiutil', 'otool', 'plutil']) {
  if (run('/usr/bin/which', [tool]).code !== 0)
    cannotRun(`${tool} not found — install the Xcode command line tools`)
}
if (!existsSync(buildDir)) cannotRun(`no build directory at ${buildDir}`)
if (!existsSync(join(buildDir, 'args.gn'))) {
  cannotRun(`${buildDir} has no args.gn — that is not a gn build directory`)
}

// Packaging a tree that a build is actively rewriting produces an artifact that
// matches no source revision. siso leaves .siso_lock behind after it exits, so
// the file's presence proves nothing; the pid inside it does.
const lockFile = join(buildDir, '.siso_lock')
if (existsSync(lockFile)) {
  const pid = Number(/pid=(\d+)/.exec(readFileSync(lockFile, 'utf8'))?.[1])
  if (Number.isFinite(pid)) {
    const ps = run('/bin/ps', ['-p', String(pid), '-o', 'command='])
    if (ps.code === 0 && ps.out.trim()) {
      cannotRun(
        `a build is writing ${buildDir} right now (pid ${pid}: ${ps.out.trim().slice(0, 80)}) — wait for it to finish`
      )
    }
  }
}

// ── 1. what did we get ──────────────────────────────────────────────────────

/** Parse args.gn well enough to read the handful of args that decide packaging. */
function readArgsGn(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return out
}
const gnArgs = readArgsGn(join(buildDir, 'args.gn'))

// The outer app is the only top-level .app that is not a Helper.
const apps = readdirSync(buildDir).filter((n) => n.endsWith('.app') && !n.includes('Helper'))
if (apps.length !== 1) {
  cannotRun(
    apps.length === 0
      ? `no .app in ${buildDir} — build \`chrome\` first`
      : `${apps.length} candidate apps in ${buildDir} (${apps.join(', ')}) — cannot tell which to package`
  )
}
const appName = apps[0]
const product = appName.replace(/\.app$/, '')
const srcApp = join(buildDir, appName)

/** Read an Info.plist key. Returns undefined rather than throwing. */
function plist(path, key) {
  const r = run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path])
  return r.code === 0 ? r.out.trim() : undefined
}
const infoPlist = join(srcApp, 'Contents', 'Info.plist')
if (!existsSync(infoPlist))
  cannotRun(`${appName} has no Contents/Info.plist — the bundle is not built`)

const bundleId = plist(infoPlist, 'CFBundleIdentifier')
const version = plist(infoPlist, 'CFBundleShortVersionString')
const mainExeName = plist(infoPlist, 'CFBundleExecutable')

// The fork's pin. A build older than the pin is the classic way to package
// yesterday's browser and not notice.
let fork = {}
try {
  fork = JSON.parse(readFileSync(join(repoRoot, 'chromium', 'fork.json'), 'utf8'))
} catch (err) {
  warn(
    'fork.json readable',
    `could not read chromium/fork.json (${err.message}) — version not cross-checked`
  )
}

// ── 2. the sanity gate ──────────────────────────────────────────────────────

ok('build directory', buildDir)
ok('app bundle', `${appName} (${product} ${version ?? '?'})`)

if (!bundleId || bundleId === 'org.chromium.Chromium') {
  fail(
    'branding applied',
    `CFBundleIdentifier is ${bundleId ?? 'unset'} — branding.diff is not in this build`
  )
} else {
  ok('branding applied', `CFBundleIdentifier=${bundleId}`)
}

if (fork.base && version && fork.base !== version) {
  fail(
    'build matches the pin',
    `built ${version}, chromium/fork.json pins ${fork.base} — rebuild, or update the pin`
  )
} else if (fork.base) {
  ok('build matches the pin', `${version} == fork.json base`)
}

const exeName = mainExeName ?? product
const mainExe = join(srcApp, 'Contents', 'MacOS', exeName)
if (!existsSync(mainExe)) {
  fail('main executable', `Info.plist names ${exeName}, which does not exist`)
} else {
  ok('main executable', `${exeName} (${(statSync(mainExe).size / 1024).toFixed(0)} KB)`)
}

const fwDir = join(srcApp, 'Contents', 'Frameworks', `${product} Framework.framework`)
const fwCurrent = join(fwDir, 'Versions', 'Current')
const fwBinary = join(fwCurrent, `${product} Framework`)
if (!existsSync(fwBinary)) {
  fail('framework', `no ${product} Framework at ${fwBinary}`)
} else {
  ok('framework', `${(statSync(fwBinary).size / 1024 / 1024).toFixed(1)} MB`)
}

const helpersDir = join(fwCurrent, 'Helpers')
const helperApps = existsSync(helpersDir)
  ? readdirSync(helpersDir).filter((n) => n.endsWith('.app'))
  : []
if (helperApps.length === 0)
  fail('helper apps', 'no helper .app bundles — the renderer/GPU processes are missing')
else ok('helper apps', `${helperApps.length} helpers`)

const crashpad = join(helpersDir, 'chrome_crashpad_handler')
if (!existsSync(crashpad))
  warn('crash handler', 'chrome_crashpad_handler missing — crashes will not be captured')
else ok('crash handler', 'chrome_crashpad_handler present')

// Resources. A browser that packs without its .pak files starts and renders
// nothing, and the failure looks like a UI bug rather than a packaging one.
const fwResources = join(fwCurrent, 'Resources')
const missingPaks = ['resources.pak', 'chrome_100_percent.pak', 'icudtl.dat'].filter(
  (f) => !existsSync(join(fwResources, f))
)
if (missingPaks.length > 0) fail('resource paks', `missing: ${missingPaks.join(', ')}`)
else ok('resource paks', 'resources.pak, chrome_100_percent.pak, icudtl.dat')

// ── the component build ─────────────────────────────────────────────────────
// Three independent tells, because args.gn can be edited and the build not
// redone. Any one of them is enough.
const looseDylibs = readdirSync(buildDir).filter((n) => n.endsWith('.dylib'))
const fwIsStub = existsSync(fwBinary) && statSync(fwBinary).size < 2 * 1024 * 1024
const isComponent = gnArgs.is_component_build === 'true' || fwIsStub || looseDylibs.length > 50

if (isComponent) {
  const mb = looseDylibs.reduce((n, f) => n + statSync(join(buildDir, f)).size, 0) / 1024 / 1024
  const evidence = [
    gnArgs.is_component_build === 'true' ? 'args.gn says is_component_build = true' : null,
    fwIsStub
      ? `the Framework binary is a ${(statSync(fwBinary).size / 1024).toFixed(0)} KB stub`
      : null,
    `${looseDylibs.length} loose dylibs (${mb.toFixed(0)} MB) beside the app`
  ]
    .filter(Boolean)
    .join('; ')

  if (!flag('allow-component-build')) {
    fail(
      'distributable build config',
      `${evidence}. chrome/installer/mac/signing/README.md: "Signing requires a statically linked build (i.e. is_component_build = false)". Rebuild with is_official_build = true and is_component_build = false, or pass --allow-component-build to make a DEV artifact anyway.`
    )
  } else {
    warn('distributable build config', `COMPONENT BUILD — ${evidence}`)
    blocker(
      'This is a component build',
      'The Framework binary is a stub over ~520 separate dylibs. To make the bundle even launch, this script copies the whole dylib closure into Contents/Frameworks, which quadruples its size and produces exactly the objc duplicate-class warnings you will see on launch. Chromium does not support signing this shape for distribution. Rebuild with is_official_build = true and is_component_build = false.'
    )
  }
} else {
  ok('distributable build config', 'non-component build')
}

if (gnArgs.is_official_build !== 'true') {
  warn(
    'is_official_build',
    'false — dcheck_always_on resolves to true (build/config/dcheck_always_on.gni), so a tester will hit fatal CHECK crashes on conditions shipping Chrome tolerates'
  )
  blocker(
    'DCHECKs are fatal in this build',
    'is_official_build = false turns dcheck_always_on on implicitly. There is no args.gn line to remove; the fix is is_official_build = true.'
  )
} else {
  ok('is_official_build', 'true')
}

if (gnArgs.target_cpu && gnArgs.target_cpu !== 'arm64') ok('target_cpu', gnArgs.target_cpu)
else {
  warn(
    'target_cpu',
    'arm64 only — Intel Macs cannot run this. A universal build needs a second x64 out dir and chrome/installer/mac/universalizer.py'
  )
}

// ── webdeck-core ────────────────────────────────────────────────────────────
// The fork spawns an executable called webdeck-core out of base::DIR_MODULE.
// Today that is a shell script pointing at Homebrew's node and a checkout of
// this repo. Both paths are absolute and neither exists on a tester's machine.
const coreInBundle = join(srcApp, 'Contents', 'MacOS', 'webdeck-core')
if (!existsSync(coreInBundle)) {
  warn('webdeck-core', 'absent from the bundle — chrome://webdeck will not connect to anything')
  blocker(
    'webdeck-core is not in the bundle',
    'chrome://webdeck spawns it from base::DIR_MODULE. Without it the browser runs but the product does not.'
  )
} else {
  const head = readFileSync(coreInBundle, 'utf8').slice(0, 512)
  if (head.startsWith('#!')) {
    const paths = [...head.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1])
    const outside = paths.filter((p) => !p.startsWith(srcApp))
    warn('webdeck-core', `a shell script referencing ${outside.length} path(s) outside the bundle`)
    blocker(
      'webdeck-core is a shell script with absolute paths outside the app',
      `It execs ${outside.join(' and ') || '(unparsed paths)'}. On any other machine those do not exist, so chrome://webdeck cannot start its backend. codesign also refuses to seal the app until this file is signed in its own right, and a script's signature lives in extended attributes rather than in the file — it survives a HFS+ dmg and does not survive a plain zip or most upload paths. It must become a real Mach-O executable inside the bundle before anything is notarized.`
    )
  } else {
    ok('webdeck-core', 'present and not a script')
  }
}

const failed = checks.filter((c) => c.status === 'fail')

// ── reporting ───────────────────────────────────────────────────────────────

const SYMBOL = { ok: '✓', warn: '!', fail: '✗' }

function realSigningInstructions() {
  return [
    'What this run did NOT do, and what a real one needs:',
    '',
    `  1. Build the packaging driver:  autoninja -C ${buildDir} chrome/installer/mac`,
    '  2. An Apple Developer Program membership for Arcwel, and a',
    '     "Developer ID Application" certificate in the login keychain. A',
    '     self-signed identity does not work: Chrome signs with the `library`',
    '     option, so the app will only load code bearing its own Team ID.',
    '  3. Notary credentials — an App Store Connect API key (.p8 + key id +',
    '     issuer uuid) is the right shape; an Apple ID app-specific password',
    '     also works.',
    '  4. Then, with the certificate present:',
    '',
    `       "${buildDir}/${product} Packaging/sign_chrome.py" \\`,
    `           --input  "${buildDir}" \\`,
    `           --output "${outDir}/signed" \\`,
    "           --identity 'Developer ID Application: Arcwel (TEAMID)' \\",
    '           --notarize \\',
    '           --notary-arg --key    --notary-arg /path/to/AuthKey.p8 \\',
    '           --notary-arg --key-id --notary-arg KEYID \\',
    '           --notary-arg --issuer --notary-arg ISSUER-UUID',
    '',
    '  That walks the bundle inside-out, applies chrome/app/app-entitlements.plist,',
    '  signs with --options restrict,library,runtime,kill --timestamp, builds the',
    '  dmg with chrome/installer/mac/pkg-dmg, submits to Apple, and staples.',
    '',
    '  This script signs ad-hoc with --options kill only. Measured on macOS 26.5.1:',
    '  ad-hoc + `runtime` fails to launch ("mapping process and mapped file',
    '  (non-platform) have different Team IDs") and ad-hoc + `restrict` fails with',
    '  "security policy does not allow @ path expansion". Both need a real identity.',
    '',
    '  Full runbook: chromium/RELEASING.md'
  ].join('\n')
}

function report(result, exitCode) {
  if (asJson) {
    console.log(JSON.stringify({ ...result, checks, blockers }, null, 2))
    process.exit(exitCode)
  }
  for (const c of checks)
    console.log(`${SYMBOL[c.status]} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  if (result.artifacts?.length) {
    console.log('')
    for (const a of result.artifacts) console.log(`→ ${a.path}${a.size ? ` (${a.size})` : ''}`)
  }
  if (blockers.length > 0) {
    console.log(
      `\nNOT DISTRIBUTABLE — ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}:`
    )
    for (const b of blockers)
      console.log(`\n  • ${b.title}\n    ${b.detail.replace(/\n/g, '\n    ')}`)
  }
  console.log('')
  console.log(realSigningInstructions())
  console.log('')
  console.log(result.summary)
  process.exit(exitCode)
}

if (failed.length > 0) {
  report(
    {
      status: 'unfit',
      summary: `Refusing to package: ${failed.length} sanity check${failed.length === 1 ? '' : 's'} failed. Nothing was written.`
    },
    1
  )
}

// ── 3. stage ────────────────────────────────────────────────────────────────

const label = isComponent
  ? `${version}-${gnArgs.target_cpu ?? 'arm64'}-COMPONENT-DEV`
  : `${version}-${gnArgs.target_cpu ?? 'arm64'}`
const stageRoot = join(outDir, 'stage')
const stagedApp = join(stageRoot, appName)
const dmgPath = join(outDir, `${product.replace(/ /g, '-')}-${label}.dmg`)

/** Is this file a Mach-O image? Cheap: read the magic. */
function isMachO(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(4)
    if (readSync(fd, buf, 0, 4, 0) < 4) return false
    const magic = buf.readUInt32BE(0)
    // MH_MAGIC_64 / MH_CIGAM_64 / FAT_MAGIC / FAT_CIGAM
    return (
      magic === 0xfeedfacf || magic === 0xcffaedfe || magic === 0xcafebabe || magic === 0xbebafeca
    )
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** `otool -L` over many files at once. Returns Map<path, dependency[]>. */
function machODeps(paths) {
  const deps = new Map()
  for (let i = 0; i < paths.length; i += 64) {
    const chunk = paths.slice(i, i + 64)
    const out = run('/usr/bin/otool', ['-L', ...chunk]).out
    let current = null
    for (const line of out.split('\n')) {
      if (!line.startsWith('\t')) {
        const m = /^(.*):$/.exec(line)
        if (m && !m[1].startsWith('Archive')) {
          current = m[1]
          deps.set(current, [])
        }
        continue
      }
      const dep = line.trim().replace(/ \(compatibility version.*$/, '')
      if (current) deps.get(current).push(dep)
    }
  }
  return deps
}

/** Every Mach-O file inside a directory tree. */
function machOsUnder(dir) {
  const found = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && isMachO(p)) found.push(p)
    }
  }
  walk(dir)
  return found
}

let dmgSize = null
let mounted = null
try {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })
  cpSync(srcApp, stagedApp, { recursive: true, verbatimSymlinks: true })
  ok('staged the app', stagedApp)

  const stagedFrameworks = join(stagedApp, 'Contents', 'Frameworks')

  // For a component build the bundle is not self-contained: its rpaths reach
  // out to the build directory. Copying the closure into Contents/Frameworks
  // makes it whole — that path is on every rpath list in the bundle (the main
  // executable's @executable_path/../Frameworks, the framework's
  // @loader_path/../../.., the helpers' @executable_path/../../../../../../..).
  if (isComponent) {
    const available = new Map(looseDylibs.map((n) => [n, join(buildDir, n)]))
    const copied = new Set()
    let frontier = machOsUnder(stagedApp)
    while (frontier.length > 0) {
      const next = []
      for (const [, deps] of machODeps(frontier)) {
        for (const dep of deps) {
          if (!dep.startsWith('@rpath/')) continue
          const name = dep.slice('@rpath/'.length)
          if (name.includes('/')) continue // the framework itself, already inside
          if (copied.has(name) || !available.has(name)) continue
          const dest = join(stagedFrameworks, name)
          cpSync(available.get(name), dest)
          copied.add(name)
          next.push(dest)
        }
      }
      frontier = next
    }
    ok(
      'copied the dylib closure',
      `${copied.size} of ${looseDylibs.length} dylibs into Contents/Frameworks`
    )
  }

  // Whatever the config, prove the bundle resolves against itself. This is the
  // check that catches a staging bug: a bundle missing one dylib passes every
  // other check here and dies in dyld on the tester's machine.
  const insideNames = new Set([
    ...readdirSync(stagedFrameworks).filter((n) => n.endsWith('.dylib')),
    ...(existsSync(join(fwCurrent, 'Libraries'))
      ? readdirSync(
          join(
            stagedApp,
            'Contents',
            'Frameworks',
            `${product} Framework.framework`,
            'Versions',
            'Current',
            'Libraries'
          )
        ).filter((n) => n.endsWith('.dylib'))
      : [])
  ])
  const unresolved = new Set()
  for (const [file, deps] of machODeps(machOsUnder(stagedApp))) {
    for (const dep of deps) {
      if (!dep.startsWith('@rpath/')) continue
      const name = dep.slice('@rpath/'.length)
      if (name.includes('/')) continue
      if (!insideNames.has(name)) unresolved.add(`${name} (needed by ${basename(file)})`)
    }
  }
  if (unresolved.size > 0) {
    fail(
      'bundle is self-contained',
      `${unresolved.size} unresolved @rpath dependencies: ${[...unresolved].slice(0, 5).join(', ')}`
    )
    report(
      {
        status: 'failed',
        summary: 'The staged bundle is not self-contained — it would not launch off this machine.'
      },
      1
    )
  }
  ok('bundle is self-contained', 'every @rpath dependency resolves inside the app')

  // ── 4. ad-hoc sign, inside-out, the order chrome/installer/mac uses ────────

  // The entitlements the real signing run applies. Found relative to the build
  // dir so this works against any checkout.
  let checkout = buildDir
  while (
    checkout !== '/' &&
    !existsSync(join(checkout, 'chrome', 'app', 'app-entitlements.plist'))
  ) {
    checkout = dirname(checkout)
  }
  const entitlementsDir = checkout === '/' ? null : join(checkout, 'chrome', 'app')
  if (!entitlementsDir)
    warn(
      'entitlements',
      'chrome/app/app-entitlements.plist not found — signing without entitlements'
    )

  /** codesign, ad-hoc, in batches. `options` is a codesign --options string. */
  function sign(paths, { options, entitlements } = {}) {
    const base = ['--force', '--sign', '-']
    if (options) base.push('--options', options)
    if (entitlements && entitlementsDir)
      base.push('--entitlements', join(entitlementsDir, entitlements))
    for (let i = 0; i < paths.length; i += 40) {
      must(
        '/usr/bin/codesign',
        [...base, ...paths.slice(i, i + 40)],
        `codesign ${basename(paths[i])}`
      )
    }
  }

  /** Mach-O magic, so a data file is never handed to codesign as if it were code. */
  function isMachO(file) {
    try {
      const fd = openSync(file, 'r')
      const buf = Buffer.alloc(4)
      readSync(fd, buf, 0, 4, 0)
      closeSync(fd)
      const magic = buf.readUInt32BE(0)
      // feedface / feedfacf (thin, BE-read), cffaedfe / cefaedfe (LE), cafebabe (fat)
      return (
        magic === 0xfeedface ||
        magic === 0xfeedfacf ||
        magic === 0xcffaedfe ||
        magic === 0xcefaedfe ||
        magic === 0xcafebabe
      )
    } catch {
      return false
    }
  }

  const stagedFw = join(stagedApp, 'Contents', 'Frameworks', `${product} Framework.framework`)
  const stagedCurrent = join(stagedFw, 'Versions', 'Current')
  const stagedHelpers = join(stagedCurrent, 'Helpers')

  // 1. the loose dylibs, 2. the framework's own Libraries
  const flatDylibs = readdirSync(stagedFrameworks)
    .filter((n) => n.endsWith('.dylib'))
    .map((n) => join(stagedFrameworks, n))
  if (flatDylibs.length > 0) sign(flatDylibs)
  const fwLibs = existsSync(join(stagedCurrent, 'Libraries'))
    ? readdirSync(join(stagedCurrent, 'Libraries'))
        .filter((n) => n.endsWith('.dylib'))
        .map((n) => join(stagedCurrent, 'Libraries', n))
    : []
  if (fwLibs.length > 0) sign(fwLibs)

  // 3. the helpers. Chromium gives the renderer and GPU helpers their own,
  //    narrower entitlements; the rest inherit the app's.
  for (const entry of readdirSync(stagedHelpers)) {
    const p = join(stagedHelpers, entry)
    const ent = /Renderer/.test(entry)
      ? 'helper-renderer-entitlements.plist'
      : /GPU/.test(entry)
        ? 'helper-gpu-entitlements.plist'
        : undefined
    // `kill` only: ad-hoc code has no Team ID, so `runtime`/`library` make dyld
    // refuse the bundle's own libraries and `restrict` bans @rpath expansion.
    sign([p], { options: 'kill', entitlements: ent })
  }

  // 4. the framework itself (a dylib — codesign --options flags are meaningless)
  sign([stagedFw])

  // 5. webdeck-core and everything Mach-O inside its runtime. The runtime is a
  //    plain directory, not a bundle, so codesign will not reach the native
  //    files (node-pty's pty.node and spawn-helper) on its own — each has to be
  //    sealed in its own right, deepest first, or --verify --deep --strict
  //    rejects the app. This is also what makes the whole thing notarizable:
  //    every executable carries the same signature.
  const machoInRuntime = []
  const runtimeRoot = join(stagedApp, 'Contents', 'MacOS', 'webdeck-core-runtime')
  if (existsSync(runtimeRoot)) {
    const stack = [runtimeRoot]
    while (stack.length) {
      const dir = stack.pop()
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (isMachO(full)) machoInRuntime.push(full)
      }
    }
  }
  // Deepest paths first, so a containing item is never sealed before its
  // contents.
  machoInRuntime.sort((a, b) => b.length - a.length)
  if (machoInRuntime.length > 0) sign(machoInRuntime, { options: 'kill' })

  // Then anything else loose in Contents/MacOS (the SEA core included). The
  // shell shim used to block signing here; a real Mach-O signs cleanly.
  const extraMacOS = readdirSync(join(stagedApp, 'Contents', 'MacOS'))
    .filter((n) => n !== mainExeName && n !== 'webdeck-core-runtime')
    .map((n) => join(stagedApp, 'Contents', 'MacOS', n))
  if (extraMacOS.length > 0) sign(extraMacOS, { options: 'kill' })

  // 6. the app
  sign([stagedApp], { options: 'kill', entitlements: 'app-entitlements.plist' })

  const dv = run('/usr/bin/codesign', ['-dv', stagedApp])
  const dvText = (dv.err || dv.out).split('\n')
  const pick = (k) => dvText.find((l) => l.startsWith(k))?.trim() ?? ''
  ok(
    'ad-hoc signed',
    `${pick('Identifier=')} · ${pick('CodeDirectory')?.match(/flags=\S+/)?.[0] ?? ''} · ${pick('Sealed Resources')}`
  )

  const verify = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
  if (verify.code !== 0) {
    fail('signature verifies', (verify.err || verify.out).trim().split('\n').slice(-2).join(' / '))
    report(
      { status: 'failed', summary: 'The ad-hoc signature does not verify — packaging stopped.' },
      1
    )
  }
  ok('signature verifies', 'codesign --verify --deep --strict')

  // ── 5. the disk image ─────────────────────────────────────────────────────

  if (flag('skip-dmg')) {
    ok('disk image', 'skipped (--skip-dmg)')
    report(
      {
        status: 'staged',
        artifacts: [
          {
            path: stagedApp,
            size: `${Number(run('/usr/bin/du', ['-sm', stagedApp]).out.split('\t')[0]) || 0} MB`
          }
        ],
        summary:
          blockers.length > 0
            ? 'Staged and ad-hoc signed. NOT distributable — see the blockers above.'
            : 'Staged and ad-hoc signed.'
      },
      0
    )
  }

  // chrome/installer/mac/pkg-dmg (a checked-in perl wrapper around hdiutil) is
  // what the real pipeline uses, with --format ULMO and a branded .DS_Store.
  // Neither the background art nor the layout exists for an unbranded build, so
  // this does the same thing hdiutil does underneath: a drag-install volume with
  // the app and a symlink to /Applications.
  symlinkSync('/Applications', join(stageRoot, 'Applications'))
  must(
    '/usr/bin/hdiutil',
    [
      'create',
      '-quiet',
      '-srcfolder',
      stageRoot,
      '-volname',
      product,
      '-fs',
      'HFS+',
      '-format',
      dmgFormat,
      '-ov',
      dmgPath
    ],
    'hdiutil create'
  )
  dmgSize = `${(statSync(dmgPath).size / 1024 / 1024).toFixed(0)} MB`
  ok('disk image', `${basename(dmgPath)} (${dmgSize}, ${dmgFormat})`)

  // ── 6. prove it ───────────────────────────────────────────────────────────

  if (!flag('no-verify')) {
    const attach = must(
      '/usr/bin/hdiutil',
      ['attach', '-nobrowse', '-readonly', '-mountrandom', '/private/tmp', dmgPath],
      'hdiutil attach'
    )
    mounted = attach.trim().split('\n').pop().split('\t').pop().trim()
    const mountedApp = join(mounted, appName)
    if (!existsSync(mountedApp)) throw new Error(`${appName} is not on the mounted volume`)

    const mv = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', mountedApp])
    if (mv.code !== 0)
      fail('signature survives the dmg', (mv.err || mv.out).trim().split('\n').slice(-1)[0])
    else ok('signature survives the dmg', 'verifies while mounted read-only')

    // --version is enough: it links the whole framework and every dylib the
    // browser needs at startup, which is exactly what a broken bundle fails at.
    const launch = run(join(mountedApp, 'Contents', 'MacOS', mainExeName), ['--version'], {
      timeout: 120000
    })
    const printed = launch.out.trim()
    if (launch.code !== 0 || !printed.includes(version)) {
      const why = (launch.err || '')
        .split('\n')
        .filter((l) => !l.startsWith('objc['))
        .slice(0, 3)
        .join(' / ')
      fail('the app in the dmg runs', `exit ${launch.code}${why ? ` — ${why}` : ''}`)
    } else {
      ok('the app in the dmg runs', printed)
    }
    const dupes = (launch.err || '')
      .split('\n')
      .filter((l) => l.includes('is implemented in both')).length
    if (dupes > 0) {
      warn(
        'objc duplicate classes',
        `${dupes} — every dylib in the closure carries its own copy. A component-build artefact; it does not happen in a static build.`
      )
    }

    // What Gatekeeper will say. Ad-hoc is not a distribution signature.
    const spctl = run('/usr/sbin/spctl', ['-a', '-vvv', '-t', 'exec', mountedApp])
    warn(
      'Gatekeeper',
      `spctl: ${(spctl.err || spctl.out).trim().split('\n').join(' ').slice(0, 120)} — expected: ad-hoc is not notarized`
    )
  }
} catch (err) {
  fail('packaging', err.message)
  if (mounted) run('/usr/bin/hdiutil', ['detach', mounted, '-quiet', '-force'])
  report({ status: 'failed', summary: `Packaging failed: ${err.message}` }, 1)
} finally {
  if (mounted) run('/usr/bin/hdiutil', ['detach', mounted, '-quiet'])
}

if (!flag('keep-stage')) rmSync(stageRoot, { recursive: true, force: true })

const late = checks.filter((c) => c.status === 'fail')
report(
  {
    status: late.length > 0 ? 'failed' : 'packaged',
    artifacts: [{ path: dmgPath, size: dmgSize }],
    summary:
      late.length > 0
        ? 'The dmg was written but a check failed — read the ✗ lines.'
        : blockers.length > 0
          ? `Packaged. This dmg is for testing on machines you control, NOT for distribution — ${blockers.length} blocker${blockers.length === 1 ? '' : 's'} above.`
          : 'Packaged and verified.'
  },
  late.length > 0 ? 1 : 0
)
