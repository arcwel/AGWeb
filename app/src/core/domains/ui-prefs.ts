import { JsonStore } from './json-store'

/**
 * Main-side mirror of the renderer-owned UI theme.
 *
 * Theme lives in the renderer (it drives the DOM), but WebDeck Sync runs in
 * main, so it needs a value to read and a place to write an incoming one. The
 * renderer pushes every theme change here over `theme:set`; sync reads this
 * mirror, and on a pull writes it back and tells the renderer to adopt it.
 */

export type UiTheme = 'light' | 'dark'

const store = new JsonStore<{ theme: UiTheme }>('ui-prefs', { theme: 'dark' })

export function getUiTheme(): UiTheme {
  return store.read().theme
}

export function setUiTheme(theme: UiTheme): void {
  store.write({ theme })
}
