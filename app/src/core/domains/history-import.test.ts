// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'

// Same reason as the module under test: the bundler cannot resolve a static
// import of node:sqlite.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readHistory,
  listHistorySources,
  importHistorySource,
  mergeVisits,
  looksLikeHistoryFile
} from './history-import'

/**
 * Three browsers, three ways of counting time.
 *
 * A wrong epoch does not fail: it imports every page with a date decades out,
 * omnibox ranking quietly stops working, and nobody traces it back here. So
 * each schema is built for real and read back, with a known instant going in
 * and the same instant expected out.
 */

const root = mkdtempSync(join(tmpdir(), 'wd-history-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** 2026-03-01T12:00:00Z, chosen so every conversion is checked against one instant. */
const WHEN = Date.UTC(2026, 2, 1, 12, 0, 0)

const home = join(root, 'home')
const support = join(home, 'Library', 'Application Support')

function chromeProfile(
  browserDir: string,
  profile: string,
  rows: Array<[string, string, number]>
): void {
  const dir = join(support, browserDir, profile)
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'History'))
  db.exec(
    'CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER)'
  )
  for (const [url, title, visits] of rows) {
    // Chromium counts microseconds from 1601-01-01.
    const stamp = (WHEN + 11_644_473_600_000) * 1000
    db.prepare(
      'INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)'
    ).run(url, title, visits, stamp)
  }
  db.close()
}

function firefoxProfile(profile: string, rows: Array<[string, string, number]>): void {
  const dir = join(support, 'Firefox', 'Profiles', profile)
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'places.sqlite'))
  db.exec(
    'CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)'
  )
  for (const [url, title, visits] of rows) {
    // Firefox counts microseconds from the Unix epoch.
    db.prepare(
      'INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)'
    ).run(url, title, visits, WHEN * 1000)
  }
  db.close()
}

function safariHistory(rows: Array<[string, string, number]>): void {
  const dir = join(home, 'Library', 'Safari')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'History.db'))
  db.exec('CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER)')
  db.exec(
    'CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT)'
  )
  let id = 0
  for (const [url, title, visits] of rows) {
    id += 1
    db.prepare('INSERT INTO history_items (id, url, visit_count) VALUES (?, ?, ?)').run(
      id,
      url,
      visits
    )
    // Safari counts seconds from 2001-01-01.
    db.prepare('INSERT INTO history_visits (history_item, visit_time, title) VALUES (?, ?, ?)').run(
      id,
      WHEN / 1000 - 978_307_200,
      title
    )
  }
  db.close()
}

chromeProfile(join('Google', 'Chrome'), 'Default', [
  ['https://anthropic.com/', 'Anthropic', 12],
  ['https://example.com/one', 'Example One', 3]
])
chromeProfile(join('Google', 'Chrome'), 'Profile 1', [['https://work.example/', 'Work', 5]])
firefoxProfile('abc123.default-release', [['https://mozilla.org/', 'Mozilla', 7]])
safariHistory([['https://apple.com/', 'Apple', 4]])

describe('finding what is on this machine', () => {
  it('lists every browser profile that has history', () => {
    const sources = listHistorySources(home)
    const labels = sources.map((s) => s.label).sort()

    expect(labels).toEqual([
      'Firefox — abc123.default-release',
      'Google Chrome — Default',
      'Google Chrome — Profile 1',
      'Safari'
    ])
  })

  it('says how much each holds, so the choice is informed', () => {
    const chrome = listHistorySources(home).find((s) => s.label === 'Google Chrome — Default')

    expect(chrome?.entries).toBe(2)
    expect(chrome?.error).toBeUndefined()
  })

  it('finds a second profile of the same browser separately', () => {
    const sources = listHistorySources(home)
    const ids = sources.filter((s) => s.browser === 'Google Chrome').map((s) => s.id)

    // Two profiles of one browser are two sources; merging them here would
    // import a colleague's profile alongside your own without saying so.
    expect(new Set(ids).size).toBe(2)
  })
})

