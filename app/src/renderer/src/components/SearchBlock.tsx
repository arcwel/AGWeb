import { useRef, useState } from 'react'
import type { SearchHit } from '@shared/ipc'
import { isDocFile, useShellStore } from '@/store'

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

  const byFile = new Map<string, SearchHit[]>()
  for (const hit of hits ?? []) {
    const list = byFile.get(hit.path) ?? []
    list.push(hit)
    byFile.set(hit.path, list)
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
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {searching && <div className="px-1 py-2 text-slate-500">Searching…</div>}
        {!searching && hits !== null && hits.length === 0 && (
          <div className="px-1 py-2 text-slate-500">No matches.</div>
        )}
        {!searching &&
          [...byFile.entries()].map(([path, fileHits]) => (
            <div key={path} className="mb-2">
              <div className="truncate px-1 py-1 font-semibold text-slate-600 dark:text-slate-300">
                {path} <span className="font-normal text-slate-400">({fileHits.length})</span>
              </div>
              {fileHits.map((hit, i) => (
                <button
                  key={i}
                  onClick={() => open(hit)}
                  className="flex w-full gap-2 truncate rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="shrink-0 text-slate-400">{hit.line}</span>
                  <span className="truncate text-slate-700 dark:text-slate-300">{hit.text}</span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </div>
  )
}
