import { describe, it, expect } from 'vitest'
import { sanitizeAttachments } from './agent'

/**
 * The Ask button hands the agent the page the user is looking at. That is the
 * one attachment whose content comes from a website, so the sanitiser is where
 * its size and shape are pinned down.
 */
describe('sanitizeAttachments', () => {
  it('keeps a page attachment with its title and a capped excerpt', () => {
    const [page] = sanitizeAttachments([
      { path: 'https://example.com/a', kind: 'page', title: 'Example', excerpt: 'x'.repeat(20_000) }
    ])
    expect(page.kind).toBe('page')
    expect(page.title).toBe('Example')
    expect(page.excerpt).toHaveLength(12_000)
  })

  it('drops page fields from file attachments and unknown kinds become files', () => {
    const list = sanitizeAttachments([
      { path: 'src/a.ts', kind: 'file', title: 'nope', excerpt: 'nope' },
      { path: 'src', kind: 'weird' as never }
    ])
    expect(list[0]).toEqual({ path: 'src/a.ts', kind: 'file', pinned: false })
    expect(list[1].kind).toBe('file')
  })

  it('refuses junk and caps the count', () => {
    expect(sanitizeAttachments('nope')).toEqual([])
    expect(sanitizeAttachments([{ path: '' }, null, { kind: 'file' }])).toEqual([])
    const many = sanitizeAttachments(
      Array.from({ length: 40 }, (_, i) => ({ path: `f${i}`, kind: 'file' }))
    )
    expect(many).toHaveLength(24)
  })
})
