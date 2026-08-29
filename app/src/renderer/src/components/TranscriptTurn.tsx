import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { useShellStore } from '@/store'

/**
 * Prose and tool calls in the agent transcript (task 11.10).
 *
 * Agent output is markdown, so it is rendered as markdown rather than as the
 * monospace log lines everything else in the feed uses. The pipeline is the one
 * Document Studio already ships (remark-gfm → rehype-sanitize → highlight);
 * math is left out because agent replies do not need KaTeX and it is a large
 * dependency to pull into every session card.
 *
 * Sanitize runs before the highlighter so the highlighter decorates a tree that
 * is already clean — the agent's output is untrusted text like any other.
 */

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-/]]
  }
} as typeof defaultSchema

const EXT_FOR: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  bash: 'sh',
  shell: 'sh',
  json: 'json',
  yaml: 'yml',
  markdown: 'md',
  css: 'css',
  html: 'html'
}

function CodeBlock({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const language = /language-(\w+)/.exec(className ?? '')?.[1]
  const source = String(children ?? '')

  // Inline code — no chrome, it is a word in a sentence.
  if (!language && !source.includes('\n')) {
    return (
      <code className="rounded bg-slate-200/70 px-1 py-px font-mono text-[11px] dark:bg-slate-700/60">
        {children}
      </code>
    )
  }

  return (
    <SavableCode language={language} source={source} className={className}>
      {children}
    </SavableCode>
  )
}

/** A fenced block with copy and save-into-the-workspace actions. */
function SavableCode({
  language,
  source,
  className,
  children
}: {
  language?: string
  source: string
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const openFile = useShellStore((s) => s.openFile)
  const [copied, setCopied] = useState(false)
  // null = not saving. A string is the in-progress filename, so the block can
  // ask where to put the snippet without opening a modal over the transcript.
  const [target, setTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(source)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const save = async (): Promise<void> => {
    const rel = target?.trim()
    if (!rel) return
    const result = await window.agweb.fs.write(rel, source)
    if (result?.error) {
      setError(result.error)
      return
    }
    setTarget(null)
    setError(null)
    openFile(rel)
  }

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700/70">
      <div className="flex h-6 items-center gap-2 bg-slate-100/70 px-2 dark:bg-slate-800/50">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
          {language ?? 'text'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void copy()}
            className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={() =>
              setTarget(target === null ? `snippet.${EXT_FOR[language ?? ''] ?? 'txt'}` : null)
            }
            className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            Save to workspace
          </button>
        </div>
      </div>

      {target !== null && (
        <div className="flex items-center gap-1.5 border-b border-slate-200 px-2 py-1 dark:border-slate-700/70">
          <input
            autoFocus
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setTarget(null)
            }}
            placeholder="path/in/workspace.ts"
            className="min-w-0 flex-1 rounded border border-slate-200 bg-transparent px-1.5 py-0.5 font-mono text-[10px] outline-none focus:border-sky-500 dark:border-slate-700"
          />
          <button
            onClick={() => void save()}
            className="rounded bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-600"
          >
            Save
          </button>
        </div>
      )}
      {error && <div className="px-2 py-1 text-[10px] text-rose-500">{error}</div>}

      <pre className="overflow-x-auto px-2.5 py-2 text-[11px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

/** One markdown turn from the agent. */
export function ProseTurn({
  text,
  streaming
}: {
  text: string
  streaming?: boolean
}): React.JSX.Element {
  return (
    <div className="agent-prose min-w-0 font-sans text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema], rehypeHighlight]}
        components={{ code: CodeBlock, pre: ({ children }) => <>{children}</> }}
      >
        {text}
      </Markdown>
      {streaming && (
        <span
          className="ml-0.5 inline-block h-3 w-1.5 translate-y-px animate-pulse rounded-[1px] bg-sky-500 align-middle"
          aria-label="still writing"
        />
      )}
    </div>
  )
}

/**
 * A tool call, collapsed to its name (task 11.10).
 *
 * Tool traffic is the bulk of a long run and almost never what the user is
 * reading for, so it stays a one-line summary until asked for.
 */
export function ToolCall({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const newline = text.indexOf('\n')
  const summary = newline === -1 ? text : text.slice(0, newline)
  const rest = newline === -1 ? '' : text.slice(newline + 1)

  return (
    <div className="min-w-0">
      <button
        onClick={() => setOpen(!open)}
        disabled={!rest}
        className="flex w-full items-center gap-1.5 text-left hover:text-slate-600 disabled:cursor-default dark:hover:text-slate-300"
      >
        {rest ? (
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-none"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        ) : (
          <span className="w-[9px] flex-none" />
        )}
        <span className="truncate">{summary}</span>
      </button>
      {open && rest && (
        <pre className="ml-3.5 mt-0.5 overflow-x-auto whitespace-pre-wrap break-words border-l border-slate-200 pl-2 text-[10px] text-slate-500 dark:border-slate-700">
          {rest}
        </pre>
      )}
    </div>
  )
}
