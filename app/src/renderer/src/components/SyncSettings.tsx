import { useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/ipc'

/**
 * WebDeck Sync (v0): sync your settings across machines through a single file
 * you keep in a folder you already sync (iCloud, Drive, Dropbox). No account,
 * no server — the file is the source of truth, merged per section by
 * last-writer-wins. A form of real controls, because the surface is small and
 * known.
 */

function fileName(path: string | null): string {
  if (!path) return 'No file chosen'
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

export function SyncSettings(): React.JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.agweb.sync.status().then((s) => live && setStatus(s))
    const off = window.agweb.sync.onChanged((s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])

  const run = async (label: string, fn: () => Promise<SyncStatus>): Promise<void> => {
    setBusy(label)
    try {
      setStatus(await fn())
    } catch (error) {
      // Without this the button simply re-enabled itself: the status banner is
      // only ever written on success, so a failure was invisible.
      setStatus((prev) => ({
        enabled: prev?.enabled ?? false,
        filePath: prev?.filePath ?? null,
        lastSyncedAt: prev?.lastSyncedAt ?? null,
        sections: prev?.sections ?? [],
        error: error instanceof Error ? error.message : String(error)
      }))
    } finally {
      setBusy(null)
    }
  }

  const hasFile = !!status?.filePath

  return (
    <div className="flex flex-col gap-4 p-4 text-[12px]" data-testid="sync-settings">
      <div>
        <h3 className="mb-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
          Settings sync
        </h3>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Keep the sync file in a folder your OS already syncs (iCloud Drive, Google Drive,
          Dropbox). WebDeck reads it on launch and whenever it changes, and writes your edits back.
          Browser settings, permission policy, and the AI model travel with it.
        </p>
      </div>

      {/* File */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Sync file</div>
          <div
            className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300"
            title={status?.filePath ?? undefined}
            data-testid="sync-file"
          >
            {fileName(status?.filePath ?? null)}
          </div>
        </div>
        <button
          onClick={() => void run('choose', () => window.agweb.sync.chooseFile())}
          className="flex-none rounded bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          data-testid="sync-choose-file"
        >
          {hasFile ? 'Change…' : 'Choose file…'}
        </button>
      </div>

      {/* Auto-sync toggle */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={!hasFile}
          onChange={(e) => void run('enable', () => window.agweb.sync.setEnabled(e.target.checked))}
          data-testid="sync-enable"
        />
        <span className="text-slate-700 dark:text-slate-200">Sync automatically</span>
        {!hasFile && <span className="text-[10px] text-slate-400">— choose a file first</span>}
      </label>

      {/* Manual push/pull */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void run('push', () => window.agweb.sync.pushNow())}
          disabled={!hasFile || !!busy}
          className="rounded bg-sky-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
          data-testid="sync-push"
        >
          Push now
        </button>
        <button
          onClick={() => void run('pull', () => window.agweb.sync.pullNow())}
          disabled={!hasFile || !!busy}
          className="rounded bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          data-testid="sync-pull"
        >
          Pull now
        </button>
        <span className="ml-auto text-[10px] text-slate-400" data-testid="sync-last">
          {busy ? `${busy}…` : `Last synced ${relativeTime(status?.lastSyncedAt ?? null)}`}
        </span>
      </div>

      {status?.error && (
        <div className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-600 dark:bg-rose-950 dark:text-rose-300">
          {status.error}
        </div>
      )}

      {status && status.sections.length > 0 && (
        <div className="text-[10px] text-slate-400">Syncing: {status.sections.join(', ')}</div>
      )}
    </div>
  )
}
