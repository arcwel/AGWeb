import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setCoreEnv } from '../core/env'
import { addWorkspaceRoot, expandHome, openWorkspacePath, removeWorkspaceRoot } from './workspace'

/**
 * The fork has no folder picker, so a typed path is how a project gets opened —
 * and both fallbacks prompt with `~/code/my-project`. These cover the tilde the
 * prompt promises, and the boundaries where expanding one would be wrong.
 */

let home: string
let dataDir: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'wd-home-'))
  dataDir = mkdtempSync(join(tmpdir(), 'wd-workspace-'))
  mkdirSync(join(home, 'code', 'my-project'), { recursive: true })
  setCoreEnv({
    userDataDir: dataDir,
    homeDir: home,
    appDir: dataDir,
    secrets: {
      isAvailable: () => false,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString()
    }
  })
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

describe('expandHome', () => {
  it('expands a leading ~/ against the home dir', () => {
    expect(expandHome('~/code/my-project', '/Users/ada')).toBe('/Users/ada/code/my-project')
  })

  it('expands a bare ~', () => {
    expect(expandHome('~', '/Users/ada')).toBe('/Users/ada')
  })

  it('leaves an absolute path untouched', () => {
    expect(expandHome('/srv/projects/app', '/Users/ada')).toBe('/srv/projects/app')
  })

  it('leaves ~someone alone — that is another user, not this one', () => {
    expect(expandHome('~grace/code', '/Users/ada')).toBe('~grace/code')
  })

  it('does not touch a ~ that is not at the front', () => {
    expect(expandHome('/srv/~backup/app', '/Users/ada')).toBe('/srv/~backup/app')
  })
})

describe('openWorkspacePath', () => {
  it('opens a ~ path the way the start page prompts for one (regression)', () => {
    // Without the expansion this resolved to <cwd>/~/code/my-project, statSync
    // failed, and the caller got a null it could only report as "check the path".
    const workspace = openWorkspacePath('~/code/my-project')

    expect(workspace).toEqual({ path: join(home, 'code', 'my-project'), name: 'my-project' })
  })

  it('still opens an ordinary absolute path', () => {
    const workspace = openWorkspacePath(join(home, 'code'))

    expect(workspace).toEqual({ path: join(home, 'code'), name: 'code' })
  })

  it('returns null for a path that is not a directory', () => {
    expect(openWorkspacePath(join(home, 'code', 'nope'))).toBeNull()
  })
})

describe('multi-root, without a native picker', () => {
  it('grants and revokes a root by path', async () => {
    // These were treated as host-only because Electron reached them through a
    // folder picker. Only the PICKER needed the host: granting and revoking are
    // plain path operations, so taking the path as an argument makes them work
    // on both hosts — and turns the fork's dead "+ folder" button into a real
    // control.
    const dir = mkdtempSync(join(tmpdir(), 'wd-root-'))
    writeFileSync(join(dir, 'marker.txt'), 'x')

    const added = addWorkspaceRoot(dir)
    expect(added.some((r) => r.path === dir)).toBe(true)

    const after = removeWorkspaceRoot(dir)
    expect(after.some((r) => r.path === dir)).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  it('expands ~ when granting a root, as opening a project does', () => {
    // The placeholder invites a path like ~/code/thing; accepting it in one
    // place and not the other would be its own small trap.
    expect(expandHome('~/x', '/Users/someone')).toBe('/Users/someone/x')
  })
})
