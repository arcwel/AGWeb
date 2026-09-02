import { useShellStore } from '@/store'
import { useThemeEffect } from '@/theme'
import { GroupView } from '@/components/Deck'
import { CloseIcon, DeckIcon, DockInIcon } from '@/components/icons'

/**
 * The detached Deck: every dev block in one standalone IDE-style window.
 * "Dock back" merges the deck into the browser window's Stage layout.
 */
export function DeckWindow(): React.JSX.Element {
  useThemeEffect()
  const workspace = useShellStore((s) => s.workspace)
  const groups = useShellStore((s) => s.groups)
  const attachDeck = useShellStore((s) => s.attachDeck)
  const right = groups.filter((g) => g.zone === 'right')
  const bottom = groups.filter((g) => g.zone === 'bottom')

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900 dark:bg-[#0b0f14] dark:text-slate-100">
      <div
        className="drag-region flex flex-none items-center gap-2.5 border-b border-slate-200 bg-white pr-3 dark:border-slate-800 dark:bg-[#0e1420]"
        style={{ height: 'var(--wd-tabrow-h)', paddingLeft: 'var(--wd-titlebar-inset)' }}
      >
        <DeckIcon className="text-sky-500" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          WebDeck{workspace ? ` — ${workspace.name}` : ''}
        </span>
        <div className="no-drag ml-auto flex items-center gap-2">
          <button
            onClick={attachDeck}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Merge the deck back into the browser window"
          >
            <DockInIcon />
            <span>Dock back</span>
          </button>
          <button
            onClick={() => window.close()}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close deck window"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {right.length === 0 && bottom.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            All blocks are closed or on the browser window&apos;s rail.
          </div>
        )}
        {right.map((group) => (
          <GroupView key={group.id} group={group} grow />
        ))}
      </div>
      {bottom.length > 0 && (
        <div className="flex h-60 flex-none gap-3 px-3 pb-3">
          {bottom.map((group) => (
            <GroupView key={group.id} group={group} grow />
          ))}
        </div>
      )}
    </div>
  )
}
