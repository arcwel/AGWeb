import { useEffect, useRef, useState } from 'react'
import { monaco } from '@/monaco'
import { CloseIcon } from '@/components/icons'
import './InlineEdit.css'

/**
 * Inline AI code edit (roadmap A3): the editor's Cursor-style ⌘I.
 *
 * A small prompt anchored at the selection takes an instruction ("add error
 * handling", "convert to async"); the agent streams a proposed replacement,
 * which renders as an inline diff (green add / red remove via Monaco's diff
 * editor in inline mode) the user can Accept or Reject. Nothing touches the
 * buffer until Accept — which applies a single-undo-stop edit to the model.
 *
 * The overlay is mounted inside the editor's own relative container, so the
 * Monaco-relative coordinates from `getScrolledVisiblePosition` line up with
 * absolute positioning here. The target range is tracked with a decoration so
 * it stays correct under scrolling and any buffer edits before Accept.
 */

export interface InlineEditParams {
  /** Unique id for this edit; filters the streamed token event. */
  editId: string
  /** The selection (or current line) the edit replaces. */
  range: monaco.Range
  /** The original text of that range, sent to the model and shown on the diff's left. */
  originalText: string
  /** Monaco language id, so the diff and the model stay syntax-aware. */
  language: string
}

interface InlineEditProps {
  editor: monaco.editor.IStandaloneCodeEditor
  params: InlineEditParams
  onClose: () => void
}

type Phase = 'prompt' | 'streaming' | 'review' | 'error'

/** Cap the inline diff so a large replacement scrolls inside the overlay
 *  rather than covering the whole editor. */
const DIFF_MAX_HEIGHT = 260
const DIFF_LINE_HEIGHT = 18

