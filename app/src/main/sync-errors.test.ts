import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Sync reports its own health, and that report is the only way a user learns a
 * section stopped syncing. One of the sections is the agent's permission policy
 * — the security gate — so a false "healthy" is the worst thing this module can
 * say.
 */

let dataDir: string
let syncFile: string

/** The section registry is module-level, so each test needs a fresh module. */
async function freshSync(): Promise<typeof import('./sync')> {
  vi.resetModules()
  const { setCoreEnv } = await import('../core/env')
  const { nodeCoreEnv } = await import('../core/node-env')
  setCoreEnv(nodeCoreEnv({ userDataDir: dataDir }))
  return import('./sync')
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-sync-err-'))
  syncFile = join(mkdtempSync(join(tmpdir(), 'wd-sync-file-')), 'webdeck-sync.json')
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('a section that fails to read', () => {
  it('is reported, not cleared by the surrounding push succeeding', async () => {
    const sync = await freshSync()
    sync.registerSyncSection({ key: 'healthy', read: () => ({ ok: true }), apply: () => {} })
    sync.registerSyncSection({
      key: 'broken',
      read: () => {
        throw new Error('disk on fire')
      },
      apply: () => {}
    })

    sync.setSyncFile(syncFile)
    sync.setSyncEnabled(true)
    sync.pushNow()

    // The push as a whole succeeds — the file is written and the healthy
    // section syncs. Clearing lastError on that basis told the user everything
    // was fine while 'broken' silently stopped syncing entirely.
    const status = sync.getSyncStatus()
    expect(status.error).toBeTruthy()
    expect(status.error).toContain('broken')
    expect(status.error).toContain('disk on fire')

    sync.setSyncEnabled(false)
  })

  it('clears the error once every section reads again', async () => {
    const sync = await freshSync()
    let failing = true
    sync.registerSyncSection({
      key: 'flaky',
      read: () => {
        if (failing) throw new Error('temporarily unavailable')
        return { ok: true }
      },
      apply: () => {}
    })

    sync.setSyncFile(syncFile)
    sync.setSyncEnabled(true)
    sync.pushNow()
    expect(sync.getSyncStatus().error).toBeTruthy()

    failing = false
    sync.pushNow()

    expect(sync.getSyncStatus().error).toBeNull()
    sync.setSyncEnabled(false)
  })
})
