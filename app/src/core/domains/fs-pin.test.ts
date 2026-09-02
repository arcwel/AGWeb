import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCoreEnv } from '../env'
import { nodeCoreEnv } from '../node-env'
import { renameEntry, deleteEntry, writeFile } from './fs'
import { addWorkspaceRoot, openWorkspacePath, workspaceRoots } from './workspace'

/**
 * The agent is confined to one project by a `root` it passes with every file
 * operation. writeFile has always taken one; renameEntry and deleteEntry did
 * not — so an agent pinned to project A could still move and recursively
 * delete files across every OTHER folder the user had granted.
 *
 * That is the confinement failing silently, and it bites hardest on delete:
 * file_write is `allow` in the DEFAULT permission mode, and rm is recursive.
 */

let dataDir: string
let projectA: string
let projectB: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-pin-data-'))
  setCoreEnv(nodeCoreEnv({ userDataDir: dataDir }))
  // realpath, deliberately. On macOS mkdtemp hands back /var/... while the
  // workspace stores /private/var/... — so an un-resolved path fails the
  // containment check for the WRONG reason, and these tests would pass without
  // the pin they exist to prove.
  projectA = realpathSync(mkdtempSync(join(tmpdir(), 'wd-pin-a-')))
  projectB = realpathSync(mkdtempSync(join(tmpdir(), 'wd-pin-b-')))
  mkdirSync(join(projectA, 'sub'), { recursive: true })
  writeFileSync(join(projectA, 'mine.txt'), 'a')
  writeFileSync(join(projectB, 'theirs.txt'), 'b')
  // Both are granted to the user — the agent is pinned to only one. A root can
  // only be ADDED once a workspace is open, so projectA is opened first and
  // becomes the primary; without that workspaceRoots() is empty and every path
  // is refused for a reason that has nothing to do with the pin.
  openWorkspacePath(projectA)
  addWorkspaceRoot(projectB)
  expect(workspaceRoots().map((r) => r.path)).toContain(projectB)
})

afterAll(() => {
  for (const dir of [dataDir, projectA, projectB]) rmSync(dir, { recursive: true, force: true })
})

describe('an agent pinned to one root cannot reach another', () => {
  it('refuses to delete a file in a different granted root', async () => {
    const result = await deleteEntry(join(projectB, 'theirs.txt'), projectA)
    expect(result.error).toBeTruthy()
    expect(existsSync(join(projectB, 'theirs.txt'))).toBe(true)
  })

  it('refuses to move a file out of the pin', async () => {
    const result = await renameEntry(
      join(projectA, 'mine.txt'),
      join(projectB, 'stolen.txt'),
      projectA
    )
    expect(result.error).toBeTruthy()
    expect(existsSync(join(projectB, 'stolen.txt'))).toBe(false)
    expect(existsSync(join(projectA, 'mine.txt'))).toBe(true)
  })

  it('refuses to move a file INTO the pin from outside it', async () => {
    // Both ends are pinned: pulling a file in is as much an escape as pushing
    // one out, and it is how an agent would stage something it should not have.
    const result = await renameEntry(
      join(projectB, 'theirs.txt'),
      join(projectA, 'taken.txt'),
      projectA
    )
    expect(result.error).toBeTruthy()
    expect(existsSync(join(projectA, 'taken.txt'))).toBe(false)
  })

  it('still works inside the pin', async () => {
    expect((await writeFile('sub/ok.txt', 'x', projectA)).error).toBeUndefined()
    expect((await renameEntry('sub/ok.txt', 'sub/renamed.txt', projectA)).error).toBeUndefined()
    expect(existsSync(join(projectA, 'sub', 'renamed.txt'))).toBe(true)
    expect((await deleteEntry('sub/renamed.txt', projectA)).error).toBeUndefined()
    expect(existsSync(join(projectA, 'sub', 'renamed.txt'))).toBe(false)
  })
})
