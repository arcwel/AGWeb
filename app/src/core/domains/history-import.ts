import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import { core } from '../rpc'
import { asString, asNumber } from '../coerce'

/**
 * Browsing history, imported from the browsers already on this machine.
 *
 * WebDeck cannot sync with Google — signing in to a Chromium build is
 * restricted by Google, not by us — so the way a new user's history gets here
 * is a one-time read of another browser's own database. That is also the
 * honest way round: import needs nobody's permission and works today.
 *
 * Every source is SQLite, and every one of them counts time differently. Those
 * conversions are the whole risk in this file: get one wrong and the history
 * imports "successfully" with every timestamp decades out, which ruins omnibox
 * ranking in a way nobody traces back to here.
 */

/**
 * SQLite, fetched from the running Node rather than imported.
 *
 * `node:sqlite` is newer than the bundlers in this repo know about, and a
 * static import of it fails to resolve in both the test runner and the core
 * build. Asking the runtime for the builtin is opaque to them and is the same
 * module either way.
 */
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')

/** Chromium stores microseconds since 1601-01-01; Windows, via WebKit. */
const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_600_000
/** Safari stores seconds since 2001-01-01, Core Data's reference date. */
const CORE_DATA_EPOCH_OFFSET_S = 978_307_200

export interface ImportedVisit {
  url: string
  title: string
  visitCount: number
  /** Epoch milliseconds. */
  lastVisit: number
}

export interface HistorySource {
  /** Stable id the caller imports by. */
  id: string
  /** What to show a person: "Google Chrome — Profile 1". */
  label: string
  browser: string
  profile: string
  path: string
  /** Entries available, or null when the file could not be opened. */
  entries: number | null
  /** Why it could not be read, when it could not. */
  error?: string
}

type Family = 'chromium' | 'firefox' | 'safari'

interface Candidate {
  browser: string
  family: Family
  /** Directory holding one or more profiles, or a file for a single-profile browser. */
  root: string
}

/**
 * Where the browsers on a Mac keep history.
 *
 * Chromium-family browsers all share one schema and one layout, so they differ
 * only by the directory their user data lives in.
 */
function candidates(home: string): Candidate[] {
  const support = join(home, 'Library', 'Application Support')
  const chromium = (browser: string, ...parts: string[]): Candidate => ({
    browser,
    family: 'chromium',
    root: join(support, ...parts)
  })
  return [
    chromium('Google Chrome', 'Google', 'Chrome'),
    chromium('Google Chrome Beta', 'Google', 'Chrome Beta'),
    chromium('Google Chrome Canary', 'Google', 'Chrome Canary'),
    chromium('Chromium', 'Chromium'),
    chromium('Microsoft Edge', 'Microsoft Edge'),
    chromium('Brave', 'BraveSoftware', 'Brave-Browser'),
    chromium('Vivaldi', 'Vivaldi'),
    chromium('Opera', 'com.operasoftware.Opera'),
    chromium('Arc', 'Arc', 'User Data'),
    { browser: 'Firefox', family: 'firefox', root: join(support, 'Firefox', 'Profiles') },
    { browser: 'Safari', family: 'safari', root: join(home, 'Library', 'Safari', 'History.db') }
  ]
}

/** The history file inside one profile directory, if it has one. */
function historyFile(family: Family, profileDir: string): string | null {
  const name = family === 'firefox' ? 'places.sqlite' : 'History'
  const path = join(profileDir, name)
  return existsSync(path) ? path : null
}

