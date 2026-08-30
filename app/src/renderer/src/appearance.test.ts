import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseColor,
  toHex,
  toCss,
  applyColors,
  setColor,
  resetAllColors,
  hasOverride
} from './appearance'

describe('parseColor', () => {
  it('parses #rrggbb', () => {
    expect(parseColor('#4fd4c4')).toEqual({ r: 79, g: 212, b: 196, a: 1 })
  })

  it('parses shorthand #rgb', () => {
    expect(parseColor('#0f0')).toEqual({ r: 0, g: 255, b: 0, a: 1 })
  })

  it('parses #rrggbbaa alpha', () => {
    const c = parseColor('#00000080')
    expect(c.r).toBe(0)
    expect(c.a).toBeCloseTo(0.5, 1)
  })

  it('parses rgb() and rgba()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('rgba(10, 20, 30, 0.4)')).toEqual({ r: 10, g: 20, b: 30, a: 0.4 })
  })

  it('falls back to mid-grey for garbage rather than throwing', () => {
    expect(parseColor('not a color')).toEqual({ r: 128, g: 128, b: 128, a: 1 })
  })
})

describe('toHex / toCss', () => {
  it('round-trips an opaque color through hex', () => {
    expect(toHex(parseColor('#123456'))).toBe('#123456')
  })

  it('emits rgb() when opaque and rgba() when translucent', () => {
    expect(toCss({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)')
    expect(toCss({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)')
  })
})

describe('applyColors accent propagation', () => {
  beforeEach(() => {
    resetAllColors('dark')
    resetAllColors('light')
    document.documentElement.removeAttribute('style')
  })

  it('regenerates the Tailwind sky ramp from a custom accent', () => {
    setColor('dark', 'wd-accent', 'rgb(255, 0, 0)')
    applyColors('dark')
    const root = document.documentElement
    // 500 is the accent itself; 600 is a darker mix; 400 a lighter one.
    expect(root.style.getPropertyValue('--color-sky-500')).toBe('#ff0000')
    expect(root.style.getPropertyValue('--color-sky-600')).not.toBe('')
    expect(root.style.getPropertyValue('--wd-accent-soft')).toContain('255, 0, 0')
  })

  it('clears the sky ramp when the accent is not overridden', () => {
    setColor('dark', 'wd-accent', 'rgb(255, 0, 0)')
    applyColors('dark')
    resetAllColors('dark')
    applyColors('dark')
    expect(document.documentElement.style.getPropertyValue('--color-sky-500')).toBe('')
    expect(hasOverride('dark', 'wd-accent')).toBe(false)
  })
})
