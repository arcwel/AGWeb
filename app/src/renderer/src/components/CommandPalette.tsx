import { useEffect, useMemo, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { buildCommands, fuzzyMatch, type AppCommand } from '@/commands'

/**
 * The ⌘K command palette.
 *
 * A centred glass overlay listing every app command, fuzzy-filtered as you
 * type. Like the Settings surface, it raises the shared overlay count so the
 * native WebContentsView hides and this DOM shows through — otherwise the live
 * page would paint straight over it.
 *
 * The command set is data (`buildCommands`), not markup, so this component
 * stays a thin view: filter, rank, and drive the selected command's `run`.
 */
interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Raise the tab switcher (the "Switch Tab…" command routes here). */
  onOpenTabSwitcher: () => void
}

export function CommandPalette({
  open,
  onClose,
  onOpenTabSwitcher
}: CommandPaletteProps): React.JSX.Element | null {
  const setOverlayOpen = useShellStore((s) => s.setOverlayOpen)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The element focused before the palette opened, so focus can be handed back
  // when it closes instead of being stranded on the (now-hidden) overlay.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // Rebuild each open so store-reading commands (close tab, presets) act on
  // live state, and so the tab-switcher opener is current.
  const commands = useMemo(
    () => (open ? buildCommands({ openTabSwitcher: onOpenTabSwitcher }) : []),
    [open, onOpenTabSwitcher]
  )

  const results = useMemo<AppCommand[]>(() => {
    const scored = commands
      .map((command) => ({
        command,
        score: fuzzyMatch(query, `${command.title} ${command.keywords ?? ''}`)
      }))
      .filter((entry): entry is { command: AppCommand; score: number } => entry.score !== null)
    scored.sort((a, b) => b.score - a.score)
    return scored.map((entry) => entry.command)
  }, [commands, query])

  // Raise the overlay count while open so the native view yields to the DOM.
  useEffect(() => {
    if (!open) return
    setOverlayOpen(true)
    return () => setOverlayOpen(false)
  }, [open, setOverlayOpen])

  // Fresh query + selection each time it opens, focus straight into the field.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('')
    setSelected(0)
    inputRef.current?.focus()
  }, [open])

  // Capture the previously-focused element on open and restore it on close, so
  // dismissing the palette returns keyboard focus where it was.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    return () => restoreFocusRef.current?.focus?.()
  }, [open])

  // Keep the selection in range as the filtered list shrinks.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected((current) => (current >= results.length ? 0 : current))
  }, [results.length])

  // Keep the active option scrolled into view as the selection moves.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  if (!open) return null

  const runCommand = (command: AppCommand): void => {
    onClose()
    void command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = results[selected]
      if (command) runCommand(command)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  // Trap Tab within the panel so focus can't wander to the hidden page behind
  // the modal: cycle from the last focusable element back to the first (and the
  // reverse for Shift+Tab).
  const onTrapKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activeId = results[selected] ? `wd-cmd-${results[selected].id}` : undefined

  return (
    <div
      className="fixed inset-0 z-[210] flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
      data-testid="command-palette"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="glass wd-cmd-panel flex w-[min(620px,94vw)] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--wd-r-stage)' }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onTrapKeyDown}
      >
        <div className="flex-none border-b border-[var(--wd-glass-border)] px-3 py-2">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="wd-cmd-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search commands"
            type="text"
            placeholder="Type a command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="wd-cmd-input w-full bg-transparent text-[14px] text-[var(--wd-text)] outline-none placeholder:text-[var(--wd-dim)]"
          />
        </div>
        <ul
          ref={listRef}
          id="wd-cmd-listbox"
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(420px,60vh)] min-h-0 flex-1 overflow-y-auto py-1"
        >
          {results.length === 0 ? (
            <li
              className="px-3 py-6 text-center text-[13px] text-[var(--wd-dim)]"
              aria-disabled="true"
            >
              No matching commands
            </li>
          ) : (
            results.map((command, index) => (
              <li
                key={command.id}
                id={`wd-cmd-${command.id}`}
                data-index={index}
                role="option"
                aria-selected={index === selected}
                onClick={() => runCommand(command)}
                onMouseMove={() => setSelected(index)}
                className={`wd-cmd-row mx-1 flex cursor-pointer items-center gap-3 rounded-[var(--wd-r-inner)] px-2.5 py-2 ${
                  index === selected ? 'wd-cmd-row-active' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--wd-text)]">
                  {command.title}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--wd-dim)]">
                  {command.section}
                </span>
                {command.shortcut && (
                  <kbd className="wd-cmd-kbd shrink-0 text-[11px] text-[var(--wd-muted)]">
                    {command.shortcut}
                  </kbd>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
