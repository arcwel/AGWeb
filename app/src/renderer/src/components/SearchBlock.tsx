import { useMemo, useRef, useState } from 'react'
import type { SearchHit } from '@shared/ipc'
import { isDocFile, useShellStore } from '@/store'
import { useVirtualRows } from '@/virtual'

/** Fixed row height (px) the virtualizer windows on — must match each row's box. */
const ROW_H = 26

/** A flattened result row: a file header, or one hit under it. */
type ResultRow = { kind: 'file'; path: string; count: number } | { kind: 'hit'; hit: SearchHit }

/** Group hits by file and flatten to header+hit rows. Pure/module-level so the
 *  local Map/array mutation stays outside any hook. */
function flattenResults(hits: SearchHit[] | null): ResultRow[] {
  const byFile = new Map<string, SearchHit[]>()
  for (const hit of hits ?? []) {
    const list = byFile.get(hit.path) ?? []
    list.push(hit)
    byFile.set(hit.path, list)
  }
  const out: ResultRow[] = []
  for (const [path, fileHits] of byFile) {
    out.push({ kind: 'file', path, count: fileHits.length })
    for (const hit of fileHits) out.push({ kind: 'hit', hit })
  }
  return out
}

/**
 * Project-wide search (ripgrep-backed with a Node fallback in main).
 * Results group by file; clicking a hit opens the file at that line.
 */
export function SearchBlock(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const openFile = useShellStore((s) => s.openFile)
  const openDoc = useShellStore((s) => s.openDoc)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const seq = useRef(0)

  // Window the (potentially huge) result set — a broad grep no longer renders
  // thousands of DOM nodes at once (P2-12).
  const rows = useMemo(() => flattenResults(hits), [hits])
  const { containerRef, onScroll, start, end, padTop, padBottom } = useVirtualRows(
    rows.length,
    ROW_H
  )

  const run = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    const mySeq = ++seq.current
    setSearching(true)
    const results = await window.agweb.search(q)
    if (seq.current !== mySeq) return
    setHits(results)
    setSearching(false)
  }

  const open = (hit: SearchHit): void => {
    if (isDocFile(hit.path)) openDoc(hit.path)
    else openFile(hit.path, hit.line)
  }

  if (!workspace) {
    return <div className="p-3 text-xs text-slate-500">Open a project to search it.</div>
  }

  const renderRow = (row: ResultRow, index: number): React.JSX.Element => {
    if (row.kind === 'file') {
      return (
        <div
          key={`f:${row.path}`}
          className="flex items-center truncate px-1 font-semibold text-slate-600 dark:text-slate-300"
          style={{ height: ROW_H }}
        >
          <span className="truncate">{row.path}</span>
          <span className="ml-1 shrink-0 font-normal text-slate-400">({row.count})</span>
        </div>
      )
    }
    const hit = row.hit
    return (
      <button
        key={`h:${index}`}
        onClick={() => open(hit)}
        className="flex w-full items-center gap-2 truncate rounded px-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
        style={{ height: ROW_H }}
      >
        <span className="shrink-0 text-slate-400">{hit.line}</span>
        <span className="truncate text-slate-700 dark:text-slate-300">{hit.text}</span>
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex flex-none gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          placeholder="Search project…"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
        />
        <button
          onClick={() => void run()}
          className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500"
        >
          Search
        </button>
      </div>
      <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto p-2">
        {searching && <div className="px-1 py-2 text-slate-500">Searching…</div>}
        {!searching && hits !== null && hits.length === 0 && (
          <div className="px-1 py-2 text-slate-500">No matches.</div>
        )}
        {!searching && rows.length > 0 && (
          <>
            <div style={{ height: padTop }} />
            {rows.slice(start, end).map((row, i) => renderRow(row, start + i))}
            <div style={{ height: padBottom }} />
          </>
        )}
      </div>
    </div>
  )
}
