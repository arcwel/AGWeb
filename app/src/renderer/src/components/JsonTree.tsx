import { useMemo, useState } from 'react'
import { useVirtualRows } from '@/virtual'

/**
 * Virtualized collapsible JSON inspector: the visible tree flattens to rows
 * and only the viewport renders, so multi-MB documents stay responsive.
 * Type badges, value previews, copy-as-path, and search-to-subtree filtering.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const ROW_HEIGHT = 24

interface Row {
  path: string
  name: string
  value: Json
  depth: number
  isContainer: boolean
  expanded: boolean
}

function typeOf(value: Json): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array·${value.length}`
  return typeof value === 'object' ? `object·${Object.keys(value).length}` : typeof value
}

function matches(value: Json, key: string, term: string): boolean {
  if (key.toLowerCase().includes(term)) return true
  if (Array.isArray(value)) return value.some((v, i) => matches(v, String(i), term))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => matches(v, k, term))
  }
  return String(value).toLowerCase().includes(term)
}

/** Flatten the tree into the currently visible rows. */
function flatten(data: Json, expanded: Set<string>, term: string): Row[] {
  const rows: Row[] = []
  const visit = (name: string, value: Json, path: string, depth: number): void => {
    if (term && !matches(value, name, term)) return
    const isContainer = value !== null && typeof value === 'object'
    const isExpanded = term ? true : expanded.has(path)
    rows.push({ path, name, value, depth, isContainer, expanded: isExpanded })
    if (!isContainer || !isExpanded) return
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(String(i), item, `${path}[${i}]`, depth + 1))
    } else {
      for (const [k, v] of Object.entries(value)) visit(k, v, `${path}.${k}`, depth + 1)
    }
  }
  visit('root', data, '$', 0)
  return rows
}

function defaultExpanded(data: Json): Set<string> {
  const expanded = new Set<string>(['$'])
  if (data !== null && typeof data === 'object') {
    if (Array.isArray(data))
      data.forEach((v, i) => v !== null && typeof v === 'object' && expanded.add(`$[${i}]`))
    else for (const k of Object.keys(data)) expanded.add(`$.${k}`)
  }
  return expanded
}

export function JsonTree({ data }: { data: unknown }): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(data as Json))
  const term = search.trim().toLowerCase()

  const rows = useMemo(() => flatten(data as Json, expanded, term), [data, expanded, term])
  const { containerRef, onScroll, start, end, padTop, padBottom } = useVirtualRows(
    rows.length,
    ROW_HEIGHT
  )

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search keys and values…"
          className="w-64 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
        />
        <span className="text-[11px] text-slate-500">
          {rows.length.toLocaleString()} nodes shown
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs"
      >
        <div style={{ height: padTop }} />
        {rows.slice(start, end).map((row) => (
          <div
            key={row.path}
            style={{ height: ROW_HEIGHT, paddingLeft: row.depth * 14 }}
            onClick={() => row.isContainer && toggle(row.path)}
            className={`group flex items-center gap-2 rounded px-1 ${
              row.isContainer ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60' : ''
            }`}
          >
            <span className="w-3 shrink-0 text-slate-400">
              {row.isContainer ? (row.expanded ? '▾' : '▸') : ''}
            </span>
            <span className="shrink-0 text-sky-700 dark:text-sky-300">{row.name}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {typeOf(row.value)}
            </span>
            {!row.isContainer && (
              <span
                className={`truncate ${
                  typeof row.value === 'string'
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {typeof row.value === 'string' ? JSON.stringify(row.value) : String(row.value)}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard.writeText(row.path)
              }}
              className="hidden shrink-0 rounded border border-slate-300 px-1 text-[10px] text-slate-400 hover:text-sky-500 group-hover:inline dark:border-slate-600"
              title={`Copy path ${row.path}`}
            >
              path
            </button>
          </div>
        ))}
        <div style={{ height: padBottom }} />
      </div>
    </div>
  )
}
