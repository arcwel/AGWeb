import { useEffect, useMemo, useRef, useState } from 'react'
import { useShellStore, type WorkspaceSnapshot } from '@/store'
import { CloseIcon } from '@/components/browser-icons'

/**
 * Session snapshots overlay.
 *
 * Lists every saved snapshot (name, tab count, workspace, saved-at) and lets
 * the user capture the current state under a name, then restore, rename, or
 * delete one. Like the Settings sheet and the command palette, it raises the
 * shared overlay count so the native WebContentsView yields to this DOM while
 * it is open — otherwise the live page would paint straight over it.
 *
 * Visibility lives in the store (like the Settings sheet) so both the hotkey
 * and the command palette can raise it without prop-threading.
 */

/** Compact "time ago" so a long list of snapshots stays scannable. */
function timeAgo(then: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

export function SnapshotPanel(): React.JSX.Element | null {
  const open = useShellStore((s) => s.snapshotsOpen)
  const setSnapshotsOpen = useShellStore((s) => s.setSnapshotsOpen)
  const snapshots = useShellStore((s) => s.snapshots)
  const saveSnapshot = useShellStore((s) => s.saveSnapshot)
  const restoreSnapshot = useShellStore((s) => s.restoreSnapshot)
  const renameSnapshot = useShellStore((s) => s.renameSnapshot)
  const deleteSnapshot = useShellStore((s) => s.deleteSnapshot)
  const pushToast = useShellStore((s) => s.pushToast)
  const setOverlayOpen = useShellStore((s) => s.setOverlayOpen)

  const onClose = (): void => setSnapshotsOpen(false)

  const [saveName, setSaveName] = useState('')
  const [selected, setSelected] = useState(0)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const saveInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  )

  // Raise the overlay count while open so the native view yields to the DOM.
  useEffect(() => {
    if (!open) return
    setOverlayOpen(true)
    return () => setOverlayOpen(false)
  }, [open, setOverlayOpen])

  // Fresh fields each open; focus straight into the name field.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveName('')
    setSelected(0)
    setRenamingId(null)
    saveInputRef.current?.focus()
  }, [open])

  // Keep the selection in range as the list shrinks (deletes) or grows (saves).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected((current) =>
      current >= snapshots.length ? Math.max(0, snapshots.length - 1) : current
    )
  }, [snapshots.length])

  // Keep the focused row scrolled into view as the selection moves.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  // Focus the rename field when entering rename mode.
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  if (!open) return null

  const commitSave = (): void => {
    const name = saveName.trim()
    if (!name) return
    const persisted = saveSnapshot(name)
    setSaveName('')
    setSelected(0)
    // saveSnapshot reports whether localStorage actually took the write; a
    // quota failure must not masquerade as a successful save.
    if (persisted) {
      pushToast(`Saved snapshot "${name}".`, 'info')
    } else {
      pushToast("Couldn't save snapshot — storage full.", 'error')
    }
    saveInputRef.current?.focus()
  }

  const doRestore = (snapshot: WorkspaceSnapshot): void => {
    restoreSnapshot(snapshot.id)
    pushToast(`Restored "${snapshot.name}".`, 'info')
    onClose()
  }

  const startRename = (snapshot: WorkspaceSnapshot): void => {
    setRenamingId(snapshot.id)
    setRenameValue(snapshot.name)
  }

  const commitRename = (): void => {
    if (renamingId) renameSnapshot(renamingId, renameValue)
    setRenamingId(null)
  }

  // Arrow navigation + Enter/Delete over the list. Editing a name owns its own
  // keys, so list navigation is suspended while a rename field is focused.
  const onListKeyDown = (event: React.KeyboardEvent): void => {
    if (renamingId) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((c) => (snapshots.length === 0 ? 0 : (c + 1) % snapshots.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((c) =>
        snapshots.length === 0 ? 0 : (c - 1 + snapshots.length) % snapshots.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const snapshot = snapshots[selected]
      if (snapshot) doRestore(snapshot)
    }
  }

  // Esc closes the panel, but first cancels an in-progress rename.
  const onRootKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (renamingId) {
      setRenamingId(null)
      return
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[205] flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
      onKeyDown={onRootKeyDown}
      data-testid="snapshot-panel"
    >
      <div
        className={`glass wd-snap-panel flex max-h-[76vh] w-[min(640px,94vw)] flex-col overflow-hidden ${
          prefersReducedMotion ? 'wd-snap-panel-static' : ''
        }`}
        style={{ borderRadius: 'var(--wd-r-stage)' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wd-snap-title"
      >
        <div className="flex flex-none items-center justify-between border-b border-[var(--wd-glass-border)] px-4 py-2.5">
          <span id="wd-snap-title" className="text-[13px] font-semibold text-[var(--wd-text)]">
            Session Snapshots
          </span>
          <button
            onClick={onClose}
            className="wd-icon"
            aria-label="Close snapshots"
            title="Close (Esc)"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        {/* Save-current row */}
        <div className="flex flex-none items-center gap-2 border-b border-[var(--wd-glass-border)] px-3 py-2.5">
          <input
            ref={saveInputRef}
            type="text"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitSave()
              }
            }}
            placeholder="Name this snapshot…"
            aria-label="New snapshot name"
            className="wd-snap-input min-w-0 flex-1 rounded-[var(--wd-r-inner)] bg-[var(--wd-well)] px-2.5 py-1.5 text-[13px] text-[var(--wd-text)] outline-none placeholder:text-[var(--wd-dim)]"
          />
          <button
            onClick={commitSave}
            disabled={!saveName.trim()}
            className="wd-snap-primary flex-none rounded-[var(--wd-r-inner)] px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            Save current…
          </button>
        </div>

        <ul
          ref={listRef}
          role="listbox"
          aria-label="Saved snapshots"
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        >
          {snapshots.length === 0 ? (
            <li
              className="px-3 py-8 text-center text-[13px] text-[var(--wd-dim)]"
              aria-disabled="true"
            >
              No snapshots yet — name one above to capture your tabs, layout, and open files.
            </li>
          ) : (
            snapshots.map((snapshot, index) => {
              const isRenaming = renamingId === snapshot.id
              return (
                <li
                  key={snapshot.id}
                  data-index={index}
                  role="option"
                  aria-selected={index === selected}
                  onMouseMove={() => setSelected(index)}
                  className={`wd-snap-row mx-1 flex items-center gap-3 rounded-[var(--wd-r-inner)] px-2.5 py-2 ${
                    index === selected ? 'wd-snap-row-active' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitRename()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            event.stopPropagation()
                            setRenamingId(null)
                          }
                        }}
                        onBlur={commitRename}
                        aria-label={`Rename ${snapshot.name}`}
                        className="w-full rounded-[var(--wd-r-inner)] bg-[var(--wd-well)] px-2 py-1 text-[13px] text-[var(--wd-text)] outline-none"
                      />
                    ) : (
                      <>
                        <div className="truncate text-[13px] text-[var(--wd-text)]">
                          {snapshot.name}
                        </div>
                        <div className="truncate text-[11px] text-[var(--wd-dim)]">
                          {snapshot.tabSession.tabs.length}{' '}
                          {snapshot.tabSession.tabs.length === 1 ? 'tab' : 'tabs'}
                          {' · '}
                          {snapshot.workspace?.name ?? 'No workspace'}
                          {' · '}
                          {timeAgo(snapshot.savedAt)}
                        </div>
                      </>
                    )}
                  </div>
                  {!isRenaming && (
                    <div className="flex flex-none items-center gap-1">
                      <button
                        onClick={() => doRestore(snapshot)}
                        className="wd-snap-action rounded-[var(--wd-r-inner)] px-2.5 py-1 text-[12px] font-medium"
                        aria-label={`Restore ${snapshot.name}`}
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => startRename(snapshot)}
                        className="wd-snap-action rounded-[var(--wd-r-inner)] px-2 py-1 text-[12px]"
                        aria-label={`Rename ${snapshot.name}`}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => deleteSnapshot(snapshot.id)}
                        className="wd-snap-action wd-snap-danger rounded-[var(--wd-r-inner)] px-2 py-1 text-[12px]"
                        aria-label={`Delete ${snapshot.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
