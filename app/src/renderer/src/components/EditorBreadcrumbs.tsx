import { useCallback, useEffect, useRef, useState } from 'react'
import { documentSymbols, type OutlineSymbol } from '@/lsp'
import { languageForPath } from '@/monaco'
import { usePopover } from '@/popover'
import { AnchoredPopover } from '@/components/AnchoredPopover'

/**
 * Breadcrumbs and symbol outline (task 12.7).
 *
 * The path segments come from the file path; the trailing segment is the
 * enclosing symbol at the cursor, taken from the language server's document
 * symbols. Clicking it opens the outline, which jumps the editor.
 *
 * There is no outline without a language server, so this renders the path
 * alone rather than an empty affordance when 12.2 has nothing to offer.
 */

/** LSP SymbolKind → a glyph. Only the kinds worth distinguishing at a glance. */
const KIND_GLYPHS: Record<number, string> = {
  5: 'C', // Class
  6: 'M', // Method
  8: 'F', // Field
  9: '◇', // Constructor
  10: 'E', // Enum
  11: 'I', // Interface
  12: 'ƒ', // Function
  13: 'v', // Variable
  14: 'c', // Constant
  23: '{}' // Struct
}

export function EditorBreadcrumbs({
  path,
  uri,
  line,
  onReveal
}: {
  /** Workspace-relative, for the visible crumbs. */
  path: string
  /** The model's own URI — what the language server knows the file by. */
  uri: string
  /** One-based cursor line, so the crumb tracks where the caret is. */
  line: number
  onReveal: (line: number) => void
}): React.JSX.Element {
  const [symbols, setSymbols] = useState<OutlineSymbol[]>([])
  const [open, setOpen] = useState(false)
  // The bar is 24px tall and overflow-hidden, so an outline menu positioned
  // inside it never showed at all. It is portalled and anchored to the bar.
  const panelRef = useRef<HTMLDivElement>(null)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), []),
    panelRef
  )

  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      const next = await documentSymbols(languageForPath(path), uri)
      if (live) setSymbols(next)
    }
    void load()
    // The server indexes asynchronously on first open, so an empty first
    // answer is expected; one retry covers it without a polling loop.
    const retry = setTimeout(() => void load(), 2500)
    return () => {
      live = false
      clearTimeout(retry)
    }
  }, [path, uri])

  const segments = path.split('/').filter(Boolean)

  // The innermost symbol whose start is at or above the cursor.
  const enclosing = symbols.reduce<OutlineSymbol | null>(
    (best, symbol) =>
      symbol.line <= line - 1 && (!best || symbol.line >= best.line) ? symbol : best,
    null
  )

  return (
    <div
      ref={ref}
      className="relative flex h-6 flex-none items-center gap-1 overflow-hidden border-b border-slate-200 px-2.5 text-[11px] text-slate-400 dark:border-slate-800"
      data-testid="editor-breadcrumbs"
    >
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1 truncate">
          {i > 0 && <span className="text-slate-300 dark:text-slate-600">/</span>}
          <span className={i === segments.length - 1 ? 'text-slate-600 dark:text-slate-300' : ''}>
            {segment}
          </span>
        </span>
      ))}

      {symbols.length > 0 && (
        <>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <button
            onClick={() => setOpen(!open)}
            className="truncate rounded px-1 font-medium text-sky-600 hover:bg-slate-100 dark:text-sky-400 dark:hover:bg-slate-800"
            data-testid="breadcrumb-symbol"
          >
            {enclosing?.name ?? 'Outline'}
          </button>
        </>
      )}

      {open && (
        <AnchoredPopover
          anchorRef={ref}
          panelRef={panelRef}
          placement="below"
          align="start"
          width={256}
          maxHeight={288}
          className="rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          data-testid="outline-menu"
          role="menu"
        >
          {symbols.map((symbol, i) => (
            <button
              key={`${symbol.name}-${symbol.line}-${i}`}
              onClick={() => {
                setOpen(false)
                onReveal(symbol.line + 1)
              }}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              style={{ paddingLeft: `${10 + symbol.depth * 12}px` }}
            >
              <span className="w-3 flex-none font-mono text-[10px] text-slate-400">
                {KIND_GLYPHS[symbol.kind] ?? '·'}
              </span>
              <span className="truncate text-slate-600 dark:text-slate-300">{symbol.name}</span>
            </button>
          ))}
        </AnchoredPopover>
      )}
    </div>
  )
}
