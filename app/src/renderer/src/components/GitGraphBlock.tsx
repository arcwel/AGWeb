import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitCommit, GitCommitDetail, GitGraphResult } from '@shared/ipc'
import { monaco, languageForPath } from '@/monaco'
import { useMonacoReady } from '@/monaco-ready'
import { useShellStore } from '@/store'
import { CloseIcon, ReloadIcon } from '@/components/icons'

/**
 * Git Graph (roadmap C9): a railroad commit graph for the workspace repo.
 *
 * The lane layout is the classic reservation algorithm — each lane holds the
 * hash of the commit expected to land there next (a child reserving its parent),
 * so a commit takes the lane a child left for it and its first parent inherits
 * that lane while extra parents branch into fresh ones. Edges are drawn between a
 * commit and each of its parents; the whole graph is one SVG layered behind the
 * text rows so a hover highlights the full row without repainting per lane.
 *
 * Clicking a commit opens its diff through the same Monaco side-by-side path the
 * Source Control block uses (task 3.5) — `git:show` returns each changed file as
 * before/after blobs, which feed straight into a diff editor.
 */

const ROW_H = 26
const LANE_W = 16
const DOT_R = 4.5
const PAD_X = 12
const REQUEST_LIMIT = 300

/** Lane hues, cycled by column so branches read apart. Legible in both themes. */
const LANE_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#ef4444',
  '#a855f7',
  '#14b8a6',
  '#f97316',
  '#ec4899'
] as const

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length]
}

interface Placed {
  commit: GitCommit
  row: number
  col: number
}

interface Layout {
  placed: Placed[]
  byHash: Map<string, Placed>
  laneCount: number
}

/** Reservation-based lane assignment; commits arrive newest-first. */
function assignLanes(commits: GitCommit[]): Layout {
  const placed: Placed[] = []
  const byHash = new Map<string, Placed>()
  // Each lane holds the hash it is currently waiting to place, or null if free.
  const lanes: (string | null)[] = []
  let laneCount = 0

  const firstFree = (): number => {
    const idx = lanes.indexOf(null)
    if (idx >= 0) return idx
    lanes.push(null)
    return lanes.length - 1
  }

  commits.forEach((commit, row) => {
    let col = lanes.indexOf(commit.hash)
    if (col === -1) {
      col = firstFree()
    } else {
      // A merge target: free every other lane that was also waiting on us.
      for (let i = 0; i < lanes.length; i++) {
        if (i !== col && lanes[i] === commit.hash) lanes[i] = null
      }
    }

    if (commit.parents.length === 0) {
      lanes[col] = null
    } else {
      // The first parent inherits this lane; extra parents branch into new ones.
      lanes[col] = commit.parents[0]
      for (let p = 1; p < commit.parents.length; p++) {
        const ph = commit.parents[p]
        if (lanes.indexOf(ph) === -1) lanes[firstFree()] = ph
      }
    }

    const entry: Placed = { commit, row, col }
    placed.push(entry)
    byHash.set(commit.hash, entry)
    laneCount = Math.max(laneCount, lanes.length)
  })

  return { placed, byHash, laneCount }
}

const laneX = (col: number): number => PAD_X + col * LANE_W
const rowMidY = (row: number): number => row * ROW_H + ROW_H / 2

/** One ref chip parsed out of git's `%D` decoration. */
interface RefChip {
  kind: 'head' | 'branch' | 'remote' | 'tag'
  label: string
}

function parseRefs(refs: string): RefChip[] {
  if (!refs) return []
  const chips: RefChip[] = []
  for (const raw of refs.split(',')) {
    const ref = raw.trim()
    if (!ref || ref === 'grafted') continue
    if (ref.startsWith('HEAD -> ')) {
      chips.push({ kind: 'head', label: ref.slice('HEAD -> '.length) })
    } else if (ref === 'HEAD') {
      chips.push({ kind: 'head', label: 'HEAD' })
    } else if (ref.startsWith('tag: ')) {
      chips.push({ kind: 'tag', label: ref.slice('tag: '.length) })
    } else if (ref.includes('/')) {
      chips.push({ kind: 'remote', label: ref })
    } else {
      chips.push({ kind: 'branch', label: ref })
    }
  }
  return chips
}

const CHIP_CLASS: Record<RefChip['kind'], string> = {
  head: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  branch: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  remote: 'bg-slate-500/15 text-slate-500 dark:text-slate-300',
  tag: 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
}

