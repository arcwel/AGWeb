import { useShellStore, type BlockInstance } from '@/store'
import { EditorBlock } from '@/components/EditorBlock'
import { TerminalBlock } from '@/components/TerminalBlock'
import { FilesTree } from '@/components/FilesTree'
import { SearchBlock } from '@/components/SearchBlock'
import { AgentsBlock, LogsBlock } from '@/components/AgentsBlock'
import { PreviewBlock } from '@/components/PreviewBlock'
import { SourceControlBlock } from '@/components/SourceControlBlock'
import { TasksBlock } from '@/components/TasksBlock'
import { SettingsBlock } from '@/components/SettingsBlock'
import { DebugBlock } from '@/components/DebugBlock'
import { PageAssistantBlock } from '@/components/PageAssistantBlock'
import { GitGraphBlock } from '@/components/GitGraphBlock'
import { RestClientBlock } from '@/components/RestClientBlock'
import { DbClientBlock } from '@/components/DbClientBlock'
import { JupyterBlock } from '@/components/JupyterBlock'
import { ExtensionsBlock } from '@/components/ExtensionsBlock'
import { ExtensionViewBlock } from '@/components/ExtensionViewBlock'

/** Content for each block type. */
export function BlockContent({ block }: { block: BlockInstance }): React.JSX.Element {
  // The agent has one surface at a time. While the assistant panel is open it
  // is the agent, so a Deck block of the same kind would be a second live
  // composer over the same conversation — two of everything, one behind the
  // other. The block keeps its place in the layout and says where it went.
  const assistantOpen = useShellStore((s) => s.assistantOpen)
  if (block.type === 'agents' && assistantOpen) {
    return <AgentsMovedNotice />
  }
  switch (block.type) {
    case 'files':
      return <FilesTree />
    case 'terminal':
      return <TerminalBlock id={block.id} />
    case 'editor':
      return <EditorBlock />
    case 'search':
      return <SearchBlock />
    case 'agents':
      return <AgentsBlock />
    case 'logs':
      return <LogsBlock />
    case 'preview':
      return <PreviewBlock />
    case 'scm':
      return <SourceControlBlock />
    case 'tasks':
      return <TasksBlock />
    case 'settings':
      return <SettingsBlock />
    case 'debug':
      return <DebugBlock />
    case 'chat':
      return <PageAssistantBlock />
    case 'gitgraph':
      return <GitGraphBlock />
    case 'rest':
      return <RestClientBlock />
    case 'db':
      return <DbClientBlock />
    case 'jupyter':
      return <JupyterBlock />
    case 'extensions':
      return <ExtensionsBlock />
    case 'extview':
      return <ExtensionViewBlock containerId={block.payload?.containerId ?? ''} />
  }
}

/** Shown in a Deck agents block while the assistant panel holds the agent. */
function AgentsMovedNotice(): React.JSX.Element {
  const close = useShellStore((s) => s.closeAssistant)
  return (
    <div className="flex h-full flex-col items-start gap-2 p-4 text-[12px] text-[var(--wd-dim)]">
      <span className="font-medium text-[var(--wd-muted)]">
        The agent is in the assistant panel
      </span>
      <span className="leading-relaxed">
        Ask opened it beside the page. Close the panel to bring the conversation back into this
        block.
      </span>
      <button
        onClick={close}
        className="rounded-md border border-[var(--wd-glass-border)] px-2 py-1 text-[11px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]"
        data-testid="agents-moved-close"
      >
        Close the panel
      </button>
    </div>
  )
}
