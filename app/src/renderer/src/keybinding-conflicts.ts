import type { Shortcut } from '@/shortcuts'

/**
 * Which editor/extension keybindings collide with the shell's own shortcuts
 * (task 12.8). Pure — no React, no VS Code services — so it is unit-testable
 * and the Settings panel is only a view over it.
 *
 * The rule it describes: shell shortcuts are handled before a key reaches the
 * editor, so an editor binding on the same combo never fires. A VS Code chord
 * ("cmd+k cmd+s") is intercepted at its FIRST stroke, so it is a conflict too.
 */

export const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

export interface Conflict {
  /** The shell combo as registered, e.g. "mod+k". */
  combo: string
  /** What the shell does with it. */
  shell: string
  /** Editor/extension commands that wanted the same combo (chords marked). */
  editor: Array<{ command: string; chord: boolean }>
}

/**
 * Canonical form of one keystroke — sorted modifiers + key — so "mod+shift+p",
 * "shift+cmd+p" and "cmd+shift+p" all compare equal on a Mac.
 */
export function canonicalStroke(label: string): string {
  const parts = label
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  const key = parts.pop() ?? ''
  const mods = parts
    .map((m) => (m === 'mod' ? (IS_MAC ? 'cmd' : 'ctrl') : m === 'meta' ? 'cmd' : m))
    .sort()
  return [...mods, key].join('+')
}

export function findConflicts(
  shell: ReadonlyArray<Pick<Shortcut, 'combo' | 'description'>>,
  editor: ReadonlyArray<{ label: string; command: string }>
): Conflict[] {
  const byStroke = new Map<string, Conflict>()
  for (const s of shell) {
    byStroke.set(canonicalStroke(s.combo), { combo: s.combo, shell: s.description, editor: [] })
  }
  for (const k of editor) {
    const strokes = k.label.split(' ').filter(Boolean)
    const hit = byStroke.get(canonicalStroke(strokes[0] ?? ''))
    if (hit) hit.editor.push({ command: k.command, chord: strokes.length > 1 })
  }
  return [...byStroke.values()]
    .filter((c) => c.editor.length > 0)
    .sort((a, b) => a.combo.localeCompare(b.combo))
}

/** "mod+shift+p" → "⌘⇧P" on a Mac, "Ctrl+Shift+P" elsewhere. */
export function displayCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => {
      switch (p) {
        case 'mod':
          return IS_MAC ? '⌘' : 'Ctrl'
        case 'shift':
          return IS_MAC ? '⇧' : 'Shift'
        case 'alt':
          return IS_MAC ? '⌥' : 'Alt'
        default:
          return p.length === 1 ? p.toUpperCase() : p
      }
    })
    .join(IS_MAC ? '' : '+')
}