/** Every profile a candidate holds that actually has history in it. */
function profilesOf(candidate: Candidate): Array<{ profile: string; path: string }> {
  if (candidate.family === 'safari') {
    return existsSync(candidate.root) ? [{ profile: 'Safari', path: candidate.root }] : []
  }
  if (!existsSync(candidate.root)) return []
  const found: Array<{ profile: string; path: string }> = []
  // A Chromium profile directory is "Default" or "Profile N"; Firefox names
  // them "<hash>.default". Rather than matching those patterns — which differ
  // per browser and change — take any directory that contains a history file.
  for (const entry of readdirSync(candidate.root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = historyFile(candidate.family, join(candidate.root, entry.name))
    if (path) found.push({ profile: entry.name, path })
  }
  // Some single-profile builds keep it in the root itself.
  const direct = historyFile(candidate.family, candidate.root)
  if (direct) found.push({ profile: basename(candidate.root), path: direct })
  return found
}

const idFor = (browser: string, profile: string): string =>
  `${browser}::${profile}`.replace(/\s+/g, '-').toLowerCase()

/**
 * Read a locked database by copying it first.
 *
 * Every one of these browsers may be running, and a running browser holds its
 * history open in WAL mode. Opening it in place risks both a "database is
 * locked" failure and, worse, disturbing another application's data. A copy
 * costs a few megabytes and removes both problems — but it must include the
 * -wal file, or the copy is missing whatever has not been checkpointed yet,
 * which is exactly the most recent browsing.
 */
function withCopy<T>(path: string, read: (copy: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'webdeck-history-'))
  try {
    const copy = join(dir, basename(path))
    copyFileSync(path, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix)
    }
    return read(copy)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The query and time conversion for each family.
 *
 * Times come back as BigInt, and that is not fussiness: a Chromium timestamp
 * for any recent date is about 1.3e16 microseconds, which is past what a
 * JavaScript number can hold exactly. Read as a number it throws outright, and
 * had it not thrown it would have silently rounded — a history import where
 * every date is approximately right is worse than one that fails.
 */
const QUERIES: Record<Family, { sql: string; toMillis: (raw: bigint | number) => number }> = {
  chromium: {
    sql: `SELECT url, title, visit_count AS visits, last_visit_time AS at
            FROM urls WHERE url LIKE 'http%' AND last_visit_time > 0
            ORDER BY last_visit_time DESC LIMIT ?`,
    toMillis: (raw) =>
      typeof raw === 'bigint'
        ? Number(raw / 1000n) - WINDOWS_EPOCH_OFFSET_MS
        : Math.round(raw / 1000) - WINDOWS_EPOCH_OFFSET_MS
  },
  firefox: {
    sql: `SELECT url, title, visit_count AS visits, last_visit_date AS at
            FROM moz_places WHERE url LIKE 'http%' AND last_visit_date IS NOT NULL
            ORDER BY last_visit_date DESC LIMIT ?`,
    toMillis: (raw) => (typeof raw === 'bigint' ? Number(raw / 1000n) : Math.round(raw / 1000))
  },
  safari: {
    // Safari splits the url from its visits, and the title lives on the visit.
    sql: `SELECT i.url AS url,
                 (SELECT v2.title FROM history_visits v2
                   WHERE v2.history_item = i.id AND v2.title IS NOT NULL
                   ORDER BY v2.visit_time DESC LIMIT 1) AS title,
                 i.visit_count AS visits,
                 MAX(v.visit_time) AS at
            FROM history_items i JOIN history_visits v ON v.history_item = i.id
           WHERE i.url LIKE 'http%'
           GROUP BY i.id ORDER BY at DESC LIMIT ?`,
    toMillis: (raw) => Math.round((Number(raw) + CORE_DATA_EPOCH_OFFSET_S) * 1000)
  }
}

/** Read one history database. Throws only what the caller turns into `error`. */
export function readHistory(path: string, family: Family, limit: number): ImportedVisit[] {
  const { sql, toMillis } = QUERIES[family]
  return withCopy(path, (copy) => {
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const statement = db.prepare(sql)
      // Without this a recent Chromium timestamp throws: it does not fit in a
      // JavaScript number.
      statement.setReadBigInts(true)
      const rows = statement.all(limit) as unknown as Array<{
        url: string
        title: string | null
        visits: bigint | number | null
        at: bigint | number | null
      }>
      const out: ImportedVisit[] = []
      for (const row of rows) {
        const at = toMillis(row.at ?? 0)
        // A timestamp outside living memory means the conversion was wrong for
        // this file, and a wrong date poisons omnibox ranking silently. Drop
        // the row rather than import a lie.
        if (!Number.isFinite(at) || at < 0 || at > Date.now() + 86_400_000) continue
        out.push({
          url: row.url,
          title: row.title?.trim() || row.url,
          visitCount: Math.max(1, Number(row.visits ?? 1)),
          lastVisit: at
        })
      }
      return out
    } finally {
      db.close()
    }
  })
}

