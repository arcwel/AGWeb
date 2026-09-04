import { describe, it, expect } from 'vitest'
import { safeDropName } from './drops'

/**
 * The browser opens a dropped file by the relative name this contributes to,
 * resolving it inside one staging directory. A name that escaped that
 * directory would turn "open what I dropped" into "open any file", so the
 * shape is pinned here.
 */
describe('safeDropName', () => {
  it('keeps a plain name and its extension, exactly as dropped', () => {
    // The PDF viewer shows this in its title bar, so it has to be the name the
    // user recognises — no prefix, no decoration.
    expect(safeDropName('report.pdf')).toBe('report.pdf')
  })

  it('strips every path separator and traversal', () => {
    for (const attempt of ['../../etc/passwd', '/etc/passwd', 'a/b/c.pdf', '..\\..\\win.ini']) {
      const name = safeDropName(attempt)
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      expect(name).not.toContain('..')
    }
  })

  it('never returns an empty name', () => {
    expect(safeDropName('')).toBe('file')
    expect(safeDropName('///')).toBe('file')
  })

  it('caps a very long name', () => {
    expect(safeDropName('x'.repeat(500) + '.pdf').length).toBeLessThan(100)
  })
})
