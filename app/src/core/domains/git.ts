import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, sep } from 'node:path'
import type { GitBlameLine, GitFileDiff, GitStatus, GitStatusEntry } from '@shared/git'
import type { GitCommit, GitCommitDetail, GitCommitFile, GitGraphResult } from '@shared/ipc'
import { getCurrentWorkspace } from './workspace'
import { IpcChannels } from '@shared/ipc'
import { core } from '../rpc'
import { asNumber, asString, asStringList } from '../coerce'

/**
 * Source control (task 12.3).
 *
 * Uses the system `git` rather than `isomorphic-git`. TASKS.md allowed either;
 * system git is what VS Code itself shells out to, and it is the only one that
 * gets submodules, hooks, credential helpers, LFS and worktrees right. The cost
 * is a dependency on git being installed, which every developer machine has and
 * which `isRepository` degrades gracefully when it is missing.
 *
 * Every call goes through execFile with an argument array — never a shell
 * string. Branch names and paths arrive from the renderer, and a shell here
 * would turn a branch called `;rm -rf ~` into a command.
 *
 * These are the *user's* own clicks, so they are not routed through the policy
 * engine: that gates what the agent may do on its own, and direct UI actions
 * are direct intent. The same reason `fs.write` from the Files block is not
 * gated either.
 */

const run = promisify(execFile)

/** Output cap: a diff or blame on a huge file should not blow up main's heap. */
const MAX_BUFFER = 32 * 1024 * 1024

interface GitResult {
  stdout: string
  error?: string
}

/** Run one git command in the workspace, returning stderr as data. */
async function git(args: string[], cwd?: string): Promise<GitResult> {
  const root = cwd ?? getCurrentWorkspace()?.path
  if (!root) return { stdout: '', error: 'No workspace open.' }
  try {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: MAX_BUFFER })
    return { stdout }
  } catch (e) {
    const err = e as { stderr?: string; message?: string; code?: string }
    if (err.code === 'ENOENT') return { stdout: '', error: 'git is not installed.' }
    return { stdout: '', error: (err.stderr || err.message || String(e)).trim() }
  }
}

/** Refuse paths that escape the workspace before handing them to git. */
function safeRelative(rel: string): string | null {
  const base = getCurrentWorkspace()?.path
  if (!base) return null
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) return null
  return rel
}

/**
 * Porcelain v1 status codes, as a pair of index and worktree letters.
 *
 * `-z` matters: it is the only status format that survives filenames
 * containing spaces, quotes or newlines, all of which are legal.
 */
export function parseStatus(raw: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  const records = raw.split('\0')

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record || record.startsWith('##')) continue
    const index = record[0]
    const worktree = record[1]
    const path = record.slice(3)
    if (!path) continue

    // A rename/copy is followed by its source path as a separate record.
    const renamed = index === 'R' || index === 'C'
    const original = renamed ? records[++i] : undefined

    entries.push({
      path,
      original,
      index,
      worktree,
      // '?' in both columns is untracked; anything else in the index column is
      // staged. This is what drives the two lists in the UI.
      untracked: index === '?',
      staged: index !== ' ' && index !== '?'
    })
  }
  return entries
}

/** `## main...origin/main [ahead 1, behind 2]` */
export function parseBranchLine(raw: string): Pick<GitStatus, 'branch' | 'ahead' | 'behind'> {
  const line = raw.split('\0').find((r) => r.startsWith('##')) ?? ''
  const head = line.slice(3)
  const branch = head.split('...')[0].split(' ')[0] || 'HEAD'
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  return { branch, ahead, behind }
}

export async function gitStatus(): Promise<GitStatus> {
  const result = await git(['status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'])
  if (result.error) {
    return { repository: false, branch: '', ahead: 0, behind: 0, files: [], error: result.error }
  }
  return {
    repository: true,
    ...parseBranchLine(result.stdout),
    files: parseStatus(result.stdout)
  }
}

/**
 * The two sides of a file's diff, as text.
 *
 * Returning blobs rather than a unified diff is deliberate: the Monaco diff
 * component from task 3.5 already renders before/after, so there is no reason
 * to parse a patch format and then re-derive what Monaco computes anyway.
 */
export async function gitFileDiff(rel: string, staged: boolean): Promise<GitFileDiff> {
  const path = safeRelative(rel)
  if (!path) return { original: '', modified: '', error: 'Path is outside the workspace.' }

  if (staged) {
    // HEAD → index. A file added in this commit has no HEAD side.
    const head = await git(['show', `HEAD:${path}`])
    const index = await git(['show', `:${path}`])
    return { original: head.error ? '' : head.stdout, modified: index.error ? '' : index.stdout }
  }

  // Index → working tree. An untracked file has no index side, so `git show`
  // fails there and an empty left-hand side is exactly right.
  const index = await git(['show', `:${path}`])
  return {
    original: index.error ? '' : index.stdout,
    modified: await readWorking(path)
  }
}

