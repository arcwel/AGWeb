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

  const openFolder = async (): Promise<void> => {
    const ws = await window.agweb.openWorkspace()
    if (ws) setWorkspace(ws)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-slate-50 text-slate-900 dark:bg-[#0b0f14] dark:text-slate-100">
      <div className="flex flex-col items-center gap-3">
        <img src="./icon.png" alt="" width={64} height={54} className="opacity-95" />
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-[0.2em] text-slate-400 uppercase">
            Arcwel
          </span>
          <span className="text-4xl font-bold tracking-tight">WebDeck</span>
        </div>
        <div className="text-sm text-slate-500">
          Browse anywhere. Press{' '}
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">
            ⌘D
          </kbd>{' '}
          when it&apos;s time to build.
        </div>
      </div>

      <div className="flex w-80 flex-col gap-2">
        <button
          onClick={() => void openFolder()}
          className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Open Project Folder…
        </button>
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
            WebDeck {info.version} · Electron {info.electron} · Chromium {info.chrome}
          </div>
        )}
      </div>
    </div>
  )
}
