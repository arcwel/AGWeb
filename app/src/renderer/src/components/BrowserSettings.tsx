import { useEffect, useState } from 'react'
import { browserPrefs, type BrowserDefaultState } from '../../../webui/shell'

/**
 * Browser — the Chromium browser-level preferences.
 *
 * A WebDeck window blocks every chrome:// URL except chrome://webdeck, so native
 * chrome://settings is unreachable. This panel surfaces the browser prefs that
 * would otherwise live there — third-party cookies, Do Not Track, HTTPS-Only,
 * preloading, clearing real browsing data, and the default-browser control —
 * over the Mojo Shell (see BROWSER_PREFS_PLAN.md and app/src/webui/shell.ts
 * `browserPrefs`).
 *
 * These are Chromium's own prefs, so the panel only does anything on the fork
 * (the chromium host). Under Electron, WebDeck draws its own chrome and none of
 * these exist; the panel says so rather than offering dead switches. The default
 * SEARCH ENGINE is deliberately NOT here — it already lives in Application
 * settings — so this panel links there instead of duplicating it.
 */

/** Time ranges offered for the real Chromium browsing-data clear. */
const TIME_RANGES: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Last hour' },
  { value: 1, label: 'Last 24 hours' },
  { value: 2, label: 'Last 7 days' },
  { value: 3, label: 'Last 4 weeks' },
  { value: 4, label: 'All time' }
]

interface PrefsSnapshot {
  cookieBlock: boolean
  dnt: boolean
  httpsOnly: boolean
  preload: boolean
  adblock: boolean
}

