import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import type { AgentAttachment } from '@shared/agents'
import { useShellStore } from '@/store'
import { usePopover } from '@/popover'
import { AttachIcon, FolderIcon, ImageIcon, MicIcon, SendIcon, SlashIcon } from '@/components/icons'
import { useSpeechInput } from '@/speech'

/**
 * The agent composer (Phase 11): the input surface an agentic IDE needs —
 * attachments as explicit context, @mention over workspace files, slash
 * commands, voice, and the two per-run decisions (model, permission mode)
 * beside Send.
 *
 * Attachments are workspace-relative paths, not file contents: the agent reads
 * them with its own policy-gated tools, so nothing bypasses the Phase 9 gate.
 */

const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const

const SLASH_COMMANDS: { name: string; hint: string; template: string }[] = [
  { name: '/plan', hint: 'Plan without executing', template: 'Plan (do not execute yet): ' },
  { name: '/explain', hint: 'Explain the attached code', template: 'Explain how this works: ' },
  { name: '/test', hint: 'Write tests', template: 'Write tests covering: ' },
  {
    name: '/review',
    hint: 'Review for defects',
    template: 'Review for correctness and edge cases: '
  },
  { name: '/fix', hint: 'Fix a failure', template: 'Diagnose and fix: ' }
]

const MAX_CHARS = 12000

