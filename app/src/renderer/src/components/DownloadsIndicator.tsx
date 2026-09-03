import { useCallback, useEffect, useState } from 'react'
import type { DownloadInfo } from '@shared/ipc'
import { usePopover } from '@/popover'

/**
 * Toolbar downloads pill: hidden until the first download, spins while any
 * download is in flight, and opens a dropdown with progress and Show-in-Folder.
 */
export function DownloadsIndicator(): React.JSX.Element | null {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  const [open, setOpen] = useState(false)

  const menuRef = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  useEffect(() => {
    let cancelled = false
    void window.agweb.downloads.list().then((list) => {
      if (!cancelled) setDownloads(list)
    })
    const off = window.agweb.downloads.onUpdate((download) => {
      setDownloads((existing) => {
        const index = existing.findIndex((d) => d.id === download.id)
        if (index < 0) return [...existing, download]
        return existing.map((d) => (d.id === download.id ? download : d))
      })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  if (downloads.length === 0) return null

  const active = downloads.filter((d) => d.state === 'progressing').length

  const clear = async (): Promise<void> => {
    await window.agweb.downloads.clear()
    setDownloads(await window.agweb.downloads.list())
    setOpen(false)
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="downloads-indicator"
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${
          active > 0
            ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
            : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
        }`}
        aria-label="Downloads"
      >
        <span>↓</span>
        <span>{active > 0 ? `${active}…` : downloads.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 max-h-[min(24rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0e1420]">
          {downloads.map((d) => (
            <div key={d.id} className="border-b border-slate-100 px-3.5 py-2 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate font-medium" title={d.url}>
                  {d.filename}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                  {d.state === 'progressing'
                    ? d.totalBytes > 0
                      ? `${Math.round((d.receivedBytes / d.totalBytes) * 100)}%`
                      : '…'
                    : d.state}
                </span>
              </div>
              {d.state === 'progressing' && d.totalBytes > 0 && (
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-sky-500"
                    style={{ width: `${(d.receivedBytes / d.totalBytes) * 100}%` }}
                  />
                </div>
              )}
              {d.state === 'completed' && (
                <button
                  onClick={() => void window.agweb.downloads.show(d.id)}
                  className="mt-1 text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                >
                  Show in Folder
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => void clear()}
            className="block w-full px-3.5 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Clear finished
          </button>
        </div>
      )}
    </div>
  )
}
