import { useCallback, useEffect, useMemo, useState } from 'react'
import { browserPrefs, type BrowserDefaultState } from '../../../webui/shell'
import type { SettingPref } from '@shared/ipc'
import { useShellStore } from '@/store'
import {
  BROWSER_SETTINGS,
  rowMatches,
  settingPrefNames,
  type CustomRowId,
  type SettingRow
} from '@/browser-settings-map'

/**
 * Chromium's settings, in WebDeck's own window.
 *
 * The sections, their order and their wording are Chrome's, because that is the
 * map people already know — and each row is provided the way Chrome provides it:
 *
 *  - a preference Chrome exposes as a switch or a dropdown is a switch or a
 *    dropdown here, writing the same pref chrome://settings writes (through an
 *    allowlist in the browser, so this page cannot name arbitrary prefs);
 *  - a setting Chrome hands to a subpage — passwords, payment methods,
 *    addresses, site permissions, search engines, languages, reset — is a row
 *    that opens Chromium's real page, the same move Chrome makes;
 *  - a few are WebDeck's own and stay in place: clearing data, the
 *    default-browser check, the ad blocker.
 *
 * Anything this build does not register is hidden rather than drawn dead, and
 * anything policy controls is disabled and says so — again, as Chrome does.
 */

const TIME_RANGES = [
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

type PrefMap = Record<string, SettingPref>

function parseValue(pref: SettingPref | undefined): boolean | number | string | undefined {
  if (!pref || pref.unavailable || !pref.jsonValue) return undefined
  try {
    return JSON.parse(pref.jsonValue) as boolean | number | string
  } catch {
    return undefined
  }
}

export function BrowserSettings(): React.JSX.Element {
  const ownsBrowser = window.agweb.host.ownsBrowserFeatures

  const [prefs, setPrefs] = useState<PrefsSnapshot | null>(null)
  const [chromePrefs, setChromePrefs] = useState<PrefMap>({})
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [blockedCount, setBlockedCount] = useState<number | null>(null)

  const [clearCookies, setClearCookies] = useState(true)
  const [clearCache, setClearCache] = useState(true)
  const [clearHistory, setClearHistory] = useState(false)
  const [timeRange, setTimeRange] = useState(4)
  const [clearing, setClearing] = useState(false)

  const [defaultState, setDefaultState] = useState<BrowserDefaultState | undefined>(undefined)
  const [makingDefault, setMakingDefault] = useState(false)

  const flash = useCallback((message: string): void => {
    setStatus(message)
    setTimeout(() => setStatus(null), 3000)
  }, [])

  const loadChromePrefs = useCallback(async (): Promise<void> => {
    try {
      const list = await browserPrefs.getSettingPrefs(settingPrefNames())
      const map: PrefMap = {}
      for (const pref of list) map[pref.name] = pref
      setChromePrefs(map)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

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
      if (live) await loadChromePrefs()
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
        // Leave defaultState undefined; the row says the status is unknown.
      }
    })()
    return () => {
      live = false
    }
  }, [ownsBrowser, loadChromePrefs])

  const toggle = async (key: keyof PrefsSnapshot, value: boolean): Promise<void> => {
    if (!prefs) return
    const previous = prefs
    setPrefs({ ...prefs, [key]: value })
    try {
      if (key === 'cookieBlock') await browserPrefs.setBlockThirdPartyCookies(value)
      else if (key === 'dnt') await browserPrefs.setSendDoNotTrack(value)
      else if (key === 'httpsOnly') await browserPrefs.setHttpsOnlyMode(value)
      else if (key === 'preload') await browserPrefs.setPreloadPages(value)
      else await browserPrefs.setAdblockEnabled(value)
      setError(null)
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

  /** Write one Chromium pref, then re-read so the UI shows what actually stuck. */
  const setPref = async (name: string, value: boolean | number | string): Promise<void> => {
    const before = chromePrefs[name]
    setChromePrefs((prev) => ({
      ...prev,
      [name]: { name, jsonValue: JSON.stringify(value), managed: false, unavailable: false }
    }))
    try {
      const ok = await browserPrefs.setSettingPref(name, value)
      if (!ok) {
        setChromePrefs((prev) => ({ ...prev, [name]: before }))
        setError(`That setting could not be changed. It may be controlled by your organisation.`)
        return
      }
      setError(null)
      await loadChromePrefs()
    } catch (err) {
      setChromePrefs((prev) => ({ ...prev, [name]: before }))
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

  const openPage = (url: string): void => {
    useShellStore.getState().newTab(url)
    useShellStore.getState().setSettingsOpen(false)
  }

  /** Hide a row whose pref this build does not register. */
  const rowAvailable = useCallback(
    (row: SettingRow): boolean => {
      if (row.kind === 'toggle' || row.kind === 'select' || row.kind === 'text') {
        const pref = chromePrefs[row.pref]
        // Until the first read lands, show it: a flash of a real control beats
        // a section that pops in late.
        return !pref || !pref.unavailable
      }
      if (row.kind === 'safeBrowsing') {
        return chromePrefs['safebrowsing.enabled']?.unavailable !== true
      }
      return true
    },
    [chromePrefs]
  )

  const sections = useMemo(
    () =>
      BROWSER_SETTINGS.map((section) => ({
        ...section,
        rows: section.rows.filter((row) => rowAvailable(row) && rowMatches(row, query))
      })).filter((section) => section.rows.length > 0),
    [rowAvailable, query]
  )

  if (!ownsBrowser) {
    return (
      <div className="flex flex-col gap-4 p-3 text-[12px]">
        <p className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--wd-dim)]">
          Browser preferences are managed by the browser itself. On this build WebDeck runs inside
          its own window and draws its own chrome, so Chromium&rsquo;s settings aren&rsquo;t
          available here.
        </p>
      </div>
    )
  }

  const nothingToClear = !clearCookies && !clearCache && !clearHistory

  const custom = (id: CustomRowId, label: string, hint: string): React.JSX.Element | null => {
    const simple: Partial<Record<CustomRowId, keyof PrefsSnapshot>> = {
      thirdPartyCookies: 'cookieBlock',
      doNotTrack: 'dnt',
      httpsOnly: 'httpsOnly',
      preloadPages: 'preload'
    }
    const key = simple[id]
    if (key) {
      return prefs ? (
        <Toggle
          label={label}
          hint={hint}
          checked={prefs[key]}
          onChange={(v) => void toggle(key, v)}
        />
      ) : null
    }
    switch (id) {
      case 'adblock':
        return prefs ? (
          <>
            <Toggle
              label={label}
              hint={hint}
              checked={prefs.adblock}
              onChange={(v) => void toggle('adblock', v)}
            />
            {prefs.adblock && blockedCount !== null && (
              <span className="block px-2 pl-9 text-[11px] text-[var(--wd-dim)]">
                {blockedCount.toLocaleString()} request{blockedCount === 1 ? '' : 's'} blocked
              </span>
            )}
          </>
        ) : null
      case 'theme':
        return (
          <Row label={label} hint={hint}>
            <span className="text-[11px] text-[var(--wd-dim)]">Chosen at the top of Settings</span>
          </Row>
        )
      case 'shellSearchEngine':
        // One writer per setting: the address-bar engine is WebDeck's own and
        // lives on the Application tab. Naming it here without a second control
        // is what keeps the two from disagreeing.
        return (
          <Row label={label} hint={hint}>
            <span className="text-[11px] text-[var(--wd-dim)]">On the Application tab</span>
          </Row>
        )
      case 'defaultBrowser':
        return (
          <Row
            label={label}
            hint={
              defaultState === 1
                ? 'WebDeck is your default browser.'
                : defaultState === 0
                  ? hint
                  : 'Default-browser status is unknown.'
            }
          >
            {defaultState !== 1 && (
              <button
                onClick={() => void makeDefault()}
                disabled={makingDefault}
                className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
              >
                {makingDefault ? 'Working…' : 'Make default'}
              </button>
            )}
          </Row>
        )
      case 'clearBrowsingData':
        return (
          <div className="rounded-lg px-2 py-1.5">
            <span className="block font-medium text-[var(--wd-text)]">{label}</span>
            <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {(
                [
                  ['Cookies', clearCookies, setClearCookies],
                  ['Cached files', clearCache, setClearCache],
                  ['History', clearHistory, setClearHistory]
                ] as const
              ).map(([itemLabel, checked, set]) => (
                <label key={itemLabel} className="flex items-center gap-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    className="accent-[var(--wd-accent)]"
                    checked={checked}
                    onChange={(e) => set(e.target.checked)}
                  />
                  {itemLabel}
                </label>
              ))}
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(Number(e.target.value))}
                aria-label="Time range"
                className="rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
              >
                {TIME_RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void clearNow()}
                disabled={clearing || nothingToClear}
                className="rounded-md bg-rose-500/90 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
              >
                {clearing ? 'Clearing…' : 'Clear now'}
              </button>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 text-[12px]">
      {/* Chrome puts a search box above its settings; so does this. */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search settings"
        aria-label="Search settings"
        data-testid="settings-search"
        className="w-full flex-none rounded-lg border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-3 py-1.5 text-[12px] outline-none focus:border-[var(--wd-accent)]"
      />

      {sections.length === 0 && (
        <p className="px-2 py-6 text-center text-[11px] text-[var(--wd-dim)]">
          Nothing matches that. Chromium&rsquo;s full settings are at{' '}
          <button
            onClick={() => openPage('chrome://settings/')}
            className="text-[var(--wd-accent)] hover:underline"
          >
            chrome://settings
          </button>
          .
        </p>
      )}

      {sections.map((section) => (
        <section key={section.id} className="flex flex-none flex-col gap-0.5">
          <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
            {section.title}
          </h3>
          {section.rows.map((row, index) => {
            const key = `${section.id}-${index}`
            if (row.kind === 'custom') {
              return <div key={key}>{custom(row.id, row.label, row.hint)}</div>
            }
            if (row.kind === 'link') {
              return (
                <button
                  key={key}
                  onClick={() => openPage(row.url)}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--wd-hover)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[var(--wd-text)]">{row.label}</span>
                    <span className="block text-[11px] text-[var(--wd-dim)]">{row.hint}</span>
                  </span>
                  <span className="flex-none text-[var(--wd-dim)]" aria-hidden>
                    &rsaquo;
                  </span>
                </button>
              )
            }
            if (row.kind === 'safeBrowsing') {
              return (
                <SafeBrowsing
                  key={key}
                  label={row.label}
                  hint={row.hint}
                  enabled={parseValue(chromePrefs['safebrowsing.enabled']) === true}
                  enhanced={parseValue(chromePrefs['safebrowsing.enhanced']) === true}
                  managed={chromePrefs['safebrowsing.enabled']?.managed === true}
                  onChange={(next) => {
                    void (async () => {
                      await setPref('safebrowsing.enabled', next !== 'off')
                      await setPref('safebrowsing.enhanced', next === 'enhanced')
                    })()
                  }}
                />
              )
            }
            const pref = chromePrefs[row.pref]
            const managed = pref?.managed === true
            if (row.kind === 'toggle') {
              return (
                <Toggle
                  key={key}
                  label={row.label}
                  hint={managed ? `${row.hint} Managed by your organisation.` : row.hint}
                  checked={parseValue(pref) === true}
                  disabled={managed}
                  restart={row.restart}
                  onChange={(v) => void setPref(row.pref, v)}
                />
              )
            }
            if (row.kind === 'select') {
              const value = parseValue(pref)
              return (
                <Row key={key} label={row.label} hint={row.hint}>
                  <select
                    value={String(value ?? '')}
                    disabled={managed}
                    aria-label={row.label}
                    onChange={(e) => {
                      const chosen = row.options.find((o) => String(o.value) === e.target.value)
                      if (chosen) void setPref(row.pref, chosen.value)
                    }}
                    className="max-w-[15rem] rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)] disabled:opacity-50"
                  >
                    {row.options.map((option) => (
                      <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Row>
              )
            }
            const value = parseValue(pref)
            return (
              <Row key={key} label={row.label} hint={row.hint}>
                <span
                  className="max-w-[14rem] truncate text-[11px] text-[var(--wd-muted)]"
                  title={String(value ?? '')}
                >
                  {String(value ?? '—')}
                </span>
                {row.url && (
                  <button
                    onClick={() => openPage(row.url as string)}
                    className="rounded-md border border-[var(--wd-glass-border)] px-2 py-1 text-[11px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]"
                  >
                    Change
                  </button>
                )}
              </Row>
            )
          })}
        </section>
      ))}

      {status && <span className="px-2 text-[11px] text-emerald-500">{status}</span>}
      {error && (
        <span className="px-2 text-[11px] text-rose-500" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}

/** Chrome's three-way Safe Browsing choice, over its two booleans. */
function SafeBrowsing({
  label,
  hint,
  enabled,
  enhanced,
  managed,
  onChange
}: {
  label: string
  hint: string
  enabled: boolean
  enhanced: boolean
  managed: boolean
  onChange: (level: 'enhanced' | 'standard' | 'off') => void
}): React.JSX.Element {
  const level = enhanced ? 'enhanced' : enabled ? 'standard' : 'off'
  const options = [
    {
      id: 'enhanced',
      label: 'Enhanced protection',
      hint: 'Faster, proactive warnings. Sends more browsing data to Google.'
    },
    {
      id: 'standard',
      label: 'Standard protection',
      hint: 'Warns about sites, downloads and extensions known to be dangerous.'
    },
    {
      id: 'off',
      label: 'No protection',
      hint: 'Not recommended — you lose warnings about dangerous sites.'
    }
  ] as const
  return (
    <div className="rounded-lg px-2 py-1.5">
      <span className="block font-medium text-[var(--wd-text)]">{label}</span>
      <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
      <div className="mt-1 flex flex-col gap-0.5">
        {options.map((option) => (
          <label
            key={option.id}
            className={`flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--wd-hover)] ${
              managed ? 'opacity-50' : 'cursor-pointer'
            }`}
          >
            <input
              type="radio"
              name="safe-browsing"
              className="mt-0.5 accent-[var(--wd-accent)]"
              checked={level === option.id}
              disabled={managed}
              onChange={() => onChange(option.id)}
            />
            <span className="min-w-0">
              <span className="block text-[11.5px] text-[var(--wd-text)]">{option.label}</span>
              <span className="block text-[10.5px] text-[var(--wd-dim)]">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[var(--wd-text)]">{label}</span>
        <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
      </span>
      <span className="flex flex-none items-center gap-1.5">{children}</span>
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  restart
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  restart?: boolean
}): React.JSX.Element {
  return (
    <label
      className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)] ${
        disabled ? 'opacity-60' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--wd-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-[var(--wd-text)]">
          {label}
          {restart && (
            <span className="rounded bg-[var(--wd-accent-soft)] px-1 text-[9px] font-semibold uppercase text-[var(--wd-accent)]">
              Restart
            </span>
          )}
        </span>
        <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
      </span>
    </label>
  )
}