export function Composer(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [model, setModel] = useState<string>(MODELS[0])
  const [mention, setMention] = useState<{ query: string; at: number } | null>(null)
  const [slash, setSlash] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const speech = useSpeechInput((transcript, final) => {
    setText((prev) =>
      final ? `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${transcript}` : prev
    )
  })

  const modelRef = usePopover(
    modelOpen,
    useCallback(() => setModelOpen(false), [])
  )

  // Auto-grow: the input is the primary surface, so it expands with content
  // rather than scrolling a two-line box.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`
  }, [text])

  // Shallow workspace listing backs @mention. Loaded once per workspace.
  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    void (async () => {
      const roots = await window.agweb.fs.list('')
      const out: string[] = []
      for (const entry of roots.slice(0, 40)) {
        if (entry.kind === 'file') out.push(entry.name)
        else {
          const children = await window.agweb.fs.list(entry.name)
          out.push(
            ...children.filter((c) => c.kind === 'file').map((c) => `${entry.name}/${c.name}`)
          )
        }
        if (out.length > 400) break
      }
      if (!cancelled) setFiles(out)
    })()
    return () => {
      cancelled = true
    }
  }, [workspace])

  const addAttachments = (paths: string[], kind: AgentAttachment['kind']): void => {
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.path))
      const next = paths.filter((p) => !seen.has(p)).map((path) => ({ path, kind }))
      return [...prev, ...next].slice(0, 24)
    })
  }

  const pick = async (mode: 'file' | 'dir' | 'image'): Promise<void> => {
    const paths = await window.agweb.pickPaths(mode)
    if (paths.length > 0) addAttachments(paths, mode === 'dir' ? 'dir' : mode)
  }

  const mentionMatches = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return files.filter((f) => f.toLowerCase().includes(q)).slice(0, 6)
  }, [mention, files])

  const onChange = (value: string): void => {
    setText(value.slice(0, MAX_CHARS))
    const upto = value.slice(0, inputRef.current?.selectionStart ?? value.length)
    const at = upto.lastIndexOf('@')
    const isMention = at >= 0 && !/\s/.test(upto.slice(at + 1))
    setMention(isMention ? { query: upto.slice(at + 1), at } : null)
    setSlash(value.startsWith('/') && !value.includes(' '))
  }

  const acceptMention = (path: string): void => {
    if (!mention) return
    setText((prev) =>
      `${prev.slice(0, mention.at)}${prev.slice(mention.at + mention.query.length + 1)}`.trimEnd()
    )
    addAttachments([path], 'file')
    setMention(null)
    inputRef.current?.focus()
  }

  const acceptSlash = (template: string): void => {
    setText(template)
    setSlash(false)
    inputRef.current?.focus()
  }

  // Edit-and-resend (task 11.13): a finished turn hands its task and context
  // back here rather than re-running blind, so the user can change it first.
  // Subscribing rather than reading the draft as state keeps this a one-shot
  // handoff — it fills the box on the transition, not on every render, and a
  // draft that has already been taken can never overwrite what the user typed.
  useEffect(
    () =>
      useShellStore.subscribe((state, prev) => {
        const draft = state.composerDraft
        if (!draft || draft === prev.composerDraft) return
        setText(draft.text)
        setAttachments(draft.attachments)
        state.clearDraft()
        inputRef.current?.focus()
      }),
    []
  )

  const send = async (): Promise<void> => {
    const task = text.trim()
    if (!task || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.agweb.agents.start(task, attachments)
      setText('')
      // Pinned context survives the turn; the rest is per-message.
      setAttachments((prev) => prev.filter((a) => a.pinned))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      setMention(null)
      setSlash(false)
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void send()
    }
  }

  // Drag a file from the Files tree (or the OS) straight onto the composer.
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const internal = event.dataTransfer.getData('application/x-agweb-file')
    if (internal) {
      addAttachments([internal], 'file')
      return
    }
    const dropped = Array.from(event.dataTransfer.files)
      .map((f) => f.name)
      .filter(Boolean)
    if (dropped.length > 0) addAttachments(dropped, 'file')
  }

  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-700/60 dark:hover:text-slate-200'

  return (
    <div className="flex-none border-t border-slate-200 p-2.5 dark:border-slate-800">
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="relative rounded-xl border border-slate-300 bg-white focus-within:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
      >
        {/* mention / slash palettes */}
        {mention && mentionMatches.length > 0 && (
          <div
            data-testid="composer-mentions"
            className="absolute bottom-full left-2 mb-1.5 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0e1420]"
          >
            {mentionMatches.map((path) => (
              <button
                key={path}
                onClick={() => acceptMention(path)}
                className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {path}
              </button>
            ))}
          </div>
        )}
        {slash && (
          <div className="absolute bottom-full left-2 mb-1.5 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0e1420]">
            {SLASH_COMMANDS.filter((c) => c.name.startsWith(text)).map((c) => (
              <button
                key={c.name}
                onClick={() => acceptSlash(c.template)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className="font-semibold">{c.name}</span>
                <span className="text-slate-400">{c.hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* attached context */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5" data-testid="composer-chips">
            {attachments.map((a) => (
              <span
                key={a.path}
                className="flex items-center gap-1.5 rounded-md bg-slate-100 py-1 pl-2 pr-1 text-[11px] dark:bg-slate-800"
                title={a.path}
              >
                {a.kind === 'dir' ? (
                  <FolderIcon size={11} className="text-slate-400" />
                ) : a.kind === 'image' ? (
                  <ImageIcon size={11} className="text-violet-500" />
                ) : (
                  <AttachIcon size={11} className="text-sky-500" />
                )}
                <span className="max-w-40 truncate">{a.path}</span>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                  className="rounded px-0.5 text-slate-400 hover:text-red-500"
                  aria-label={`Remove ${a.path}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          value={text}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe a task, ask about the code, or @mention a file…"
          data-testid="agent-task-input"
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] outline-none placeholder:text-slate-400"
        />

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <button onClick={() => void pick('file')} className={iconBtn} aria-label="Attach a file">
            <AttachIcon size={15} />
          </button>
          <button
            onClick={() => void pick('image')}
            className={iconBtn}
            aria-label="Attach an image"
          >
            <ImageIcon size={15} />
          </button>
          <button
            onClick={() => void pick('dir')}
            className={iconBtn}
            aria-label="Add folder context"
          >
            <FolderIcon size={15} />
          </button>
          <button
            onClick={() => {
              setText('/')
              setSlash(true)
              inputRef.current?.focus()
            }}
            className={iconBtn}
            aria-label="Slash commands"
          >
            <SlashIcon size={15} />
          </button>

          <span className="mx-1.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />

          <div className="relative" ref={modelRef}>
            <button
              onClick={() => setModelOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Model"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {model.replace('claude-', '')}
            </button>
            {modelOpen && (
              <div className="absolute bottom-full left-0 mb-1.5 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0e1420]">
                {MODELS.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setModel(m)
                      setModelOpen(false)
                    }}
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {text.length > MAX_CHARS * 0.8 && (
              <span className="text-[10px] text-slate-400">
                {text.length}/{MAX_CHARS}
              </span>
            )}
            {speech.supported && (
              <button
                onClick={speech.listening ? speech.stop : speech.start}
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  speech.listening
                    ? 'bg-red-500/15 text-red-500'
                    : 'text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
                }`}
                aria-label={speech.listening ? 'Stop dictation' : 'Voice input'}
                data-testid="composer-voice"
              >
                <MicIcon size={15} />
              </button>
            )}
            <button
              onClick={() => void send()}
              disabled={!text.trim() || busy}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
              aria-label="Send"
              data-testid="agent-plan-button"
            >
              <SendIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      {speech.listening && (
        <div className="px-1 pt-1.5 text-[11px] text-red-500">Listening… speak now</div>
      )}
      {speech.error && <div className="px-1 pt-1.5 text-[11px] text-amber-500">{speech.error}</div>}
      {error && <div className="px-1 pt-1.5 text-[11px] text-red-500">{error}</div>}
    </div>
  )
}