async function readWorking(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const base = getCurrentWorkspace()?.path
  if (!base) return ''
  try {
    return await readFile(resolve(base, path), 'utf8')
  } catch {
    // Deleted in the working tree — an empty right-hand side is the truth.
    return ''
  }
}

export async function gitStage(paths: string[]): Promise<{ error?: string }> {
  const safe = paths.map(safeRelative).filter((p): p is string => p !== null)
  if (!safe.length) return { error: 'Nothing to stage.' }
  // `--` stops git reading a path that begins with a dash as an option.
  const result = await git(['add', '--', ...safe])
  return result.error ? { error: result.error } : {}
}

export async function gitUnstage(paths: string[]): Promise<{ error?: string }> {
  const safe = paths.map(safeRelative).filter((p): p is string => p !== null)
  if (!safe.length) return { error: 'Nothing to unstage.' }
  const result = await git(['restore', '--staged', '--', ...safe])
  return result.error ? { error: result.error } : {}
}

export async function gitCommit(message: string): Promise<{ error?: string }> {
  const text = message.trim()
  if (!text) return { error: 'A commit needs a message.' }
  const result = await git(['commit', '-m', text])
  return result.error ? { error: result.error } : {}
}

export async function gitBranches(): Promise<{ current: string; branches: string[] }> {
  const result = await git(['branch', '--format=%(refname:short)'])
  const current = await git(['branch', '--show-current'])
  return {
    current: current.stdout.trim(),
    branches: result.stdout
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean)
  }
}

export async function gitCheckout(branch: string): Promise<{ error?: string }> {
  const name = branch.trim()
  // Reject anything that is not a plausible ref: execFile already makes shell
  // injection impossible, but a leading dash would still be read as an option.
  if (!name || name.startsWith('-')) return { error: 'Invalid branch name.' }
  const result = await git(['checkout', name])
  return result.error ? { error: result.error } : {}
}

/**
 * Per-line authorship.
 *
 * `--porcelain` repeats a commit's header only the first time it appears, so
 * the details are carried forward per commit as the output is walked.
 */
export async function gitBlame(rel: string): Promise<{ lines: GitBlameLine[]; error?: string }> {
  const path = safeRelative(rel)
  if (!path) return { lines: [], error: 'Path is outside the workspace.' }

  const result = await git(['blame', '--porcelain', '--', path])
  if (result.error) return { lines: [], error: result.error }

  const commits = new Map<string, { author: string; time: number; summary: string }>()
  const lines: GitBlameLine[] = []
  let current: string | null = null

  for (const line of result.stdout.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line)
    if (header) {
      current = header[1]
      if (!commits.has(current)) commits.set(current, { author: '', time: 0, summary: '' })
      continue
    }
    if (!current) continue
    const commit = commits.get(current)
    if (!commit) continue

    if (line.startsWith('author ')) commit.author = line.slice(7)
    else if (line.startsWith('author-time ')) commit.time = Number(line.slice(12)) * 1000
    else if (line.startsWith('summary ')) commit.summary = line.slice(8)
    else if (line.startsWith('\t')) {
      lines.push({
        commit: current.slice(0, 8),
        author: commit.author,
        time: commit.time,
        summary: commit.summary
      })
    }
  }
  return { lines }
}

/**
 * Commit graph (roadmap C9).
 *
 * `\x1f` (unit separator) is used between fields: it cannot appear in a commit
 * subject, author or ref, so a plain split reconstructs the record where a comma
 * or tab would be ambiguous. `--all` sweeps every ref (branches, tags, remotes)
 * so the graph shows the whole DAG, and `--date-order` keeps rows chronological
 * without the topological reshuffling that scrambles a linear history.
 */
const GRAPH_LIMIT_DEFAULT = 300
const GRAPH_LIMIT_MAX = 2000
/** Cap the per-commit blob fetches so a giant refactor commit can't stall a click. */
const COMMIT_FILE_CAP = 60
const GRAPH_FORMAT = ['%H', '%h', '%P', '%an', '%at', '%D', '%s'].join('%x1f')

export function parseGraphLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const f = line.split('\x1f')
    if (f.length < 7) continue
    commits.push({
      hash: f[0],
      short: f[1],
      parents: f[2] ? f[2].split(' ').filter(Boolean) : [],
      author: f[3],
      timestamp: Number(f[4]) || 0,
      refs: f[5],
      subject: f[6]
    })
  }
  return commits
}

export async function gitLogGraph(limit = GRAPH_LIMIT_DEFAULT): Promise<GitGraphResult> {
  const cap = Math.min(GRAPH_LIMIT_MAX, Math.max(1, Math.round(limit)))
  const result = await git([
    'log',
    '--all',
    '--date-order',
    `--max-count=${cap}`,
    `--pretty=format:${GRAPH_FORMAT}`
  ])
  if (result.error) {
    // A freshly `git init`'d repo has no commits yet: that is an empty graph, not
    // a missing repository, so don't degrade it to "not a repo".
    if (
      /does not have any commits|bad default revision|unknown revision|ambiguous argument/i.test(
        result.error
      )
    ) {
      return { repository: true, commits: [] }
    }
    return { repository: false, commits: [], error: result.error }
  }
  return { repository: true, commits: parseGraphLog(result.stdout) }
}

