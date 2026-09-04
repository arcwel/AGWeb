import { useEffect, useRef, useState } from 'react'
import type { AskProvider, AskSource } from '@shared/ipc'
import { ProseTurn } from '@/components/TranscriptTurn'
import { CloseIcon, GlobeIcon } from '@/components/icons'

/**
 * The omnibox AI answer panel (roadmap A1).
 *
 * Chosen from the "Ask AI" row, it takes over the same dropdown surface under
 * the address bar and streams a one-shot answer inline — no tab switch, no
 * agent session. Tokens arrive on `agents.onAskToken` (keyed by a per-ask id so
 * a stale stream can't bleed into a newer question); the `ask` promise settles
 * with the whole text and the links it referenced.
 *
 * State is local by design — the toolbar owns nothing but "which query is open".
 */

interface AiAnswerProps {
  /** The (already `?`-stripped) question to answer. */
  query: string
  /** Active page context, so "what does this page say" can be grounded. */
  url?: string
  title?: string
  /** Open a referenced link (routes through the toolbar's navigate path). */
  onOpen: (url: string) => void
  /** Dismiss the panel (Esc or the close button). */
  onClose: () => void
}

type AskState = 'streaming' | 'done' | 'error'

const PROVIDER_LABEL: Record<AskProvider, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini'
}

export function AiAnswer({ query, url, title, onOpen, onClose }: AiAnswerProps): React.JSX.Element {
  // Which model answers. Gemini is offered only when a key is configured — a
  // button that can only ever say "no key" is worse than no button.
  const [provider, setProvider] = useState<AskProvider>('anthropic')
  const [geminiAvailable, setGeminiAvailable] = useState(false)
  useEffect(() => {
    let live = true
    void window.agweb.agents
      .geminiAvailable()
      .then((yes) => live && setGeminiAvailable(yes))
      .catch(() => live && setGeminiAvailable(false))
    return () => {
      live = false
    }
  }, [])
  const [text, setText] = useState('')
  const [sources, setSources] = useState<AskSource[]>([])
  const [state, setState] = useState<AskState>('streaming')
  const [error, setError] = useState<string | null>(null)

  // Snapshot page context so a background title/url update can't restart the
  // stream — only a new question (query change) should.
  const contextRef = useRef({ url, title })
  useEffect(() => {
    contextRef.current = { url, title }
  }, [url, title])

  // The in-flight ask id, so the Stop button and the teardown can abort the
  // backend stream (not just ignore its late result). Kept in a ref because the
  // Stop handler lives outside the effect.
  const askIdRef = useRef('')

  useEffect(() => {
    const askId = `ask-${crypto.randomUUID()}`
    askIdRef.current = askId
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText('')
    setSources([])
    setState('streaming')
    setError(null)

    const off = window.agweb.agents.onAskToken(({ askId: incoming, token }) => {
      if (cancelled || incoming !== askId) return
      setText((prev) => prev + token)
    })

    window.agweb.agents
      .ask(askId, query, contextRef.current, provider)
      .then((result) => {
        if (cancelled) return
        // Cancelled by the user (Stop): stop the spinner and keep the partial
        // text already streamed — not an error.
        if (result.cancelled) {
          setState('done')
          return
        }
        if (result.error) {
          setError(result.error)
          setState('error')
          return
        }
        // The settled text is authoritative — it replaces the streamed
        // accumulation, so a dropped delta never leaves a gap.
        setText(result.text)
        setSources(result.sources)
        setState('done')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setState('error')
      })

    return () => {
      cancelled = true
      off()
      // Abort the backend stream so it stops burning tokens the moment the
      // panel closes or the question changes. A no-op if it already settled.
      void window.agweb.agents.cancel(askId)
    }
    // `provider` is a dependency on purpose: switching model re-asks.
  }, [query, provider])

  // Stop the stream but keep the panel open: the ask() promise then settles with
  // `cancelled: true`, which stops the spinner above.
  const onStop = (): void => {
    if (askIdRef.current) void window.agweb.agents.cancel(askIdRef.current)
  }

  return (
    <div
      className="wd-omnibox-pop glass absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(28rem,calc(100vh-7rem))] overflow-y-auto rounded-[14px]"
      role="region"
      aria-label="AI answer"
    >
      <div className="flex items-start gap-2 border-b border-[var(--wd-hairline)] px-3 py-2">
        <span className="mt-px flex-none text-[var(--wd-accent)]">
          <SparkleIcon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-[var(--wd-text)]">
            {query}
          </span>
          <span className="block text-[10.5px] text-[var(--wd-dim)]">
            {state === 'streaming'
              ? `${PROVIDER_LABEL[provider]} is answering…`
              : state === 'error'
                ? 'Could not answer'
                : `Answered by ${PROVIDER_LABEL[provider]}`}
          </span>
        </span>
        {/* Ask the other model the same question. Re-runs the stream, because
            the answer is the point — not a second opinion pasted underneath. */}
        {geminiAvailable && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setProvider(provider === 'gemini' ? 'anthropic' : 'gemini')}
            className="flex-none whitespace-nowrap rounded-md border border-[var(--wd-glass-border)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
            title={
              provider === 'gemini'
                ? 'Answer this with Claude instead'
                : 'Answer this with Gemini instead'
            }
            data-testid="ask-gemini"
          >
            {provider === 'gemini' ? 'Ask Claude' : 'Ask Gemini'}
          </button>
        )}
        {state === 'streaming' && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onStop}
            className="wd-icon flex-none"
            aria-label="Stop answering"
            title="Stop"
          >
            <StopIcon size={12} />
          </button>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          className="wd-icon flex-none"
          aria-label="Close answer"
          title="Close (Esc)"
        >
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="px-3 py-2">
        {state === 'error' ? (
          <p className="text-[12px] text-rose-500">{error}</p>
        ) : text ? (
          <ProseTurn text={text} streaming={state === 'streaming'} />
        ) : (
          <ThinkingSkeleton />
        )}

        {sources.length > 0 && (
          <div className="mt-2.5 border-t border-[var(--wd-hairline)] pt-2">
            <p className="wd-cap mb-1">Sources</p>
            <ul className="flex flex-col gap-0.5">
              {sources.map((source) => (
                <li key={source.url}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onOpen(source.url)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--wd-hover)]"
                  >
                    <span className="flex-none text-[var(--wd-dim)]">
                      <GlobeIcon size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] text-[var(--wd-text)]">
                        {source.title}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--wd-dim)]">
                        {source.url}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/** A subtle three-line shimmer while the first token is still in flight. */
function ThinkingSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 py-0.5" aria-label="Thinking">
      <span className="h-2.5 w-11/12 animate-pulse rounded bg-[var(--wd-hover)]" />
      <span className="h-2.5 w-4/5 animate-pulse rounded bg-[var(--wd-hover)]" />
      <span className="h-2.5 w-2/3 animate-pulse rounded bg-[var(--wd-hover)]" />
    </div>
  )
}

/** A filled square — the universal "stop", distinct from the close X beside it. */
function StopIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

/** Local copy of the omnibox sparkle so this panel owns its own header mark. */
function SparkleIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2zm6.5 11l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
    </svg>
  )
}
