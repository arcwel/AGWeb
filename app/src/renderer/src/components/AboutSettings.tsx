import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'
import { useShellStore } from '@/store'
import licenses from '@/generated/third-party-licenses.json'

/**
 * About — what this build is, and what it is built on.
 *
 * The version line is what a tester quotes in a bug report; the license
 * inventory is the open-source obligation to credit the components WebDeck
 * bundles. The list is generated from the installed dependencies
 * (scripts/gen-licenses.mjs), so it cannot quietly fall out of step with what
 * actually ships. The browser's OWN third-party components are Chromium's to
 * credit, and it already does at chrome://credits — so we link there rather
 * than duplicate a list that is not ours to maintain.
 */
export function AboutSettings(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.agweb.getAppInfo().then((i) => {
      if (!cancelled) setInfo(i)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Open a credit link as a new browser tab — the app owns tabs, so this rides
  // the same path a page's window.open would (the shell adopts it as a tab).
  const open = (url: string): void => {
    useShellStore.getState().newTab(url)
  }

  return (
    <div className="flex flex-col gap-4 p-2 text-[12px] text-[var(--wd-text)]">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold">Arcwel WebDeck</span>
          <span className="font-mono text-[var(--wd-dim)]">{info?.version ?? '—'}</span>
        </div>
        <div className="text-[var(--wd-dim)]">
          A browser that builds. MIT licensed —{' '}
          <button
            className="underline hover:text-[var(--wd-text)]"
            onClick={() => open('chrome://credits')}
          >
            browser components
          </button>{' '}
          are credited at chrome://credits.
        </div>
        {info?.chrome && (
          <div className="font-mono text-[11px] text-[var(--wd-dim)]">
            Chromium {info.chrome} · {info.platform}
          </div>
        )}
      </header>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
          Built on
        </h3>
        {licenses.foundations.map((f) => (
          <div key={f.name} className="rounded border border-[var(--wd-line)] p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">
                {f.name}{' '}
                <span className="font-mono text-[11px] text-[var(--wd-dim)]">{f.version}</span>
              </span>
              <span className="font-mono text-[11px] text-[var(--wd-dim)]">{f.license}</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--wd-dim)]">{f.note}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
          Application components ({licenses.dependencies.length})
        </h3>
        <div className="overflow-hidden rounded border border-[var(--wd-line)]">
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {licenses.dependencies.map((d, i) => (
                <tr key={d.name} className={i % 2 ? 'bg-[var(--wd-surface-2)]' : ''}>
                  <td className="px-2 py-1">
                    {d.homepage ? (
                      <button
                        className="underline hover:text-[var(--wd-text)]"
                        onClick={() => open(d.homepage)}
                      >
                        {d.name}
                      </button>
                    ) : (
                      d.name
                    )}
                  </td>
                  <td className="px-2 py-1 font-mono text-[var(--wd-dim)]">{d.version}</td>
                  <td className="px-2 py-1 text-right font-mono text-[var(--wd-dim)]">
                    {d.license}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[var(--wd-dim)]">
          Generated from the installed dependencies. Full text in THIRD_PARTY_LICENSES.md.
        </p>
      </section>
    </div>
  )
}
