import { applyColors } from '@/appearance'
import { useEffect } from 'react'
import { useShellStore, type Theme } from '@/store'

const STORAGE_KEY = 'agweb.theme'

export function loadInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // storage unavailable — fall through to media query
  }
  // Dark by default, not by OS preference: the Glass direction is a dark
  // design, and the light palette is a variation on it. Someone who wants
  // light can pick it in Settings, and that choice persists.
  return 'dark'
}

/** Applies the theme to the DOM, persists it, and mirrors it to nativeTheme. */
export function useThemeEffect(): void {
  const theme = useShellStore((s) => s.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    // User colour overrides are per theme, so they follow the switch.
    applyColors(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // non-fatal
    }
    void window.agweb.setTheme(theme)
  }, [theme])
}
