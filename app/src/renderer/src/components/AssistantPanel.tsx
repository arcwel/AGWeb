import { AgentsBlock } from '@/components/AgentsBlock'
import { CloseIcon } from '@/components/icons'
import { useShellStore } from '@/store'

/**
 * The agent as a side panel beside the page — what the Ask button opens.
 *
 * A layout of its own rather than a Deck zone: revealing the Deck brings the
 * editor, terminal and file tree with it, which is the wrong answer to "what
 * does this page say". The panel and the Deck are independent, and the
 * workspace insets every other zone by its width so nothing is drawn over.
 */
export function AssistantPanel(): React.JSX.Element {
  const close = useShellStore((s) => s.closeAssistant)
  return (
    <aside
      className="assistant-panel glass no-drag overflow-hidden rounded-[var(--wd-r-stage)]"
      aria-label="Assistant"
      data-testid="assistant-panel"
    >
      <div className="flex flex-none items-center gap-1 border-b border-[var(--wd-glass-border)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--wd-muted)]">
          Assistant
        </span>
        <span className="flex-1" />
        <button
          onClick={close}
          className="wd-icon"
          aria-label="Close the assistant"
          title="Close"
          data-testid="assistant-close"
        >
          <CloseIcon size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AgentsBlock surface="assistant" />
      </div>
    </aside>
  )
}
