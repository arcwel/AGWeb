import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { JsonStore } from './json-store'
import { getCurrentWorkspace } from './workspace'
import { IpcChannels } from '@shared/ipc'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'

/**
 * Settings and keybindings (task 12.6).
 *
 * Two layers, the same two VS Code has:
 *  - **User** settings live in `userData`, apply everywhere, and survive a
 *    restart. Until this task they were an in-memory object in the renderer,
 *    so every toggle reset on relaunch.
 *  - **Workspace** settings live in the project's own `.vscode/settings.json`
 *    and win over user settings, which is what makes a per-project tab width
 *    or formatter possible — and what lets an existing VS Code project keep
 *    its configuration without being rewritten.
 *
 * Both are stored and returned as **text**, not parsed objects. The editor
 * shows the user their own JSON, comments and all; parsing it into an object
 * and re-serializing would silently reformat and strip their comments.
 */

const userSettings = new JsonStore<{ text?: string }>('user-settings', {})
const userKeybindings = new JsonStore<{ text?: string }>('user-keybindings', {})

/** JSON with comments — what VS Code writes and what users paste in. */
export function stripJsonComments(text: string): string {
  // Strings must survive: a `//` inside one is data, not a comment.
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += char
  }
  // Trailing commas are legal in VS Code's JSONC and fatal to JSON.parse.
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Parse settings text, returning null rather than throwing on bad JSON. */
export function parseSettings(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(stripJsonComments(trimmed)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function readUserSettings(): string {
  return userSettings.read().text ?? ''
}

export function writeUserSettings(text: string): { error?: string } {
  if (parseSettings(text) === null) return { error: 'Settings are not valid JSON.' }
  userSettings.write({ text })
  return {}
}

export function readUserKeybindings(): string {
  return userKeybindings.read().text ?? ''
}

export function writeUserKeybindings(text: string): { error?: string } {
  const trimmed = text.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(stripJsonComments(trimmed)) as unknown
      if (!Array.isArray(parsed)) return { error: 'Keybindings must be a JSON array.' }
    } catch {
      return { error: 'Keybindings are not valid JSON.' }
    }
  }
  userKeybindings.write({ text })
  return {}
}

function workspaceSettingsPath(): string | null {
  const root = getCurrentWorkspace()?.path
  return root ? join(root, '.vscode', 'settings.json') : null
}

export async function readWorkspaceSettings(): Promise<string> {
  const path = workspaceSettingsPath()
  if (!path) return ''
  try {
    return await fsp.readFile(path, 'utf8')
  } catch {
    // No .vscode/settings.json yet — an empty document is the right start.
    return ''
  }
}

export async function writeWorkspaceSettings(text: string): Promise<{ error?: string }> {
  const path = workspaceSettingsPath()
  if (!path) return { error: 'No workspace open.' }
  if (parseSettings(text) === null) return { error: 'Settings are not valid JSON.' }
  try {
    await fsp.mkdir(join(path, '..'), { recursive: true })
    await fsp.writeFile(path, text, 'utf8')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Register the editor-config domain with webdeck-core (P1). `settingsImport`
 *  is a hybrid (native file dialog) and stays shell-side. */
export function registerSettingsRpc(): void {
  core.register(IpcChannels.settingsRead, async () => ({
    user: readUserSettings(),
    workspace: await readWorkspaceSettings(),
    keybindings: readUserKeybindings()
  }))
  core.register(IpcChannels.settingsWrite, (scope, text) => {
    const body = asString(text)
    if (body === null) return { error: 'bad arguments' }
    if (scope === 'workspace') return writeWorkspaceSettings(body)
    if (scope === 'keybindings') return writeUserKeybindings(body)
    return writeUserSettings(body)
  })
}
