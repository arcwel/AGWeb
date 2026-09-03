import { useEffect, useMemo, useState } from 'react'
import { SEARCH_ENGINES, searchUrlFor } from '@shared/ipc'
import { useShellStore } from '@/store'
import {
  asDirectUrl,
  askQuery,
  askSuggestion,
  buildSuggestions,
  looksLikeQuestion,
  type Suggestion
} from '@/omnibox-rank'
import { HistoryIcon, SearchIcon, StarFilledIcon } from '@/components/browser-icons'
import { GlobeIcon } from '@/components/icons'

/** Stable ids so the input's aria-controls / aria-activedescendant can point here. */
export const OMNIBOX_LISTBOX_ID = 'omnibox-listbox'
export function omniboxOptionId(index: number): string {
  return `omnibox-option-${index}`
}

const DEBOUNCE_MS = 120

/** The search engine chosen in Settings — read synchronously, DuckDuckGo default. */
export function currentSearchEngine(): string {
  try {
    return window.agweb.appSettings.readSync().searchEngine || 'duckduckgo'
  } catch {
    return 'duckduckgo'
  }
}

/**
 * Debounced, ranked suggestions for the current omnibox input. Reads the active
 * profile's history and bookmarks straight from the shell store — no new
 * backend — and rebuilds only when the debounced query or those slices change.
 */
export function useOmniboxSuggestions(query: string, enabled: boolean): Suggestion[] {
  const bookmarks = useShellStore((s) => s.bookmarks)
  const history = useShellStore((s) => s.history)
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  return useMemo(() => {
    if (!enabled) return []
    const q = debounced.trim()
    if (!q) return []
    const engineId = currentSearchEngine()
    const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]
    const base = buildSuggestions({
      query: q,
      history,
      bookmarks,
      directUrl: asDirectUrl(q),
      searchEngineName: engine.name,
      searchUrl: searchUrlFor(engineId, q)
    })
    // Question-like input gets an "Ask AI" row on top; normal URL/search/history
    // rows stay exactly as they were for everything else.
    return looksLikeQuestion(q) ? [askSuggestion(askQuery(q)), ...base] : base
  }, [enabled, debounced, history, bookmarks])
}

/** Wrap the first case-insensitive occurrence of `query` in an accent span. */
function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <span className="wd-omnibox-mark">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  )
}

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  url: 'Open',
  history: 'History',
  bookmark: 'Bookmark',
  search: 'Search',
  ask: 'Ask AI'
}

/** A small sparkle mark for the AI answer affordance. */
function SparkleIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2zm6.5 11l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
    </svg>
  )
}

function KindIcon({ kind }: { kind: Suggestion['kind'] }): React.JSX.Element {
  switch (kind) {
    case 'history':
      return <HistoryIcon size={15} />
    case 'bookmark':
      return <StarFilledIcon size={15} />
    case 'search':
      return <SearchIcon size={15} />
    case 'ask':
      return <SparkleIcon size={15} />
    default:
      return <GlobeIcon size={15} />
  }
}

interface OmniboxDropdownProps {
  suggestions: readonly Suggestion[]
  selectedIndex: number
  query: string
  onHover: (index: number) => void
  onPick: (suggestion: Suggestion) => void
}

/**
 * Presentational listbox rendered under the URL bar. Navigation is the caller's
 * job (via onPick) so this component never imports the toolbar's navigate path.
 */
export function OmniboxDropdown({
  suggestions,
  selectedIndex,
  query,
  onHover,
  onPick
}: OmniboxDropdownProps): React.JSX.Element {
  return (
    <div
      id={OMNIBOX_LISTBOX_ID}
      role="listbox"
      aria-label="Address suggestions"
      className="wd-omnibox-pop glass absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(24rem,calc(100vh-7rem))] overflow-y-auto rounded-[14px] py-1"
    >
      {suggestions.map((suggestion, index) => {
        const selected = index === selectedIndex
        const isAsk = suggestion.kind === 'ask'
        return (
          <button
            key={suggestion.id}
            id={omniboxOptionId(index)}
            role="option"
            aria-selected={selected}
            type="button"
            // Keep focus on the input so the click lands before onBlur closes us.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(suggestion)}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
              selected ? 'bg-[var(--wd-accent-soft)]' : 'hover:bg-[var(--wd-hover)]'
            }`}
            data-testid={`omnibox-option-${suggestion.kind}`}
          >
            <span
              className={`flex h-4 w-4 flex-none items-center justify-center overflow-hidden ${
                isAsk ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'
              }`}
            >
              {suggestion.favicon ? (
                <img src={suggestion.favicon} alt="" className="h-4 w-4 rounded-sm" />
              ) : (
                <KindIcon kind={suggestion.kind} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] text-[var(--wd-text)]">
                {isAsk ? suggestion.title : highlightMatch(suggestion.title, query)}
              </span>
              {suggestion.secondary && (
                <span
                  className={`block truncate text-[10.5px] ${
                    isAsk ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'
                  }`}
                >
                  {isAsk ? suggestion.secondary : highlightMatch(suggestion.secondary, query)}
                </span>
              )}
            </span>
            <span className="wd-cap flex-none pl-1">{KIND_LABEL[suggestion.kind]}</span>
          </button>
        )
      })}
    </div>
  )
}
