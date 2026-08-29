import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitFileDiff, GitStatus, GitStatusEntry } from '@shared/git'
import { monaco } from '@/monaco'
import { useMonacoReady } from '@/monaco-ready'
import { languageForPath } from '@/monaco'
import { useShellStore } from '@/store'
import { CloseIcon } from '@/components/icons'
import { usePopover } from '@/popover'

/**
 * Source control (task 12.3).
 *
 * Staged and unstaged changes, stage/unstage, commit, branch switch, and a
 * side-by-side diff rendered by the same Monaco diff component the editor uses.
 *
 * Status is refreshed on the workspace's file-change events rather than polled:
 * the watcher already fires for every write, and a timer would either lag the
 * user's own edits or spin `git status` forever on an idle window.
 */

const STATUS_LABELS: Record<string, string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
  '?': 'untracked'
}

/** The single letter shown against a file, and what it means. */
function describe(entry: GitStatusEntry, staged: boolean): { letter: string; title: string } {
  const code = staged ? entry.index : entry.worktree === ' ' ? entry.index : entry.worktree
  return {
    letter: code === '?' ? 'U' : code.trim() || 'M',
    title: STATUS_LABELS[code] ?? 'changed'
  }
}

export function SourceControlBlock(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ path: string; staged: boolean } | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  // Escape and outside-click dismissal, and it hides the native stage view that
  // would otherwise paint over the menu.
  const branchRef = usePopover(
    branchOpen,
    useCallback(() => setBranchOpen(false), [])
  )

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.agweb.git.status()
    setStatus(next)
  }, [])

  useEffect(() => {
    // The workspace watcher already fires on every write, so status follows the
    // user's edits without a polling timer. `live` stops a status that resolves
    // after a workspace switch from overwriting the new one.
    let live = true
    const load = async (): Promise<void> => {
      const next = await window.agweb.git.status()
      if (live) setStatus(next)
    }
    const off = window.agweb.fs.onChanged(() => void load())
    void load()
    return () => {
      live = false
      off()
    }
  }, [workspace?.path])

  const act = async (run: () => Promise<{ error?: string }>): Promise<void> => {
    setBusy(true)
    const result = await run()
    setError(result.error ?? null)
    setBusy(false)
    await refresh()
  }

  const commit = async (): Promise<void> => {
    if (!message.trim()) return
    await act(() => window.agweb.git.commit(message))
    setMessage('')
  }

  const openBranches = async (): Promise<void> => {
    const result = await window.agweb.git.branches()
    setBranches(result.branches)
    setBranchOpen(true)
  }

  if (!status) {
    return <div className="p-4 text-xs text-slate-400">Reading repository…</div>
  }

  if (!status.repository) {
    return (
      <div className="flex flex-col gap-2 p-4 text-xs text-slate-500">
        <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
          No repository here
        </span>
        <span className="leading-relaxed">
          {status.error ?? 'This workspace is not a git repo.'}
        </span>
      </div>
    )
  }

  const staged = status.files.filter((f) => f.staged)
  const changed = status.files.filter((f) => !f.staged)

  return (
    <div className="relative flex h-full flex-col text-xs">
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        {/* Trigger and panel share one positioned wrapper, so usePopover can
            treat a click on the trigger as inside rather than as a dismissal. */}
        <div ref={branchRef} className="relative">
          <button
            onClick={() => void openBranches()}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Switch branch"
            data-testid="git-branch"
          >
            <BranchIcon />
            {status.branch || 'detached'}
          </button>

          {branchOpen && (
            <div
              className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              data-testid="git-branch-menu"
            >
              {branches.map((branch) => (
                <button
                  key={branch}
                  onClick={() => {
                    setBranchOpen(false)
                    void act(() => window.agweb.git.checkout(branch))
                  }}
                  className={`block w-full truncate px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    branch === status.branch
                      ? 'font-semibold text-sky-600 dark:text-sky-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {branch}
                </button>
              ))}
              {branches.length === 0 && (
                <div className="px-2.5 py-1.5 text-slate-400">No branches.</div>
              )}
            </div>
          )}
        </div>

        {(status.ahead > 0 || status.behind > 0) && (
          <span className="font-mono text-[10px] text-slate-400">
            {status.ahead > 0 && `↑${status.ahead}`}
            {status.behind > 0 && `↓${status.behind}`}
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          {status.files.length} {status.files.length === 1 ? 'change' : 'changes'}
        </span>
      </div>

      <div className="flex-none border-b border-slate-200 p-2 dark:border-slate-800">
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit()
          }}
          placeholder={`Message (⌘↵ to commit on ${status.branch || 'HEAD'})`}
          className="w-full resize-none rounded border border-slate-200 bg-transparent px-2 py-1.5 outline-none focus:border-sky-500 dark:border-slate-700"
          data-testid="git-message"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={() => void commit()}
            disabled={!message.trim() || staged.length === 0 || busy}
            className="rounded bg-sky-500 px-2.5 py-1 font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
            data-testid="git-commit"
          >
            Commit
          </button>
          {staged.length === 0 && (
            <span className="text-[10px] text-slate-400">Stage something first.</span>
          )}
          {error && (
            <span className="truncate text-[10px] text-rose-500" title={error}>
              {error}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileSection
          title="Staged changes"
          entries={staged}
          staged
          action="Unstage"
          onAction={(paths) => void act(() => window.agweb.git.unstage(paths))}
          onOpenDiff={(path) => setDiff({ path, staged: true })}
        />
        <FileSection
          title="Changes"
          entries={changed}
          staged={false}
          action="Stage"
          onAction={(paths) => void act(() => window.agweb.git.stage(paths))}
          onOpenDiff={(path) => setDiff({ path, staged: false })}
        />
        {status.files.length === 0 && <div className="p-4 text-slate-400">Working tree clean.</div>}
      </div>

      {diff && (
        <GitDiffOverlay path={diff.path} staged={diff.staged} onClose={() => setDiff(null)} />
      )}
    </div>
  )
}

function FileSection({
  title,
  entries,
  staged,
  action,
  onAction,
  onOpenDiff
}: {
  title: string
  entries: GitStatusEntry[]
  staged: boolean
  action: string
  onAction: (paths: string[]) => void
  onOpenDiff: (path: string) => void
}): React.JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-200 px-2.5 py-1 dark:border-slate-800">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <button
          onClick={() => onAction(entries.map((e) => e.path))}
          className="ml-auto text-[10px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          {action} all
        </button>
      </div>
      {entries.map((entry) => {
        const { letter, title: what } = describe(entry, staged)
        return (
          <div
            key={entry.path}
            className="group flex items-center gap-2 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <button
              onClick={() => onOpenDiff(entry.path)}
              className="min-w-0 flex-1 truncate text-left text-slate-600 dark:text-slate-300"
              title={`${entry.path} — ${what}`}
            >
              {entry.path}
            </button>
            <button
              onClick={() => onAction([entry.path])}
              className="rounded px-1.5 text-[10px] font-semibold text-slate-400 opacity-0 hover:text-slate-600 group-hover:opacity-100 dark:hover:text-slate-300"
            >
              {action}
            </button>
            <span
              className="w-3 flex-none text-center font-mono text-[10px] font-bold text-slate-400"
              title={what}
            >
              {letter}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Side-by-side diff of one file, in the Monaco diff component (3.5). */
function GitDiffOverlay({
  path,
  staged,
  onClose
}: {
  path: string
  staged: boolean
  onClose: () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const monacoReady = useMonacoReady()
  const [error, setError] = useState<string | null>(null)

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

    // Closing before the read resolves would set a model on a disposed editor
    // and orphan the two models it just created.
    let cancelled = false
    let models: monaco.editor.ITextModel[] = []

    void window.agweb.git.diff(path, staged).then((result: GitFileDiff) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        return
      }
      const language = languageForPath(path)
      const original = monaco.editor.createModel(result.original, language)
      const modified = monaco.editor.createModel(result.modified, language)
      models = [original, modified]
      editor.setModel({ original, modified })
    })

    return () => {
      cancelled = true
      editor.dispose()
      for (const model of models) model.dispose()
    }
  }, [path, staged, monacoReady])

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-[#0e1420]">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-slate-200 px-2.5 dark:border-slate-800">
        <span className="truncate font-semibold text-slate-600 dark:text-slate-300">{path}</span>
        <span className="flex-none text-[10px] text-slate-400">
          {staged ? 'HEAD → staged' : 'staged → working tree'}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close diff"
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {error ? (
        <div className="p-4 text-rose-500">{error}</div>
      ) : (
        <div ref={containerRef} className="min-h-0 flex-1" />
      )}
    </div>
  )
}

function BranchIcon(): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M18 11.5c0 3-3 4-6 4.5" />
    </svg>
  )
}
