import { describe, it, expect } from 'vitest'
import { htmlSinksAllowed, withHtmlSinksAllowed } from './trusted-html'

describe('the HTML-sink door', () => {
  it('is closed by default', () => {
    expect(htmlSinksAllowed()).toBe(false)
  })

  it('is open only for the duration of the work, and closes even when it throws', async () => {
    let seenInside: boolean | null = null
    await withHtmlSinksAllowed(async () => {
      seenInside = htmlSinksAllowed()
    })
    expect(seenInside).toBe(true)
    expect(htmlSinksAllowed()).toBe(false)

    await expect(
      withHtmlSinksAllowed(async () => {
        throw new Error('render failed')
      })
    ).rejects.toThrow('render failed')
    expect(htmlSinksAllowed()).toBe(false)
  })

  it('stays open while any of several overlapping renders is still running', async () => {
    let releaseFirst!: () => void
    const first = withHtmlSinksAllowed(() => new Promise<void>((r) => (releaseFirst = r)))
    await withHtmlSinksAllowed(async () => {})
    expect(htmlSinksAllowed()).toBe(true)
    releaseFirst()
    await first
    expect(htmlSinksAllowed()).toBe(false)
  })
})
