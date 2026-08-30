import { Fragment, useCallback, useState } from 'react'
import type { DragEvent } from 'react'
import {
  TAB_GROUP_COLORS,
  useShellStore,
  type BrowserTab,
  type TabGroup,
  type TabGroupColor
} from '@/store'
import { CloseIcon, DocIcon, GlobeIcon } from '@/components/icons'
import { usePopover } from '@/popover'

/**
 * Tab strip with drag-to-reorder and Chrome-style tab groups.
 *
 * Two layout rules matter here. Tabs **shrink to fit** rather than running off
 * the window — a strip you cannot see the end of is a strip you cannot use.
 * And a group's tabs are kept adjacent, so a group is always a contiguous run
 * that can be collapsed to a single chip.
 */

const TAB_DRAG_MIME = 'application/x-agweb-tab'

export function TabStrip(): React.JSX.Element {
  // Per-field selectors: subscribing to the whole store re-renders the strip
  // on every unrelated mutation (agent logs, browser state, dirty flags).
  const tabs = useShellStore((s) => s.tabs)
  const activeTabId = useShellStore((s) => s.activeTabId)
  const activateTab = useShellStore((s) => s.activateTab)
  const closeTab = useShellStore((s) => s.closeTab)
  const moveTab = useShellStore((s) => s.moveTab)
  const newTab = useShellStore((s) => s.newTab)
  const tabGroups = useShellStore((s) => s.tabGroups)
  const groupTabs = useShellStore((s) => s.groupTabs)
  const ungroupTab = useShellStore((s) => s.ungroupTab)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const acceptDrag = (event: DragEvent, target: string | null): void => {
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }

  const finishDrop = (event: DragEvent, beforeId: string | null): void => {
    event.preventDefault()
    setDropTarget(null)
    const id = event.dataTransfer.getData(TAB_DRAG_MIME)
    if (id) moveTab(id, beforeId)
  }

  return (
    <div
      data-testid="tab-strip"
      className="drag-region flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden pt-2 pr-2 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ paddingLeft: 'var(--wd-titlebar-inset)' }}
      onDragOver={(event) => acceptDrag(event, 'end')}
      onDrop={(event) => finishDrop(event, null)}
      onDragLeave={() => setDropTarget(null)}
    >
      {tabs.map((tab, index) => {
        const group = tab.groupId ? tabGroups[tab.groupId] : undefined
        // The chip renders once, at the start of each contiguous group run.
        const startsGroup = group !== undefined && tabs[index - 1]?.groupId !== tab.groupId
        const memberCount = group ? tabs.filter((t) => t.groupId === group.id).length : 0

        return (
          <Fragment key={tab.id}>
            {startsGroup && group && <GroupChip group={group} count={memberCount} />}
            {group?.collapsed ? null : (
              <div
                draggable
                title={tab.title}
                onDragStart={(event) => {
                  event.dataTransfer.setData(TAB_DRAG_MIME, tab.id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  event.stopPropagation()
                  acceptDrag(event, tab.id)
                }}
                onDrop={(event) => {
                  event.stopPropagation()
                  finishDrop(event, tab.id)
                }}
                onClick={() => activateTab(tab.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenuFor(menuFor === tab.id ? null : tab.id)
                }}
                style={{ borderRadius: 'var(--wd-r-pill)' }}

                className={`no-drag group relative flex min-w-[46px] shrink basis-52 cursor-pointer items-center gap-2 overflow-hidden px-3 py-1.5 text-[12.5px] transition-colors ${
                  tab.id === activeTabId
                    ? 'bg-[rgba(255,255,255,0.1)] text-[var(--wd-text)] ring-1 ring-[var(--wd-glass-border)]'
                    : 'text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]'
                } ${dropTarget === tab.id ? 'shadow-[inset_2px_0_0_0_var(--wd-accent)]' : ''}`}
              >
                {/* A group's colour runs along the top of its tabs, so the run
                    reads as one thing even when the chip is scrolled away. */}
                {group && (
                  <span
                    className={`absolute inset-x-0 top-0 h-[3px] ${TAB_GROUP_COLORS[group.color].dot}`}
                  />
                )}
                {tab.kind === 'doc' ? (
                  <DocIcon
                    size={13}
                    className={`shrink-0 ${tab.id === activeTabId ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'}`}
                  />
                ) : tab.favicon ? (
                  <img
                    src={tab.favicon}
                    alt=""
                    className="h-[13px] w-[13px] shrink-0 rounded-[2px] object-contain"
                  />
                ) : (
                  <GlobeIcon
                    size={13}
                    className={`shrink-0 ${tab.id === activeTabId ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'}`}
                  />
                )}
                {/* flex-1 so the title fills the tab and the close button is
                    always pinned to the far right, not tucked after a short
                    title. */}
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className="ml-auto shrink-0 rounded p-0.5 text-[var(--wd-dim)] opacity-0 hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)] group-hover:opacity-100"
                  aria-label={`Close ${tab.title}`}
                >
                  <CloseIcon size={11} />
                </button>

                {menuFor === tab.id && (
                  <TabMenu
                    onClose={() => setMenuFor(null)}
                    inGroup={Boolean(group)}
                    onGroup={() => groupTabs([tab.id])}
                    onUngroup={() => ungroupTab(tab.id)}
                    onCloseTab={() => closeTab(tab.id)}
                  />
                )}
              </div>
            )}
          </Fragment>
        )
      })}

      <button
        onClick={() => newTab()}
        className="wd-icon no-drag shrink-0"
        style={{ width: 26, height: 26 }}
        aria-label="New tab"
      >
        +
      </button>
    </div>
  )
}

/** A group's label: click to collapse, ⋯ to rename, recolour or ungroup. */
function GroupChip({ group, count }: { group: TabGroup; count: number }): React.JSX.Element {
  const toggleTabGroup = useShellStore((s) => s.toggleTabGroup)
  const renameTabGroup = useShellStore((s) => s.renameTabGroup)
  const setTabGroupColor = useShellStore((s) => s.setTabGroupColor)
  const removeTabGroup = useShellStore((s) => s.removeTabGroup)
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )
  const colors = TAB_GROUP_COLORS[group.color]

  return (
    <div ref={ref} className="relative mb-1 flex shrink-0 items-center">
      {renaming !== null ? (
        <input
          autoFocus
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => setRenaming(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              renameTabGroup(group.id, renaming.trim() || group.name)
              setRenaming(null)
            }
            if (e.key === 'Escape') setRenaming(null)
          }}
          className={`h-6 w-24 rounded-md px-2 text-[11px] font-semibold outline-none ${colors.chip}`}
        />
      ) : (
        <button
          onClick={() => toggleTabGroup(group.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
          className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold ${colors.chip}`}
          title={`${group.name} — click to ${group.collapsed ? 'expand' : 'collapse'}`}
          data-testid="tab-group-chip"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
          {group.name}
          {group.collapsed && <span className="opacity-60">{count}</span>}
        </button>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="px-1 text-[11px] text-slate-400 hover:text-slate-600"
        aria-label={`${group.name} options`}
      >
        ⋯
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-50 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-[11px] shadow-xl dark:border-slate-700 dark:bg-[#0e1420]">
          <button
            onClick={() => {
              setOpen(false)
              setRenaming(group.name)
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Rename
          </button>
          <div className="flex gap-1 px-3 py-1.5">
            {(Object.keys(TAB_GROUP_COLORS) as TabGroupColor[]).map((color) => (
              <button
                key={color}
                onClick={() => setTabGroupColor(group.id, color)}
                className={`h-4 w-4 rounded-full ${TAB_GROUP_COLORS[color].dot} ${
                  color === group.color ? 'ring-2 ring-slate-400 ring-offset-1' : ''
                }`}
                aria-label={color}
              />
            ))}
          </div>
          <button
            onClick={() => {
              setOpen(false)
              removeTabGroup(group.id)
            }}
            className="block w-full px-3 py-1.5 text-left text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Ungroup all
          </button>
        </div>
      )}
    </div>
  )
}

/** Right-click menu on a tab. */
function TabMenu({
  onClose,
  inGroup,
  onGroup,
  onUngroup,
  onCloseTab
}: {
  onClose: () => void
  inGroup: boolean
  onGroup: () => void
  onUngroup: () => void
  onCloseTab: () => void
}): React.JSX.Element {
  const ref = usePopover(true, onClose)
  const item =
    'block w-full px-3 py-1.5 text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800'

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-full z-50 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-[#0e1420]"
      data-testid="tab-menu"
    >
      {inGroup ? (
        <button
          className={item}
          onClick={() => {
            onUngroup()
            onClose()
          }}
        >
          Remove from group
        </button>
      ) : (
        <button
          className={item}
          onClick={() => {
            onGroup()
            onClose()
          }}
        >
          Add to new group
        </button>
      )}
      <button
        className={`${item} text-rose-500`}
        onClick={() => {
          onCloseTab()
          onClose()
        }}
      >
        Close tab
      </button>
    </div>
  )
}

export type { BrowserTab }
