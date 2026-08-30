/**
 * User-settable colours (feedback item 2).
 *
 * Every colour the shell paints comes from a CSS custom property, so making
 * them themeable is a matter of letting the user write those properties rather
 * than rewriting components. Values are stored as RGBA so translucent surfaces
 * — the glass, the hairlines, the accent washes — stay adjustable, not just
 * the opaque ones.
 *
 * Overrides are per theme: the light and dark palettes are different designs,
 * and a colour picked for one is rarely right for the other.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface ColorToken {
  /** CSS custom property, without the leading `--`. */
  token: string
  label: string
  hint: string
  /** Grouping in the settings panel. */
  group: 'Accent' | 'Surfaces' | 'Text'
}

/**
 * The full set of colours the app paints, in the order they matter.
 *
 * `--wd-accent` is first because it is the one people actually want to change;
 * the rest are here so "everything we have coloured" is literally true.
 */
export const COLOR_TOKENS: ColorToken[] = [
  {
    token: 'wd-accent',
    label: 'Accent',
    hint: 'Buttons, active tabs, selection, focus',
    group: 'Accent'
  },
  {
    token: 'wd-accent-ink',
    label: 'Accent text',
    hint: 'Text drawn on top of the accent',
    group: 'Accent'
  },
  {
    token: 'wd-accent-soft',
    label: 'Accent wash',
    hint: 'Tinted backgrounds — active icons, selected rows',
    group: 'Accent'
  },
  {
    token: 'wd-accent-line',
    label: 'Accent border',
    hint: 'Outlines on accented controls',
    group: 'Accent'
  },
  {
    token: 'wd-accent-2',
    label: 'Secondary',
    hint: 'The second ambient glow and group colors',
    group: 'Accent'
  },

  { token: 'wd-bg', label: 'Background', hint: 'The window behind everything', group: 'Surfaces' },
  { token: 'wd-glass', label: 'Glass', hint: 'Frosted chrome and menus', group: 'Surfaces' },
  {
    token: 'wd-glass-border',
    label: 'Glass border',
    hint: 'The edge on frosted surfaces',
    group: 'Surfaces'
  },
  { token: 'wd-well', label: 'Block', hint: 'Panel interiors', group: 'Surfaces' },
  { token: 'wd-field', label: 'Field', hint: 'Inputs and the address bar', group: 'Surfaces' },
  { token: 'wd-hairline', label: 'Divider', hint: 'Separators inside panels', group: 'Surfaces' },
  {
    token: 'wd-hover',
    label: 'Hover',
    hint: 'The wash under a hovered control',
    group: 'Surfaces'
  },

  { token: 'wd-text', label: 'Text', hint: 'Primary text', group: 'Text' },
  { token: 'wd-muted', label: 'Muted', hint: 'Secondary text and icons', group: 'Text' },
  { token: 'wd-dim', label: 'Dim', hint: 'Captions and placeholders', group: 'Text' },
  { token: 'wd-faint', label: 'Faint', hint: 'Disabled text, line numbers', group: 'Text' }
]

const STORAGE_KEY = 'agweb.colors'

type Overrides = Record<string, Record<string, string>>

function load(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Overrides) : {}
  } catch {
    return {}
  }
}

let overrides: Overrides = load()

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // storage unavailable — colours just won't survive a restart
  }
}

/**
 * The Tailwind `sky` scale, which the theme remaps to the accent, is what most
 * buttons, tabs and rings are painted with (`bg-sky-500`, `hover:bg-sky-600`,
 * …). Those utilities resolve to `--color-sky-*`, so changing only `--wd-accent`
 * left every sky-based control on the original teal. When the accent is
 * customised we regenerate the whole ramp from it, and the washes too, so the
 * new colour actually reaches the buttons.
 */
const SKY_SHADES: Array<[number, number]> = [
  // shade → mix amount: negative mixes toward white, positive toward black.
  [50, -0.9],
  [100, -0.8],
  [200, -0.6],
  [300, -0.4],
  [400, -0.18],
  [500, 0],
  [600, 0.16],
  [700, 0.3],
  [800, 0.42],
  [900, 0.52]
]

