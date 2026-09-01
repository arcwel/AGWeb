import { beautifyXml, minifyXml } from '@/xml'

/**
 * Explicit, in-place Beautify / Minify for structured source buffers.
 *
 * Dependency-free for JSON (native JSON.parse/stringify); XML routes through
 * the shared fast-xml-parser helpers. Both throw a readable Error on invalid
 * input so the Studio can surface it inline instead of crashing the view. This
 * is a lightweight complement to the Prettier-based "Format" action, not a
 * replacement for it.
 */

export type StructuredFormat = 'json' | 'xml'

/** Which explicit format, if any, an extension supports. */
export function structuredFormatFor(ext: string): StructuredFormat | null {
  if (ext === 'json') return 'json'
  if (ext === 'xml' || ext === 'svg') return 'xml'
  return null
}

/** Pretty-print the buffer (2-space indent). Throws with a readable message. */
export function beautify(ext: string, content: string): string {
  const kind = structuredFormatFor(ext)
  if (kind === 'json') return JSON.stringify(JSON.parse(content), null, 2) + '\n'
  if (kind === 'xml') return beautifyXml(content)
  throw new Error(`Beautify is not available for .${ext} files.`)
}

/** Compact the buffer onto minimal whitespace. Throws with a readable message. */
export function minify(ext: string, content: string): string {
  const kind = structuredFormatFor(ext)
  if (kind === 'json') return JSON.stringify(JSON.parse(content))
  if (kind === 'xml') return minifyXml(content)
  throw new Error(`Minify is not available for .${ext} files.`)
}