export function InlineEdit({ editor, params, onClose }: InlineEditProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('prompt')
  const [instruction, setInstruction] = useState('')
  const [streamed, setStreamed] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const diffContainerRef = useRef<HTMLDivElement>(null)
  // The target range as a tracked decoration: getRange() reflects any buffer
  // edits, so Accept replaces the right span even if the model shifted.
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)

  // Guard the streamed edit against unmount/reject mid-flight (mirrors the
  // `cancelled` idiom in AiAnswer.tsx / PageAssistantBlock.tsx): a cancel flag
  // gates every setState in the async callbacks, and offRef holds the live token
  // listener so we detach it the instant the overlay closes rather than waiting
  // for the editCode promise to settle.
  const cancelledRef = useRef(false)
  const offRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      offRef.current?.()
      offRef.current = null
      // Abort the backend stream on unmount so it stops burning tokens rather
      // than merely being ignored. A no-op once the edit has settled.
      void window.agweb.agents.cancel(params.editId)
    }
  }, [params.editId])

  // Mount: highlight the target, anchor the overlay, and keep both in step with
  // scrolling/layout. Focus the input so the user can type immediately.
  useEffect(() => {
    const collection = editor.createDecorationsCollection([
      {
        range: params.range,
        options: { className: 'agweb-inline-edit-target', isWholeLine: false }
      }
    ])
    decorationsRef.current = collection

    const reposition = (): void => {
      const tracked = collection.getRange(0) ?? params.range
      const visible = editor.getScrolledVisiblePosition({
        lineNumber: tracked.startLineNumber,
        column: 1
      })
      if (!visible) return
      setPos({ top: Math.max(0, visible.top + visible.height + 2), left: 12 })
    }

    reposition()
    const onScroll = editor.onDidScrollChange(reposition)
    const onLayout = editor.onDidLayoutChange(reposition)
    inputRef.current?.focus()

    return () => {
      onScroll.dispose()
      onLayout.dispose()
      collection.clear()
    }
  }, [editor, params.range])

  // Review phase: mount an inline (unified) diff of original vs proposal.
  // renderSideBySide:false gives the green-add / red-remove single-column view.
  useEffect(() => {
    if (phase !== 'review') return
    const container = diffContainerRef.current
    if (!container) return

    const originalModel = monaco.editor.createModel(params.originalText, params.language)
    const modifiedModel = monaco.editor.createModel(result, params.language)
    const diff = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: false,
      renderOverviewRuler: false,
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12
    })
    diff.setModel({ original: originalModel, modified: modifiedModel })

    return () => {
      diff.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [phase, result, params.originalText, params.language])

  const submit = (): void => {
    const inst = instruction.trim()
    // Empty instruction is a no-op (constraint 4): stay open for the user to type.
    if (!inst || phase === 'streaming') return
    setPhase('streaming')
    setStreamed('')
    setError(null)

    const off = window.agweb.agents.onEditToken(({ editId, token }) => {
      if (cancelledRef.current || editId !== params.editId) return
      setStreamed((prev) => prev + token)
    })
    offRef.current = off

    void window.agweb.agents
      .editCode(params.editId, inst, params.originalText, params.language)
      .then((res) => {
        off()
        if (offRef.current === off) offRef.current = null
        if (cancelledRef.current) return
        // Cancelled by the user (Esc / close / unmount): the overlay is already
        // closing, so just stop — no diff to review, no error to show.
        if (res.cancelled) return
        if (res.error) {
          setError(res.error)
          setPhase('error')
          return
        }
        setResult(res.text)
        setPhase('review')
      })
      .catch((e: unknown) => {
        off()
        if (offRef.current === off) offRef.current = null
        if (cancelledRef.current) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
  }

  const accept = (): void => {
    if (phase !== 'review') return
    const range = decorationsRef.current?.getRange(0) ?? params.range
    // A pair of undo stops makes Accept a single, atomic undo for the user.
    editor.pushUndoStop()
    editor.executeEdits('agweb-inline-edit', [{ range, text: result, forceMoveMarkers: true }])
    editor.pushUndoStop()
    editor.focus()
    onClose()
  }

  const reject = (): void => {
    // Stop the backend stream if one is mid-flight (Esc / close / Reject).
    if (phase === 'streaming') void window.agweb.agents.cancel(params.editId)
    editor.focus()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      reject()
      return
    }
    if (e.key === 'Enter' && phase === 'prompt' && !e.shiftKey) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && phase === 'review') {
      e.preventDefault()
      accept()
    }
  }

  const diffHeight = Math.min(
    DIFF_MAX_HEIGHT,
    Math.max(result.split('\n').length, params.originalText.split('\n').length) * DIFF_LINE_HEIGHT +
      16
  )

  return (
    <div
      role="dialog"
      aria-label="Inline AI edit"
      onKeyDown={onKeyDown}
      className="absolute z-20 flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900"
      style={{
        top: pos?.top ?? 8,
        left: pos?.left ?? 12,
        width: 'min(640px, calc(100% - 24px))'
      }}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
          AI Edit
        </span>
        <span className="truncate text-[11px] text-slate-500">
          Edit selection with an instruction
        </span>
        <button
          onClick={reject}
          className="ml-auto rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close inline edit"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <div className="flex items-start gap-2 p-2">
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Describe the change — e.g. add error handling, convert to async…"
          rows={2}
          disabled={phase === 'streaming'}
          className="min-h-[2.25rem] flex-1 resize-none rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        {(phase === 'prompt' || phase === 'error') && (
          <button
            onClick={submit}
            disabled={!instruction.trim()}
            className="rounded bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
            title="Generate (Enter)"
          >
            Generate
          </button>
        )}
      </div>

      {phase === 'streaming' && (
        <div className="border-t border-slate-200 p-2 dark:border-slate-800">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
            Generating replacement…
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {streamed || ' '}
          </pre>
        </div>
      )}

      {phase === 'review' && (
        <div className="flex flex-col border-t border-slate-200 dark:border-slate-800">
          <div ref={diffContainerRef} style={{ height: diffHeight }} className="w-full" />
          <div className="flex items-center gap-2 border-t border-slate-200 px-2 py-1.5 dark:border-slate-800">
            <span className="text-[11px] text-slate-500">
              Proposed change — nothing is applied yet.
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={reject}
                className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Discard (Esc)"
              >
                Reject
              </button>
              <button
                onClick={accept}
                className="rounded bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                title="Apply to the buffer (Cmd+Enter)"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="border-t border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}
