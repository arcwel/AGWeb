import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AppInfo, RecentProject } from '@shared/ipc'
import { useShellStore } from '@/store'
import { subscribeShortcuts, getShortcuts } from '@/shortcuts'

export function StartPage(): React.JSX.Element {
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const workspace = useShellStore((s) => s.workspace)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  // Subscribe so the shortcut list fills in as shortcuts register after first
  // paint, instead of rendering the empty/partial registry once (P3-8).
  const shortcuts = useSyncExternalStore(subscribeShortcuts, getShortcuts)

  useEffect(() => {
    void window.agweb.getRecentProjects().then(setRecent)
    void window.agweb.getAppInfo().then(setInfo)
  }, [workspace])

  const [typedPath, setTypedPath] = useState('')
  const [pathError, setPathError] = useState('')
  // One field, one button. A typed path opens directly (workspace:open-path is
  // served by the core); an EMPTY path with the button pressed opens the native
  // folder panel, when this host has one (Shell.pickPaths on the fork). Without
  // a picker the button simply waits for a path — it is never a dead control.
  const canPick = window.agweb.host.canPickPaths

  const openFolder = async (): Promise<void> => {
    setPathError('')
    const ws = await window.agweb.openWorkspace()
    if (ws) setWorkspace(ws)
  }

  const openTypedPath = async (): Promise<void> => {
    const path = typedPath.trim()
    if (!path) {
      if (canPick) await openFolder()
      return
    }
    setPathError('')
    const ws = await window.agweb.openWorkspacePath(path)
    if (ws) {
      setWorkspace(ws)
      setTypedPath('')
    } else {
      setPathError(`Could not open "${path}" — check the path and try again.`)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-slate-50 text-slate-900 dark:bg-[#0b0f14] dark:text-slate-100">
      <div className="flex flex-col items-center gap-3">
        {/* The brand lockup carries the mark and the "WebDeck by Arcwel"
            wordmark together, so it replaces both the icon and the headline
            text that used to be assembled here by hand.

            Two files rather than one: the lockups differ only in text colour,
            and the app's theme is a `.dark` class on <html> (see theme.ts), not
            the OS preference — so a <picture> with prefers-color-scheme would
            ignore the user's own choice. The `dark:` variant follows the store.
            Only one is ever displayed, so only one reaches the a11y tree. */}
        <img
          src="./webdeck-lockup-light.svg"
          alt="Arcwel WebDeck"
          width={276}
          height={88}
          className="dark:hidden"
        />
        <img
          src="./webdeck-lockup-dark.svg"
          alt="Arcwel WebDeck"
          width={276}
          height={88}
          className="hidden dark:block"
        />
        <div className="text-sm text-slate-500">
          Browse anywhere. Press{' '}
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">
            ⌘D
          </kbd>{' '}
          when it&apos;s time to build.
        </div>
      </div>

      <div className="flex w-80 flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wd-project-path" className="text-xs text-slate-500">
            {canPick
              ? 'Open a project — type a path, or leave it empty to browse'
              : 'Open a project by path'}
          </label>
          <div className="flex gap-2">
            <input
              id="wd-project-path"
              value={typedPath}
              onChange={(e) => setTypedPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void openTypedPath()
              }}
              placeholder="~/code/my-project"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              onClick={() => void openTypedPath()}
              disabled={!canPick && !typedPath.trim()}
              title={canPick && !typedPath.trim() ? 'Choose a project folder…' : 'Open this path'}
              data-testid="start-open"
              className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {canPick && !typedPath.trim() ? 'Open…' : 'Open'}
            </button>
          </div>
          {pathError && <div className="text-xs text-rose-500">{pathError}</div>}
        </div>
        {workspace && (
          <div className="truncate text-center text-xs text-slate-500" title={workspace.path}>
            Current: {workspace.name}
          </div>
        )}
        {recent.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent
            </div>
            {recent.slice(0, 5).map((project) => (
              <button
                key={project.path}
                onClick={() => void window.agweb.openWorkspacePath(project.path)}
                className="truncate rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                title={project.path}
              >
                {project.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 text-xs text-slate-500">
        {shortcuts.slice(0, 5).map((s) => (
          <div key={s.combo}>
            <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-600 dark:bg-slate-800">
              {s.combo}
            </kbd>{' '}
            {s.description}
          </div>
        ))}
        {info && (
          <div className="mt-3 text-[11px] text-slate-400 dark:text-slate-600">
            WebDeck {info.version}
            {info.electron ? ` · Electron ${info.electron}` : ''}
            {info.chrome ? ` · Chromium ${info.chrome}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}
