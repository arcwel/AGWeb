import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import { useVirtualRows } from '@/virtual'

/** CSV/TSV as a sortable, filterable, row-virtualized table. */

const ROW_HEIGHT = 29

export function CsvTable({
  content,
  delimiter
}: {
  content: string
  delimiter?: string
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)

  const parsed = useMemo(
    () => Papa.parse<string[]>(content.trim(), { delimiter, skipEmptyLines: true }),
    [content, delimiter]
  )
  const [header = [], ...rows] = parsed.data

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    let out = term
      ? rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(term)))
      : rows
    if (sort) {
      const { col, dir } = sort
      out = [...out].sort((a, b) => {
        const x = a[col] ?? ''
        const y = b[col] ?? ''
        const nx = Number(x)
        const ny = Number(y)
        if (!Number.isNaN(nx) && !Number.isNaN(ny) && x !== '' && y !== '') return (nx - ny) * dir
        return x.localeCompare(y) * dir
      })
    }
    return out
  }, [rows, filter, sort])

  const { containerRef, onScroll, start, end, padTop, padBottom } = useVirtualRows(
    visible.length,
    ROW_HEIGHT
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows…"
          className="w-64 min-w-0 max-w-full rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
        />
        <span className="text-[11px] text-slate-500">{visible.length.toLocaleString()} rows</span>
      </div>
      <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#101827]">
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  onClick={() =>
                    setSort((s) =>
                      s?.col === i ? { col: i, dir: s.dir === 1 ? -1 : 1 } : { col: i, dir: 1 }
                    )
                  }
                  className="cursor-pointer whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600 hover:text-sky-600 dark:border-slate-700 dark:text-slate-300"
                >
                  {cell}
                  {sort?.col === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr style={{ height: padTop }} />}
            {visible.slice(start, end).map((row, r) => (
              <tr
                key={start + r}
                style={{ height: ROW_HEIGHT }}
                className="odd:bg-slate-50 dark:odd:bg-[#0d131d]"
              >
                {header.map((_, c) => (
                  <td
                    key={c}
                    className="max-w-96 truncate border-b border-slate-100 px-3 py-1.5 text-slate-700 dark:border-slate-800/60 dark:text-slate-300"
                  >
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
            {padBottom > 0 && <tr style={{ height: padBottom }} />}
          </tbody>
        </table>
      </div>
    </div>
  )
}
