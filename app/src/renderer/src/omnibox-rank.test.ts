import { describe, it, expect } from 'vitest'
import {
  looksLikeQuestion,
  askQuery,
  askSuggestion,
  asDirectUrl,
  buildSuggestions,
  type HistoryEntry,
  type BookmarkEntry,
  type BuildSuggestionsArgs,
  type Suggestion
} from './omnibox-rank'

/**
 * omnibox-rank is the pure URL-vs-search-vs-"Ask AI" decision behind the address
 * bar. Every expected value below is derived from the scoring constants in the
 * source (BOOKMARK_BOOST 140, frequency cap 25 visits * weight 5 = 125) and the
 * scoreMatch tiers (host-exact 1000 > host-prefix 950 > bare-prefix 900 >
 * host-substring 650 > title-prefix 600 > bare-substring 500 > title-substring
 * 450), not from guessing.
 */

/** Build a HistoryEntry, defaulting the fields a given test does not care about. */
function history(partial: Partial<HistoryEntry> & { url: string }): HistoryEntry {
  return {
    title: '',
    visitCount: 1,
    lastVisit: 0,
    ...partial
  }
}

/** Minimal args so each test overrides only the fields under test. */
function args(partial: Partial<BuildSuggestionsArgs> & { query: string }): BuildSuggestionsArgs {
  return {
    history: [],
    bookmarks: [],
    directUrl: null,
    searchEngineName: 'Google',
    searchUrl: 'https://www.google.com/search?q=x',
    ...partial
  }
}

/** The non-search rows, in order — the ranking under test without the trailing search row. */
function rankedUrls(out: Suggestion[]): string[] {
  return out.filter((s) => s.kind !== 'search').map((s) => s.url)
}

describe('looksLikeQuestion', () => {
  it('treats an explicit "?" prefix as a question (the power-user opt-in)', () => {
    // Arrange / Act / Assert
    expect(looksLikeQuestion('?best pizza near me')).toBe(true)
  })

  it('treats a trailing "?" as a question', () => {
    expect(looksLikeQuestion('this is real?')).toBe(true)
  })

  it('treats a wh-word first token in a multi-word phrase as a question', () => {
    expect(looksLikeQuestion('what is rust')).toBe(true)
  })

  it('does NOT treat a bare single wh-word as a question', () => {
    // words.length < 2 short-circuits before the QUESTION_WORDS check.
    expect(looksLikeQuestion('what')).toBe(false)
  })

  it('does NOT treat a one-word domain like "how.gg" as a question', () => {
    // The documented edge: no space means one word, so the wh-word rule is skipped.
    expect(looksLikeQuestion('how.gg')).toBe(false)
  })

  it('returns false for input shorter than two characters', () => {
    expect(looksLikeQuestion('?')).toBe(false)
    expect(looksLikeQuestion('a')).toBe(false)
  })
})

describe('askQuery', () => {
  it('strips a leading "?" opt-in marker and surrounding whitespace', () => {
    expect(askQuery('?  what is x')).toBe('what is x')
  })

  it('trims a plain query with no marker', () => {
    expect(askQuery('  hello world  ')).toBe('hello world')
  })
})

describe('askSuggestion', () => {
  it('builds a non-navigating ask row keyed on the query', () => {
    const s = askSuggestion('why is the sky blue')
    expect(s).toEqual({
      id: 'ask:why is the sky blue',
      kind: 'ask',
      url: '',
      title: 'why is the sky blue',
      secondary: 'Answer inline with AI'
    })
  })
})

describe('asDirectUrl', () => {
  it('defaults a local dev host to http (localhost:3000 -> http://localhost:3000)', () => {
    expect(asDirectUrl('localhost:3000')).toBe('http://localhost:3000')
  })

  it('defaults a bare public host to https (example.com -> https://example.com)', () => {
    expect(asDirectUrl('example.com')).toBe('https://example.com')
  })

  it("navigates to the browser's own pages instead of searching for them", () => {
    // Typing chrome://settings/passwords used to be handed to the search
    // engine as a query, which made Chromium's password manager, autofill and
    // payment settings unreachable by the one route every user tries.
    expect(asDirectUrl('chrome://settings/passwords')).toBe('chrome://settings/passwords')
    expect(asDirectUrl('chrome://password-manager')).toBe('chrome://password-manager')
    expect(asDirectUrl('chrome://settings/autofill')).toBe('chrome://settings/autofill')
  })

  it('returns null for plain words that are not a host', () => {
    expect(asDirectUrl('just words')).toBeNull()
  })

  it('passes an explicit https:// scheme through unchanged', () => {
    expect(asDirectUrl('https://example.com/path')).toBe('https://example.com/path')
  })

  it('returns null for empty / whitespace-only input', () => {
    expect(asDirectUrl('   ')).toBeNull()
  })
})

describe('buildSuggestions ordering by match tier', () => {
  it('ranks host-prefix above host-substring above title-only', () => {
    // Arrange: equal visit counts so only the match tier separates the three.
    const hostPrefix = history({ url: 'https://maps.google.com', title: 'Google Maps' }) // 950
    const hostSubstring = history({ url: 'https://sitemap.org', title: 'Sitemap' }) // 650
    const titleOnly = history({ url: 'https://example.net', title: 'Treasure Map' }) // 450

    // Act: pass them in reverse of the expected order to prove sorting.
    const out = buildSuggestions(
      args({ query: 'map', history: [titleOnly, hostSubstring, hostPrefix] })
    )

    // Assert
    expect(rankedUrls(out)).toEqual([
      'https://maps.google.com',
      'https://sitemap.org',
      'https://example.net'
    ])
  })
})