describe('reading each browser back', () => {
  it('converts Chromium time, which counts from 1601', () => {
    const [entry] = importHistorySource('google-chrome::default', 10, home).entries ?? []

    expect(entry.url).toBe('https://anthropic.com/')
    expect(entry.title).toBe('Anthropic')
    expect(entry.visitCount).toBe(12)
    expect(entry.lastVisit).toBe(WHEN)
  })

  it('converts Firefox time, which counts microseconds from 1970', () => {
    const [entry] = importHistorySource('firefox::abc123.default-release', 10, home).entries ?? []

    expect(entry.url).toBe('https://mozilla.org/')
    expect(entry.lastVisit).toBe(WHEN)
  })

  it('converts Safari time, which counts from 2001', () => {
    const [entry] = importHistorySource('safari::safari', 10, home).entries ?? []

    expect(entry.url).toBe('https://apple.com/')
    expect(entry.title).toBe('Apple')
    expect(entry.lastVisit).toBe(WHEN)
  })

  it('refuses a source it does not have', () => {
    expect(importHistorySource('not-a-browser::default', 10, home).error).toMatch(/no history/)
  })

  it('honours the limit, so a huge history cannot be pulled in whole', () => {
    const entries = importHistorySource('google-chrome::default', 1, home).entries ?? []
    expect(entries).toHaveLength(1)
  })
})

describe('timestamps that cannot be real', () => {
  it('drops a row rather than importing a date from the far future', () => {
    const dir = join(support, 'Chromium', 'Default')
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'History'))
    db.exec(
      'CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER)'
    )
    // A plausible-looking file whose times are already in Unix microseconds:
    // exactly what a wrong conversion produces, and what must not be trusted.
    db.prepare(
      'INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)'
    ).run('https://wrong.example/', 'Wrong', 1, (WHEN + 11_644_473_600_000 * 2) * 1000)
    db.prepare(
      'INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)'
    ).run('https://right.example/', 'Right', 1, (WHEN + 11_644_473_600_000) * 1000)
    db.close()

    const entries = readHistory(join(dir, 'History'), 'chromium', 10)

    expect(entries.map((e) => e.url)).toEqual(['https://right.example/'])
  })
})

describe('merging into what is already here', () => {
  const existing = [
    { url: 'https://anthropic.com/', title: 'Anthropic', visitCount: 2, lastVisit: 1000 }
  ]

  it('does not double a page that both sides know', () => {
    const merged = mergeVisits(
      existing,
      [{ url: 'https://anthropic.com/', title: 'Anthropic Home', visitCount: 9, lastVisit: 5000 }],
      100
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].visitCount).toBe(9)
    expect(merged[0].lastVisit).toBe(5000)
    expect(merged[0].title).toBe('Anthropic Home')
  })

  it('keeps the existing entry when the import is older', () => {
    const merged = mergeVisits(
      existing,
      [{ url: 'https://anthropic.com/', title: 'Stale', visitCount: 1, lastVisit: 10 }],
      100
    )

    expect(merged[0].lastVisit).toBe(1000)
    expect(merged[0].title).toBe('Anthropic')
  })

  it('orders by most recent and honours the cap', () => {
    const merged = mergeVisits(
      existing,
      [
        { url: 'https://a.example/', title: 'A', visitCount: 1, lastVisit: 9000 },
        { url: 'https://b.example/', title: 'B', visitCount: 1, lastVisit: 8000 }
      ],
      2
    )

    expect(merged.map((e) => e.url)).toEqual(['https://a.example/', 'https://b.example/'])
  })
})

describe('recognising a file the user points at', () => {
  it('names the family for each known database', () => {
    expect(looksLikeHistoryFile(join(support, 'Google', 'Chrome', 'Default', 'History'))).toBe(
      'chromium'
    )
    expect(
      looksLikeHistoryFile(
        join(support, 'Firefox', 'Profiles', 'abc123.default-release', 'places.sqlite')
      )
    ).toBe('firefox')
    expect(looksLikeHistoryFile(join(home, 'Library', 'Safari', 'History.db'))).toBe('safari')
  })

  it('says no to anything else', () => {
    expect(looksLikeHistoryFile(join(root, 'nope.txt'))).toBeNull()
    expect(looksLikeHistoryFile(support)).toBeNull()
  })
})
