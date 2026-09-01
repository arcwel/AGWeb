/**
 * Pure ranking for the address-bar (omnibox) suggestions dropdown.
 *
 * Kept free of React and of `window`/store access so the ranking is trivially
 * unit-testable and reusable. The renderer wiring (debounce, store reads, the
 * dropdown itself) lives in `components/Omnibox.tsx`.
 */

/** A visited page, backing the omnibox's "History" rows. Persisted per profile. */
export interface HistoryEntry {
  url: string
  title: string
  /** The page's favicon as a data: URL, mirrored from browser state. */
  favicon?: string
  /** How many distinct visits — feeds the frequency boost in ranking. */
  visitCount: number
  /** Epoch ms of the most recent visit — the recency tie-breaker. */
  lastVisit: number
}

/** A saved bookmark, backing the omnibox's "Bookmark" rows. */
export interface BookmarkEntry {
  url: string
  title: string
}

export type SuggestionKind = 'url' | 'history' | 'bookmark' | 'search' | 'ask'

/** One rendered row in the dropdown. `url` is what navigation loads. */
export interface Suggestion {
  /** Stable React key — never an array index. */
  id: string
  kind: SuggestionKind
  url: string
  /** Primary line: page title or host. */
  title: string
  /** Muted secondary line: usually the URL. Empty for the search row. */
  secondary: string
  favicon?: string
}

export interface BuildSuggestionsArgs {
  query: string
  history: readonly HistoryEntry[]
  bookmarks: readonly BookmarkEntry[]
  /** A navigable URL when the raw input parses as one, else null (see asDirectUrl). */
  directUrl: string | null
  /** Display name of the configured search engine, for the search row label. */
  searchEngineName: string
  /** Prebuilt search URL for the query (the search row navigates here). */
  searchUrl: string
  /** Maximum rows, search row included. */
  limit?: number
}

/**
 * Local dev hosts serve plain http, so defaulting them to https would fail on
 * the address a dev-focused browser is typed into most. Mirrors the address
 * bar's own handling.
 */
export const LOCAL_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^\s/]+\.localhost)(:\d+)?(\/.*)?$/i

/**
 * Turn raw address-bar input into a navigable URL, but ONLY when it genuinely
 * looks like a URL or host — otherwise null (the caller falls back to search).
 * This is the URL-vs-search decision the "Go to <url>" row depends on.
 */
export function asDirectUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^(https?|data|about|file):/i.test(trimmed)) return trimmed
  const bare = trimmed.replace(/^https?:\/\//i, '')
  if (LOCAL_HOST_PATTERN.test(bare)) return `http://${bare}`
  if (/^[^\s]+\.[^\s/]+(\/.*)?$/.test(trimmed)) return `https://${bare}`
  return null
}

/**
 * The "Ask AI" heuristic (roadmap A1): does this input read as a question the
 * user would want answered inline, rather than a place to navigate to?
 *
 * Kept deliberately tight so it never hijacks ordinary URL/search input:
 *  - an explicit `?` prefix always opts in (the power-user escape hatch);
 *  - input ending in `?` is a question;
 *  - a wh-/aux-word first token counts only in a multi-word phrase, so a bare
 *    "what" or a domain like "how.gg" still behaves as before.
 */
const QUESTION_WORDS: ReadonlySet<string> = new Set([
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'which',
  'whose',
  'whom',
  'is',
  'are',
  'am',
  'can',
  'could',
  'do',
  'does',
  'did',
  'should',
  'would',
  'will',
  'was',
  'were'
])

export function looksLikeQuestion(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed.length < 2) return false
  if (trimmed.startsWith('?')) return true
  if (trimmed.endsWith('?')) return true
  const words = trimmed.split(/\s+/)
  if (words.length < 2) return false
  return QUESTION_WORDS.has(words[0].toLowerCase())
}

/** The question to ask, with any leading `?` opt-in marker stripped. */
export function askQuery(input: string): string {
  return input
    .trim()
    .replace(/^\?\s*/, '')
    .trim()
}

/** The synthetic top row that offers an inline AI answer for `query`. It never
 *  navigates — the toolbar opens the answer panel when this row is chosen. */
