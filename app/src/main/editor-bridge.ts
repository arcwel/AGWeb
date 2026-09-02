import type { EditorCommandRequest, EditorCommandResponse } from '../shared/ipc'

/**
 * The agent's way into the editor (task 12.8).
 *
 * VS Code's command service lives in the shell, not here. So an agent tool
 * that wants to run `editor.action.formatDocument` — or ask which commands an
 * installed extension contributes — has to hand the request to the shell and
 * wait for its answer. This is the same shape as a policy confirmation
 * (`policy.ts`): a sink injected by whatever transport is driving the UI, a
 * pending map keyed by request id, and the answer arriving on its own RPC.
 *
 * Fail-closed like prompts: no shell attached, the shell going away, or no
 * answer in time all resolve to an error the agent can read — never a hang.
 */

export type EditorCommandSink = (request: EditorCommandRequest) => boolean

interface Pending {
  resolve(response: EditorCommandResponse): void
  timer: ReturnType<typeof setTimeout>
}

/** Long enough for a format-on-large-file; short enough that a stuck host is reported. */
export const EDITOR_COMMAND_TIMEOUT_MS = 30_000
export const NO_EDITOR_ERROR = 'no editor attached — open the Deck so the shell can run commands'

let sink: EditorCommandSink | null = null
let nextId = 1
const pending = new Map<string, Pending>()

export function setEditorCommandSink(next: EditorCommandSink | null): void {
  sink = next
  abortPendingEditorCommands()
}

/** Fail every waiting request: the shell that would have answered is gone. */
export function abortPendingEditorCommands(): void {
  for (const [id, entry] of [...pending]) {
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.resolve({ ok: false, error: 'editor went away before answering' })
  }
}

/** Send one request to the shell and wait for its answer. */
export function requestEditorCommand(
  request: Omit<EditorCommandRequest, 'id'>,
  timeoutMs = EDITOR_COMMAND_TIMEOUT_MS
): Promise<EditorCommandResponse> {
  if (!sink) return Promise.resolve({ ok: false, error: NO_EDITOR_ERROR })
  const id = `ec-${nextId++}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        resolve({ ok: false, error: `editor did not answer within ${timeoutMs / 1000}s` })
      }
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    let delivered: boolean
    try {
      delivered = sink!({ ...request, id })
    } catch {
      delivered = false
    }
    if (!delivered && pending.delete(id)) {
      clearTimeout(timer)
      resolve({ ok: false, error: NO_EDITOR_ERROR })
    }
  })
}

/** The shell's answer. Unknown ids (late, duplicate) are ignored. */
export function respondEditorCommand(id: string, response: EditorCommandResponse): void {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve({
    ok: response?.ok === true,
    value: response?.value,
    error: typeof response?.error === 'string' ? response.error : undefined
  })
}

/** For tests. */
export function pendingEditorCommandCount(): number {
  return pending.size
}
