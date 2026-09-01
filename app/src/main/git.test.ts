import { describe, it, expect } from 'vitest'
import {
  parseGraphLog,
  parseStatus,
  parseBranchLine,
  parseNameStatus,
  isValidCommitHash
} from './git'

// These parsers consume the raw stdout of `git` — untrusted output whose exact
// byte layout (\x1f unit separators, \0 record separators) the security review
// relied on. The tests construct that layout by hand so a regression in the
// splitting or field mapping is caught here rather than in the UI.

const US = '\x1f' // git %x1f unit separator, between GRAPH_FORMAT fields
const NUL = '\0' // -z record separator

describe('parseGraphLog', () => {
  // GRAPH_FORMAT = %H %h %P %an %at %D %s joined by %x1f
  const line = (fields: string[]): string => fields.join(US)

  it('parses a single \\x1f-delimited line into a commit', () => {
    const raw = line([
      'a1b2c3d4e5f600000000000000000000000000ab',
      'a1b2c3d',
      'parent0000000000000000000000000000000000',
      'Ada Lovelace',
      '1700000000',
      'HEAD -> main, origin/main',
      'Add the analytical engine'
    ])

    const commits = parseGraphLog(raw)

    expect(commits).toHaveLength(1)
    expect(commits[0]).toEqual({
      hash: 'a1b2c3d4e5f600000000000000000000000000ab',
      short: 'a1b2c3d',
      parents: ['parent0000000000000000000000000000000000'],
      author: 'Ada Lovelace',
      timestamp: 1700000000,
      refs: 'HEAD -> main, origin/main',
      subject: 'Add the analytical engine'
    })
  })

  it('splits a merge commit with multiple space-separated parents', () => {
    const raw = line([
      'mergehash',
      'mergeh',
      'p1 p2 p3',
      'Merger',
      '1700000001',
      '',
      'Merge branches'
    ])

    const commits = parseGraphLog(raw)

    expect(commits[0].parents).toEqual(['p1', 'p2', 'p3'])
  })

  it('gives a root commit an empty parents array', () => {
    const raw = line([
      'roothash',
      'rooth',
      '',
      'Root Author',
      '1699999999',
      'tag: v0',
      'Initial commit'
    ])

    const commits = parseGraphLog(raw)

    expect(commits[0].parents).toEqual([])
  })

  it('drops a malformed line with fewer than 7 fields', () => {
    // Only 6 fields (missing subject) — must be skipped, not partially parsed.
    const bad = ['h', 'sh', 'p', 'auth', '1700000000', 'refs'].join(US)
    const good = line(['h2', 'sh2', '', 'auth2', '1700000002', '', 'subject two'])

    const commits = parseGraphLog(`${bad}\n${good}`)

    expect(commits).toHaveLength(1)
    expect(commits[0].short).toBe('sh2')
  })

  it('skips blank lines and parses multiple records', () => {
    const a = line(['ha', 'sha', '', 'A', '1700000000', '', 'first'])
    const b = line(['hb', 'shb', 'ha', 'B', '1700000003', '', 'second'])

    const commits = parseGraphLog(`${a}\n\n${b}\n`)

    expect(commits.map((c) => c.short)).toEqual(['sha', 'shb'])
    expect(commits[1].parents).toEqual(['ha'])
  })

  it('falls back to timestamp 0 when %at is not a number', () => {
    const raw = line(['h', 'sh', '', 'A', 'not-a-number', '', 'subject'])

    expect(parseGraphLog(raw)[0].timestamp).toBe(0)
  })

  it('returns an empty array for empty input', () => {
    expect(parseGraphLog('')).toEqual([])
  })
})

describe('parseStatus', () => {
  it('parses an untracked file (?? in both columns)', () => {
    const entries = parseStatus(`?? new.txt${NUL}`)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      path: 'new.txt',
      index: '?',
      worktree: '?',
      untracked: true,
      staged: false
    })
  })

  it('marks a staged file (index column set) as staged', () => {
    // "M  file.ts" = index M, worktree space → staged, not untracked.
    const entries = parseStatus(`M  file.ts${NUL}`)

    expect(entries[0]).toMatchObject({
      path: 'file.ts',
      index: 'M',
      worktree: ' ',
      untracked: false,
      staged: true
    })
  })

  it('marks a worktree-only change (index blank) as unstaged', () => {
    // " M file.ts" = index space, worktree M → not staged, not untracked.
    const entries = parseStatus(` M file.ts${NUL}`)

    expect(entries[0]).toMatchObject({
      path: 'file.ts',
      index: ' ',
      worktree: 'M',
      untracked: false,
      staged: false
    })
  })

  it('consumes the next record as the original path for a rename', () => {
    // A rename is "R  new" followed by its source path as a separate -z record.
    const entries = parseStatus(`R  renamed.ts${NUL}old.ts${NUL}`)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      path: 'renamed.ts',
      original: 'old.ts',
      index: 'R',
      staged: true
    })
  })

  it('treats a copy (C) the same way, consuming the source path', () => {
    const entries = parseStatus(`C  copy.ts${NUL}source.ts${NUL}`)

    expect(entries[0]).toMatchObject({ path: 'copy.ts', original: 'source.ts', index: 'C' })
  })

  it('ignores the ## branch header and empty records', () => {
    const raw = `## main...origin/main${NUL}M  a.ts${NUL}${NUL}`

    const entries = parseStatus(raw)

    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('a.ts')
  })

  it('parses several entries in one status stream', () => {
    const raw = `?? u.ts${NUL}M  s.ts${NUL} M w.ts${NUL}`

    const entries = parseStatus(raw)

    expect(entries.map((e) => e.path)).toEqual(['u.ts', 's.ts', 'w.ts'])
    expect(entries.map((e) => e.untracked)).toEqual([true, false, false])
    expect(entries.map((e) => e.staged)).toEqual([false, true, false])
  })
})

