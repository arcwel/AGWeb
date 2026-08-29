import { useCallback, useState } from 'react'
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
import { usePopover } from '@/popover'

/**
 * Colour customisation (feedback item 2).
 *
 * Every colour the shell paints, editable as RGBA. Alpha matters as much as
 * hue here: the glass, the hairlines and the accent washes are all translucent,
 * and an opaque-only picker would flatten the design the first time anyone
 * touched it.
 *
 * Overrides are per theme, because the light and dark palettes are different
 * designs rather than inversions of one another.
 */

const GROUPS = ['Accent', 'Surfaces', 'Text'] as const

export function ColorSettings(): React.JSX.Element {
  const theme = useShellStore((s) => s.theme)
  // Re-render after any change so every swatch reflects the live value.
  const [revision, bump] = useState(0)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--wd-hairline)] px-2.5 py-1.5">
        <span className="wd-cap">Colours</span>
        <span className="text-[10px] text-[var(--wd-dim)]">{theme} theme</span>
        <button
          onClick={() => {
            resetAllColors(theme)
            bump((n) => n + 1)
          }}
          className="ml-auto text-[10px] font-semibold text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
        >
          Reset all
        </button>
      </div>

      {GROUPS.map((group) => (
        <div key={group}>
          <div className="wd-cap px-2.5 pt-2 pb-1">{group}</div>
          {COLOR_TOKENS.filter((t) => t.group === group).map((token) => (
            <ColorRow
              key={`${token.token}-${theme}-${revision}`}
              token={token}
              theme={theme}
              onChange={() => bump((n) => n + 1)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function ColorRow({
  token,
  theme,
  onChange
}: {
  token: ColorToken
  theme: 'light' | 'dark'
  onChange: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )
  const value = currentColor(token.token)
  const overridden = hasOverride(theme, token.token)

  return (
    <div ref={ref} className="group relative flex items-center gap-2 px-2.5 py-1">
      <button
        onClick={() => setOpen(!open)}
        className="h-5 w-9 flex-none rounded border border-[var(--wd-glass-border)]"
        // The checkerboard shows through translucent values, so alpha is
        // visible in the swatch rather than only in the number.
        style={{
          backgroundImage: `linear-gradient(${toCss(value)}, ${toCss(value)}), repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)`,
          backgroundSize: 'auto, 8px 8px'
        }}
        aria-label={`Change ${token.label}`}
        data-testid={`color-${token.token}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--wd-text)]">{token.label}</div>
        <div className="truncate text-[10px] text-[var(--wd-dim)]">{token.hint}</div>
      </div>
      {overridden && (
        <button
          onClick={() => {
            resetColor(theme, token.token)
            onChange()
          }}
          className="flex-none text-[10px] text-[var(--wd-dim)] opacity-0 group-hover:opacity-100 hover:text-[var(--wd-text)]"
          title="Restore the default"
        >
          reset
        </button>
      )}

      {open && (
        <RgbaPicker
          value={value}
          onChange={(next) => {
            setColor(theme, token.token, toCss(next))
            onChange()
          }}
        />
      )}
    </div>
  )
}

/** Hue/RGB channels plus alpha, with a hex field for pasting a brand colour. */
function RgbaPicker({
  value,
  onChange
}: {
  value: Rgba
  onChange: (next: Rgba) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Rgba>(value)
  const [hex, setHex] = useState(toHex(value))

  const update = (next: Rgba): void => {
    setDraft(next)
    setHex(toHex(next))
    onChange(next)
  }

  const channel = (key: 'r' | 'g' | 'b', label: string): React.JSX.Element => (
    <label className="flex items-center gap-2">
      <span className="w-3 text-[10px] text-[var(--wd-dim)]">{label}</span>
      <input
        type="range"
        min={0}
        max={255}
        value={draft[key]}
        onChange={(e) => update({ ...draft, [key]: Number(e.target.value) })}
        className="h-1 flex-1 accent-[var(--wd-accent)]"
      />
      <input
        type="number"
        min={0}
        max={255}
        value={draft[key]}
        onChange={(e) => update({ ...draft, [key]: Number(e.target.value) })}
        className="w-11 rounded border border-[var(--wd-glass-border)] bg-transparent px-1 py-0.5 text-right text-[10px] outline-none"
      />
    </label>
  )

  return (
    <div className="glass absolute top-8 right-2 z-50 flex w-60 flex-col gap-2 rounded-[14px] p-3">
      {/* The OS picker for choosing a hue quickly... */}
      <input
        type="color"
        value={hex}
        onChange={(e) => update({ ...draft, ...parseColor(e.target.value) })}
        className="h-8 w-full cursor-pointer rounded border border-[var(--wd-glass-border)] bg-transparent"
        aria-label="Pick a colour"
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
