import { useShellStore, type BlockInstance } from '@/store'
import { useThemeEffect } from '@/theme'
import { BlockContent } from '@/components/BlockContent'
import { DockInIcon, GripIcon } from '@/components/icons'

/**
 * One floating block group in its own frameless window. The header is a
 * window drag region; "dock" returns the group to the browser window.
 */
export function FloatWindow({ groupId }: { groupId: string }): React.JSX.Element {
  useThemeEffect()
  const group = useShellStore((s) => s.groups.find((g) => g.id === groupId))
  const blocks = useShellStore((s) => s.blocks)
  const activateBlock = useShellStore((s) => s.activateBlock)
  const moveGroup = useShellStore((s) => s.moveGroup)

  if (!group) {
    // Docked back or dissolved — the main window closes this window shortly.
    return <div className="h-full bg-slate-100 dark:bg-[#0b0f14]" />
  }

  const members = group.blockIds.map((id) => blocks[id]).filter(Boolean) as BlockInstance[]
  const active = blocks[group.activeBlockId] ?? members[0]

  return (
    <div className="flex h-full flex-col border border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-[#0e1420] dark:text-slate-100">
      <div className="drag-region flex h-9 flex-none items-center gap-1 border-b border-slate-200 px-2.5 dark:border-slate-800">
        <GripIcon className="mr-1 shrink-0 text-slate-400 dark:text-slate-600" />
        {members.map((block) => (
          <button
            key={block.id}
            onClick={() => activateBlock(group.id, block.id)}
            className={`no-drag flex h-full items-center px-2.5 text-[11px] font-bold uppercase tracking-wider ${
              block.id === active?.id
                ? 'border-b-2 border-sky-500 text-slate-700 dark:text-slate-200'
                : 'font-semibold text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
            }`}
          >
            {block.title}
          </button>
        ))}
        <button
          onClick={() => moveGroup(group.id, { kind: 'zone', zone: 'right' })}
          className="no-drag ml-auto flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Dock back"
          title="Dock back into the browser window"
        >
          <DockInIcon />
          <span>Dock</span>
        </button>
      </div>
      <div className="min-h-0 flex-1">{active && <BlockContent block={active} />}</div>
    </div>
  )
}
