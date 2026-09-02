import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebdeckCore } from './server'
import { getSyncStatus } from './domains/sync'
import type { WsServerHandle } from './transports/ws-server'

/**
 * What WebDeck Sync may carry between machines (13.8e).
 *
 * A synced document is written to a file the user shares; anything in it that
 * names a command to run, or a credential, turns "sync my settings" into remote
 * code execution or credential exfiltration. So the sections a booted core
 * registers for sync are pinned here: adding one is a reviewed decision, and
 * the secret-source configuration (it names a command) and the keystore are
 * never among them.
 */

const ALLOWED_SECTIONS = new Set([
  'settings',
  'keybindings',
  'policy',
  'bookmarks',
  'ui-prefs',
  'app-settings',
  'agent-model',
  'deck'
])
const NEVER = /secret|key|token|credential|password|source/i

let handle: WsServerHandle
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-sync-boundary-'))
  handle = await startWebdeckCore({ userDataDir: dataDir, port: 0 })
})
afterAll(async () => {
  await handle.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('sync sections registered by a booted core', () => {
  it('never include a secret source, a key or a credential', () => {
    for (const section of getSyncStatus().sections) {
      expect(section, `sync section "${section}"`).not.toMatch(NEVER)
    }
  })

  it('are all on the reviewed allowlist', () => {
    const unknown = getSyncStatus().sections.filter((s) => !ALLOWED_SECTIONS.has(s))
    expect(unknown, 'new sync sections must be added to ALLOWED_SECTIONS deliberately').toEqual([])
  })
})
