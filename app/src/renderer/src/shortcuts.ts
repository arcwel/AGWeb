import { useEffect } from 'react'

/**
 * Keyboard-shortcut framework for the shell.
 *
 * Combos use `mod` for Cmd on macOS / Ctrl elsewhere, e.g. "mod+shift+p".
 * Registrations return an unregister function; later registrations of the
 * same combo win, so views can shadow shell defaults while mounted.
 */
export interface Shortcut {
  combo: string
  description: string
  handler: (event: KeyboardEvent) => void
}

const registry = new Map<string, Shortcut[]>()

const IS_MAC = navigator.platform.toUpperCase().includes('MAC')

function normalize(combo: string): string {
  return combo
    .toLowerCase()
    .split('+')
    .map((part) => (part === 'mod' ? (IS_MAC ? 'meta' : 'ctrl') : part))
    .sort()
    .join('+')
}

function comboFromEvent(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.metaKey) parts.push('meta')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  const key = event.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(key)) parts.push(key)
  return parts.sort().join('+')
}

export function registerShortcut(shortcut: Shortcut): () => void {
  const key = normalize(shortcut.combo)
  const stack = registry.get(key) ?? []
  stack.push(shortcut)
  registry.set(key, stack)
  return () => {
    const current = registry.get(key) ?? []
    const index = current.indexOf(shortcut)
    if (index >= 0) current.splice(index, 1)
    if (current.length === 0) registry.delete(key)
  }
}

export function listShortcuts(): Shortcut[] {
  return [...registry.values()].map((stack) => stack[stack.length - 1])
}

export function useShortcut(
  combo: string,
  description: string,
  handler: Shortcut['handler']
): void {
  useEffect(() => {
    return registerShortcut({ combo, description, handler })
  }, [combo, description, handler])
}

function runCombo(combo: string, event: KeyboardEvent): boolean {
  const stack = registry.get(combo)
  if (!stack || stack.length === 0) return false
  stack[stack.length - 1].handler(event)
  return true
}

export function installShortcutListener(): void {
  window.addEventListener('keydown', (event) => {
    if (runCombo(comboFromEvent(event), event)) event.preventDefault()
  })
  // Combos pressed while a browser view had focus arrive over IPC instead of
  // as DOM events — the page, not the shell, owned the keyboard (P1-14).
  window.agweb.onShellShortcut((combo) => {
    runCombo(normalize(combo), new KeyboardEvent('keydown'))
  })
}
