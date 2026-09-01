import { useEffect, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { CloseIcon } from '@/components/icons'
import { formatReaderContent, type ReaderDoc } from '@/reader-format'
import { pageText as shellPageText } from '../../../webui/shell'
import './ReaderView.css'

/**
 * Reader Mode — a distraction-free reading overlay for the active tab.
 *
 * The staged page renders in a native WebContentsView layered OVER the DOM, so
 * the only way to read its content here is the Mojo Shell's page-text API. On
 * open this raises the shared overlay count (Stage hides the native view while
 * overlayCount > 0), fetches `pageText.get(0)`, formats it into clean
 * typography via `formatReaderContent`, and renders it as an in-DOM reading
 * column the now-hidden page sits behind.
 *
 * Off the fork there is no Mojo Shell and `pageText.get` rejects — the error
 * state explains the reader needs the WebDeck browser build rather than
 * surfacing a wiring error. Font size, column width, and theme persist in
 * localStorage (guarded, so a private window or blocked storage just falls back
 * to defaults).
 */

type ReaderTheme = 'light' | 'sepia' | 'dark'
type ReaderWidth = 'narrow' | 'wide'
type FetchStatus = 'loading' | 'ready' | 'error'

const FONT_MIN = 15
const FONT_MAX = 26
const FONT_STEP = 2
const FONT_DEFAULT = 19
const WIDTH_PX: Record<ReaderWidth, number> = { narrow: 640, wide: 820 }

const LS_FONT = 'wd.reader.fontSize'
const LS_WIDTH = 'wd.reader.width'
const LS_THEME = 'wd.reader.theme'

/** Read one localStorage key, tolerating private windows / blocked storage. */
function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write one localStorage key, swallowing quota / access failures. */
function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — preferences simply do not persist this session */
  }
}

function initialFontSize(): number {
  const raw = readLocal(LS_FONT)
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isFinite(parsed) && parsed >= FONT_MIN && parsed <= FONT_MAX ? parsed : FONT_DEFAULT
}

function initialWidth(): ReaderWidth {
  return readLocal(LS_WIDTH) === 'wide' ? 'wide' : 'narrow'
}

function initialTheme(): ReaderTheme {
  const stored = readLocal(LS_THEME)
  return stored === 'sepia' || stored === 'dark' ? stored : 'light'
}

function clampFont(size: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, size))
}

const THEMES: { id: ReaderTheme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' }
]

export function ReaderView(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const title = useShellStore((s) => s.browserStates[s.activeTabId]?.title) || undefined
  const setOverlayOpen = useShellStore((s) => s.setOverlayOpen)
  const setReaderOpen = useShellStore((s) => s.setReaderOpen)

  const [status, setStatus] = useState<FetchStatus>('loading')
  const [doc, setDoc] = useState<ReaderDoc>({ blocks: [] })
  const [fontSize, setFontSize] = useState<number>(initialFontSize)
  const [width, setWidth] = useState<ReaderWidth>(initialWidth)
  const [theme, setTheme] = useState<ReaderTheme>(initialTheme)

  const panelRef = useRef<HTMLDivElement>(null)

  const close = (): void => setReaderOpen(false)

  // Hide the native page while the reader is up: raise the overlay count on
  // mount and lower it on unmount (close/tab-switch), so every true is paired
  // with exactly one false. ReaderView only mounts while readerOpen is set.
  useEffect(() => {
    setOverlayOpen(true)
    return () => setOverlayOpen(false)
  }, [setOverlayOpen])

  // Move focus into the panel on open so Escape and scroll keys land here, not
  // in whatever had focus behind the overlay.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // Read the active tab's rendered text, then format it. Off the fork this
  // rejects (no Mojo Shell) and drops to the error state. Guarded against a
  // tab switch resolving after teardown.
  useEffect(() => {
    let cancelled = false
    shellPageText
      .get(0)
      .then((text) => {
        if (cancelled) return
        setDoc(formatReaderContent(text, title))
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [activeTabId, title])

  const applyFont = (next: number): void => {
    const clamped = clampFont(next)
    setFontSize(clamped)
    writeLocal(LS_FONT, String(clamped))
  }
  const applyWidth = (next: ReaderWidth): void => {
    setWidth(next)
    writeLocal(LS_WIDTH, next)
  }
  const applyTheme = (next: ReaderTheme): void => {
    setTheme(next)
    writeLocal(LS_THEME, next)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const isEmpty = status === 'ready' && doc.blocks.length === 0

  return (
    <div
      ref={panelRef}
      className={`wd-reader wd-reader-${theme}`}
      role="dialog"
      aria-modal="true"
      aria-label="Reader mode"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="reader-view"
    >
      <div className="wd-reader-bar">
        <div className="wd-reader-group" role="group" aria-label="Font size">
          <button
            type="button"
            className="wd-reader-btn"
            onClick={() => applyFont(fontSize - FONT_STEP)}
            disabled={fontSize <= FONT_MIN}
            aria-label="Decrease font size"
            title="Smaller text"
          >
            <span style={{ fontSize: 11 }}>A</span>
          </button>
          <button
            type="button"
            className="wd-reader-btn"
            onClick={() => applyFont(fontSize + FONT_STEP)}
            disabled={fontSize >= FONT_MAX}
            aria-label="Increase font size"
            title="Larger text"
          >
            <span style={{ fontSize: 15 }}>A</span>
          </button>
        </div>

        <span className="wd-reader-sep" aria-hidden="true" />

        <div className="wd-reader-group" role="group" aria-label="Column width">
          <button
            type="button"
            className="wd-reader-btn"
            onClick={() => applyWidth('narrow')}
            aria-pressed={width === 'narrow'}
            title="Narrow column"
          >
            Narrow
          </button>
          <button
            type="button"
            className="wd-reader-btn"
            onClick={() => applyWidth('wide')}
            aria-pressed={width === 'wide'}
            title="Wide column"
          >
            Wide
          </button>
        </div>

        <span className="wd-reader-sep" aria-hidden="true" />

        <div className="wd-reader-group" role="group" aria-label="Reading theme">
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              className="wd-reader-btn"
              onClick={() => applyTheme(option.id)}
              aria-pressed={theme === option.id}
              title={`${option.label} theme`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="wd-reader-btn"
          style={{ marginLeft: 'auto' }}
          onClick={close}
          aria-label="Close reader mode"
          title="Close (Esc)"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      {status === 'loading' && (
        <div className="wd-reader-state" data-testid="reader-loading">
          <div className="wd-reader-state-sub">Loading readable text…</div>
        </div>
      )}

      {status === 'error' && (
        <div className="wd-reader-state" data-testid="reader-error">
          <div className="wd-reader-state-title">Reader mode isn&apos;t available here</div>
          <div className="wd-reader-state-sub">
            Reader mode needs the WebDeck browser build to read the page&apos;s text.
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="wd-reader-state" data-testid="reader-empty">
          <div className="wd-reader-state-title">Nothing to read</div>
          <div className="wd-reader-state-sub">No readable text was found on this page.</div>
        </div>
      )}

      {status === 'ready' && !isEmpty && (
        <article
          className="wd-reader-article"
          style={{ maxWidth: WIDTH_PX[width], fontSize }}
          data-testid="reader-content"
        >
          {doc.title && <h1 className="wd-reader-title">{doc.title}</h1>}
          {doc.blocks.map((block, index) =>
            block.kind === 'heading' ? (
              <h2 key={index} className="wd-reader-heading">
                {block.text}
              </h2>
            ) : (
              <p key={index} className="wd-reader-para">
                {block.text}
              </p>
            )
          )}
        </article>
      )}
    </div>
  )
}
