import { describe, it, expect } from 'vitest'
import {
  BROWSER_SETTINGS,
  rowMatches,
  settingPrefNames,
  type SettingRow
} from './browser-settings-map'

const rows = BROWSER_SETTINGS.flatMap((s) => s.rows)

/**
 * The settings map mirrors chrome://settings. These pin the properties that
 * make it safe to render blind: every row is addressable, every pref row names
 * a pref the browser will actually answer for, and search never hides a
 * section by accident.
 */
describe('the browser settings map', () => {
  it('covers the sections Chrome has', () => {
    expect(BROWSER_SETTINGS.map((s) => s.id)).toEqual([
      'people',
      'autofill',
      'privacy',
      'performance',
      'appearance',
      'search',
      'startup',
      'downloads',
      'languages',
      'accessibility',
      'system',
      'reset'
    ])
  })

  it('gives every row a label and a hint, so nothing renders bare', () => {
    for (const row of rows) {
      expect(row.label.length, JSON.stringify(row)).toBeGreaterThan(0)
      expect(row.hint.length, JSON.stringify(row)).toBeGreaterThan(0)
    }
  })

  it('collects each pref once for a single round trip', () => {
    const names = settingPrefNames()
    expect(new Set(names).size).toBe(names.length)
    // Safe Browsing is two prefs behind one control; both must be fetched.
    expect(names).toContain('safebrowsing.enabled')
    expect(names).toContain('safebrowsing.enhanced')
  })

  it('sends every link at a real page, and every chrome:// link at a host the shell may open', () => {
    // IsAllowedShellUrl in the browser only opens these hosts; a link to any
    // other chrome:// page would be silently refused.
    const allowed = new Set([
      'settings',
      'password-manager',
      'extensions',
      'history',
      'downloads',
      'bookmarks',
      'newtab',
      'version'
    ])
    for (const row of rows) {
      if (row.kind !== 'link') continue
      const url = new URL(row.url)
      expect(['chrome:', 'https:']).toContain(url.protocol)
      if (url.protocol === 'chrome:') expect(allowed).toContain(url.hostname)
    }
  })

  it('matches on the label, the hint and the pref name, and needs every word', () => {
    const row: SettingRow = {
      kind: 'toggle',
      pref: 'autofill.profile_enabled',
      label: 'Save and fill addresses',
      hint: 'Offer to save addresses.'
    }
    expect(rowMatches(row, '')).toBe(true)
    expect(rowMatches(row, 'addresses')).toBe(true)
    expect(rowMatches(row, 'AUTOFILL')).toBe(true)
    expect(rowMatches(row, 'save addresses')).toBe(true)
    expect(rowMatches(row, 'save passwords')).toBe(false)
  })
})
