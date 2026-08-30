import { describe, it, expect } from 'vitest'
import { docNavTarget } from './doc-nav'

// The security-critical half of P3-3: only ever yield a path that resolves
// *inside* the open workspace, so a file: navigation can never surface an
// arbitrary local file as a "document".
const WS = '/ws'

describe('docNavTarget', () => {
  it('returns the workspace-relative path for a doc file', () => {
    expect(docNavTarget('file:///ws/notes.md', WS)).toBe('notes.md')
    expect(docNavTarget('file:///ws/docs/readme.md', WS)).toBe('docs/readme.md')
  })

  it('handles the other doc types', () => {
    expect(docNavTarget('file:///ws/data.json', WS)).toBe('data.json')
    expect(docNavTarget('file:///ws/config.yaml', WS)).toBe('config.yaml')
    expect(docNavTarget('file:///ws/rows.csv', WS)).toBe('rows.csv')
  })

  it('ignores non-doc files (they load in the browser as before)', () => {
    expect(docNavTarget('file:///ws/app.ts', WS)).toBeNull()
    expect(docNavTarget('file:///ws/image.png', WS)).toBeNull()
  })

  it('ignores slide decks — they have their own runtime', () => {
    expect(docNavTarget('file:///ws/talk.slides.md', WS)).toBeNull()
  })

  it('refuses files outside the workspace', () => {
    expect(docNavTarget('file:///etc/passwd', WS)).toBeNull()
    expect(docNavTarget('file:///other/notes.md', WS)).toBeNull()
  })

  it('refuses a directory that only prefix-matches the workspace path', () => {
    // `/ws-secret` is a sibling, not inside `/ws` — the trailing-sep guard blocks it.
    expect(docNavTarget('file:///ws-secret/notes.md', WS)).toBeNull()
  })

  it('refuses path traversal back out of the workspace', () => {
    expect(docNavTarget('file:///ws/../etc/notes.md', WS)).toBeNull()
  })

  it('ignores non-file schemes', () => {
    expect(docNavTarget('https://example.com/notes.md', WS)).toBeNull()
    expect(docNavTarget('about:blank', WS)).toBeNull()
    expect(docNavTarget('data:text/markdown,hi', WS)).toBeNull()
  })

  it('returns null when no workspace is open', () => {
    expect(docNavTarget('file:///ws/notes.md', null)).toBeNull()
  })

  it('returns null for the workspace root itself', () => {
    expect(docNavTarget('file:///ws', WS)).toBeNull()
  })
})
