#!/usr/bin/env node
// Can this machine produce an installer that opens like any other Mac app?
//
// A notarized build needs three things this repository cannot contain: an Apple
// Developer Program membership, a Developer ID Application certificate in the
// login keychain, and a notarytool credential profile. Each is set up once, by
// a human, with a password. This checks for all three and prints the exact
// command for whichever is missing — so the answer is never "it did not work".
//
// Usage: node scripts/release-preflight.mjs [--json]
// Exit codes: 0 ready to notarize · 1 something is missing · 2 could not run
import { spawnSync } from 'node:child_process'

const asJson = process.argv.includes('--json')
const PROFILE = process.argv.includes('--notary-profile')
  ? process.argv[process.argv.indexOf('--notary-profile') + 1]
  : 'webdeck-notary'

if (process.platform !== 'darwin') {
  console.error('cannot run: macOS only')
  process.exit(2)
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
}

const steps = []
const add = (name, ready, detail, fix) => steps.push({ name, ready, detail, fix })

// 1. Xcode's command line tools carry both codesign's notarization support and
//    notarytool itself. Everything below depends on them.
const xcrun = run('/usr/bin/which', ['xcrun'])
add(
  'Xcode command line tools',
  xcrun.code === 0,
  xcrun.code === 0 ? run('/usr/bin/xcrun', ['--find', 'notarytool']).out.trim() : 'xcrun not found',
  'xcode-select --install'
)

// 2. The certificate. "Developer ID Application" is the only kind Apple
//    notarizes; an Apple Development or self-signed certificate signs happily
//    and is rejected at the end of a long upload.
const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']).out
const rows = [...identities.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/gm)].map((m) => ({
  hash: m[1],
  name: m[2]
}))
const devIds = rows.filter((r) => r.name.startsWith('Developer ID Application:'))
add(
  'Developer ID Application certificate',
  devIds.length === 1,
  devIds.length === 1
    ? devIds[0].name
    : devIds.length > 1
      ? `${devIds.length} of them — package-fork needs one named exactly: ${devIds.map((r) => r.name).join(', ')}`
      : rows.length > 0
        ? `none. The keychain holds: ${rows.map((r) => r.name).join(', ')}`
        : 'none — this keychain holds no code-signing identity at all',
  'Enrol at https://developer.apple.com/programs (99 USD/year), then Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application. It must be created on this machine, or imported with its private key.'
)

// 3. The notarytool credential. Stored once in the keychain; neither this
//    script nor the packager ever reads it.
const history = run('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', PROFILE])
const haveProfile = history.code === 0
add(
  `notarytool profile "${PROFILE}"`,
  haveProfile,
  haveProfile
    ? 'stored, and Apple answered'
    : (history.err || history.out).trim().split('\n')[0] || 'not found',
  `xcrun notarytool store-credentials ${PROFILE} --apple-id <your-apple-id> --team-id <TEAM_ID>\n    It asks for an app-specific password: make one at https://account.apple.com → Sign-In and Security → App-Specific Passwords. Your Team ID is on https://developer.apple.com/account under Membership.`
)

const ready = steps.every((s) => s.ready)

if (asJson) {
  console.log(JSON.stringify({ ready, profile: PROFILE, steps }, null, 2))
  process.exit(ready ? 0 : 1)
}

console.log('\nRelease preflight — what a no-warning installer needs\n')
for (const s of steps) {
  console.log(`${s.ready ? '✓' : '✗'} ${s.name}`)
  console.log(`    ${s.detail}`)
  if (!s.ready) console.log(`    fix: ${s.fix}`)
}

console.log(
  ready
    ? `\nReady. Build, then:\n  npm run release:dmg -- --build-dir <out dir> --out <dir>\nThe result mounts, drags to Applications and opens with no warning.\n`
    : `\nNot ready. Until the boxes above are ticked, \`npm run package:dmg\` still makes a\nworking disk image — it is ad-hoc signed, so testers meet Gatekeeper once\n(System Settings → Privacy & Security → Open Anyway). See chromium/RELEASING.md.\n`
)
process.exit(ready ? 0 : 1)