export function askSuggestion(query: string): Suggestion {
  return {
    id: `ask:${query}`,
    kind: 'ask',
    url: '',
    title: query,
    secondary: 'Answer inline with AI'
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** URL with scheme and a leading `www.` stripped, lower-cased — the match target. */
function stripScheme(url: string): string {
  return url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .toLowerCase()
}

/** Normalized key for de-duplication across sources (trailing slash ignored). */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}

/**
 * Score a candidate against the (already lower-cased) query. Higher is better;
 * a negative result means "no match, drop it". Exact/prefix host matches beat
 * substring matches, which beat title-only matches.
 */
function scoreMatch(url: string, title: string, query: string): number {
  const bareHost = hostOf(url).replace(/^www\./, '')
  const bare = stripScheme(url)
  const t = title.toLowerCase()

  if (bareHost === query) return 1000
  if (bareHost.startsWith(query)) return 950
  if (bare.startsWith(query)) return 900
  if (bareHost.includes(query)) return 650
  if (t.startsWith(query)) return 600
  if (bare.includes(query)) return 500
  if (t.includes(query)) return 450
  return -1
}

const DEFAULT_LIMIT = 8
/** Curated bookmarks outrank a same-strength history hit. */
const BOOKMARK_BOOST = 140
const MAX_FREQUENCY_BONUS_VISITS = 25
const FREQUENCY_WEIGHT = 5

/**
 * Build the ranked, de-duplicated suggestion list for a query:
 *  1. a direct "Go to <url>" row when the input parses as a URL/host,
 *  2. ranked history + bookmark matches (exact/prefix host first, then
 *     substring; bookmarks and frequently-visited history float up),
 *  3. a "Search <engine> for '<query>'" row, always last.
 */
export function buildSuggestions(args: BuildSuggestionsArgs): Suggestion[] {
  const { history, bookmarks, directUrl, searchEngineName, searchUrl } = args
  const limit = args.limit ?? DEFAULT_LIMIT
  const query = args.query.trim()
  const q = query.toLowerCase()
  if (!q) return []

  const out: Suggestion[] = []
  const seen = new Set<string>()

  // 1. Direct URL row leads when the input is itself a navigable address.
  if (directUrl) {
    const key = normalizeUrl(directUrl)
    const known = history.find((h) => normalizeUrl(h.url) === key)
    out.push({
      id: `url:${directUrl}`,
      kind: 'url',
      url: directUrl,
      title: directUrl,
      secondary: 'Open this address',
      favicon: known?.favicon
    })
    seen.add(key)
  }

  // 2. History + bookmarks, scored together.
  interface Scored {
    suggestion: Suggestion
    score: number
    recency: number
  }
  const scored: Scored[] = []

  for (const b of bookmarks) {
    if (!b.url) continue
    const match = scoreMatch(b.url, b.title || b.url, q)
    if (match < 0) continue
    scored.push({
      suggestion: {
        id: `bookmark:${b.url}`,
        kind: 'bookmark',
        url: b.url,
        title: b.title || hostOf(b.url) || b.url,
        secondary: b.url
      },
      score: match + BOOKMARK_BOOST,
      recency: Number.MAX_SAFE_INTEGER
    })
  }

  for (const h of history) {
    if (!h.url) continue
    const match = scoreMatch(h.url, h.title || h.url, q)
    if (match < 0) continue
    const frequency = Math.min(h.visitCount, MAX_FREQUENCY_BONUS_VISITS) * FREQUENCY_WEIGHT
    scored.push({
      suggestion: {
        id: `history:${h.url}`,
        kind: 'history',
        url: h.url,
        title: h.title || hostOf(h.url) || h.url,
        secondary: h.url,
        favicon: h.favicon
      },
      score: match + frequency,
      recency: h.lastVisit
    })
  }

  scored.sort((a, b) => b.score - a.score || b.recency - a.recency)

  for (const item of scored) {
    // Reserve the final slot for the search row.
    if (out.length >= limit - 1) break
    const key = normalizeUrl(item.suggestion.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item.suggestion)
  }

  // 3. Search row, always last while there is room.
  if (out.length < limit) {
    out.push({
      id: `search:${searchUrl}`,
      kind: 'search',
      url: searchUrl,
      title: `Search ${searchEngineName} for “${query}”`,
      secondary: ''
    })
  }

  return out
}
