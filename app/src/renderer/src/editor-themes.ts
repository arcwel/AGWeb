import { getService } from '@codingame/monaco-vscode-api/services'
import { IWorkbenchThemeService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service'
import { getSetting, monacoReady, updateSettings } from '@/monaco'

/**
 * Editor color themes as the user sees them (task 12.8, "how do I use a theme
 * I installed?").
 *
 * VS Code keeps a preferred theme per scheme — `workbench.preferredDarkColorTheme`
 * and `workbench.preferredLightColorTheme` — and the shell's light/dark toggle
 * switches between those (`setEditorTheme`). This module lists what can be
 * chosen (built-in themes plus everything installed extensions contribute) and
 * reads/writes those two settings. It imports from `@/monaco`, never the
 * reverse, so there is no cycle.
 */

export type ThemeKind = 'light' | 'dark'

export interface EditorThemeOption {
  label: string
  /** The value `workbench.colorTheme` takes — what the settings document stores. */
  settingsId: string
  kind: ThemeKind
}

export const DEFAULT_EDITOR_THEME: Record<ThemeKind, string> = {
  dark: 'Default Dark Modern',
  light: 'Default Light Modern'
}

const PREFERRED_KEY: Record<ThemeKind, string> = {
  dark: 'workbench.preferredDarkColorTheme',
  light: 'workbench.preferredLightColorTheme'
}

/** Every selectable color theme, light and dark, alphabetical. */
export async function listEditorThemes(): Promise<EditorThemeOption[]> {
  await monacoReady
  const service = await getService(IWorkbenchThemeService)
  const themes = await service.getColorThemes()
  return themes
    .flatMap((t) => {
      // High-contrast variants are left out of the picker: the shell has no
      // high-contrast mode to pair them with, so they would be dead entries.
      const type = String(t.type)
      if (!t.settingsId || (type !== 'light' && type !== 'dark')) return []
      return [{ label: t.label, settingsId: t.settingsId, kind: type as ThemeKind }]
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function preferredEditorTheme(kind: ThemeKind): string {
  return getSetting<string>(PREFERRED_KEY[kind]) ?? DEFAULT_EDITOR_THEME[kind]
}

export async function setPreferredEditorTheme(kind: ThemeKind, settingsId: string): Promise<void> {
  await updateSettings({ [PREFERRED_KEY[kind]]: settingsId })
}
