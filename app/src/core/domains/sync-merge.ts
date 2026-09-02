/**
 * WebDeck Sync — the merge core (pure, dependency-free, unit-tested).
 *
 * Sync v0 is local-first: the user's settings live in one portable JSON document
 * they keep in a folder they already sync (iCloud/Drive/Dropbox). Each device
 * reads that doc on start + when it changes, and writes its own edits back. There
 * is no server and no locking, so conflicts are resolved **per section, by
 * last-writer-wins**: every section carries the wall-clock time it was last
 * changed, and the newest write wins. Because sections are independent, theme
 * from one machine and policy from another both survive — field-level merge falls
 * out of the structure for free.
 *
 * This module holds only the decision logic (what to write, what to apply). All
 * I/O, file-watching, and domain wiring lives in `sync.ts`.
 */

export const SYNC_DOC_VERSION = 1

/** Section keys that must never be honored — a JSON `"__proto__"` key would reach
 *  the prototype setter through bracket assignment. Defense-in-depth. */
const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype'])

export interface SyncSectionEntry {
  /** The section's value (opaque here; each domain owns its shape). */
  value: unknown
  /** Wall-clock ms when this value was last changed by some device. */
  updatedAt: number
  /** Which device last wrote it (informational; for display/debugging). */
  device?: string
}

export interface SyncDoc {
  version: number
  sections: Record<string, SyncSectionEntry>
}

/** An empty, well-formed document — the starting point when no file exists yet. */
export function emptyDoc(): SyncDoc {
  return { version: SYNC_DOC_VERSION, sections: {} }
}

/** Coerce arbitrary parsed JSON into a valid SyncDoc, dropping anything malformed. */
export function normalizeDoc(raw: unknown): SyncDoc {
  const doc = emptyDoc()
  if (!raw || typeof raw !== 'object') return doc
  const sections = (raw as { sections?: unknown }).sections
  if (!sections || typeof sections !== 'object') return doc
  for (const [key, entry] of Object.entries(sections as Record<string, unknown>)) {
    if (UNSAFE_KEY.has(key)) continue
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.updatedAt !== 'number') continue
    doc.sections[key] = {
      value: e.value,
      updatedAt: e.updatedAt,
      device: typeof e.device === 'string' ? e.device : undefined
    }
  }
  return doc
}

/** Structural equality via canonical JSON — enough for settings-shaped values. */
export function valueEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Fold this device's current local values into `doc`, bumping `updatedAt` only
 * for sections whose value actually changed vs. what the doc already holds. A
 * section we didn't touch keeps its existing timestamp, so an unchanged push
 * never steals a "last writer" from another device.
 *
 * Returns the new doc plus the keys that changed (so the caller can mark them
 * seen and know whether a write is even needed).
 */
export function mergeLocalIntoDoc(
  doc: SyncDoc,
  locals: Record<string, unknown>,
  now: number,
  device: string
): { doc: SyncDoc; changed: string[] } {
  const next: SyncDoc = { version: SYNC_DOC_VERSION, sections: { ...doc.sections } }
  const changed: string[] = []
  for (const [key, value] of Object.entries(locals)) {
    if (UNSAFE_KEY.has(key)) continue
    const existing = next.sections[key]
    if (existing && valueEquals(existing.value, value)) continue
    next.sections[key] = { value, updatedAt: now, device }
    changed.push(key)
  }
  return { doc: next, changed }
}

/**
 * Given a doc and the timestamps this device has already applied (`seen`), decide
 * which sections are newer in the doc and should be applied locally. A section is
 * applied when the doc's `updatedAt` is strictly greater than the last one we
 * applied — so we never re-apply our own writes or thrash on equal timestamps.
 */
export function sectionsToApply(
  doc: SyncDoc,
  seen: Record<string, number>
): Array<{ key: string; value: unknown; updatedAt: number }> {
  const out: Array<{ key: string; value: unknown; updatedAt: number }> = []
  for (const [key, entry] of Object.entries(doc.sections)) {
    if (entry.updatedAt > (seen[key] ?? 0)) {
      out.push({ key, value: entry.value, updatedAt: entry.updatedAt })
    }
  }
  return out
}

/** After a successful write/read, the timestamps this device is now in sync with. */
export function seenFromDoc(doc: SyncDoc): Record<string, number> {
  const seen: Record<string, number> = {}
  for (const [key, entry] of Object.entries(doc.sections)) seen[key] = entry.updatedAt
  return seen
}