function mixToward(c: Rgba, amount: number): Rgba {
  const target = amount < 0 ? 255 : 0
  const t = Math.abs(amount)
  const chan = (v: number): number => Math.round(v + (target - v) * t)
  return { r: chan(c.r), g: chan(c.g), b: chan(c.b), a: 1 }
}

function applyAccentRamp(accent: Rgba): void {
  const root = document.documentElement
  for (const [shade, amount] of SKY_SHADES) {
    root.style.setProperty(`--color-sky-${shade}`, toHex(mixToward(accent, amount)))
  }
}

function clearAccentRamp(): void {
  const root = document.documentElement
  for (const [shade] of SKY_SHADES) root.style.removeProperty(`--color-sky-${shade}`)
}

/** Apply the overrides for a theme, clearing any that belong to the other. */
export function applyColors(theme: 'light' | 'dark'): void {
  const root = document.documentElement
  for (const { token } of COLOR_TOKENS) root.style.removeProperty(`--${token}`)
  for (const [token, value] of Object.entries(overrides[theme] ?? {})) {
    root.style.setProperty(`--${token}`, value)
  }

  // When the accent is customised, propagate it to the Tailwind ramp and the
  // washes so buttons, tabs and tinted surfaces follow — unless the user set
  // those washes explicitly, in which case their choice wins.
  const accentOverride = overrides[theme]?.['wd-accent']
  if (accentOverride) {
    const accent = parseColor(accentOverride)
    applyAccentRamp(accent)
    if (!hasOverride(theme, 'wd-accent-soft')) {
      root.style.setProperty(
        '--wd-accent-soft',
        `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.14)`
      )
    }
    if (!hasOverride(theme, 'wd-accent-line')) {
      root.style.setProperty(
        '--wd-accent-line',
        `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.26)`
      )
    }
  } else {
    clearAccentRamp()
  }
}

export function setColor(theme: 'light' | 'dark', token: string, value: string): void {
  overrides = { ...overrides, [theme]: { ...(overrides[theme] ?? {}), [token]: value } }
  persist()
  applyColors(theme)
}

export function resetColor(theme: 'light' | 'dark', token: string): void {
  const forTheme = { ...(overrides[theme] ?? {}) }
  delete forTheme[token]
  overrides = { ...overrides, [theme]: forTheme }
  persist()
  applyColors(theme)
}

export function resetAllColors(theme: 'light' | 'dark'): void {
  overrides = { ...overrides, [theme]: {} }
  persist()
  applyColors(theme)
}

export function hasOverride(theme: 'light' | 'dark', token: string): boolean {
  return overrides[theme]?.[token] !== undefined
}

/**
 * The colour a token currently resolves to.
 *
 * Read from the computed style rather than the override map, so an untouched
 * token reports the stylesheet's own value and the picker opens on what the
 * user can actually see.
 */
export function currentColor(token: string): Rgba {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim()
  return parseColor(raw)
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()`. */
export function parseColor(input: string): Rgba {
  const value = input.trim()

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (rgb) {
    const parts = rgb[1].split(/[,/]/).map((p) => parseFloat(p))
    return {
      r: clamp255(parts[0]),
      g: clamp255(parts[1]),
      b: clamp255(parts[2]),
      a: parts[3] === undefined || Number.isNaN(parts[3]) ? 1 : Math.min(1, Math.max(0, parts[3]))
    }
  }

  const hex = value.replace('#', '')
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1
    }
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    }
  }
  // Unparseable (a named colour, or empty): mid grey is a visible, harmless
  // starting point rather than a crash.
  return { r: 128, g: 128, b: 128, a: 1 }
}

function clamp255(n: number): number {
  return Number.isNaN(n) ? 0 : Math.min(255, Math.max(0, Math.round(n)))
}

export function toCss({ r, g, b, a }: Rgba): string {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
}

export function toHex({ r, g, b }: Rgba): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