describe('buildSuggestions bookmark boost', () => {
  it('floats a bookmark above an equal-match history entry', () => {
    // Both match by host-prefix (950). BOOKMARK_BOOST (140) beats the history
    // entry's frequency bonus (10 visits -> capped contribution 50).
    const bookmark: BookmarkEntry = { url: 'https://news.ycombinator.com', title: 'HN' }
    const hist = history({ url: 'https://news.bbc.co.uk', title: 'BBC News', visitCount: 10 })

    const out = buildSuggestions(args({ query: 'news', history: [hist], bookmarks: [bookmark] }))

    expect(rankedUrls(out)).toEqual(['https://news.ycombinator.com', 'https://news.bbc.co.uk'])
    expect(out[0].kind).toBe('bookmark')
    expect(out[1].kind).toBe('history')
  })
})

describe('buildSuggestions frequency bonus is capped', () => {
  it('keeps a higher-tier match ahead of a low-tier match with a huge visit count', () => {
    // Uncapped, 100000 visits would dominate. The cap (25 visits * 5 = 125)
    // keeps the host-prefix match (950 + 5) ahead of the bare-substring match
    // (500 + 125).
    const higherTierFewVisits = history({
      url: 'https://testing.io',
      title: 'Testing',
      visitCount: 1
    })
    const lowerTierManyVisits = history({
      url: 'https://a.io/testbed',
      title: 'zzz',
      visitCount: 100000
    })

    const out = buildSuggestions(
      args({ query: 'test', history: [lowerTierManyVisits, higherTierFewVisits] })
    )

    expect(rankedUrls(out)).toEqual(['https://testing.io', 'https://a.io/testbed'])
  })

  it('leaves two entries tied on a capped bonus to be broken by recency (newer first)', () => {
    // 25 and 100000 visits both cap at 125, so equal match tier -> recency wins.
    const older = history({
      url: 'https://cap-a.com',
      title: 'Cap A',
      visitCount: 25,
      lastVisit: 1000
    })
    const newer = history({
      url: 'https://cap-b.com',
      title: 'Cap B',
      visitCount: 100000,
      lastVisit: 2000
    })

    const out = buildSuggestions(args({ query: 'cap', history: [older, newer] }))

    expect(rankedUrls(out)).toEqual(['https://cap-b.com', 'https://cap-a.com'])
  })
})

describe('buildSuggestions de-duplication by normalized URL', () => {
  it('collapses entries that differ only by a trailing slash, keeping the higher-ranked one', () => {
    // Bookmark (with boost) and history point at the same normalized URL.
    const bookmark: BookmarkEntry = { url: 'https://dup.com', title: 'Dup Bookmark' }
    const hist = history({ url: 'https://dup.com/', title: 'Dup History', visitCount: 5 })

    const out = buildSuggestions(args({ query: 'dup', history: [hist], bookmarks: [bookmark] }))

    const dupRows = out.filter((s) => s.kind === 'bookmark' || s.kind === 'history')
    expect(dupRows).toHaveLength(1)
    expect(dupRows[0].kind).toBe('bookmark')
  })

  it('does not repeat a history entry already shown as the direct-URL row', () => {
    const hist = history({ url: 'https://direct.com/', title: 'Direct' })

    const out = buildSuggestions(
      args({ query: 'direct', history: [hist], directUrl: 'https://direct.com' })
    )

    // The url row is present; the trailing-slash history duplicate is suppressed.
    expect(out.filter((s) => s.kind === 'url')).toHaveLength(1)
    expect(out.filter((s) => s.kind === 'history')).toHaveLength(0)
  })
})

describe('buildSuggestions search row placement', () => {
  it('appends the search row last with the engine label and original-case query', () => {
    const out = buildSuggestions(
      args({
        query: 'Rust Lang',
        history: [history({ url: 'https://rust-lang.org', title: 'Rust' })],
        searchEngineName: 'DuckDuckGo',
        searchUrl: 'https://duckduckgo.com/?q=Rust+Lang'
      })
    )

    const last = out[out.length - 1]
    expect(last.kind).toBe('search')
    expect(last.url).toBe('https://duckduckgo.com/?q=Rust+Lang')
    expect(last.title).toBe('Search DuckDuckGo for “Rust Lang”')
  })

  it('leads with the direct-URL row and ends with the search row', () => {
    const out = buildSuggestions(
      args({
        query: 'example.com',
        directUrl: 'https://example.com',
        history: [history({ url: 'https://example.com', title: 'Example', visitCount: 3 })]
      })
    )

    expect(out[0].kind).toBe('url')
    expect(out[out.length - 1].kind).toBe('search')
  })

  it('reserves the final slot for the search row, capping total rows at limit', () => {
    // Five matches but limit 3: at most 2 ranked rows, then the search row.
    const hist: HistoryEntry[] = [
      history({ url: 'https://test1.com', title: 'One', visitCount: 5 }),
      history({ url: 'https://test2.com', title: 'Two', visitCount: 4 }),
      history({ url: 'https://test3.com', title: 'Three', visitCount: 3 }),
      history({ url: 'https://test4.com', title: 'Four', visitCount: 2 }),
      history({ url: 'https://test5.com', title: 'Five', visitCount: 1 })
    ]

    const out = buildSuggestions(args({ query: 'test', history: hist, limit: 3 }))

    expect(out).toHaveLength(3)
    expect(out.filter((s) => s.kind === 'history')).toHaveLength(2)
    expect(out[out.length - 1].kind).toBe('search')
  })
})

describe('buildSuggestions empty query', () => {
  it('returns no suggestions for an empty query', () => {
    expect(buildSuggestions(args({ query: '' }))).toEqual([])
  })

  it('returns no suggestions for a whitespace-only query', () => {
    expect(buildSuggestions(args({ query: '   ' }))).toEqual([])
  })
})