export function BrowserSettings(): React.JSX.Element {
  const ownsBrowser = window.agweb.host.ownsBrowserFeatures

  const [prefs, setPrefs] = useState<PrefsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Requests the host-level blocker has dropped; null until first read (and off
  // the fork, where the read rejects) so the badge simply doesn't show.
  const [blockedCount, setBlockedCount] = useState<number | null>(null)

  // Clear-browsing-data selection.
  const [clearCookies, setClearCookies] = useState(true)
  const [clearCache, setClearCache] = useState(true)
  const [clearHistory, setClearHistory] = useState(false)
  const [timeRange, setTimeRange] = useState(4)
  const [clearing, setClearing] = useState(false)

  // Default-browser status: undefined while first loading.
  const [defaultState, setDefaultState] = useState<BrowserDefaultState | undefined>(undefined)
  const [makingDefault, setMakingDefault] = useState(false)

  useEffect(() => {
    if (!ownsBrowser) return
    let live = true
    void (async (): Promise<void> => {
      try {
        const [cookieBlock, dnt, httpsOnly, preload, adblock] = await Promise.all([
          browserPrefs.getBlockThirdPartyCookies(),
          browserPrefs.getSendDoNotTrack(),
          browserPrefs.getHttpsOnlyMode(),
          browserPrefs.getPreloadPages(),
          browserPrefs.getAdblockEnabled()
        ])
        if (live) setPrefs({ cookieBlock, dnt, httpsOnly, preload, adblock })
      } catch (err) {
        if (live) setError((err as Error).message)
      }
      try {
        const count = await browserPrefs.getAdblockBlockedCount()
        if (live) setBlockedCount(count)
      } catch {
        // Leave blockedCount null; the badge simply doesn't show.
      }
      try {
        const state = await browserPrefs.getDefaultBrowserState()
        if (live) setDefaultState(state)
      } catch {
        // Leave defaultState undefined; the row shows "Unknown".
      }
    })()
    return () => {
      live = false
    }
  }, [ownsBrowser])

  const flash = (message: string): void => {
    setStatus(message)
    setTimeout(() => setStatus(null), 3000)
  }

  const toggle = async (key: keyof PrefsSnapshot, value: boolean): Promise<void> => {
    if (!prefs) return
    // Optimistic: reflect the switch immediately, roll back on failure.
    const previous = prefs
    setPrefs({ ...prefs, [key]: value })
    try {
      if (key === 'cookieBlock') await browserPrefs.setBlockThirdPartyCookies(value)
      else if (key === 'dnt') await browserPrefs.setSendDoNotTrack(value)
      else if (key === 'httpsOnly') await browserPrefs.setHttpsOnlyMode(value)
      else if (key === 'preload') await browserPrefs.setPreloadPages(value)
      else await browserPrefs.setAdblockEnabled(value)
      setError(null)
      // The blocked count only means something while the blocker is on; refresh
      // it when the user turns it on so the badge reflects the live figure.
      if (key === 'adblock' && value) {
        try {
          setBlockedCount(await browserPrefs.getAdblockBlockedCount())
        } catch {
          // Keep the last known count; a failed read shouldn't clear the badge.
        }
      }
    } catch (err) {
      setPrefs(previous)
      setError((err as Error).message)
    }
  }

  const clearNow = async (): Promise<void> => {
    setClearing(true)
    try {
      await browserPrefs.clearBrowsingData(clearCookies, clearCache, clearHistory, timeRange)
      flash('Browsing data cleared.')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
    setClearing(false)
  }

  const makeDefault = async (): Promise<void> => {
    setMakingDefault(true)
    try {
      const state = await browserPrefs.makeDefaultBrowser()
      setDefaultState(state)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
    setMakingDefault(false)
  }

  if (!ownsBrowser) {
    return (
      <div className="flex flex-col gap-4 p-3 text-[12px]">
        <p className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--wd-dim)]">
          Browser preferences are managed by the browser itself. On this build WebDeck runs inside
          its own window and draws its own chrome, so Chromium’s cookie, tracking, HTTPS-Only and
          default-browser settings aren’t available here. They appear on the Arcwel WebDeck build.
        </p>
      </div>
    )
  }

  const nothingToClear = !clearCookies && !clearCache && !clearHistory

  return (
    <div className="flex flex-col gap-4 p-3 text-[12px]">
      <Section title="Privacy & security">
        {prefs ? (
          <>
            <Toggle
              label="Block third-party cookies"
              hint="Stops sites you don’t visit directly from setting cookies to track you across the web."
              checked={prefs.cookieBlock}
              onChange={(v) => void toggle('cookieBlock', v)}
            />
            <Toggle
              label="Send “Do Not Track”"
              hint="Ask sites not to track you. Honouring it is up to them."
              checked={prefs.dnt}
              onChange={(v) => void toggle('dnt', v)}
            />
            <Toggle
              label="Always use secure connections (HTTPS-Only)"
              hint="Warn before loading any site over plain HTTP."
              checked={prefs.httpsOnly}
              onChange={(v) => void toggle('httpsOnly', v)}
            />
            <Toggle
              label="Preload pages"
              hint="Let Chromium prefetch pages it predicts you’ll open, for faster browsing. Uses more data."
              checked={prefs.preload}
              onChange={(v) => void toggle('preload', v)}
            />
            <Toggle
              label="Block ads and trackers"
              hint="Drops known ad and tracker requests before they load, using a built-in blocklist. Not a full ad blocker."
              checked={prefs.adblock}
              onChange={(v) => void toggle('adblock', v)}
            />
            {prefs.adblock && blockedCount !== null && (
              <p className="px-2 pl-9 text-[11px] text-[var(--wd-dim)]">
                {blockedCount.toLocaleString()} requests blocked
              </p>
            )}
          </>
        ) : (
          <p className="px-2 py-1 text-[11px] text-[var(--wd-dim)]">Reading preferences…</p>
        )}
      </Section>

      <Section title="Clear browsing data">
        <p className="px-2 pb-1 text-[11px] leading-relaxed text-[var(--wd-dim)]">
          Clears Chromium’s real browsing data for this profile — cookies sign you out, the cache is
          emptied, history is removed.
        </p>
        <div className="flex flex-wrap items-center gap-3 px-2 py-1">
          <label className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              className="accent-[var(--wd-accent)]"
              checked={clearCookies}
              onChange={(e) => setClearCookies(e.target.checked)}
            />
            Cookies
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              className="accent-[var(--wd-accent)]"
              checked={clearCache}
              onChange={(e) => setClearCache(e.target.checked)}
            />
            Cached files
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              className="accent-[var(--wd-accent)]"
              checked={clearHistory}
              onChange={(e) => setClearHistory(e.target.checked)}
            />
            History
          </label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="ml-auto flex-none rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
            aria-label="Time range"
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void clearNow()}
          disabled={nothingToClear || clearing}
          className="mx-2 mt-1 w-fit rounded-md bg-rose-500/90 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear now'}
        </button>
      </Section>

      <Section title="Default browser">
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--wd-text)]">
            {defaultState === 1
              ? 'WebDeck is your default browser.'
              : defaultState === 0
                ? 'WebDeck is not your default browser.'
                : 'Default-browser status is unknown.'}
            <span className="block text-[11px] text-[var(--wd-dim)]">
              Open http and https links in WebDeck.
            </span>
          </span>
          {defaultState !== 1 && (
            <button
              onClick={() => void makeDefault()}
              disabled={makingDefault}
              className="flex-none rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
            >
              {makingDefault ? 'Working…' : 'Make WebDeck default'}
            </button>
          )}
        </div>
      </Section>

      <Section title="Search">
        <p className="px-2 py-1 text-[11px] leading-relaxed text-[var(--wd-dim)]">
          The address-bar search engine lives in the{' '}
          <span className="font-medium text-[var(--wd-muted)]">Application</span> tab, so it isn’t
          repeated here.
        </p>
      </Section>

      {status && <span className="px-2 text-[11px] text-emerald-500">{status}</span>}
      {error && (
        <span className="px-2 text-[11px] text-rose-500" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]">
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--wd-accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-medium text-[var(--wd-text)]">{label}</span>
        <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
      </span>
    </label>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
        {title}
      </h3>
      {children}
    </section>
  )
}
