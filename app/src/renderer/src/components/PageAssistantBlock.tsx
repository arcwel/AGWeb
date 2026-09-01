import { useEffect, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { ProseTurn } from '@/components/TranscriptTurn'
import { GlobeIcon, SendIcon } from '@/components/icons'
import { pageText as shellPageText } from '../../../webui/shell'

/**
 * Page Assistant block — "Chat with this page" (roadmap A4).
 *
 * A user-facing surface that answers questions about the tab the user is
 * looking at: summarize, extract, Q&A. Distinct from the Mission-Control agent
 * (which drives isolated agent tabs) — this reads the ACTIVE staged tab and
 * never acts.
 *
 * Flow: it reads the active tab's rendered text over the Mojo Shell
 * (`pageText.get(0)`) when it opens and whenever the page changes, then hands
 * that text plus the question to `agents.chatPage`, which streams a grounded
 * answer keyed by a per-chat id. The page text is treated as DATA — the system
 * prompt (main/agent.ts) forbids following instructions embedded in it, and
 * there are no tools/actions for injected text to reach.
 *
 * Off the fork there is no Mojo Shell, so `pageText.get` rejects; the block
 * degrades to chatting with empty page text (and says so) rather than surfacing
 * a wiring error — which is also what makes it verifiable under AGWEB_AGENT_MOCK.
 */

type ChatState = 'idle' | 'reading' | 'streaming' | 'done' | 'error'

export function PageAssistantBlock(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const browserStates = useShellStore((s) => s.browserStates)
  const active = browserStates[activeTabId]
  const url = active?.url && !/^about:/i.test(active.url) ? active.url : undefined
  const title = active?.title || undefined

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [state, setState] = useState<ChatState>('idle')
  const [error, setError] = useState<string | null>(null)
  /** How many chars we read from the page, and whether the read was possible. */
  const [pageChars, setPageChars] = useState<number | null>(null)
  const [pageUnavailable, setPageUnavailable] = useState(false)

  // The freshest page text, and the chat currently streaming. Refs so the token
  // listener and async flow read live values without re-subscribing per render.
  const pageTextRef = useRef('')
  const chatIdRef = useRef('')

  // Read the page text on open and whenever the active page changes, so the
  // block always reflects what the user is looking at. Errors (off-fork, no
  // Shell) degrade to empty text with a visible note rather than throwing.
  useEffect(() => {
    let cancelled = false
    void shellPageText
      .get(0)
      .then((text) => {
        if (cancelled) return
        pageTextRef.current = text
        setPageChars(text.length)
        setPageUnavailable(false)
      })
      .catch(() => {
        if (cancelled) return
        pageTextRef.current = ''
        setPageChars(0)
        setPageUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [activeTabId, url])

  // One token listener for the block's lifetime; it appends only the tokens of
  // the chat that is currently streaming (chatIdRef), so a stale stream from a
  // superseded question can never bleed into a newer answer.
  useEffect(() => {
    const off = window.agweb.agents.onChatPageToken(({ chatId, token }) => {
      if (chatId !== chatIdRef.current) return
      setAnswer((prev) => prev + token)
    })
    return off
  }, [])

  // If the block unmounts mid-stream, abort the backend so it stops burning
  // tokens rather than merely being ignored. A no-op once the chat has settled.
  useEffect(() => {
    return () => {
      if (chatIdRef.current) void window.agweb.agents.cancel(chatIdRef.current)
    }
  }, [])

  const runChat = async (q: string): Promise<void> => {
    const trimmed = q.trim()
    if (!trimmed || state === 'reading' || state === 'streaming') return

    const chatId = `chat-${crypto.randomUUID()}`
    chatIdRef.current = chatId
    setAnswer('')
    setError(null)
    setState('reading')

    // Re-read the page right before asking so the answer grounds on the current
    // DOM (the page may have changed since the block last read it).
    let text = pageTextRef.current
    try {
      text = await shellPageText.get(0)
      pageTextRef.current = text
      setPageChars(text.length)
      setPageUnavailable(false)
    } catch {
      // Keep the last-known text (usually empty off-fork); note it below.
      setPageUnavailable(true)
    }
    if (chatIdRef.current !== chatId) return // superseded while reading

    setState('streaming')
    try {
      const result = await window.agweb.agents.chatPage(chatId, trimmed, text, url, title)
      if (chatIdRef.current !== chatId) return
      // Cancelled by the user (Stop): drop back to idle and keep the partial
      // answer already streamed — not an error.
      if (result.cancelled) {
        setState('idle')
        return
      }
      if (result.error) {
        setError(result.error)
        setState('error')
        return
      }
      // The settled text is authoritative — it replaces the streamed
      // accumulation so a dropped delta never leaves a gap.
      setAnswer(result.text)
      setState('done')
    } catch (e: unknown) {
      if (chatIdRef.current !== chatId) return
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  const onAsk = (): void => {
    if (!question.trim()) return
    void runChat(question)
  }
  const onSummarize = (): void => {
    setQuestion('')
    void runChat('Summarize this page in a few concise bullet points.')
  }
  // Stop the in-flight chat: the backend aborts and chatPage settles with
  // `cancelled: true`, which drops the block back to idle (see runChat).
  const onStop = (): void => {
    if (chatIdRef.current) void window.agweb.agents.cancel(chatIdRef.current)
  }

  const busy = state === 'reading' || state === 'streaming'

  return (
    <div className="flex h-full flex-col text-xs">
      {/* Current page */}
      <div className="flex flex-none items-center gap-2 border-b border-[var(--wd-hairline)] px-3 py-2">
        <span className="flex-none text-[var(--wd-dim)]">
          <GlobeIcon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-[var(--wd-text)]">
            {title ?? 'No page open'}
          </span>
          <span className="block truncate text-[10.5px] text-[var(--wd-dim)]">
            {pageUnavailable
              ? 'Page text unavailable on this host'
              : url
                ? pageChars !== null
                  ? `${url} · ${pageChars.toLocaleString()} chars read`
                  : url
                : 'Open a web page to chat about it'}
          </span>
        </span>
      </div>

      {/* Quick actions */}
      <div className="flex flex-none items-center gap-2 px-3 pt-2">
        <button
          type="button"
          onClick={onSummarize}
          disabled={busy}
          className="rounded-md bg-[var(--wd-accent)] px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Summarize
        </button>
        {busy && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-md border border-[var(--wd-hairline)] px-3 py-1.5 font-medium text-[var(--wd-text)] hover:bg-[var(--wd-hover)]"
            aria-label="Stop answering"
            title="Stop"
          >
            <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
            Stop
          </button>
        )}
      </div>

      {/* Answer */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {state === 'error' ? (
          <p className="text-[12px] text-rose-500">{error}</p>
        ) : answer ? (
          <ProseTurn text={answer} streaming={state === 'streaming'} />
        ) : state === 'reading' ? (
          <p className="text-[11px] text-[var(--wd-dim)]">Reading the page…</p>
        ) : (
          <p className="text-[11px] text-[var(--wd-dim)]">
            Ask a question about this page, or hit Summarize.
          </p>
        )}
      </div>

      {/* Composer */}
      <div className="flex flex-none items-end gap-2 border-t border-[var(--wd-hairline)] p-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onAsk()
            }
          }}
          rows={1}
          placeholder="Ask about this page…"
          className="min-h-[34px] min-w-0 flex-1 resize-none rounded-md border border-[var(--wd-hairline)] bg-[var(--wd-input,transparent)] px-2.5 py-1.5 text-[12px] text-[var(--wd-text)] outline-none focus:border-[var(--wd-accent)]"
        />
        <button
          type="button"
          onClick={onAsk}
          disabled={busy || !question.trim()}
          className="flex-none rounded-md bg-[var(--wd-accent)] px-3 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
          aria-label="Ask"
          title="Ask (Enter)"
        >
          <SendIcon size={14} />
        </button>
      </div>
    </div>
  )
}
