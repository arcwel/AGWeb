import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCoreEnv } from '../env'
import { nodeCoreEnv } from '../node-env'
import { writeBinaryFile } from './fs'
import { openWorkspacePath } from './workspace'

/**
 * The Composer copies the user's attachments into the workspace under
 * `.webdeck/attachments/` (the fork has no native path picker, so the page can
 * only hand the core bytes). On a fresh project that folder does not exist,
 * and the first attach of every project failed with ENOENT — the native panel
 * opened, the user picked a file, and the Composer showed an error instead of
 * a chip. The write has to create its parent.
 */

let dataDir: string
let project: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-attach-data-'))
  setCoreEnv(nodeCoreEnv({ userDataDir: dataDir }))
  project = realpathSync(mkdtempSync(join(tmpdir(), 'wd-attach-')))
  openWorkspacePath(project)
})

afterAll(() => {
  for (const dir of [dataDir, project]) rmSync(dir, { recursive: true, force: true })
})

describe('writeBinaryFile', () => {
  it('creates missing parent folders inside the workspace', async () => {
    const rel = '.webdeck/attachments/app.log'
    expect(existsSync(join(project, '.webdeck'))).toBe(false)

    const result = await writeBinaryFile(rel, Buffer.from('hello'))

    expect(result.error).toBeUndefined()
    expect(readFileSync(join(project, rel), 'utf8')).toBe('hello')
  })

  it('still refuses a path that escapes the workspace', async () => {
    const result = await writeBinaryFile('../outside/app.log', Buffer.from('x'))
    expect(result.error).toBeTruthy()
    expect(existsSync(join(project, '..', 'outside'))).toBe(false)
  })
})
