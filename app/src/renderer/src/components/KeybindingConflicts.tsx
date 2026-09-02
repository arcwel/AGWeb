import { useSyncExternalStore } from 'react'
import { getShortcuts, subscribeShortcuts } from '@/shortcuts'
import { editorKeybindings } from '@/editor-commands'
import { displayCombo, findConflicts } from '@/keybinding-conflicts'

/**
 * Settings › Keybindings › conflicts (task 12.8).
 *
 * WebDeck's shell shortcuts (⌘D, ⌘T, ⌘W, ⌘K…) are handled before a key
 * reaches the editor, so an editor or extension keybinding on the same combo
 * never fires. That rule is deliberate — the shell must stay predictable — but
 * it should be *visible*: an installed keymap that maps ⌘K to something will
 * otherwise just seem broken. The logic lives in `keybinding-conflicts.ts`;
 * this is the view.
 */
export function KeybindingConflicts(): React.JSX.Element {
  const shell = useSyncExternalStore(subscribeShortcuts, getShortcuts)
  const conflicts = findConflicts(shell, editorKeybindings())

  return (
    <div className="flex-none border-b border-[var(--wd-hairline)] px-2.5 py-2">
      <div className="wd-cap mb-1">Conflicts with shell shortcuts</div>
      <p className="mb-1 text-[10px] text-[var(--wd-dim)]">
        Shell shortcuts win: a key the shell handles never reaches the editor, so an editor or
        extension binding on the same combo does nothing. Listed so a keymap that seems broken can
        be understood — rebind either side in the JSON below.
      </p>
      {conflicts.length === 0 ? (
        <div className="text-[11px] text-[var(--wd-muted)]">No conflicts.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {conflicts.map((c) => (
            <li key={c.combo} className="flex items-start gap-2 text-[11px]">
              <kbd className="wd-cmd-kbd w-16 flex-none text-[11px] text-[var(--wd-muted)]">
                {displayCombo(c.combo)}
              </kbd>
              <div className="min-w-0 flex-1">
                <div className="text-[var(--wd-text)]">{c.shell}</div>
                <div className="truncate text-[var(--wd-dim)]">
                  shadows{' '}
                  {c.editor
                    .slice(0, 4)
                    .map((e) => `${e.command}${e.chord ? ' (chord)' : ''}`)
                    .join(', ')}
                  {c.editor.length > 4 ? ` +${c.editor.length - 4} more` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
