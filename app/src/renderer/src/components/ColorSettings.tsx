import { useEffect, useState } from 'react'
import {
  COLOR_TOKENS,
  currentColor,
  hasOverride,
  parseColor,
  resetAllColors,
  resetColor,
  setColor,
  toCss,
  toHex,
  type ColorToken,
  type Rgba
} from '@/appearance'
import { useShellStore } from '@/store'
import { EditorThemeSettings } from '@/components/EditorThemeSettings'

/**
 * Color customisation.
 *
 * Every color the shell paints, editable as RGBA. Alpha matters as much as hue
 * here: the glass, the hairlines and the accent washes are all translucent, and
 * an opaque-only picker would flatten the design the first time anyone touched
 * it.
 *
 * The picker stays open until you're done — it closes only on Done, Escape, or
 * opening a different color, never on a stray click — because choosing a color
 * is a deliberate back-and-forth, not a single tap. A live preview at the top
 * shows the effect on real controls as you drag.
 *
 * Overrides are per theme, because the light and dark palettes are different
 * designs rather than inversions of one another.
 */

const GROUPS = ['Accent', 'Surfaces', 'Text'] as const

export function ColorSettings(): React.JSX.Element {
  const theme = useShellStore((s) => s.theme)
  // Re-render after any change so every swatch and the preview reflect the
  // live value.
  // Bumped on every change so swatches re-render; the value itself is unread —
  // the re-render is the point.
  const [, bump] = useState(0)
  const [openToken, setOpenToken] = useState<string | null>(null)

  const changed = (): void => bump((n) => n + 1)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--wd-hairline)] px-2.5 py-1.5">
        <span className="wd-cap">Color</span>
        <span className="text-[10px] text-[var(--wd-dim)]">{theme} theme</span>
        <button
          onClick={() => {
            resetAllColors(theme)
            changed()
          }}
          className="ml-auto text-[10px] font-semibold text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
        >
          Reset all
        </button>
      </div>

      <EditorThemeSettings theme={theme} />

      {/* Preview paints from the live CSS custom properties, so it reflects
          edits automatically — no key needed. */}
      <Preview />

      {GROUPS.map((group) => (
        <div key={group}>
          <div className="wd-cap px-2.5 pt-2 pb-1">{group}</div>
          {COLOR_TOKENS.filter((t) => t.group === group).map((token) => (
            <ColorRow
              // Stable key: a revision-keyed row would remount (and close) the
              // open picker on every slider drag, which is exactly the bug where
              // the picker "instantly goes away". `revision` still re-renders the
              // row so the swatch refreshes; it just must not force a remount.
              key={`${token.token}-${theme}`}
              token={token}
              theme={theme}
              isOpen={openToken === token.token}
              onOpen={() => setOpenToken(openToken === token.token ? null : token.token)}
              onDone={() => setOpenToken(null)}
              onChange={changed}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * A live example of what the colors do.
 *
 * The panel edits abstract tokens, so this shows the concrete result — a
 * primary button, an active tab, an input, accent text and a wash — all painted
 * from the same tokens, updating as you drag a slider.
 */
function Preview(): React.JSX.Element {
  return (
    <div className="border-b border-[var(--wd-hairline)] px-2.5 py-2.5">
      <div className="wd-cap mb-1.5">Preview</div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--wd-accent)', color: 'var(--wd-accent-ink)' }}
        >
          Primary
        </button>
        <button className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-600">
          Button
        </button>
        <span
          className="rounded-md px-2 py-1 text-[11px] font-medium"
          style={{
            background: 'var(--wd-accent-soft)',
            color: 'var(--wd-accent)',
            border: '1px solid var(--wd-accent-line)'
          }}
        >
          Active tab
        </span>
        {/* A swatch showing what a field looks like, not a control. It was in
            the tab order and announced as an unlabelled text box. */}
        <input
          readOnly
          aria-hidden
          tabIndex={-1}
          value="Field"
          className="w-16 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] text-[var(--wd-text)]"
        />
      </div>
      <div className="mt-1.5 text-[11px]">
        <span style={{ color: 'var(--wd-text)' }}>Text</span>{' '}
        <span style={{ color: 'var(--wd-muted)' }}>muted</span>{' '}
        <span style={{ color: 'var(--wd-dim)' }}>dim</span>{' '}
        <span style={{ color: 'var(--wd-accent)' }}>accent link</span>
      </div>
    </div>
  )
}

function ColorRow({
  token,
  theme,
  isOpen,
  onOpen,
  onDone,
  onChange
}: {
  token: ColorToken
  theme: 'light' | 'dark'
  isOpen: boolean
  onOpen: () => void
  onDone: () => void
  onChange: () => void
}): React.JSX.Element {
  const value = currentColor(token.token)
  const overridden = hasOverride(theme, token.token)

  return (
    <div className="flex flex-col">
      <div className="group flex items-center gap-2 px-2.5 py-1">
        <button
          onClick={onOpen}
          className={`h-5 w-9 flex-none rounded border ${
            isOpen ? 'border-[var(--wd-accent)]' : 'border-[var(--wd-glass-border)]'
          }`}
          // The checkerboard shows through translucent values, so alpha is
          // visible in the swatch rather than only in the number.
          style={{
            backgroundImage: `linear-gradient(${toCss(value)}, ${toCss(value)}), repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)`,
            backgroundSize: 'auto, 8px 8px'
          }}
          aria-label={`Change ${token.label}`}
          data-testid={`color-${token.token}`}
        />
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[11px] text-[var(--wd-text)]">{token.label}</div>
          <div className="truncate text-[10px] text-[var(--wd-dim)]">{token.hint}</div>
        </button>
        {overridden && (
          <button
            onClick={() => {
              resetColor(theme, token.token)
              onChange()
            }}
            className="flex-none text-[10px] text-[var(--wd-dim)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[var(--wd-text)]"
            title="Restore the default"
          >
            reset
          </button>
        )}
      </div>

      {isOpen && (
        <RgbaPicker
          label={token.label}
          value={value}
          onChange={(next) => {
            setColor(theme, token.token, toCss(next))
            onChange()
          }}
          onDone={onDone}
        />
      )}
    </div>
  )
}

/** Hue/RGB channels plus alpha, with a hex field for pasting a brand color. */
function RgbaPicker({
  label,
  value,
  onChange,
  onDone
}: {
  label: string
  value: Rgba
  onChange: (next: Rgba) => void
  onDone: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Rgba>(value)
  const [hex, setHex] = useState(toHex(value))

  // Escape closes; it never closes on an outside click, so the OS color dialog
  // and the sliders can be used freely without dismissing the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  const update = (next: Rgba): void => {
    setDraft(next)
    setHex(toHex(next))
    onChange(next)
  }

  const channel = (key: 'r' | 'g' | 'b', label: string): React.JSX.Element => (
    <label className="flex items-center gap-2">
      <span className="w-3 text-[10px] text-[var(--wd-dim)]">{label}</span>
      {/* Both inputs sit inside one label, so a screen reader announced both
          as just "R". Name them apart. */}
      <input
        type="range"
        min={0}
        max={255}
        value={draft[key]}
        aria-label={`${label} slider`}
        onChange={(e) => update({ ...draft, [key]: Number(e.target.value) })}
        className="h-1 flex-1 accent-[var(--wd-accent)]"
      />
      <input
        type="number"
        min={0}
        max={255}
        value={draft[key]}
        aria-label={`${label} value`}
        onChange={(e) => update({ ...draft, [key]: Number(e.target.value) })}
        className="w-11 rounded border border-[var(--wd-glass-border)] bg-transparent px-1 py-0.5 text-right text-[10px] outline-none"
      />
    </label>
  )

  return (
    <div className="mx-2.5 mb-2 flex flex-col gap-2 rounded-[12px] border border-[var(--wd-glass-border)] bg-[var(--wd-well)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[var(--wd-text)]">{label}</span>
        <button
          onClick={onDone}
          className="rounded-md bg-[var(--wd-accent)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--wd-accent-ink)]"
        >
          Done
        </button>
      </div>
      {/* The OS picker for choosing a hue quickly... */}
      <input
        type="color"
        value={hex}
        onChange={(e) => update({ ...draft, ...parseColor(e.target.value) })}
        className="h-8 w-full cursor-pointer rounded border border-[var(--wd-glass-border)] bg-transparent"
        aria-label="Pick a color"
      />
      {/* ...and the channels, because the OS picker cannot do alpha. */}
      {channel('r', 'R')}
      {channel('g', 'G')}
      {channel('b', 'B')}
      <label className="flex items-center gap-2">
        <span className="w-3 text-[10px] text-[var(--wd-dim)]">A</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={draft.a}
          onChange={(e) => update({ ...draft, a: Number(e.target.value) })}
          className="h-1 flex-1 accent-[var(--wd-accent)]"
        />
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={draft.a}
          onChange={(e) => update({ ...draft, a: Number(e.target.value) })}
          className="w-11 rounded border border-[var(--wd-glass-border)] bg-transparent px-1 py-0.5 text-right text-[10px] outline-none"
        />
      </label>

      <input
        value={hex}
        onChange={(e) => {
          setHex(e.target.value)
          if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) {
            update({ ...draft, ...parseColor(e.target.value) })
          }
        }}
        placeholder="#4fd4c4"
        className="m rounded border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[10px] outline-none focus:border-[var(--wd-accent-line)]"
        aria-label="Hex value"
      />
      <div className="m text-[9.5px] text-[var(--wd-dim)]">{toCss(draft)}</div>
    </div>
  )
}
