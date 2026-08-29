import { useShellStore } from '@/store'
import { navigateTab } from '@/components/Toolbar'
import { LockIcon, SearchIcon, SplitscreenIcon } from '@/components/browser-icons'

/**
 * The utilities bar (design canvas: "the favourites bar is summoned, not
 * permanent").
 *
 * Favourites and page tools on one strip that appears and disappears with the
 * same choreography as the deck, rather than permanently costing a row of the
 * window. It reveals slowly enough to read (`utilities-reveal`) instead of
 * snapping in. The lock lives here rather than in the chrome, and keeps the
 * bar open for people who want a conventional bookmarks bar.
 */

/** Colours for the favourite chips, cycled by position. */
const CHIP_COLORS = ['var(--wd-accent)', 'var(--wd-accent-2)', '#e0b04f', '#e07a7a', '#8fd07a']

export function UtilitiesBar(): React.JSX.Element | null {
  const open = useShellStore((s) => s.utilitiesOpen)
  const locked = useShellStore((s) => s.utilitiesLocked)
  const bookmarks = useShellStore((s) => s.bookmarks)
  const activeTabId = useShellStore((s) => s.activeTabId)
  const setUtilitiesLocked = useShellStore((s) => s.setUtilitiesLocked)

  if (!open && !locked) return null

  return (
    <div
      className="glass utilities-bar flex flex-none items-center gap-1 px-2 py-1"
      style={{ borderRadius: '14px' }}
      data-testid="utilities-bar"
    >
      <span className="wd-cap flex-none px-1.5">Favourites</span>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {bookmarks.length === 0 && (
          <span className="px-2 text-[11px] text-[var(--wd-dim)]">
            Star a page and it appears here.
          </span>
        )}
        {bookmarks.slice(0, 12).map((bookmark, i) => (
          <button
            key={bookmark.url}
            onClick={() => void navigateTab(activeTabId, bookmark.url)}
            className="flex min-w-0 flex-none items-center gap-2 px-2.5 py-1 text-[11.5px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
            style={{ borderRadius: '9px' }}
            title={bookmark.url}
          >
            <span
              className="h-3 w-3 flex-none rounded-[3px]"
              style={{ background: CHIP_COLORS[i % CHIP_COLORS.length] }}
            />
            <span className="max-w-36 truncate">{bookmark.title}</span>
          </button>
        ))}
      </div>

      <span className="h-4 w-px flex-none bg-[var(--wd-glass-border)]" />
      <span className="wd-cap flex-none px-1.5">Tools</span>

      {/* Splits the PAGE into two panes — this is the browser's split view,
          not the Dev Deck. */}
      <ToolChip
        label="Split view"
        icon={<SplitscreenIcon size={13} />}
        onClick={() => useShellStore.getState().toggleSplit()}
      />
      <ToolChip
        label="Find in page"
        icon={<SearchIcon size={13} />}
        onClick={() =>
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))
        }
      />

      <button
        onClick={() => setUtilitiesLocked(!locked)}
        className="ml-1 flex flex-none items-center gap-1.5 px-2 py-1"
        style={{
          borderRadius: 'var(--wd-r-inner)',
          background: locked ? 'var(--wd-accent-soft)' : 'transparent',
          color: locked ? 'var(--wd-accent)' : 'var(--wd-dim)'
        }}
        title={locked ? 'Unlock the bar' : 'Lock the bar open'}
      >
        <LockIcon size={11} />
        <span className="m text-[9.5px]">{locked ? 'LOCKED' : 'LOCK'}</span>
      </button>
    </div>
  )
}

function ToolChip({
  label,
  icon,
  onClick
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex flex-none items-center gap-2 px-2.5 py-1 text-[11.5px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
      style={{ borderRadius: '9px' }}
    >
      <span className="text-[var(--wd-dim)]">{icon}</span>
      {label}
    </button>
  )
}

/** The four-square glyph on the utilities toggle. */
export function GridIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  )
}

/** Shield, for the embed-proxy indicator. */
export function ShieldIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Z" />
    </svg>
  )
}