/** `diff-tree --name-status -z` is a flat NUL stream of STATUS, PATH, STATUS… */
export function parseNameStatus(raw: string): { status: string; path: string }[] {
  const parts = raw.split('\0').filter((p) => p.length > 0)
  const out: { status: string; path: string }[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    out.push({ status: parts[i][0] ?? 'M', path: parts[i + 1] })
  }
  return out
}

/**
 * A rev is a plausible object name: 4–40 hex digits and nothing else. execFile
 * already makes shell injection impossible; this rejects a leading dash (read as
 * an option) and any non-hex ref (`HEAD`, `; rm -rf`, empty), so a click can
 * never hand git an arbitrary revision.
 */
export function isValidCommitHash(s: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(s)
}

function emptyDetail(hash: string, error?: string): GitCommitDetail {
  return { hash, short: hash.slice(0, 7), author: '', timestamp: 0, subject: '', files: [], error }
}

/**
 * One commit's metadata and changed files, each as before/after blobs — the same
 * shape `gitFileDiff` returns, so the renderer feeds them straight into the
 * Monaco diff component the Source Control block already uses.
 */
export async function gitShow(hash: string): Promise<GitCommitDetail> {
  const rev = hash.trim()
  if (!isValidCommitHash(rev)) return emptyDetail(rev, 'Invalid commit.')

  const meta = await git([
    'show',
    '--no-patch',
    `--pretty=format:${['%H', '%h', '%an', '%at', '%s'].join('%x1f')}`,
    rev
  ])
  if (meta.error) return emptyDetail(rev, meta.error)
  const m = meta.stdout.split('\x1f')

  // `--root` so the initial commit lists its files; `--no-renames` keeps every
  // change a plain A/M/D pair (a rename becomes D+A), which the blob reads below
  // handle without a separate rename case. Merge commits list nothing here.
  const names = await git([
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '--no-renames',
    '-r',
    '-z',
    '--root',
    rev
  ])
  const entries = parseNameStatus(names.stdout)
  const capped = entries.slice(0, COMMIT_FILE_CAP)

  // Fetch every capped file's two blobs concurrently. Serially this was up to
  // 60 × 2 = 120 back-to-back `git show` spawns; a flat Promise.all over the
  // (≤60) cap, with the two sides of each file also in parallel, keeps a click
  // on a large commit from stalling. Same result shape and A/D guards as before.
  const files: GitCommitFile[] = await Promise.all(
    capped.map(async (entry) => {
      // Parent side and commit side, exactly like gitFileDiff: an added file has no
      // parent blob, a deleted file has no commit blob, and a `git show` that fails
      // leaves that side empty — which is the truth for both.
      const [before, after]: [GitResult, GitResult] = await Promise.all([
        entry.status === 'A'
          ? Promise.resolve({ stdout: '' })
          : git(['show', `${rev}^:${entry.path}`]),
        entry.status === 'D'
          ? Promise.resolve({ stdout: '' })
          : git(['show', `${rev}:${entry.path}`])
      ])
      return {
        path: entry.path,
        status: entry.status,
        original: before.error ? '' : before.stdout,
        modified: after.error ? '' : after.stdout
      }
    })
  )

  return {
    hash: m[0] ?? rev,
    short: m[1] ?? rev.slice(0, 7),
    author: m[2] ?? '',
    timestamp: Number(m[3]) || 0,
    subject: m[4] ?? '',
    files,
    truncated: entries.length > COMMIT_FILE_CAP || undefined
  }
}

/** Register the source-control domain with webdeck-core (P1). */
export function registerGitRpc(): void {
  core.register(IpcChannels.gitStatus, () => gitStatus())
  core.register(IpcChannels.gitDiff, (path, staged) => {
    const p = asString(path)
    if (p === null) return { original: '', modified: '', error: 'bad arguments' }
    return gitFileDiff(p, staged === true)
  })
  core.register(IpcChannels.gitStage, (paths) => gitStage(asStringList(paths)))
  core.register(IpcChannels.gitUnstage, (paths) => gitUnstage(asStringList(paths)))
  core.register(IpcChannels.gitCommit, (message) => gitCommit(asString(message) ?? ''))
  core.register(IpcChannels.gitBranches, () => gitBranches())
  core.register(IpcChannels.gitCheckout, (branch) => gitCheckout(asString(branch) ?? ''))
  core.register(IpcChannels.gitBlame, (path) => {
    const p = asString(path)
    return p === null ? { lines: [], error: 'bad arguments' } : gitBlame(p)
  })
  core.register(IpcChannels.gitLogGraph, (limit) =>
    gitLogGraph(asNumber(limit, GRAPH_LIMIT_DEFAULT))
  )
  core.register(IpcChannels.gitShow, (hash) => {
    const h = asString(hash)
    return h === null ? emptyDetail('', 'bad arguments') : gitShow(h)
  })
}
