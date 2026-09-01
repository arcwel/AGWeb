import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'
import { useShellStore } from '@/store'
import { ensureModel, monaco, setEditorTheme } from '@/monaco'
import { useMonacoReady } from '@/monaco-ready'
import { JsonTree } from '@/components/JsonTree'
import { JsonGraph } from '@/components/JsonGraph'
import { CsvTable } from '@/components/CsvTable'
import { conversionTargets, convertContent, parseTreeDoc } from '@/convert'
import { XML_CONVERSION_TARGETS, convertXml, parseXml } from '@/xml'
import { beautify, minify, structuredFormatFor } from '@/structuredFormat'
import { DOC_THEMES, loadDocTheme, saveDocTheme, standaloneHtml, type DocTheme } from '@/docThemes'

/**
 * Document Studio: JSON, Markdown, YAML, TOML, and CSV rendered as styled,
 * human-readable documents in a browser tab. Styled ⇄ Source toggle (editable
 * Monaco), theme presets, format conversion, and HTML/PDF/PNG export.
 */

// Sanitize first (untrusted markdown can never script), then let KaTeX and
// the highlighter decorate the clean tree. The schema keeps the class names
// those two need.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^(math|katex)/]],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^math/]]
  }
} as typeof defaultSchema

export function DocStudio({ path }: { path: string }): React.JSX.Element {
  const workspacePath = useShellStore((s) => s.workspace?.path ?? null)
  const [mode, setMode] = useState<'styled' | 'graph' | 'source'>('styled')
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [menu, setMenu] = useState<'convert' | 'export' | 'theme' | null>(null)
  const [docTheme, setDocTheme] = useState<DocTheme>(() => loadDocTheme(workspacePath))
  const openFile = useShellStore((s) => s.openFile)
  const openDoc = useShellStore((s) => s.openDoc)
  const dirty = useShellStore((s) => s.dirtyFiles[path])
  const styledRef = useRef<HTMLDivElement>(null)

  const loadFile = useCallback((): void => {
    void window.agweb.fs.read(path).then((result) => {
      if (result.content !== undefined) {
        setContent(result.content)
        setError(null)
      } else {
        setError(result.error ?? 'Could not read file.')
      }
    })
  }, [path])

  useEffect(() => {
    loadFile()
    return window.agweb.fs.onChanged(loadFile)
  }, [loadFile])

  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const name = path.split('/').pop() ?? path
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const isTreeDoc = ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml'
  const isXml = ext === 'xml' || ext === 'svg'
  const canFormat = structuredFormatFor(ext) !== null

  const pickTheme = (theme: DocTheme): void => {
    setDocTheme(theme)
    saveDocTheme(workspacePath, theme)
    setMenu(null)
  }

  const convertTo = async (target: string): Promise<void> => {
    setMenu(null)
    if (content === null) return
    try {
      const converted = isXml ? convertXml(content, target) : convertContent(content, ext, target)
      const base = path.replace(/\.[^.]+$/, '')
      let outPath = `${base}.${target}`
      const created = await window.agweb.fs.create(outPath, 'file')
      if (created.error) outPath = `${base}-converted.${target}`
      const written = await window.agweb.fs.write(outPath, converted)
      if (written.error) throw new Error(written.error)
      openDoc(outPath)
    } catch (convertError) {
      setNotice(String(convertError instanceof Error ? convertError.message : convertError))
    }
  }

  // Beautify/Minify act on the live editor buffer (the shared Monaco model),
  // not the file on disk: the change is applied as an undoable edit and marks
  // the file dirty so the user saves it with ⌘S, exactly like a manual edit.
  const runFormat = async (kind: 'beautify' | 'minify'): Promise<void> => {
    const model = await ensureModel(path)
    if (!model) {
      setNotice('Could not load the editor buffer to format.')
      return
    }
    try {
      const current = model.getValue()
      const next = kind === 'beautify' ? beautify(ext, current) : minify(ext, current)
      if (next !== current) {
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null)
      }
      setNotice(null)
    } catch (formatError) {
      const label = kind === 'beautify' ? 'Beautify' : 'Minify'
      setNotice(
        `${label} failed: ${formatError instanceof Error ? formatError.message : String(formatError)}`
      )
    }
  }

  const doExport = async (format: 'html' | 'pdf' | 'png'): Promise<void> => {
    setMenu(null)
    const base = name.replace(/\.[^.]+$/, '')
    if (format === 'png') {
      const rect = styledRef.current?.getBoundingClientRect()
      if (!rect) return
      const result = await window.agweb.exports.capture(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        `${base}.png`
      )
      setNotice(result.error ?? (result.path ? `Exported ${result.path}` : null))
      return
    }
    const body = styledRef.current?.querySelector('.doc-md')?.innerHTML
    if (!body) {
      setNotice('HTML/PDF export currently applies to Markdown views.')
      return
    }
    const html = standaloneHtml(name, body, docTheme)
    const result =
      format === 'html'
        ? await window.agweb.exports.html(html, `${base}.html`)
        : await window.agweb.exports.pdf(html, `${base}.pdf`)
    setNotice(result.error ?? (result.path ? `Exported ${result.path}` : null))
  }

  const segment = (id: 'styled' | 'graph' | 'source', label: string): React.JSX.Element => (
    <button
      onClick={() => setMode(id)}
      className={`rounded-md px-3 py-1 text-xs font-semibold ${
        mode === id
          ? 'bg-sky-600 text-white'
          : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
    >
      {label}
    </button>
  )

  const menuButton = (id: 'convert' | 'export' | 'theme', label: string): React.JSX.Element => (
    <button
      onClick={() => setMenu(menu === id ? null : id)}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
    >
      {label} ▾
    </button>
  )

  const targets = isXml ? [...XML_CONVERSION_TARGETS] : conversionTargets(ext)

  return (
    <div className="flex h-full flex-col bg-white text-slate-900 dark:bg-[#0b0f14] dark:text-slate-100">
      <div className="relative flex flex-none items-center gap-2.5 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold">{name}</span>
        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
          {ext}
        </span>
        {dirty && <span className="text-[11px] text-amber-500">unsaved edits in source</span>}
        <div className="ml-auto flex items-center gap-2">
          {mode === 'source' && canFormat && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => void runFormat('beautify')}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                title={`Pretty-print this ${ext.toUpperCase()} buffer (2-space indent); save with ⌘S`}
              >
                Beautify
              </button>
              <button
                onClick={() => void runFormat('minify')}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                title={`Compact this ${ext.toUpperCase()} buffer; save with ⌘S`}
              >
                Minify
              </button>
            </div>
          )}
          {isMarkdown && menuButton('theme', 'Theme')}
          {targets.length > 0 && menuButton('convert', 'Convert')}
          {menuButton('export', 'Export')}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
            {segment('styled', 'Styled')}
            {(isTreeDoc || isXml) && segment('graph', 'Graph')}
            {segment('source', 'Source')}
          </div>
          <button
            onClick={() => openFile(path)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
            title="Open in the Deck's editor block"
          >
            Open in Editor
          </button>
        </div>

        {menu === 'theme' && (
          <Menu>
            {DOC_THEMES.map((theme) => (
              <MenuItem key={theme.id} onClick={() => pickTheme(theme.id)}>
                <span className={docTheme === theme.id ? 'font-bold text-sky-500' : ''}>
                  {theme.label}
                </span>
                <span className="block text-[10px] text-slate-500">{theme.hint}</span>
              </MenuItem>
            ))}
          </Menu>
        )}
        {menu === 'convert' && (
          <Menu>
            {targets.map((target) => (
              <MenuItem key={target} onClick={() => void convertTo(target)}>
                to .{target}
              </MenuItem>
            ))}
          </Menu>
        )}
        {menu === 'export' && (
          <Menu>
            {isMarkdown && <MenuItem onClick={() => void doExport('html')}>HTML…</MenuItem>}
            {isMarkdown && <MenuItem onClick={() => void doExport('pdf')}>PDF…</MenuItem>}
            <MenuItem onClick={() => void doExport('png')}>PNG (as shown)…</MenuItem>
          </Menu>
        )}
      </div>

      {notice && (
        <div className="flex flex-none items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-[#0e1420] dark:text-slate-300">
          <span className="truncate">{notice}</span>
          <button onClick={() => setNotice(null)} className="ml-auto text-slate-400">
            dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1" ref={styledRef}>
        {error && <div className="p-6 text-sm text-red-500">{error}</div>}
        {!error && content === null && <div className="p-6 text-sm text-slate-500">Loading…</div>}
        {!error && content !== null && mode === 'source' && <SourcePane path={path} />}
        {!error && content !== null && mode === 'graph' && isTreeDoc && (
          <TreePane ext={ext} content={content} view="graph" />
        )}
        {!error && content !== null && mode === 'graph' && isXml && (
          <XmlPane content={content} view="graph" />
        )}
        {!error && content !== null && mode === 'styled' && (
          <StyledView ext={ext} content={content} docTheme={docTheme} />
        )}
      </div>
    </div>
  )
}

function Menu({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="absolute right-4 top-11 z-50 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0e1420]">
      {children}
    </div>
  )
}

function MenuItem({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3.5 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  )
}

function StyledView({
  ext,
  content,
  docTheme
}: {
  ext: string
  content: string
  docTheme: DocTheme
}): React.JSX.Element {
  if (ext === 'md' || ext === 'markdown') {
    return (
      <div className="h-full overflow-auto">
        <div className={`doc-md doc-theme-${docTheme} mx-auto max-w-3xl px-8 py-8`}>
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeSanitize, sanitizeSchema], rehypeKatex, rehypeHighlight]}
            components={{ code: CodeBlock }}
          >
            {content}
          </Markdown>
        </div>
      </div>
    )
  }
  if (ext === 'csv' || ext === 'tsv') {
    return <CsvTable content={content} delimiter={ext === 'tsv' ? '\t' : undefined} />
  }
  if (ext === 'xml' || ext === 'svg') {
    return <XmlPane content={content} view="tree" />
  }
  return <TreePane ext={ext} content={content} view="tree" />
}

/** XML tree/graph via the JSON inspectors: fast-xml-parser maps the document
 *  to a plain object, so JsonTree/JsonGraph render it with no XML-specific UI. */
function XmlPane({
  content,
  view
}: {
  content: string
  view: 'tree' | 'graph'
}): React.JSX.Element {
  const parsed = useMemo<{ data: unknown } | { error: string }>(() => {
    try {
      return { data: parseXml(content) }
    } catch (parseError) {
      return { error: parseError instanceof Error ? parseError.message : String(parseError) }
    }
  }, [content])
  if ('error' in parsed) {
    return (
      <div className="p-6 text-sm">
        <div className="font-semibold text-red-500">This file doesn&apos;t parse as XML.</div>
        <div className="mt-2 font-mono text-xs text-slate-500">{parsed.error}</div>
      </div>
    )
  }
  return view === 'graph' ? <JsonGraph data={parsed.data} /> : <JsonTree data={parsed.data} />
}

/** Shared memoized parse for the tree and graph views of json/yaml/toml. */
function TreePane({
  ext,
  content,
  view
}: {
  ext: string
  content: string
  view: 'tree' | 'graph'
}): React.JSX.Element {
  const parsed = useMemo(() => parseTreeDoc(ext, content), [ext, content])
  if ('error' in parsed) {
    return (
      <div className="p-6 text-sm">
        <div className="font-semibold text-red-500">This file doesn&apos;t parse as {ext}.</div>
        <div className="mt-2 font-mono text-xs text-slate-500">{parsed.error}</div>
      </div>
    )
  }
  return view === 'graph' ? <JsonGraph data={parsed.data} /> : <JsonTree data={parsed.data} />
}

/** Code renderer: mermaid fences become live diagrams; the rest highlight. */
function CodeBlock(props: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  const { className, children, ...rest } = props
  if (className?.includes('language-mermaid')) {
    return <MermaidBlock code={String(children ?? '')} />
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  )
}

let mermaidSeq = 0
function MermaidBlock({ code }: { code: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const theme = useShellStore((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    void import('mermaid').then(async ({ default: mermaid }) => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default'
        })
        const { svg: rendered } = await mermaid.render(`agweb-mermaid-${mermaidSeq++}`, code)
        if (!cancelled) setSvg(rendered)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [code, theme])

  if (failed) return <code>{code}</code>
  if (!svg) return <span className="text-xs text-slate-500">rendering diagram…</span>
  // Mermaid's output is SVG generated by our bundled library from sanitized
  // text (securityLevel: strict); it never contains foreign HTML.
  return <span className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** Editable Monaco bound to one file; ⌘S saves like the editor block. */
function SourcePane({ path }: { path: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useShellStore((s) => s.theme)
  const monacoReady = useMonacoReady()

  useEffect(() => {
    const container = containerRef.current
    if (!container || !monacoReady) return
    const editor = monaco.editor.create(container, {
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const model = editor.getModel()
      if (!model) return
      void window.agweb.fs.write(path, model.getValue()).then((result) => {
        if (!result.error) useShellStore.getState().setFileDirty(path, false)
      })
    })
    let disposed = false
    void ensureModel(path).then((model) => {
      if (!disposed && model) editor.setModel(model)
    })
    return () => {
      disposed = true
      editor.dispose()
    }
  }, [path, monacoReady])

  useEffect(() => {
    if (!monacoReady) return
    void setEditorTheme(theme)
  }, [theme, monacoReady])

  return <div ref={containerRef} className="h-full" />
}
