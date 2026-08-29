import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useShellStore } from '@/store'

/**
 * An agent command rendered where it was run (task 11.10).
 *
 * While it runs, the live pty is shown in place — the same session a Terminal
 * block would attach to, so popping it out loses nothing. Once it exits the
 * pane collapses to a one-line summary, which is what keeps a task with eight
 * commands from turning the conversation into a log file.
 */

const DARK = { background: '#00000000', foreground: '#cbd5e1', cursor: '#7dd3fc' }
const LIGHT = { background: '#00000000', foreground: '#1e293b', cursor: '#0284c7' }

export function InlineTerminal({
  terminalId,
  command,
  exitCode
}: {
  terminalId: string
  command: string
  exitCode?: number
}): React.JSX.Element {
  const finished = exitCode !== undefined
  // Derived, not an effect: null follows the command (open while running,
  // collapsed once it exits); a boolean is the user overriding that.
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? !finished
  const [elapsed, setElapsed] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useShellStore((s) => s.theme)
  const adoptTerminal = useShellStore((s) => s.adoptTerminal)

  useEffect(() => {
    if (finished) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [finished])

  useEffect(() => {
    const container = containerRef.current
    if (!open || !container) return

    const term = new Terminal({
      fontSize: 11,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      theme: theme === 'dark' ? DARK : LIGHT,
      cursorBlink: !finished,
      disableStdin: true,
      scrollback: 2000,
      allowTransparency: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    // Same attach path a Terminal block uses, so scrollback replays and a
    // pop-out later shows the identical session.
    let cancelled = false
    let attached = false
    void window.agweb.terminal.attach(terminalId).then(({ buffer }) => {
      if (cancelled) return
      if (buffer) term.write(buffer)
      attached = true
    })
    const offData = window.agweb.terminal.onData((id, data) => {
      if (id === terminalId && attached) term.write(data)
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
      offData()
      term.dispose()
    }
    // theme is a dependency: a theme flip re-creates the terminal, which is
    // cheap here and always correct — scrollback replays from the pty.
  }, [open, terminalId, finished, theme])

  const ok = exitCode === 0
  const statusDot = finished
    ? ok
      ? 'bg-emerald-500'
      : 'bg-amber-500'
    : 'bg-sky-500 shadow-[0_0_6px_theme(colors.sky.500)]'

  return (
    <div
      className="my-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 dark:border-slate-700/70 dark:bg-black/25"
      data-testid="inline-terminal"
    >
      <div className="flex h-7 items-center gap-2 px-2.5">
        <span className={`h-1.5 w-1.5 flex-none rounded-full ${statusDot}`} />
        <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-200">
          {command.replace(/^\$\s*/, '')}
        </span>
        <span className="flex-none font-mono text-[10px] text-slate-400">
          {finished ? (ok ? 'passed' : `exit ${exitCode}`) : `${elapsed}s`}
        </span>

        <div className="ml-auto flex flex-none items-center gap-0.5">
          {!finished && (
            <button
              onClick={() => void window.agweb.terminal.stop(terminalId)}
              className="rounded p-1 text-amber-500 hover:bg-amber-500/10"
              aria-label="Stop the command"
              title="Stop"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinejoin="round"
              >
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          )}
          <button
            onClick={() => adoptTerminal(terminalId, command.replace(/^\$\s*/, '').slice(0, 30))}
            className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
            aria-label="Open as a Terminal block"
            title="Open as a Terminal block"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 4h6v6" />
              <path d="M20 4l-8 8" />
              <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </button>
          <button
            onClick={() => setOverride(!open)}
            className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
            aria-label={open ? 'Collapse output' : 'Show output'}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: open ? 'none' : 'rotate(180deg)' }}
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={containerRef}
          className="h-36 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700/70"
        />
      )}
    </div>
  )
}
