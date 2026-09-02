import { useEffect, useState } from 'react'
import { onSettingsChanged, setEditorTheme } from '@/monaco'
import {
  listEditorThemes,
  preferredEditorTheme,
  setPreferredEditorTheme,
  type EditorThemeOption,
  type ThemeKind
} from '@/editor-themes'
import { onEditorExtensionsChanged } from '@/editor-extensions'

/**
 * Settings › Colors › Editor theme (task 12.8).
 *
 * Two pickers — the theme used while the shell is dark, and while it is light —
 * listing VS Code's built-in themes plus every theme an installed extension
 * contributes. Choosing one for the *current* scheme applies it immediately;
 * choosing for the other scheme takes effect on the next toggle. The list
 * refreshes when an extension is installed or removed, so a freshly installed
 * theme is selectable without reopening Settings.
 */
export function EditorThemeSettings({ theme }: { theme: ThemeKind }): React.JSX.Element {
  const [themes, setThemes] = useState<EditorThemeOption[]>([])
  // Bumped when settings change so the selects show the persisted value.
  const [, bump] = useState(0)

  useEffect(() => {
    let live = true
    const load = (): void => {
      void listEditorThemes().then((list) => {
        if (live) setThemes(list)
      })
    }
    load()
    const offExtensions = onEditorExtensionsChanged(load)
    const offSettings = onSettingsChanged(() => bump((n) => n + 1))
    return () => {
      live = false
      offExtensions()
      offSettings()
    }
  }, [])

  const choose = async (kind: ThemeKind, settingsId: string): Promise<void> => {
    await setPreferredEditorTheme(kind, settingsId)
    if (kind === theme) await setEditorTheme(theme)
  }

  const picker = (kind: ThemeKind, label: string): React.JSX.Element => {
    const options = themes.filter((t) => t.kind === kind)
    const current = preferredEditorTheme(kind)
    return (
      <label className="flex items-center gap-2 py-1">
        <span className="w-24 flex-none text-[11px] text-[var(--wd-muted)]">
          {label}
          {kind === theme ? <span className="text-[var(--wd-dim)]"> · active</span> : null}
        </span>
        <select
          value={current}
          onChange={(e) => void choose(kind, e.target.value)}
          aria-label={`${label} editor theme`}
          className="min-w-0 flex-1 rounded-md border border-[var(--wd-hairline)] bg-transparent px-2 py-1 text-[11px] text-[var(--wd-text)] outline-none focus:border-[var(--wd-accent)]"
        >
          {/* Keep a persisted value selectable even if its extension is gone. */}
          {!options.some((o) => o.settingsId === current) && (
            <option value={current}>{current} (not installed)</option>
          )}
          {options.map((o) => (
            <option key={o.settingsId} value={o.settingsId}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <div className="border-b border-[var(--wd-hairline)] px-2.5 py-2">
      <div className="wd-cap mb-1">Editor theme</div>
      <p className="mb-1 text-[10px] text-[var(--wd-dim)]">
        The editor follows the shell&apos;s light/dark toggle using these two. Themes installed from
        Open VSX appear here.
      </p>
      {picker('dark', 'Dark')}
      {picker('light', 'Light')}
    </div>
  )
}
