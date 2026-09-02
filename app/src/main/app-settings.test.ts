import { describe, it, expect } from 'vitest'
import { sanitizePatch } from './app-settings'

describe('sanitizePatch', () => {
  it('keeps known, correctly-typed fields', () => {
    expect(sanitizePatch({ doNotTrack: true, downloadPath: '/x' })).toEqual({
      doNotTrack: true,
      downloadPath: '/x'
    })
  })

  it('drops unknown keys', () => {
    // A compromised renderer must not be able to inject arbitrary keys.
    const dirty = { doNotTrack: true, __proto__: { polluted: true }, evil: 1 } as never
    const clean = sanitizePatch(dirty)
    expect(clean).toEqual({ doNotTrack: true })
    expect('evil' in clean).toBe(false)
  })

  it('rejects wrong-typed booleans', () => {
    expect(sanitizePatch({ spellcheck: 'yes' as never })).toEqual({})
  })

  it('filters spellcheckLanguages to strings only', () => {
    expect(sanitizePatch({ spellcheckLanguages: ['en-US', 5, null] as never })).toEqual({
      spellcheckLanguages: ['en-US']
    })
  })

  it('rejects a non-array spellcheckLanguages', () => {
    expect(sanitizePatch({ spellcheckLanguages: 'en-US' as never })).toEqual({})
  })
})
