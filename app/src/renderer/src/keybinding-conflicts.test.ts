import { describe, it, expect } from 'vitest'
import { IS_MAC, canonicalStroke, displayCombo, findConflicts } from './keybinding-conflicts'

// The platform modifier "mod" resolves per platform; tests spell the VS Code
// side with the same resolution so they hold on any runner.
const MOD = IS_MAC ? 'cmd' : 'ctrl'

describe('canonicalStroke', () => {
  it('ignores modifier order and case', () => {
    expect(canonicalStroke(`shift+${MOD}+p`)).toBe(canonicalStroke(`${MOD}+Shift+P`))
  })
  it('resolves the shell "mod" to the platform modifier', () => {
    expect(canonicalStroke('mod+k')).toBe(canonicalStroke(`${MOD}+k`))
  })
})

describe('findConflicts', () => {
  const shell = [
    { combo: 'mod+k', description: 'Open the command palette' },
    { combo: 'mod+d', description: 'Reveal / hide the Dev Deck' },
    { combo: 'mod+shift+p', description: 'Editor & extension commands' }
  ]

  it('flags an editor binding on a shell combo', () => {
    const out = findConflicts(shell, [
      { label: `${MOD}+d`, command: 'editor.action.addSelectionToNextFindMatch' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].combo).toBe('mod+d')
    expect(out[0].editor[0]).toEqual({
      command: 'editor.action.addSelectionToNextFindMatch',
      chord: false
    })
  })

  it('flags a chord whose FIRST stroke is a shell combo, and marks it', () => {
    const out = findConflicts(shell, [
      { label: `${MOD}+k ${MOD}+s`, command: 'workbench.action.keybindings' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].combo).toBe('mod+k')
    expect(out[0].editor[0].chord).toBe(true)
  })

  it('ignores bindings that do not collide', () => {
    expect(findConflicts(shell, [{ label: 'f5', command: 'debug.start' }])).toEqual([])
  })

  it('groups several editor bindings under one shell combo', () => {
    const out = findConflicts(shell, [
      { label: `${MOD}+k ${MOD}+c`, command: 'a' },
      { label: `${MOD}+k ${MOD}+u`, command: 'b' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].editor.map((e) => e.command)).toEqual(['a', 'b'])
  })
})

describe('displayCombo', () => {
  it('renders platform glyphs', () => {
    expect(displayCombo('mod+shift+p')).toBe(IS_MAC ? '⌘⇧P' : 'Ctrl+Shift+P')
  })
})
