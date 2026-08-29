import { useEffect, useState } from 'react'
import type { DevServerStatus } from '@shared/ipc'
import { useShellStore } from '@/store'
import { ReloadIcon } from '@/components/icons'

/**
 * Live preview block (Phase 4.2): drives the workspace dev server and embeds
 * it in a sandboxed iframe. Script mode rides the dev server's own HMR;
 * static mode serves the workspace directly (cache disabled, reload to see
 * changes). The iframe gives the preview full style/script isolation.
 */
export function PreviewBlock(): React.JSX.Element {
  const [status, setStatus] = useState<DevServerStatus | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const newTab = useShellStore((s) => s.newTab)

  useEffect(() => {
    void window.agweb.devServer.status().then(setStatus)
    return window.agweb.devServer.onUpdate(setStatus)
  }, [])

  const start = (mode: 'script' | 'static'): void => {
    void window.agweb.devServer.start(mode).then(setStatus)
  }
  const stop = (): void => {
    void window.agweb.devServer.stop().then(setStatus)
  }

  const running = status?.state === 'running' && status.url
  const busy = status?.state === 'starting'

  const dotColor =
    status?.state === 'running'
      ? 'bg-emerald-500'
      : status?.state === 'starting'
        ? 'bg-amber-500'
        : status?.state === 'error'
          ? 'bg-red-500'
          : 'bg-slate-400'

  const smallButton =
    'rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'

  return (
    <div className="flex h-full flex-col" data-testid="preview-block">
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        <span
          className="truncate text-[11px] text-slate-500"
          data-testid="preview-status"
          title={status?.logTail.join('\n')}
        >
          {status?.state === 'running'
            ? status.url
            : status?.state === 'starting'
              ? 'Starting…'
              : status?.state === 'error'
                ? (status.logTail.at(-1) ?? 'Failed')
                : status?.script
                  ? `npm run ${status.script.name}`
                  : 'Static file server'}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {running ? (
            <>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className={smallButton}
                aria-label="Reload preview"
              >
                <ReloadIcon size={12} />
              </button>
              <button
                onClick={() => status?.url && newTab(status.url)}
                className={smallButton}
                aria-label="Open preview in tab"
              >
                Open in tab
              </button>
              <button onClick={stop} className={smallButton} aria-label="Stop dev server">
                Stop
              </button>
            </>
          ) : (
            <>
              {status?.script && (
                <button
                  onClick={() => start('script')}
                  disabled={busy}
                  className={smallButton}
                  aria-label="Start dev server"
                >
                  Run {status.script.name}
                </button>
              )}
              <button
                onClick={() => start('static')}
                disabled={busy}
                className={smallButton}
                aria-label="Serve folder statically"
              >
                Serve folder
              </button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-white dark:bg-[#101418]">
        {running ? (
          <iframe
            key={reloadKey}
            src={status?.url ?? ''}
            title="Live preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-400">
            {status?.state === 'error'
              ? 'The dev server failed — check the status line for the last output.'
              : 'Start the dev server (or serve the folder) to preview this project live.'}
          </div>
        )}
      </div>
    </div>
  )
}
