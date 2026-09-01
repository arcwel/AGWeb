/**
 * Reader Mode formatter (roadmap: distraction-free reading overlay).
 *
 * The only way to read a staged page's content from the renderer is the Mojo
 * Shell's page-text API, which hands back a flat block of visible text. This
 * pure function turns that plain text into a small, typed document the
 * ReaderView renders as clean typography — no DOM, no external deps, fully
 * deterministic so it can be unit-tested in isolation.
 *
 * Segmentation: split on blank lines (double newlines), collapse internal
 * whitespace to single spaces, trim, and drop empty fragments. Heading
 * heuristic: a short standalone segment (< MAX_HEADING_LENGTH chars) that does
 * not end in sentence punctuation reads as a heading; everything else is a
 * paragraph.
 */

export type ReaderBlockKind = 'heading' | 'paragraph'

export interface ReaderBlock {
  kind: ReaderBlockKind
  text: string
}

export interface ReaderDoc {
  title?: string
  blocks: ReaderBlock[]
}

/** Segments at or above this length are always paragraphs, never headings. */
const MAX_HEADING_LENGTH = 80

/** A segment ending in one of these is a sentence — a paragraph, not a heading. */
const SENTENCE_TERMINATORS = /[.!?]$/

/** Collapse every run of whitespace (including newlines) to a single space. */
function collapseWhitespace(fragment: string): string {
  return fragment.replace(/\s+/g, ' ').trim()
}

/**
 * A short, standalone segment with no terminal sentence punctuation reads as a
 * heading. Because segments are already delimited by blank lines, each is
 * "standalone" by construction — so length and terminator are the only tests.
 */
function isHeading(text: string): boolean {
  return text.length < MAX_HEADING_LENGTH && !SENTENCE_TERMINATORS.test(text)
}

export function formatReaderContent(rawText: string, title?: string): ReaderDoc {
  const trimmedTitle = title?.trim()
  const blocks: ReaderBlock[] = rawText
    // Blank-line (double-newline) boundaries separate paragraphs.
    .split(/\n\s*\n/)
    .map(collapseWhitespace)
    .filter((segment) => segment.length > 0)
    .map((text) => ({ kind: isHeading(text) ? 'heading' : 'paragraph', text }))

  return trimmedTitle ? { title: trimmedTitle, blocks } : { blocks }
}