/** Which browsers on this machine have history to offer. */
export function listHistorySources(home = homedir()): HistorySource[] {
  const sources: HistorySource[] = []
  for (const candidate of candidates(home)) {
    for (const { profile, path } of profilesOf(candidate)) {
      const source: HistorySource = {
        id: idFor(candidate.browser, profile),
        label:
          profile === candidate.browser ? candidate.browser : `${candidate.browser} — ${profile}`,
        browser: candidate.browser,
        profile,
        path,
        entries: null
      }
      try {
        // Counting means opening it, which is also the only honest way to know
        // whether it CAN be opened. Safari's history is behind Full Disk
        // Access, so this is where that shows up — as a source that lists with
        // a reason, rather than one that fails when the user picks it.
        source.entries = readHistory(path, candidate.family, 100_000).length
      } catch (error) {
        source.error =
          error instanceof Error && /operation not permitted|EPERM/i.test(error.message)
            ? 'WebDeck needs Full Disk Access to read this browser’s history.'
            : error instanceof Error
              ? error.message
              : String(error)
      }
      sources.push(source)
    }
  }
  return sources.sort((a, b) => (b.entries ?? -1) - (a.entries ?? -1))
}

/** Read one source by the id `listHistorySources` gave it. */
export function importHistorySource(
  id: string,
  limit = 10_000,
  home = homedir()
): { entries?: ImportedVisit[]; error?: string } {
  for (const candidate of candidates(home)) {
    for (const { profile, path } of profilesOf(candidate)) {
      if (idFor(candidate.browser, profile) !== id) continue
      try {
        return { entries: readHistory(path, candidate.family, limit) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  return { error: `no history source called ${id}` }
}

/**
 * Merge imported visits into what is already here.
 *
 * Two browsers' histories overlap heavily, so importing twice must not double
 * anything. A URL seen in both keeps the higher visit count and the more
 * recent visit, which is what both of them are really saying.
 */
export function mergeVisits(
  existing: ImportedVisit[],
  imported: ImportedVisit[],
  cap: number
): ImportedVisit[] {
  const byUrl = new Map<string, ImportedVisit>()
  for (const entry of [...existing, ...imported]) {
    const found = byUrl.get(entry.url)
    if (!found) {
      byUrl.set(entry.url, { ...entry })
      continue
    }
    found.visitCount = Math.max(found.visitCount, entry.visitCount)
    if (entry.lastVisit > found.lastVisit) {
      found.lastVisit = entry.lastVisit
      // Prefer the title that came with the more recent visit: a page's title
      // changes, and the newest one is the one the user would recognise.
      if (entry.title && entry.title !== entry.url) found.title = entry.title
    }
  }
  return [...byUrl.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, cap)
}

/** Is this file plausibly one of these databases? Used by the file picker. */
export function looksLikeHistoryFile(path: string): Family | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null
  const name = basename(path).toLowerCase()
  if (name === 'places.sqlite') return 'firefox'
  if (name === 'history.db') return 'safari'
  if (name === 'history') return 'chromium'
  return null
}

export function registerHistoryImportRpc(): void {
  core.register(IpcChannels.historySources, () => listHistorySources())
  core.register(IpcChannels.historyImport, (id, limit) =>
    importHistorySource(asString(id) ?? '', asNumber(limit, 10_000))
  )
}
