import type { EditorCommandInfo, EditorCommandRequest, EditorCommandResponse } from '@shared/ipc'
import { EDITOR_SECTION, listEditorCommands, runEditorCommand } from '@/editor-commands'

/**
 * The shell's half of the agent → editor bridge (task 12.8).
 *
 * The agent's `editor_command` / `editor_list_commands` tools run in the core,
 * which pushes each request here; this answers from VS Code's command
 * registry — the same list the ⌘K palette shows, so what the agent can run is
 * exactly what the user can. Policy has already been applied on the core side
 * (a `command`-class action) before a `run` ever arrives.
 */

/** The palette prefixes VS Code ids to keep them unique beside WebDeck's own. */
const ID_PREFIX = 'vscode:'
const MAX_LIST = 200

/** Everything the agent may run, optionally filtered. */
export function editorCommandsForAgent(query = ''): EditorCommandInfo[] {
  const needle = query.trim().toLowerCase()
  const out: EditorCommandInfo[] = []
  for (const cmd of listEditorCommands()) {
    if (cmd.section !== EDITOR_SECTION) continue
    const id = cmd.id.startsWith(ID_PREFIX) ? cmd.id.slice(ID_PREFIX.length) : cmd.id
    if (needle && !id.toLowerCase().includes(needle) && !cmd.title.toLowerCase().includes(needle)) {
      continue
    }
    out.push({ id, title: cmd.title, source: cmd.badge, shortcut: cmd.shortcut })
    if (out.length >= MAX_LIST) break
  }
  return out
}

/** Only JSON survives the trip back; anything else becomes a description. */
function serialisable(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

export async function handleEditorCommandRequest(
  request: EditorCommandRequest
): Promise<EditorCommandResponse> {
  try {
    if (request.op === 'list') {
      return { ok: true, value: editorCommandsForAgent(request.query ?? '') }
    }
    const command = String(request.command ?? '').trim()
    if (!command) return { ok: false, error: 'no command id given' }
    const args = Array.isArray(request.args) ? request.args : []
    const value = await runEditorCommand(command, ...args)
    return { ok: true, value: serialisable(value) }
  } catch (err) {
    return { ok: false, error: (err as Error).message || String(err) }
  }
}

/** Subscribe to the core's requests; returns the unsubscribe. */
export function installEditorAgentBridge(): () => void {
  const api = window.agweb?.editor
  if (!api) return () => {}
  return api.onCommandRequest((request) => {
    void handleEditorCommandRequest(request).then((response) =>
      api.respondCommand(request.id, response).catch(() => {
        /* the core dropped the request (timeout/abort) — nothing left to tell it */
      })
    )
  })
}
