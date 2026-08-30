import { useEffect, useState } from 'react'
import { SEARCH_ENGINES, type AppInfo, type AppSettings, type ClearableData } from '@shared/ipc'

/**
 * The Electron application settings — the ones that configure the app itself
 * rather than the editor. This is what "the actual Electron settings" meant:
 * launch behaviour, what a page is allowed to do, and the on-disk state the
 * browser keeps.
 *
 * A form of real toggles rather than a JSON editor, because — unlike VS Code's
 * open-ended, extension-contributed settings surface — this set is small,
 * fixed, and known, so a form is complete and clearer.
 */

const TOGGLES: Array<{ key: keyof AppSettings; label: string; hint: string; restart?: boolean }> = [
  {
    key: 'hardwareAcceleration',
    label: 'Hardware acceleration',
    hint: 'GPU compositing. Turn off if pages render with visual glitches.',
    restart: true
  },
  { key: 'restoreTabs', label: 'Restore tabs on launch', hint: 'Reopen the last session’s tabs.' },
  {
    key: 'askForPermissions',
    label: 'Ask before granting page permissions',
    hint: 'Camera, microphone, location, notifications.'
  },
  {
    key: 'spellcheck',
    label: 'Spell-check text fields',
    hint: 'Underline misspellings as you type.'
  },
  {
    key: 'doNotTrack',
    label: 'Send “Do Not Track”',
    hint: 'Ask sites not to track you. Honouring it is up to them.'
  }
]

const CLEARABLE: Array<{ kind: ClearableData; label: string }> = [
  { kind: 'cache', label: 'Cached files' },
  { kind: 'cookies', label: 'Cookies' },
  { kind: 'storage', label: 'Site storage' },
  { kind: 'history', label: 'Auth cache' }
]

export function ApplicationSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [clearing, setClearing] = useState<Set<ClearableData>>(new Set(['cache']))
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.agweb.appSettings.read().then((next) => live && setSettings(next))
    void window.agweb.getAppInfo().then((next) => live && setInfo(next))
    return () => {
      live = false
    }
  }, [])

  const update = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> => {
    const next = await window.agweb.appSettings.write({ [key]: value })
    setSettings(next)
    if (TOGGLES.find((t) => t.key === key)?.restart) {
      setStatus('Saved — restart WebDeck to apply.')
      setTimeout(() => setStatus(null), 4000)
    }
  }

  const clearNow = async (): Promise<void> => {
    await window.agweb.appSettings.clearData([...clearing])
    setStatus('Browsing data cleared.')
    setTimeout(() => setStatus(null), 3000)
  }

  if (!settings) return <div className="p-4 text-[var(--wd-dim)]">Reading settings…</div>

  return (
    <div className="flex flex-col gap-4 p-3 text-[12px]">
      <Section title="General">
        {TOGGLES.map((toggle) => (
          <label
            key={toggle.key}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--wd-accent)]"
              checked={Boolean(settings[toggle.key])}
              onChange={(e) => void update(toggle.key, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium text-[var(--wd-text)]">
                {toggle.label}
                {toggle.restart && (
                  <span className="rounded bg-[var(--wd-accent-soft)] px-1 text-[9px] font-semibold uppercase text-[var(--wd-accent)]">
                    restart
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-[var(--wd-dim)]">{toggle.hint}</span>
            </span>
          </label>
        ))}
      </Section>

      <Section title="Search">
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--wd-text)]">
            Search engine
            <span className="block text-[11px] text-[var(--wd-dim)]">
              Used when you type a search into the address bar.
            </span>
          </span>
          <select
            value={settings.searchEngine}
            onChange={(e) => void update('searchEngine', e.target.value)}
            className="flex-none rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
            aria-label="Search engine"
          >
            {SEARCH_ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Downloads">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--wd-accent)]"
            checked={settings.askWhereToSave}
            onChange={(e) => void update('askWhereToSave', e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block font-medium text-[var(--wd-text)]">
              Ask where to save each file
            </span>
            <span className="block text-[11px] text-[var(--wd-dim)]">
              Choose a location every time, instead of saving to the folder below.
            </span>
          </span>
        </label>
        <div
          className={`flex items-center gap-2 px-2 py-1 ${
            settings.askWhereToSave ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--wd-muted)]">
            {settings.downloadPath || 'Default location (your Downloads folder)'}
          </span>
          <button
            onClick={() => {
              void window.agweb.appSettings.chooseDownloadDir().then(setSettings)
            }}
            className="flex-none rounded-md border border-[var(--wd-glass-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]"
          >
            Change…
          </button>
          {settings.downloadPath && (
            <button
              onClick={() => {
                void window.agweb.appSettings.write({ downloadPath: '' }).then(setSettings)
              }}
              className="flex-none text-[11px] text-[var(--wd-dim)] hover:text-rose-500"
            >
              Reset
            </button>
          )}
        </div>
      </Section>

      <Section title="Privacy — clear browsing data">
        <div className="flex flex-wrap gap-2 px-2 py-1">
          {CLEARABLE.map((item) => (
            <label key={item.kind} className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                className="accent-[var(--wd-accent)]"
                checked={clearing.has(item.kind)}
                onChange={(e) =>
                  setClearing((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(item.kind)
                    else next.delete(item.kind)
                    return next
                  })
                }
              />
              {item.label}
            </label>
          ))}
        </div>
        <button
          onClick={() => void clearNow()}
          disabled={clearing.size === 0}
          className="mx-2 mt-1 w-fit rounded-md bg-rose-500/90 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
        >
          Clear now
        </button>
      </Section>

      {info && (
        <Section title="About">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 px-2 py-1 text-[11px] text-[var(--wd-muted)]">
            <dt className="text-[var(--wd-dim)]">Version</dt>
            <dd>{info.version}</dd>
            <dt className="text-[var(--wd-dim)]">Electron</dt>
            <dd>{info.electron}</dd>
            <dt className="text-[var(--wd-dim)]">Chromium</dt>
            <dd>{info.chrome}</dd>
            <dt className="text-[var(--wd-dim)]">Platform</dt>
            <dd>{info.platform}</dd>
          </dl>
        </Section>
      )}

      {status && <span className="px-2 text-[11px] text-emerald-500">{status}</span>}
    </div>
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
