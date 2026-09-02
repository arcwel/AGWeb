// Vendors Microsoft's js-debug DAP server (task 12.4).
//
// Not an npm dependency because it is not published to npm — the standalone
// server ships only as a GitHub release asset. It is fetched at install time
// rather than committed so 1.2 MB of third-party build output stays out of the
// repository, and the version is pinned so a release cannot change under us.
//
// Licence: MIT (Microsoft). The vsix on Open VSX is MIT too, but it contains
// only the *extension*, which would need an extension host to run — the
// standalone `dapDebugServer.js` in this tarball is what lets AGWeb debug
// without one. See IDE_FOUNDATION.md.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const VERSION = '1.117.0'
// Pinned with the version: a release asset that changes under the same tag is
// exactly the supply-chain event this exists to catch (13.8d).
const SHA256 = 'ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772'
const URL = `https://github.com/microsoft/vscode-js-debug/releases/download/v${VERSION}/js-debug-dap-v${VERSION}.tar.gz`

const dest = join('resources', 'js-debug')
const stamp = join(dest, '.version')

// Already vendored at the pinned version — nothing to do.
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === VERSION) {
  process.exit(0)
}

const tarball = join('resources', `js-debug-${VERSION}.tar.gz`)

try {
  mkdirSync('resources', { recursive: true })
  execFileSync('curl', ['-sL', '--fail', '--max-time', '300', '-o', tarball, URL], {
    stdio: ['ignore', 'ignore', 'inherit']
  })

  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  if (digest !== SHA256) {
    throw new Error(
      `js-debug  download does not match the pinned sha256 (got ); refusing to vendor it`
    )
  }

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  // The tarball contains a single js-debug/ directory; strip it so the server
  // lands at resources/js-debug/src/dapDebugServer.js.
  execFileSync('tar', ['xzf', tarball, '-C', dest, '--strip-components=1'], { stdio: 'inherit' })
  rmSync(tarball, { force: true })

  if (!existsSync(join(dest, 'src', 'dapDebugServer.js'))) {
    throw new Error('dapDebugServer.js missing from the downloaded archive')
  }

  writeFileSync(stamp, `${VERSION}\n${digest}\n`)
  console.log(`js-debug ${VERSION} vendored (sha256 ${digest.slice(0, 16)}…)`)
} catch (error) {
  rmSync(tarball, { force: true })
  // A failed fetch must not break `npm install`: debugging degrades to
  // unavailable, and the Debug block says so, rather than the whole app
  // failing to install because GitHub was unreachable.
  console.warn(`js-debug could not be vendored — debugging will be unavailable. ${error}`)
}