describe('parseBranchLine', () => {
  it('parses branch, ahead and behind from a full tracking header', () => {
    const raw = `## main...origin/main [ahead 1, behind 2]${NUL}`

    expect(parseBranchLine(raw)).toEqual({ branch: 'main', ahead: 1, behind: 2 })
  })

  it('parses a branch with an upstream but no ahead/behind suffix', () => {
    const raw = `## main...origin/main${NUL}`

    expect(parseBranchLine(raw)).toEqual({ branch: 'main', ahead: 0, behind: 0 })
  })

  it('parses a branch with no upstream (no ...)', () => {
    const raw = `## feature/x${NUL}`

    expect(parseBranchLine(raw)).toEqual({ branch: 'feature/x', ahead: 0, behind: 0 })
  })

  it('reads ahead alone and behind alone', () => {
    expect(parseBranchLine(`## a...b [ahead 5]${NUL}`)).toEqual({
      branch: 'a',
      ahead: 5,
      behind: 0
    })
    expect(parseBranchLine(`## a...b [behind 7]${NUL}`)).toEqual({
      branch: 'a',
      ahead: 0,
      behind: 7
    })
  })

  it('falls back to HEAD when there is no ## header', () => {
    expect(parseBranchLine('')).toEqual({ branch: 'HEAD', ahead: 0, behind: 0 })
  })
})

describe('parseNameStatus', () => {
  it('pairs NUL-separated status,path records', () => {
    const raw = `M${NUL}src/a.ts${NUL}A${NUL}src/b.ts${NUL}D${NUL}src/c.ts`

    expect(parseNameStatus(raw)).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'src/b.ts' },
      { status: 'D', path: 'src/c.ts' }
    ])
  })

  it('takes only the first letter of a status field', () => {
    // diff-tree can emit R100 / C075 for renames/copies; only the letter is kept.
    const raw = `R100${NUL}new.ts`

    expect(parseNameStatus(raw)).toEqual([{ status: 'R', path: 'new.ts' }])
  })

  it('ignores an odd trailing element with no path', () => {
    const raw = `M${NUL}a.ts${NUL}A`

    expect(parseNameStatus(raw)).toEqual([{ status: 'M', path: 'a.ts' }])
  })

  it('returns an empty array for empty input', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('isValidCommitHash (injection guard)', () => {
  it('accepts short and full hex object names', () => {
    expect(isValidCommitHash('abc123')).toBe(true)
    expect(isValidCommitHash('a1b2')).toBe(true) // 4 chars: the minimum
    expect(isValidCommitHash('a1b2c3d4e5f600000000000000000000000000ab')).toBe(true) // 40
    expect(isValidCommitHash('ABCDEF')).toBe(true) // case-insensitive
  })

  it('rejects an empty string', () => {
    expect(isValidCommitHash('')).toBe(false)
  })

  it('rejects a leading dash (would be read as a git option)', () => {
    expect(isValidCommitHash('-x')).toBe(false)
    expect(isValidCommitHash('--upload-pack=touch /tmp/pwn')).toBe(false)
  })

  it('rejects shell-injection payloads', () => {
    expect(isValidCommitHash('; rm -rf')).toBe(false)
    expect(isValidCommitHash('$(whoami)')).toBe(false)
    expect(isValidCommitHash('abc123; rm -rf ~')).toBe(false)
  })

  it('rejects symbolic refs and non-hex names', () => {
    expect(isValidCommitHash('HEAD')).toBe(false) // 'H' is not hex
    expect(isValidCommitHash('main')).toBe(false) // 'm','i','n' not hex
    expect(isValidCommitHash('HEAD~1')).toBe(false)
    expect(isValidCommitHash('origin/main')).toBe(false)
  })

  it('rejects hashes shorter than 4 or longer than 40 chars', () => {
    expect(isValidCommitHash('abc')).toBe(false) // 3 chars
    expect(isValidCommitHash('a'.repeat(41))).toBe(false) // 41 chars
  })

  it('rejects non-hex characters mixed into a plausible hash', () => {
    expect(isValidCommitHash('abc12g')).toBe(false) // g is not hex
    expect(isValidCommitHash('abc 123')).toBe(false) // embedded space
  })
})
