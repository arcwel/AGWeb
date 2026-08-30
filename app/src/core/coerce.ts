/**
 * Argument coercion for webdeck-core handlers.
 *
 * Requests arrive as `unknown` whatever the transport (Electron IPC today, a
 * socket tomorrow), so every handler narrows its own arguments. These mirror
 * the guards the Electron registrar used inline, kept here — Electron-free — so
 * they move with the handlers.
 */

/** A string, or null if it isn't one. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Just the strings from an array; empty for anything else. */
export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

/** A finite, rounded number, or the fallback if it isn't one. */
export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}