/** Compact relative time from an epoch-seconds author timestamp. */
function relativeTime(seconds: number): string {
  if (!seconds) return ''
  const delta = Date.now() / 1000 - seconds
  if (delta < 60) return 'just now'
  const units: [number, string][] = [
    [60, 'm'],
    [3600, 'h'],
    [86400, 'd'],
    [604800, 'w'],
    [2592000, 'mo'],
    [31536000, 'y']
  ]
  let label = `${Math.floor(delta / 60)}m`
  for (let i = units.length - 1; i >= 0; i--) {
    const [secs, suffix] = units[i]
    if (delta >= secs) {
      label = `${Math.floor(delta / secs)}${suffix}`
      break
    }
  }
  return `${label} ago`
}

export function GitGraphBlock(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const [result, setResult] = useState<GitGraphResult | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.agweb.git.logGraph(REQUEST_LIMIT)
    setResult(next)
  }, [])

  useEffect(() => {
    // Mirror the Source Control block: the workspace watcher already fires on
    // every write (a commit included), so the graph follows without polling.
    let live = true
    const load = async (): Promise<void> => {
      const next = await window.agweb.git.logGraph(REQUEST_LIMIT)
      if (live) setResult(next)
    }
    const off = window.agweb.fs.onChanged(() => void load())
    void load()
    return () => {
      live = false
      off()
    }
  }, [workspace?.path])

  const commits = result?.commits
  const layout = useMemo(() => (commits ? assignLanes(commits) : null), [commits])

  if (!result) {
    return <div className="p-4 text-xs text-slate-400">Reading history…</div>
  }

  if (!result.repository) {
    return (
      <div className="flex flex-col gap-2 p-4 text-xs text-slate-500">
        <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
          No repository here
        </span>
        <span className="leading-relaxed">
          {result.error ?? 'This workspace is not a git repo.'}
        </span>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col text-xs">
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        <span className="font-semibold text-slate-600 dark:text-slate-300">Commit graph</span>
        <span className="text-[10px] text-slate-400">
          {result.commits.length} {result.commits.length === 1 ? 'commit' : 'commits'}
        </span>
        <button
          onClick={() => void refresh()}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          title="Refresh"
          aria-label="Refresh graph"
          data-testid="gitgraph-refresh"
        >
          <ReloadIcon size={13} />
        </button>
      </div>

      {result.commits.length === 0 || !layout ? (
        <div className="p-4 text-slate-400">No commits yet.</div>
      ) : (
        <GraphRows layout={layout} selected={selected} onSelect={setSelected} />
      )}

      {selected && <CommitDiffOverlay hash={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function GraphRows({
  layout,
  selected,
  onSelect
}: {
  layout: Layout
  selected: string | null
  onSelect: (hash: string) => void
}): React.JSX.Element {
  const theme = useShellStore((s) => s.theme)
  const { placed, byHash, laneCount } = layout
  const graphWidth = PAD_X + laneCount * LANE_W
  const totalHeight = placed.length * ROW_H
  // The dot's ring separates it from edges and the row behind it — paint it the
  // surface colour so the dot reads as sitting on top of the lane lines.
  const dotRing = theme === 'dark' ? '#0b0f14' : '#ffffff'

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="gitgraph-rows">
      <div className="relative" style={{ height: totalHeight }}>
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={graphWidth}
          height={totalHeight}
        >
          {placed.map((node) =>
            node.commit.parents.map((parentHash) => {
              const parent = byHash.get(parentHash)
              if (!parent) return null
              const x1 = laneX(node.col)
              const y1 = rowMidY(node.row)
              const x2 = laneX(parent.col)
              const y2 = rowMidY(parent.row)
              const d =
                x1 === x2
                  ? `M ${x1} ${y1} L ${x2} ${y2}`
                  : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
              // The child owns the lane it inherits, so colour the edge by the
              // lane it lives in (its own for the first parent, the parent's for
              // a branch line) — a merge line takes the branch's colour.
              const col = parent.col === node.col ? node.col : parent.col
              return (
                <path
                  key={`${node.commit.hash}-${parentHash}`}
                  d={d}
                  fill="none"
                  stroke={laneColor(col)}
                  strokeWidth={1.6}
                  strokeOpacity={0.85}
                />
              )
            })
          )}
          {placed.map((node) => (
            <circle
              key={node.commit.hash}
              cx={laneX(node.col)}
              cy={rowMidY(node.row)}
              r={DOT_R}
              fill={laneColor(node.col)}
              stroke={dotRing}
              strokeWidth={1.5}
            />
          ))}
        </svg>

        {placed.map((node) => {
          const chips = parseRefs(node.commit.refs)
          const isSelected = node.commit.hash === selected
          return (
            <button
              key={node.commit.hash}
              onClick={() => onSelect(node.commit.hash)}
              style={{ height: ROW_H, paddingLeft: graphWidth + 4 }}
              className={`flex w-full items-center gap-2 pr-2.5 text-left ${
                isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-500/10'
              }`}
              title={`${node.commit.short} — ${node.commit.subject}`}
              data-testid="gitgraph-commit"
            >
              <span
                className="flex-none font-mono text-[10px]"
                style={{ color: laneColor(node.col) }}
              >
                {node.commit.short}
              </span>
              {chips.map((chip) => (
                <span
                  key={`${chip.kind}:${chip.label}`}
                  className={`flex-none truncate rounded px-1 py-px text-[9px] font-semibold ${CHIP_CLASS[chip.kind]}`}
                  style={{ maxWidth: 130 }}
                >
                  {chip.label}
                </span>
              ))}
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                {node.commit.subject}
              </span>
              <span
                className="flex-none truncate text-[10px] text-slate-400"
                style={{ maxWidth: 90 }}
              >
                {node.commit.author}
              </span>
              <span className="flex-none text-[10px] tabular-nums text-slate-400">
                {relativeTime(node.commit.timestamp)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A commit's diff, over the Source Control block's Monaco diff path (task 3.5):
 * the changed files list on the left, one file's side-by-side diff on the right.
 */
function CommitDiffOverlay({
  hash,
  onClose
}: {
  hash: string
  onClose: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.agweb.git
      .show(hash)
      .then((next) => {
        if (!live) return
        setLoadError(null)
        setDetail(next)
        setActivePath(next.files[0]?.path ?? null)
      })
      .catch((e: unknown) => {
        // Without this the overlay would hang on "Loading commit…" forever if
        // the show call rejects; surface the failure and stop the spinner.
        if (!live) return
        setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      live = false
    }
  }, [hash])

  const active = detail?.files.find((f) => f.path === activePath) ?? null

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-[#0e1420]">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-slate-200 px-2.5 dark:border-slate-800">
        <span className="flex-none font-mono text-[11px] text-slate-500">
          {detail?.short ?? hash.slice(0, 7)}
        </span>
        <span className="truncate font-semibold text-slate-600 dark:text-slate-300">
          {detail?.subject ?? (loadError ? 'Could not load commit' : 'Loading commit…')}
        </span>
        {detail && (
          <span className="flex-none text-[10px] text-slate-400">
            {detail.author} · {relativeTime(detail.timestamp)}
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto flex-none rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close commit"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {loadError ? (
        <div className="p-4 text-rose-500">{loadError}</div>
      ) : detail?.error ? (
        <div className="p-4 text-rose-500">{detail.error}</div>
      ) : detail && detail.files.length === 0 ? (
        <div className="p-4 text-slate-400">
          No file changes in this commit{detail.truncated ? '' : ' (or a merge commit)'}.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-56 flex-none overflow-y-auto border-r border-slate-200 dark:border-slate-800">
            {detail?.files.map((file) => (
              <button
                key={file.path}
                onClick={() => setActivePath(file.path)}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left ${
                  file.path === activePath
                    ? 'bg-sky-500/10 text-slate-700 dark:text-slate-200'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
                }`}
                title={file.path}
              >
                <span className="w-3 flex-none text-center font-mono text-[10px] font-bold text-slate-400">
                  {file.status}
                </span>
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
              </button>
            ))}
            {detail?.truncated && (
              <div className="px-2.5 py-1 text-[10px] text-amber-500">
                File list truncated for a large commit.
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {active ? (
              <CommitFileDiff
                key={active.path}
                path={active.path}
                original={active.original}
                modified={active.modified}
              />
            ) : (
              <div className="p-4 text-slate-400">
                {detail ? 'Select a file.' : 'Loading commit…'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Side-by-side diff of one file, in the same Monaco diff component the editor
 *  and Source Control block use (task 3.5). */
function CommitFileDiff({
  path,
  original,
  modified
}: {
  path: string
  original: string
  modified: string
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const monacoReady = useMonacoReady()

  useEffect(() => {
    const container = containerRef.current
    if (!container || !monacoReady) return

    const editor = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      fontSize: 12
    })
    const language = languageForPath(path)
    const originalModel = monaco.editor.createModel(original, language)
    const modifiedModel = monaco.editor.createModel(modified, language)
    editor.setModel({ original: originalModel, modified: modifiedModel })

    return () => {
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [path, original, modified, monacoReady])

  return <div ref={containerRef} className="h-full w-full" />
}
