import type { BlockInstance } from '@/store'
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

/** Content for each block type. */
export function BlockContent({ block }: { block: BlockInstance }): React.JSX.Element {
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
  }
}
