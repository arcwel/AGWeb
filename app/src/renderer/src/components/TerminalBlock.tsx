import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useShellStore } from '@/store'

/**
 * xterm.js frontend for a main-process pty session keyed by the block id.
 * The session outlives this component: hiding the deck or moving the block
 * just re-attaches, replaying buffered scrollback.
 */

const DARK = { background: '#0e1420', foreground: '#e2e8f0', cursor: '#7dd3fc' }
const LIGHT = { background: '#ffffff', foreground: '#0f172a', cursor: '#0284c7' }

export function TerminalBlock({ id }: { id: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useShellStore((s) => s.theme)
  const termRef = useRef<Terminal | null>(null)
  // Find-in-terminal (task 12.7): scrollback is often where the answer is, and
  // scrolling a thousand lines by hand is not a search.
  const searchRef = useRef<SearchAddon | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      theme: useShellStore.getState().theme === 'dark' ? DARK : LIGHT,
      cursorBlink: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    term.open(container)
    fit.fit()
    termRef.current = term

    // Data events that arrive before the attach reply are already contained
    // in the snapshot buffer (main appends before broadcasting), so writing
    // them live AND replaying the buffer would duplicate scrollback. Hold
    // live writes until the snapshot lands, then drop the overlap.
    // `cancelled` guards the reply: without it a remount (StrictMode, block
    // re-tab) can write into the disposed terminal and spawn a second pty for
    // the same id, because `running` still reflects the pre-create state.
    let attached = false
    let cancelled = false
    void window.agweb.terminal.attach(id).then(({ buffer, running }) => {
      if (cancelled) return
      if (buffer) term.write(buffer)
      attached = true
      if (!running) void window.agweb.terminal.create(id, term.cols, term.rows)
      else void window.agweb.terminal.resize(id, term.cols, term.rows)
    })

    const offInput = term.onData((data) => void window.agweb.terminal.input(id, data))
    const offData = window.agweb.terminal.onData((termId, data) => {
      if (termId === id && attached) term.write(data)
    })
    const offExit = window.agweb.terminal.onExit((termId, code) => {
      if (termId === id) term.write(`\r\n[process exited with code ${code}]\r\n`)
    })

    const observer = new ResizeObserver(() => {
      fit.fit()
      void window.agweb.terminal.resize(id, term.cols, term.rows)
    })
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
      offInput.dispose()
      offData()
      offExit()
      termRef.current = null
      searchRef.current = null
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = theme === 'dark' ? DARK : LIGHT
  }, [theme])

  const find = (next: boolean): void => {
    if (!query) return
    const search = searchRef.current
    if (!search) return
    if (next) search.findNext(query)
    else search.findPrevious(query)
  }

  return (
    <div
      className="relative h-full w-full bg-white dark:bg-[#0e1420]"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault()
          setFindOpen(true)
        }
      }}
    >
      <div ref={containerRef} className="h-full w-full pl-2 pt-1" />

      {findOpen && (
        <div
          className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          data-testid="terminal-find"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              searchRef.current?.findNext(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(!e.shiftKey)
              if (e.key === 'Escape') {
                setFindOpen(false)
                searchRef.current?.clearDecorations()
                termRef.current?.focus()
              }
            }}
            placeholder="Find in scrollback"
            className="w-40 bg-transparent px-1 text-[11px] outline-none"
          />
          <button
            onClick={() => find(false)}
            className="rounded px-1 text-[11px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Previous match"
          >
            ↑
          </button>
          <button
            onClick={() => find(true)}
            className="rounded px-1 text-[11px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Next match"
          >
            ↓
          </button>
          <button
            onClick={() => {
              setFindOpen(false)
              searchRef.current?.clearDecorations()
            }}
            className="rounded px-1 text-[11px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close find"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
