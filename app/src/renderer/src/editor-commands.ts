import { getService } from '@codingame/monaco-vscode-api/services'
import {
  MenuId,
  MenuRegistry,
  isIMenuItem
} from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions'
import { ICommandService } from '@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service'
import { IKeybindingService } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service'
import { IContextKeyService } from '@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service'
import { monacoReady } from '@/monaco'
import type { AppCommand } from '@/commands'

/**
 * VS Code's commands — built-in editor commands and every command an installed
 * extension contributes — as entries for WebDeck's own ⌘K palette (task 12.8).
 *
 * One palette, not two: rather than surfacing VS Code's separate ⌘⇧P widget,
 * these are read from the same registry VS Code's palette reads (the
 * `CommandPalette` menu) and listed in ⌘K under "Editor & Extensions", titled
 * as the extension titles them, with the extension's name as a badge and the
 * bound key as a hint. `when`/precondition are honoured the way VS Code's
 * palette honours them, so a command that needs an active editor is hidden
 * when there is none instead of padding the list with no-ops.
 *
 * The services are resolved once after the editor boots; until then the list
 * is simply empty. Everything here is synchronous after that, which is what
 * lets the palette build its list in one pass on open.
 */

interface Services {
  commands: ICommandService
  keybindings: IKeybindingService
  contextKeys: IContextKeyService
}

let services: Services | null = null

export const editorCommandsReady: Promise<void> = monacoReady.then(async () => {
  const [commands, keybindings, contextKeys] = await Promise.all([
    getService(ICommandService),
    getService(IKeybindingService),
    getService(IContextKeyService)
  ])
  services = { commands, keybindings, contextKeys }
})

/** ICommandAction titles/categories are either plain strings or localized {value}. */
function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) {
    return String((value as { value: unknown }).value)
  }
  return ''
}

/** The section every editor/extension command lands in. */
export const EDITOR_SECTION = 'Editor & Extensions' as const

/** The command id prefix that keeps palette ids unique across the two sources. */
const ID_PREFIX = 'vscode:'

/** Run a VS Code / extension command by its VS Code id. */
export async function runEditorCommand(id: string, ...args: unknown[]): Promise<unknown> {
  await editorCommandsReady
  return services?.commands.executeCommand(id, ...args)
}

/**
 * Every editor/extension command that applies right now, as palette entries.
 * Empty until the editor services are up.
 */
export function listEditorCommands(): AppCommand[] {
  if (!services) return []
  const { keybindings, contextKeys } = services
  const seen = new Set<string>()
  const out: AppCommand[] = []
  for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
    if (!isIMenuItem(item)) continue
    const { command } = item
    if (seen.has(command.id)) continue
    if (item.when && !contextKeys.contextMatchesRules(item.when)) continue
    if (command.precondition && !contextKeys.contextMatchesRules(command.precondition)) continue
    seen.add(command.id)
    const category = text(command.category)
    const title = text(command.title)
    if (!title) continue
    out.push({
      id: `${ID_PREFIX}${command.id}`,
      title: category ? `${category}: ${title}` : title,
      section: EDITOR_SECTION,
      badge: command.source?.title,
      // The raw id, so "formatDocument" or "editor.action.…" finds it too.
      keywords: command.id,
      shortcut: keybindings.lookupKeybinding(command.id)?.getLabel() ?? undefined,
      run: () => {
        void runEditorCommand(command.id)
      }
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

/** Every VS Code keybinding in force — user-settings label + command — for the conflict view. */
export function editorKeybindings(): Array<{ label: string; command: string }> {
  if (!services) return []
  return services.keybindings.getKeybindings().flatMap((k) => {
    const label = k.resolvedKeybinding?.getUserSettingsLabel()
    return label && k.command ? [{ label, command: k.command }] : []
  })
}
