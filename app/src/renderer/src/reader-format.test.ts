import { describe, it, expect } from 'vitest'
import { formatReaderContent, type ReaderBlock } from './reader-format'

/**
 * reader-format is the pure plain-text -> ReaderDoc segmenter behind Reader
 * Mode. Every expectation below is derived from the source's rules, not
 * guessing: split on blank lines, collapse whitespace, drop empties; a segment
 * shorter than MAX_HEADING_LENGTH (80) with no trailing [.!?] is a heading,
 * everything else a paragraph; the title is trimmed and passed through.
 */

/** The blocks of one kind, in order — the segmentation under test. */
function kinds(blocks: ReaderBlock[]): string[] {
  return blocks.map((b) => b.kind)
}

describe('formatReaderContent — paragraph segmentation', () => {
  it('splits on blank lines into separate paragraphs', () => {
    // Arrange
    const raw = 'This is the first paragraph, it is long enough.\n\nAnd here is the second one.'

    // Act
    const doc = formatReaderContent(raw)

    // Assert
    expect(doc.blocks).toEqual([
      { kind: 'paragraph', text: 'This is the first paragraph, it is long enough.' },
      { kind: 'paragraph', text: 'And here is the second one.' }
    ])
  })

  it('collapses runs of whitespace within a paragraph to single spaces', () => {
    // Arrange: tabs, doubled spaces, and single newlines inside one segment.
    const raw = 'The   quick\tbrown\nfox jumps over the very lazy sleeping dog.'

    // Act
    const doc = formatReaderContent(raw)

    // Assert
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].text).toBe('The quick brown fox jumps over the very lazy sleeping dog.')
  })

  it('drops empty and whitespace-only fragments between blank lines', () => {
    // Arrange: three blank-line boundaries but only two real segments.
    const raw = 'First real paragraph of body text here.\n\n   \n\nSecond real paragraph of text.'

    // Act
    const doc = formatReaderContent(raw)

    // Assert
    expect(doc.blocks).toHaveLength(2)
    expect(kinds(doc.blocks)).toEqual(['paragraph', 'paragraph'])
  })
})

describe('formatReaderContent — heading heuristic', () => {
  it('treats a short standalone line with no terminal period as a heading', () => {
    // Arrange
    const raw = 'Introduction\n\nThis is the body paragraph that follows the heading above.'

    // Act
    const doc = formatReaderContent(raw)

    // Assert
    expect(doc.blocks[0]).toEqual({ kind: 'heading', text: 'Introduction' })
    expect(doc.blocks[1].kind).toBe('paragraph')
  })

  it('treats a short line ending in a period as a paragraph, not a heading', () => {
    // Arrange
    const raw = 'This is short.'

    // Act
    const doc = formatReaderContent(raw)

    // Assert
    expect(doc.blocks[0].kind).toBe('paragraph')
  })

  it('treats a long line as a paragraph even without terminal punctuation', () => {
    // Arrange: 80+ chars, no trailing period — length alone forces a paragraph.
    const raw =
      'This line is far too long to be a heading because it runs well past the eighty character limit'

    // Act
    const doc = formatReaderContent(raw)

    // Assert
    expect(raw.length).toBeGreaterThanOrEqual(80)
    expect(doc.blocks[0].kind).toBe('paragraph')
  })
})

describe('formatReaderContent — title and empty input', () => {
  it('passes a trimmed title through onto the doc', () => {
    // Arrange / Act
    const doc = formatReaderContent('Body text of the article goes here.', '  My Article  ')

    // Assert
    expect(doc.title).toBe('My Article')
  })

  it('omits the title when it is undefined', () => {
    // Arrange / Act
    const doc = formatReaderContent('Body text of the article goes here.')

    // Assert
    expect(doc.title).toBeUndefined()
  })

  it('omits the title when it is only whitespace', () => {
    // Arrange / Act
    const doc = formatReaderContent('Body.', '   ')

    // Assert
    expect(doc.title).toBeUndefined()
  })

  it('returns an empty block list for empty input', () => {
    // Arrange / Act
    const doc = formatReaderContent('')

    // Assert
    expect(doc).toEqual({ blocks: [] })
  })

  it('returns an empty block list for whitespace-only input', () => {
    // Arrange / Act
    const doc = formatReaderContent('   \n\n \t  \n')

    // Assert
    expect(doc.blocks).toEqual([])
  })
})
