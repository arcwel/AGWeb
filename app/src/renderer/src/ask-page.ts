import type { AgentAttachment } from '@shared/agents'
import { useShellStore } from '@/store'
import { pageText } from '../../webui/shell'

/**
 * The Ask button: the agent, pointed at the page you are looking at.
 *
 * Chrome's equivalent is its Gemini side panel, which is compiled out of an
 * unbranded Chromium and loads a Google-hosted client, so it is not something
 * this browser can carry. This does the same job with our own agent: it takes a
 * snapshot of the active tab's visible text, brings the Agents block forward,
 * and pre-attaches the page so the agent reads it first. From then on the block
 * is the ordinary agent — every tool, the same permissions, the same transcript.
 *
 * The snapshot is taken here, in the renderer, because the core has no view of
 * the user's tabs except through the browser; the text is data for the model to
 * answer from, capped in the core's sanitiser.
 */
export async function askAboutPage(): Promise<void> {
  const store = useShellStore.getState()
  const tab = store.tabs.find((t) => t.id === store.activeTabId)
  const state = tab ? store.browserStates[tab.id] : undefined
  const url = state?.url ?? ''
  const title = state?.title || tab?.title || ''

  let excerpt = ''
  if (tab && tab.kind === 'web' && /^https?:/i.test(url)) {
    try {
      // 0 = the active tab, in the browser's own numbering.
      excerpt = await pageText.get(0)
    } catch {
      // Off the fork there is no page reader; the agent still gets the URL.
      excerpt = ''
    }
  }

  const attachments: AgentAttachment[] =
    url && /^https?:/i.test(url)
      ? [{ path: url, kind: 'page', title, excerpt: excerpt.slice(0, 12_000) }]
      : []

  store.revealAgents()
  store.loadDraft('', attachments)
}
