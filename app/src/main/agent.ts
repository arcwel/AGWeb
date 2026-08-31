import fsp from 'node:fs/promises'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { coreEnv } from '../core/env'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import type {
  AgentAttachment,
  AgentKeyStatus,
  AgentLogEntry,
  AgentSessionInfo,
  PlanStep
} from '@shared/agents'
import { coreBroadcast } from '../core/notify'
import { getCurrentWorkspace } from './workspace'
import {
  createEntry,
  deleteEntry,
  listDir,
  readFile,
  renameEntry,
  writeBinaryFile,
  writeFile
} from './fs'
import { agentBrowser } from '../core/agent-browser-port'
import { artifactsRoot, generateReport, removeArtifacts } from './agent-report'
import { searchWorkspace } from './search'
import { isTerminalRunning, runInTerminal, stopTerminal, terminalOutput } from './terminal'
import { JsonStore } from './json-store'
import { checkAction } from './policy'
import type { PolicyActionKind } from '@shared/ipc'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'
import { getApiKey, setApiKey } from './secrets'

/**
 * Agent orchestration (PRD flow 4.1): a task is planned first, the plan is
 * held for user approval, and only then does the agent execute — a manual
 * tool-use loop over workspace-scoped tools, with every action logged to
 * Mission Control. Sessions persist across restarts; several can run at once.
 *
 * Provider: Claude (claude-opus-5, adaptive thinking, server-side refusal
 * fallbacks). AGWEB_AGENT_MOCK=1 swaps in a deterministic scripted provider
 * so the pipeline is testable without keys or network.
 */

const MAX_ITERATIONS = 40
/** The only remaining cap: what a tool result can add to the model's context.
 *  Head and tail are both kept, because the interesting part of a long build
 *  log is at both ends. We impose no wall-clock limit on a command — a dev
 *  server or watcher is a legitimate thing for an agent to start. */
const OUTPUT_CAP = 60_000
const LOG_CAP = 500
/** Retention cap: oldest finished sessions (and their artifacts) are pruned. */
const SESSION_CAP = 50

const TERMINAL: ReadonlySet<string> = new Set([
  'done',
  'error',
  'stopped',
  'rejected',
  'interrupted'
])

interface AgentSession extends AgentSessionInfo {
  /** Explicit context the user attached in the composer. */
  attachments: AgentAttachment[]
  stopRequested: boolean
  /** Workspace-relative paths this session has written (conflict detection, 6.6). */
  writtenPaths: Set<string>
  /** Terminal sessions this agent started, so stopping it stops them too. */
  terminals: Set<string>
}

const sessions = new Map<string, AgentSession>()
let nextSessionId = 1

const settingsStore = new JsonStore<{ apiKey?: string }>('agent-settings', {})

/** Non-secret AI config (chosen model). Separate from the key, which lives in
 *  the OS keychain. */
const configStore = new JsonStore<{ model?: string }>('ai-config', {})

/** The Claude models the agent can run, newest/most-capable first. */
export const ANTHROPIC_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']

/** The model in force: an env override, then the user's choice, then default. */
function currentModel(): string {
  return process.env.AGWEB_AGENT_MODEL || configStore.read().model || 'claude-opus-5'
}

let modelChangeNotifier: (() => void) | null = null
/** Injected: fired when the chosen model changes (WebDeck Sync auto-push). */
export function setAgentModelChangeNotifier(fn: () => void): void {
  modelChangeNotifier = fn
}

export function setAgentModel(model: string): void {
  if (!ANTHROPIC_MODELS.includes(model)) return
  configStore.write({ model })
  modelChangeNotifier?.()
}

/** The chosen model (for WebDeck Sync). Ignores the env override — that's a
 *  per-machine dev knob, not a synced preference. */
export function getAgentModel(): string {
  return configStore.read().model || 'claude-opus-5'
}

/**
 * The Anthropic key, newest source first: the encrypted keychain store (set in
 * Settings → AI or the Agents block), then the legacy plaintext agent-settings
 * store (read-only now — a migration fallback for installs that saved a key
 * before the keychain existed), then the environment.
 */
function resolveAnthropicKey(): string | null {
  return (
    getApiKey('anthropic') || settingsStore.read().apiKey || process.env.ANTHROPIC_API_KEY || null
  )
}
const sessionStore = new JsonStore<{ sessions: AgentSessionInfo[] }>('agent-sessions', {
  sessions: []
})

/* ---- Session bookkeeping ---- */

function toInfo(session: AgentSession): AgentSessionInfo {
  return {
    id: session.id,
    task: session.task,
    status: session.status,
    workspacePath: session.workspacePath,
    plan: session.plan,
    log: session.log,
    attachments: session.attachments,
    createdAt: session.createdAt
  }
}

function persistSessions(): void {
  sessionStore.write({ sessions: [...sessions.values()].map(toInfo) })
}

function update(session: AgentSession, patch: Partial<AgentSessionInfo>): void {
  Object.assign(session, patch)
  coreBroadcast(IpcEvents.agentUpdate, toInfo(session), null)
  persistSessions()
  // A finished session gets its execution report written to the artifact
  // store, so the evidence survives even if the workspace changes later.
  if (patch.status && TERMINAL.has(patch.status)) {
    void generateReport(toInfo(session))
      .then(() => log(session, { kind: 'status', text: 'Execution report ready.' }))
      .catch(() => {})
  }
}

function log(session: AgentSession, entry: Omit<AgentLogEntry, 'ts'>): void {
  session.log = [...session.log.slice(-LOG_CAP), { ts: Date.now(), ...entry }]
  coreBroadcast(IpcEvents.agentUpdate, toInfo(session), null)
  persistSessions()
}

/** Fast enough to read as live, slow enough that a long reply costs tens of
 *  broadcasts rather than thousands. */
const STREAM_FLUSH_MS = 90

/**
 * Grow the in-progress assistant turn (task 11.13).
 *
 * Unlike `log`, this neither appends a new entry per delta nor writes to disk —
 * it replaces the trailing streaming entry and only broadcasts. The settled
 * text is written once by `log` when the turn completes, so a crash mid-stream
 * loses a partial sentence rather than corrupting the transcript.
 */
function streamText(session: AgentSession, text: string): void {
  const last = session.log[session.log.length - 1]
  const growing = last?.streaming === true
  const entry: AgentLogEntry = {
    ts: growing ? last.ts : Date.now(),
    kind: 'text',
    text,
    streaming: true
  }
  session.log = growing
    ? [...session.log.slice(0, -1), entry]
    : [...session.log.slice(-LOG_CAP), entry]
  coreBroadcast(IpcEvents.agentUpdate, toInfo(session), null)
}

/** Drop a partial turn so the settled text can be logged in its place. */
function dropStreaming(session: AgentSession): void {
  if (session.log[session.log.length - 1]?.streaming) session.log = session.log.slice(0, -1)
}

export function initAgents(): void {
  // Sessions from a previous app run can't still be executing.
  for (const info of sessionStore.read().sessions) {
    const session: AgentSession = {
      ...info,
      plan: withStepIds(info.plan ?? []),
      attachments: info.attachments ?? [],
      stopRequested: false,
      writtenPaths: new Set(),
      terminals: new Set()
    }
    if (session.status === 'planning') {
      session.status = 'error'
      session.log = [
        ...session.log,
        { ts: Date.now(), kind: 'error', text: 'Interrupted by app restart while planning.' }
      ]
    } else if (session.status === 'running') {
      // Mid-run resume (6.7): keep the session resumable instead of failing it.
      session.status = 'interrupted'
      session.log = [
        ...session.log,
        { ts: Date.now(), kind: 'status', text: 'Interrupted by app restart — resumable.' }
      ]
    }
    sessions.set(session.id, session)
    nextSessionId = Math.max(nextSessionId, Number(session.id.replace('agent-', '')) + 1 || 1)
  }
  // Retention: drop the oldest finished sessions beyond the cap, artifacts too.
  const finished = [...sessions.values()]
    .filter((s) => TERMINAL.has(s.status))
    .sort((a, b) => b.createdAt - a.createdAt)
  for (const old of finished.slice(SESSION_CAP)) {
    sessions.delete(old.id)
    void removeArtifacts(old.id)
  }
  persistSessions()
}

export function listAgentSessions(): AgentSessionInfo[] {
  return [...sessions.values()].map(toInfo).sort((a, b) => b.createdAt - a.createdAt)
}

export function getAgentKeyStatus(): AgentKeyStatus {
  return {
    configured: Boolean(resolveAnthropicKey()),
    mock: process.env.AGWEB_AGENT_MOCK === '1',
    model: currentModel()
  }
}

export function setAgentApiKey(key: string): void {
  // Route to the encrypted keychain store (secrets.ts), never the legacy
  // plaintext agent-settings file. That old store is now read-only — kept only
  // as a migration fallback in resolveAnthropicKey — so no cleartext key is
  // ever written to disk, whichever panel the user typed it into.
  setApiKey('anthropic', key.trim())
}

/** Open (regenerating if needed) a session's execution report in a browser tab. */
export async function openAgentReport(id: string): Promise<void> {
  const session = sessions.get(id)
  if (!session) return
  const path = await generateReport(toInfo(session))
  coreBroadcast(IpcEvents.browserOpenTab, `file://${path}`, null)
}

/** Disk-usage control: drop every finished session and its artifacts. */
export function clearFinishedAgentSessions(): AgentSessionInfo[] {
  for (const session of [...sessions.values()]) {
    if (!TERMINAL.has(session.status)) continue
    sessions.delete(session.id)
    void removeArtifacts(session.id)
  }
  persistSessions()
  const remaining = listAgentSessions()
  coreBroadcast(IpcEvents.agentSessionsReset, remaining, null)
  return remaining
}

/** Rename a conversation without touching what the agent was told (11.9).
 *  The task text is the label in every list, so a long first message deserves
 *  a short name — but a running agent keeps working from the original. */
export function renameAgentSession(id: string, title: string): void {
  const session = sessions.get(id)
  if (!session) return
  update(session, { task: title.trim() || session.task })
}

/** Delete one conversation and its artifacts (11.9). */
export function deleteAgentSession(id: string): AgentSessionInfo[] {
  const session = sessions.get(id)
  if (session && !TERMINAL.has(session.status)) session.stopRequested = true
  sessions.delete(id)
  void removeArtifacts(id)
  persistSessions()
  const remaining = listAgentSessions()
  coreBroadcast(IpcEvents.agentSessionsReset, remaining, null)
  return remaining
}

/**
 * Export a conversation as Markdown or JSON (11.9).
 *
 * Written into the session's own artifact directory rather than the workspace:
 * an export is a record of what happened, not a project file, and the workspace
 * is the thing the transcript is *about*.
 */
export async function exportAgentSession(
  id: string,
  format: 'md' | 'json'
): Promise<{ path?: string; error?: string }> {
  const session = sessions.get(id)
  if (!session) return { error: 'No such session.' }
  const info = toInfo(session)
  const dir = join(artifactsRoot(), id)
  const path = join(dir, `transcript.${format}`)

  const body =
    format === 'json'
      ? JSON.stringify(info, null, 2)
      : [
          `# ${info.task}`,
          '',
          `- Status: ${info.status}`,
          `- Started: ${new Date(info.createdAt).toISOString()}`,
          `- Workspace: ${info.workspacePath ?? '(none)'}`,
          ...(info.attachments.length
            ? ['', '## Context', ...info.attachments.map((a) => `- \`${a.path}\` (${a.kind})`)]
            : []),
          ...(info.plan.length
            ? ['', '## Plan', ...info.plan.map((s, i) => `${i + 1}. **[${s.kind}]** ${s.title}`)]
            : []),
          '',
          '## Transcript',
          ...info.log.map((e) => {
            const stamp = new Date(e.ts).toISOString()
            // Prose is already markdown; everything else is machine output and
            // is fenced so it survives the round trip verbatim.
            return e.kind === 'text'
              ? `\n**${stamp}**\n\n${e.text}`
              : `\n**${stamp}** · ${e.kind}\n\n\`\`\`\n${e.text}\n\`\`\``
          })
        ].join('\n')

  try {
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path, body, 'utf8')
    return { path }
  } catch (e) {
    return { error: String(e) }
  }
}

/* ---- Lifecycle ---- */

export function startAgentTask(task: string, attachments: AgentAttachment[] = []): string {
  const session: AgentSession = {
    id: `agent-${nextSessionId++}`,
    task,
    status: 'planning',
    workspacePath: getCurrentWorkspace()?.path ?? null,
    plan: [],
    log: [],
    createdAt: Date.now(),
    attachments,
    stopRequested: false,
    writtenPaths: new Set(),
    terminals: new Set()
  }
  sessions.set(session.id, session)
  log(session, { kind: 'status', text: 'Planning…' })

  void planTask(session).catch((error) => {
    log(session, { kind: 'error', text: String(error) })
    update(session, { status: 'error' })
  })
  return session.id
}

export function approveAgentPlan(id: string): void {
  const session = sessions.get(id)
  if (!session || session.status !== 'awaiting_approval') return
  update(session, { status: 'running' })
  log(session, { kind: 'status', text: 'Plan approved — executing.' })
  void executeTask(session).catch((error) => {
    log(session, { kind: 'error', text: String(error) })
    update(session, { status: 'error' })
  })
}

export function rejectAgentPlan(id: string): void {
  const session = sessions.get(id)
  if (!session || session.status !== 'awaiting_approval') return
  log(session, { kind: 'status', text: 'Plan rejected.' })
  update(session, { status: 'rejected' })
}

const PLAN_KINDS: ReadonlySet<string> = new Set(['edit', 'command', 'inspect', 'verify', 'other'])

let nextStepId = 1
const stepId = (): string => `step-${nextStepId++}`

/** Model-authored steps arrive without ids; mint them once here. */
function withStepIds(steps: PlanStep[]): PlanStep[] {
  return steps.map((s) => ({ ...s, id: s.id || stepId() }))
}

/** Plan editing (6.4): replace the plan while it awaits approval. */
export function updateAgentPlan(id: string, steps: PlanStep[]): void {
  const session = sessions.get(id)
  if (!session || session.status !== 'awaiting_approval' || !Array.isArray(steps)) return
  const sanitized: PlanStep[] = steps
    .filter((s) => s && typeof s.title === 'string' && s.title.trim().length > 0)
    .map((s) => ({
      id: typeof s.id === 'string' && s.id ? s.id.slice(0, 64) : stepId(),
      kind: (PLAN_KINDS.has(s.kind) ? s.kind : 'other') as PlanStep['kind'],
      title: s.title.trim().slice(0, 300),
      ...(typeof s.detail === 'string' && s.detail ? { detail: s.detail.slice(0, 1000) } : {})
    }))
  if (sanitized.length === 0) return
  update(session, { plan: sanitized })
  log(session, { kind: 'status', text: 'Plan edited by the user.' })
}

/** Mid-run resume (6.7): continue a session the app restart interrupted. */
export function resumeAgentTask(id: string): void {
  const session = sessions.get(id)
  if (!session || session.status !== 'interrupted') return
  session.stopRequested = false
  update(session, { status: 'running' })
  log(session, { kind: 'status', text: 'Resumed after interruption.' })
  void executeTask(session, true).catch((error) => {
    log(session, { kind: 'error', text: String(error) })
    update(session, { status: 'error' })
  })
}

export function stopAgent(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.stopRequested = true
  // Background commands must not outlive the session that started them.
  for (const terminalId of session.terminals) {
    if (isTerminalRunning(terminalId)) stopTerminal(terminalId)
  }
  log(session, { kind: 'status', text: 'Stop requested.' })
}

/* ---- Planning ---- */

const PLAN_TOOL: Anthropic.Tool = {
  name: 'create_plan',
  description: 'Submit the step-by-step execution plan for the task.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['steps'],
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'title'],
          properties: {
            kind: { type: 'string', enum: ['edit', 'command', 'inspect', 'verify', 'other'] },
            title: { type: 'string' },
            detail: { type: 'string' }
          }
        }
      }
    }
  },
  strict: true
}

function getClient(): Anthropic {
  const apiKey = resolveAnthropicKey()
  if (!apiKey) throw new Error('No API key configured. Add one in Settings → AI.')
  return new Anthropic({ apiKey })
}

/** Attached files/folders rendered as explicit context for the model. */
function attachmentContext(session: AgentSession): string {
  if (session.attachments.length === 0) return ''
  const lines = session.attachments.map((a) => `- ${a.kind}: ${a.path}`).join('\n')
  return `\n\nThe user attached this context — read it before planning:\n${lines}`
}

async function planTask(session: AgentSession): Promise<void> {
  if (process.env.AGWEB_AGENT_MOCK === '1') {
    session.plan = withStepIds(mockPlan(session.task))
    log(session, { kind: 'status', text: 'Plan ready (mock provider).' })
    update(session, { status: 'awaiting_approval' })
    return
  }

  const client = getClient()
  const response = await client.messages.create({
    model: currentModel(),
    max_tokens: 16000,
    system:
      'You are the planning stage of WebDeck, an agent-first IDE. Produce a concise, ' +
      'concrete execution plan for the task in the given workspace. Steps should be ' +
      'few and meaningful (typically 2-6). Use the create_plan tool.',
    tool_choice: { type: 'tool', name: 'create_plan' },
    tools: [PLAN_TOOL],
    messages: [
      {
        role: 'user',
        content:
          `Workspace: ${session.workspacePath ?? '(none open)'}\n\nTask: ${session.task}` +
          attachmentContext(session)
      }
    ]
  })
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const input = toolUse?.input as { steps?: PlanStep[] } | undefined
  session.plan = withStepIds(input?.steps ?? [])
  if (session.plan.length === 0) throw new Error('The model returned an empty plan.')
  log(session, { kind: 'status', text: `Plan ready (${session.plan.length} steps).` })
  update(session, { status: 'awaiting_approval' })
}

/* ---- Execution tools ---- */

const EXEC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file. Path is relative to the workspace root.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a text file with the given content. Path is relative to the workspace root; parent directories are created as needed.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'list_dir',
    description: 'List a directory in the workspace ("" for the root).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'search',
    description: 'Search file contents across the workspace. Returns path, line, text.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'create_dir',
    description: 'Create a directory (and any missing parents) at a workspace-relative path.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'move_file',
    description:
      'Move or rename a file or directory inside the workspace. Refuses to overwrite an existing destination.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: { from: { type: 'string' }, to: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'delete_file',
    description:
      'Delete a file or directory (recursively) inside the workspace. Cannot delete the workspace root.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in a real terminal the user can watch. Returns stdout+stderr and the exit code when it finishes. There is no time limit — for a long-running process (dev server, watcher, REPL) pass background: true to get the terminal id back immediately and stop it later with stop_command.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: { command: { type: 'string' }, background: { type: 'boolean' } }
    },
    strict: true
  },
  {
    name: 'stop_command',
    description:
      'Stop a background command started by run_command, and return whatever it printed.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['terminal_id'],
      properties: { terminal_id: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_open',
    description:
      'Open a new tab in the shell browser, navigate it to a URL, and return its tabId. The tab appears in the tab strip so the user watches you drive it. Use for verifying UIs (e.g. a dev server you started).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_navigate',
    description: 'Navigate an open browser tab to a URL and wait for the page to load.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'url'],
      properties: { tab_id: { type: 'string' }, url: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_read',
    description:
      "Read the page: title, URL, and visible text. Pass a CSS selector to read just one element's text.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id'],
      properties: { tab_id: { type: 'string' }, selector: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_eval',
    description:
      'Evaluate a JavaScript expression in the page and return its result as JSON. Use for DOM assertions (element counts, computed styles, attribute values).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'expression'],
      properties: { tab_id: { type: 'string' }, expression: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_click',
    description: 'Click the first element matching a CSS selector.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'selector'],
      properties: { tab_id: { type: 'string' }, selector: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_type',
    description:
      'Type into an input, textarea, or contenteditable element (dispatches input/change events so framework bindings update).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'selector', 'text'],
      properties: {
        tab_id: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' }
      }
    },
    strict: true
  },
  {
    name: 'browser_wait_for',
    description:
      'Wait until an element matching the CSS selector exists (default timeout 10000 ms). Use after navigation or actions that render asynchronously.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'selector'],
      properties: {
        tab_id: { type: 'string' },
        selector: { type: 'string' },
        timeout_ms: { type: 'number' }
      }
    },
    strict: true
  },
  {
    name: 'browser_screenshot',
    description:
      'Capture the page (or one element via CSS selector) as a PNG saved at a workspace-relative path, e.g. "shots/home.png".',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'path'],
      properties: {
        tab_id: { type: 'string' },
        path: { type: 'string' },
        selector: { type: 'string' }
      }
    },
    strict: true
  },
  {
    name: 'browser_record_start',
    description:
      'Start recording the tab: frames are captured on every paint. Stop with browser_record_stop to save a scrubbable HTML replay of the verification session.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id'],
      properties: { tab_id: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_record_stop',
    description:
      'Stop recording and save the session replay as a self-contained HTML player at a workspace-relative path, e.g. "recordings/verify.html".',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'path'],
      properties: { tab_id: { type: 'string' }, path: { type: 'string' } }
    },
    strict: true
  },
  {
    name: 'browser_set_viewport',
    description:
      'Emulate a viewport size for responsiveness checks (e.g. 390×844 for mobile). Pass width 0 and height 0 to reset to the native stage size.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id', 'width', 'height'],
      properties: {
        tab_id: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' }
      }
    },
    strict: true
  },
  {
    name: 'browser_inspect',
    description:
      'Agent Vision: report what the browser itself saw on the tab — network requests, failed requests (with status/error and, for HTTP errors, the response body), and console errors/warnings. Use in your verify step to catch failures the rendered page hides: a page can look fine while an XHR silently returns 500. Always inspect before concluding a browser task succeeded.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tab_id'],
      properties: { tab_id: { type: 'string' } }
    },
    strict: true
  }
]

/** Keep both ends of long output — a build log's signal is at the head and tail. */
function capOutput(text: string): string {
  if (text.length <= OUTPUT_CAP) return text
  const half = Math.floor(OUTPUT_CAP / 2)
  const omitted = text.length - OUTPUT_CAP
  return `${text.slice(0, half)}\n… [${omitted} characters omitted] …\n${text.slice(-half)}`
}

/** Conflict detection (6.6): another running session already wrote this path. */
function conflictWith(session: AgentSession, path: string): string | null {
  for (const other of sessions.values()) {
    if (other.id === session.id || other.status !== 'running') continue
    if (other.writtenPaths.has(path)) return other.id
  }
  return null
}

/** Surface any navigation the tab's guard cancelled (redirect or in-page)
 *  so the model learns the page did not go where it expected (P1-1). */
async function enforceNavigationPolicy(
  session: AgentSession,
  tabId: string
): Promise<string | null> {
  const blocked = agentBrowser().takeBlockedNavigation(tabId)
  if (!blocked) return null
  log(session, { kind: 'error', text: `Blocked navigation to ${blocked.slice(0, 200)}` })
  return `note: a navigation to ${blocked} was blocked by the permission policy; the tab did not follow it`
}

/**
 * Which gate a navigation target belongs behind.
 *
 * data:, file: and blob: have no host, so no per-site rule can reach them —
 * and what they actually do is not navigation:
 *   - a data: URL runs whatever script it contains, with a fetch of its own,
 *     which is exactly what browser_eval is gated as a `command` for;
 *   - file: reads local files, around the workspace pin;
 *   - blob: inherits the origin that made it.
 * Treating them as navigation put them behind a check built for hosts. They go
 * behind the `command` gate instead, which is what they are — and which the
 * agent's own evidence page (a data: URL it authors) legitimately passes in a
 * mode where commands are allowed.
 */
function navigationKind(url: string): PolicyActionKind {
  return /^(data|file|blob):/i.test(url) ? 'command' : 'browser_navigate'
}

/**
 * Gate an interaction with a page against the site it happens on.
 *
 * browser_eval was gated from the start because injected JS is an egress
 * channel. Clicking and typing were not — and they should have been: a click
 * can submit a purchase, send a message or fire a state-changing XHR without
 * ever navigating, and typing is what fills the form first. Checking the
 * destination AFTER a click, which is all that happened before, catches only
 * the subset that navigates.
 *
 * This matters far more now the agent can act in the user's own session, where
 * its clicks carry their cookies and are indistinguishable from theirs.
 *
 * The check is against the tab's CURRENT site, so it rides the per-site
 * permissions: a site the user has already allowed does not prompt again, and a
 * sensitive one asks even under full autonomy. Without that it would be a
 * confirmation on every click, which teaches people to click yes.
 */
async function gateInteraction(
  session: AgentSession,
  tabId: string,
  what: string
): Promise<string | null> {
  let url: string
  try {
    url = String(await agentBrowser().evaluate(tabId, 'location.href')).replace(/^"|"$/g, '')
  } catch {
    // A tab we cannot read the location of is one we should not act on blind.
    return 'error: could not determine which site this tab is on; refusing to act on it'
  }
  // The URL alone is the detail. Everything downstream — the per-site
  // decisions, the sensitive-site list, the local-navigation shortcut — parses
  // it with new URL(), so a friendlier "click #go on https://…" string would
  // parse as nothing and quietly match no site rule at all.
  const refused = await gate(session, navigationKind(url), url)
  if (refused) log(session, { kind: 'error', text: `Refused: ${what} on ${url}` })
  return refused
}

/** The tool-result text for a refused concurrent write (6.6). */
function conflictError(session: AgentSession, path: string, holder: string): string {
  log(session, { kind: 'error', text: `Write conflict on ${path} (held by ${holder})` })
  return `error: conflict — ${path} was already modified by the concurrently running session ${holder}; pick a different path or wait for it to finish`
}

/** Phase 9 gate: pause on the policy's verdict before a side-effectful tool.
 *  Returns null to proceed, or the error string the model receives. */
async function gate(
  session: AgentSession,
  kind: PolicyActionKind,
  detail: string
): Promise<string | null> {
  if (await checkAction(kind, detail, session.id)) return null
  log(session, {
    kind: 'error',
    text: `Denied by permission policy: ${kind} ${detail.slice(0, 120)}`
  })
  return 'error: denied by the permission policy — ask the user to adjust the permission mode if this action is required'
}

async function executeTool(
  session: AgentSession,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const cwd = session.workspacePath ?? coreEnv().homeDir
  // Every workspace op is pinned to the session's own workspace: opening
  // another project mid-run must never retarget an in-flight agent (P0-1).
  const root = session.workspacePath
  switch (name) {
    case 'read_file': {
      // null cap: the agent decides what it can handle, we do not pre-refuse.
      const result = await readFile(String(input.path ?? ''), root, null)
      return result.error ? `error: ${result.error}` : (result.content ?? '')
    }
    case 'write_file': {
      const path = String(input.path ?? '')
      const conflict = conflictWith(session, path)
      if (conflict) return conflictError(session, path, conflict)
      const denied = await gate(session, 'file_write', path)
      if (denied) return denied
      const before = (await readFile(path, root, null)).content ?? ''
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (dir) await createEntry(dir, 'dir', root)
      const result = await writeFile(path, String(input.content ?? ''), root)
      if (result.error) return `error: ${result.error}`
      session.writtenPaths.add(path)
      log(session, {
        kind: 'edit',
        text: `Edited ${path}`,
        path,
        before,
        after: String(input.content ?? '')
      })
      return 'ok'
    }
    case 'create_dir': {
      const path = String(input.path ?? '')
      const denied = await gate(session, 'file_write', path)
      if (denied) return denied
      const result = await createEntry(path, 'dir', root)
      if (result.error) return `error: ${result.error}`
      session.writtenPaths.add(path)
      log(session, { kind: 'edit', text: `Created directory ${path}`, path })
      return 'ok'
    }
    case 'move_file': {
      const from = String(input.from ?? '')
      const to = String(input.to ?? '')
      for (const path of [from, to]) {
        const conflict = conflictWith(session, path)
        if (conflict) return conflictError(session, path, conflict)
      }
      const denied = await gate(session, 'file_write', `${from} → ${to}`)
      if (denied) return denied
      const result = await renameEntry(from, to, root)
      if (result.error) return `error: ${result.error}`
      session.writtenPaths.add(from)
      session.writtenPaths.add(to)
      log(session, { kind: 'edit', text: `Moved ${from} → ${to}`, path: to })
      return 'ok'
    }
    case 'delete_file': {
      const path = String(input.path ?? '')
      const conflict = conflictWith(session, path)
      if (conflict) return conflictError(session, path, conflict)
      // Deletion is irreversible, so the before-content rides the log for the
      // execution report even when the policy auto-approves the write.
      const before = (await readFile(path, root, null)).content ?? ''
      const denied = await gate(session, 'file_write', path)
      if (denied) return denied
      const result = await deleteEntry(path, root)
      if (result.error) return `error: ${result.error}`
      session.writtenPaths.add(path)
      log(session, { kind: 'edit', text: `Deleted ${path}`, path, before, after: '' })
      return 'ok'
    }
    case 'list_dir': {
      const entries = await listDir(String(input.path ?? ''), root)
      return entries.map((e) => `${e.kind === 'dir' ? 'dir ' : 'file'} ${e.name}`).join('\n')
    }
    case 'search': {
      const hits = await searchWorkspace(String(input.query ?? ''), root)
      return hits
        .slice(0, 50)
        .map((h) => `${h.path}:${h.line}: ${h.text}`)
        .join('\n')
    }
    case 'run_command': {
      const command = String(input.command ?? '')
      const background = input.background === true
      const denied = await gate(session, 'command', command)
      if (denied) return denied
      // Runs in a real pty the user watches. The log entry carries the session
      // id so the transcript renders it inline where the command was run; the
      // user can pop it out into a Terminal block from there.
      const { sessionId, done } = runInTerminal(command, cwd, () => {})
      session.terminals.add(sessionId)
      log(session, { kind: 'command', text: `$ ${command}`, terminalId: sessionId })
      if (background) {
        void done.then(({ code }) =>
          log(session, {
            kind: 'command',
            text: `$ ${command}`,
            terminalId: sessionId,
            exitCode: code
          })
        )
        return `started in terminal ${sessionId} — it is running in the background; call stop_command with this id when you are done, or read its output again with it`
      }
      const { code, output } = await done
      // Re-log with the exit code: the transcript collapses the inline
      // terminal to a summary row once a command is finished.
      log(session, { kind: 'command', text: `$ ${command}`, terminalId: sessionId, exitCode: code })
      return `exit code: ${code}\n${capOutput(output)}`
    }
    case 'stop_command': {
      const terminalId = String(input.terminal_id ?? '')
      if (!session.terminals.has(terminalId))
        return `error: ${terminalId} is not a terminal you started`
      const wasRunning = stopTerminal(terminalId)
      const output = capOutput(terminalOutput(terminalId))
      log(session, {
        kind: 'command',
        text: `[${terminalId}] ${wasRunning ? 'stopped' : 'already exited'}`
      })
      return `${wasRunning ? 'stopped' : 'already exited'}\n${output}`
    }
    case 'browser_open': {
      const url = String(input.url ?? '')
      const denied = await gate(session, navigationKind(url), url)
      if (denied) return denied
      const result = await agentBrowser().openTab(url)
      log(session, { kind: 'browser', text: `Opened browser tab → ${url.slice(0, 200)}` })
      const openTabId = /tabId: (\S+)/.exec(result)?.[1] ?? ''
      const blocked = openTabId ? await enforceNavigationPolicy(session, openTabId) : null
      return blocked ? `${result}\n${blocked}` : result
    }
    case 'browser_navigate': {
      const url = String(input.url ?? '')
      const denied = await gate(session, navigationKind(url), url)
      if (denied) return denied
      const navTabId = String(input.tab_id ?? '')
      const result = await agentBrowser().navigate(navTabId, url)
      log(session, { kind: 'browser', text: `Navigated → ${url.slice(0, 200)}` })
      const blocked = await enforceNavigationPolicy(session, navTabId)
      return blocked ? `${result}\n${blocked}` : result
    }
    case 'browser_read': {
      const readTabId = String(input.tab_id ?? '')
      const page = await agentBrowser().readPage(
        readTabId,
        input.selector ? String(input.selector) : undefined
      )
      // Agent Vision auto-surface: a page can render fine while its network
      // silently failed. If the browser saw failures, append them so the model
      // notices without having to think to call browser_inspect (P0 success
      // criterion: the failing request shows up on its own).
      if (agentBrowser().visionHasProblems(readTabId)) {
        return `${page}\n\n--- Agent Vision ---\n${agentBrowser().visionReport(readTabId)}`
      }
      return page
    }
    case 'browser_eval': {
      const expression = String(input.expression ?? '')
      // Injected JS runs with the page origin's full powers (fetch, beacon,
      // location) — it is an egress channel, so it passes the same gate as a
      // shell command rather than being unguarded (P0-2).
      const denied = await gate(session, 'command', `browser_eval: ${expression}`)
      if (denied) return denied
      return agentBrowser().evaluate(String(input.tab_id ?? ''), expression)
    }
    case 'browser_click': {
      const selector = String(input.selector ?? '')
      const tabId = String(input.tab_id ?? '')
      // Gated BEFORE the click: a click that submits or fires an XHR has
      // already happened by the time a post-hoc navigation check runs.
      const refused = await gateInteraction(session, tabId, `click ${selector}`)
      if (refused) return refused
      // A click can also drive navigation; re-check where the tab lands too.
      const result = await agentBrowser().click(tabId, selector)
      log(session, { kind: 'browser', text: `Clicked ${selector}` })
      const landed = await enforceNavigationPolicy(session, tabId)
      return landed ? `${result}\n${landed}` : result
    }
    case 'browser_type': {
      const selector = String(input.selector ?? '')
      const tabId = String(input.tab_id ?? '')
      const refused = await gateInteraction(session, tabId, `type into ${selector}`)
      if (refused) return refused
      const result = await agentBrowser().type(tabId, selector, String(input.text ?? ''))
      log(session, { kind: 'browser', text: `Typed into ${selector}` })
      return result
    }
    case 'browser_wait_for':
      return agentBrowser().waitFor(
        String(input.tab_id ?? ''),
        String(input.selector ?? ''),
        typeof input.timeout_ms === 'number' ? input.timeout_ms : 10_000
      )
    case 'browser_screenshot': {
      const path = String(input.path ?? '')
      if (!path.toLowerCase().endsWith('.png')) return 'error: path must end in .png'
      const shotConflict = conflictWith(session, path)
      if (shotConflict) return conflictError(session, path, shotConflict)
      const denied = await gate(session, 'file_write', path)
      if (denied) return denied
      const png = await agentBrowser().capture(
        String(input.tab_id ?? ''),
        input.selector ? String(input.selector) : undefined
      )
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (dir) await createEntry(dir, 'dir', root)
      const result = await writeBinaryFile(path, png, root)
      if (result.error) return `error: ${result.error}`
      session.writtenPaths.add(path)
      log(session, { kind: 'screenshot', text: `Screenshot saved: ${path}`, path })
      return `saved ${path} (${png.length} bytes)`
    }
    case 'browser_record_start': {
      const result = await agentBrowser().recordStart(String(input.tab_id ?? ''))
      log(session, { kind: 'browser', text: 'Recording started' })
      return result
    }
    case 'browser_record_stop': {
      const path = String(input.path ?? '')
      if (!path.toLowerCase().endsWith('.html')) return 'error: path must end in .html'
      const recConflict = conflictWith(session, path)
      if (recConflict) return conflictError(session, path, recConflict)
      const denied = await gate(session, 'file_write', path)
      if (denied) return denied
      const html = await agentBrowser().recordStop(String(input.tab_id ?? ''))
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (dir) await createEntry(dir, 'dir', root)
      const result = await writeFile(path, html, root)
      if (result.error) return `error: ${result.error}`
      session.writtenPaths.add(path)
      log(session, { kind: 'browser', text: `Recording saved: ${path}` })
      return `saved ${path}`
    }
    case 'browser_set_viewport': {
      const result = agentBrowser().setViewport(
        String(input.tab_id ?? ''),
        Number(input.width ?? 0),
        Number(input.height ?? 0)
      )
      log(session, { kind: 'browser', text: result })
      return result
    }
    case 'browser_inspect': {
      const report = agentBrowser().visionReport(String(input.tab_id ?? ''))
      log(session, { kind: 'browser', text: report })
      return report
    }
    default:
      return `error: unknown tool ${name}`
  }
}

/* ---- Execution loop ---- */

async function executeTask(session: AgentSession, resumed = false): Promise<void> {
  if (process.env.AGWEB_AGENT_MOCK === '1') {
    await mockExecute(session)
    return
  }

  // On resume the original conversation is gone; brief the fresh loop with
  // the action log so completed steps aren't redone.
  const resumeContext = resumed
    ? '\n\nThis session was interrupted by an app restart and is now resuming. ' +
      'Actions already completed (log tail):\n' +
      session.log
        .slice(-30)
        .map((e) => `- [${e.kind}] ${e.text.slice(0, 200)}`)
        .join('\n') +
      '\nContinue from where the log leaves off; do not redo completed steps.'
    : ''

  const client = getClient()
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content:
        `Task: ${session.task}\n\nApproved plan:\n` +
        session.plan.map((s, i) => `${i + 1}. [${s.kind}] ${s.title}`).join('\n') +
        attachmentContext(session) +
        resumeContext
    }
  ]

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (session.stopRequested) {
      update(session, { status: 'stopped' })
      return
    }

    const stream = client.beta.messages.stream({
      model: currentModel(),
      max_tokens: 32000,
      // Route policy declines to a fallback model server-side (skill default).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system:
        "You are WebDeck's execution agent, working inside the workspace at " +
        `${session.workspacePath ?? '(no workspace)'} with workspace-scoped tools. ` +
        'Follow the approved plan, keep changes minimal, and end with a short summary ' +
        'of what you did and how you verified it. The browser_* tools drive real tabs ' +
        'in the shell browser the user is watching — use them to verify UI changes ' +
        '(open the page, interact, assert on the DOM with browser_read/browser_eval, ' +
        'and capture browser_screenshot evidence).',
      tools: EXEC_TOOLS,
      messages
    } as Parameters<typeof client.beta.messages.stream>[0])

    // Render the reply as it arrives, coalesced so a long answer is tens of
    // broadcasts rather than one per token.
    let pending = ''
    let flushTimer: NodeJS.Timeout | null = null
    stream.on('text', (delta: string) => {
      pending += delta
      if (flushTimer) return
      flushTimer = setTimeout(() => {
        flushTimer = null
        streamText(session, pending)
      }, STREAM_FLUSH_MS)
    })

    let message: Anthropic.Beta.BetaMessage
    try {
      message = await stream.finalMessage()
    } finally {
      if (flushTimer) clearTimeout(flushTimer)
      dropStreaming(session)
    }

    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) {
        log(session, { kind: 'text', text: block.text.trim() })
      }
    }

    if (message.stop_reason === 'refusal') {
      log(session, { kind: 'error', text: 'The model declined this request (safety policy).' })
      update(session, { status: 'error' })
      return
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content })
      continue
    }
    if (message.stop_reason !== 'tool_use') {
      update(session, { status: 'done' })
      log(session, { kind: 'status', text: 'Task complete.' })
      return
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use'
    )
    messages.push({ role: 'assistant', content: message.content })

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const tool of toolUses) {
      log(session, {
        kind: 'tool',
        text: `→ ${tool.name}(${JSON.stringify(tool.input).slice(0, 200)})`
      })
      let content: string
      try {
        content = await executeTool(session, tool.name, tool.input as Record<string, unknown>)
      } catch (error) {
        content = `error: ${String(error)}`
      }
      results.push({ type: 'tool_result', tool_use_id: tool.id, content })
    }
    messages.push({ role: 'user', content: results })
  }

  log(session, { kind: 'error', text: `Stopped after ${MAX_ITERATIONS} iterations.` })
  update(session, { status: 'error' })
}

/* ---- Mock provider (AGWEB_AGENT_MOCK=1): deterministic, offline ---- */

function mockPlan(task: string): PlanStep[] {
  return [
    { id: '', kind: 'edit', title: 'Write AGENT_NOTE.md recording the task', detail: task },
    { id: '', kind: 'inspect', title: 'Open a browser tab on the target page' },
    { id: '', kind: 'verify', title: 'Click the action button and assert the DOM updated' },
    { id: '', kind: 'verify', title: 'Capture screenshot evidence (agent-shot.png)' },
    { id: '', kind: 'command', title: 'Verify by listing the workspace' }
  ]
}

async function mockExecute(session: AgentSession): Promise<void> {
  await executeTool(session, 'write_file', {
    path: 'AGENT_NOTE.md',
    content: `# Agent note\n\nTask: ${session.task}\n\nCompleted by the mock agent.\n`
  })

  // Drive the shell browser end to end: open a page, interact, assert on the
  // DOM, then capture screenshot evidence — the PRD 4.1 verification loop.
  // The page renders fine but its script hits a dead endpoint and logs an error
  // — the exact "looks OK, silently broke" case Agent Vision exists to catch.
  const html =
    '<title>Agent Target</title>' +
    '<h1 id="status">waiting</h1>' +
    '<button id="go" onclick="document.getElementById(\'status\').textContent=\'clicked-ok\'">Go</button>' +
    '<input id="name">' +
    '<script>console.error("vision-demo: synthetic console error on load");' +
    'fetch("http://127.0.0.1:9/agent-vision-probe").catch(function(){});</script>'
  const opened = await executeTool(session, 'browser_open', {
    url: 'data:text/html,' + encodeURIComponent(html)
  })
  const tabId = /tabId: (\S+)/.exec(opened)?.[1] ?? ''
  await executeTool(session, 'browser_record_start', { tab_id: tabId })
  await executeTool(session, 'browser_wait_for', { tab_id: tabId, selector: '#go' })
  await executeTool(session, 'browser_click', { tab_id: tabId, selector: '#go' })
  const status = await executeTool(session, 'browser_read', { tab_id: tabId, selector: '#status' })
  log(session, {
    kind: status.includes('clicked-ok') ? 'text' : 'error',
    text: `DOM assertion: #status is "${status}" (expected "clicked-ok")`
  })
  await executeTool(session, 'browser_type', { tab_id: tabId, selector: '#name', text: 'agweb' })
  const value = await executeTool(session, 'browser_eval', {
    tab_id: tabId,
    expression: "document.getElementById('name').value"
  })
  log(session, { kind: 'text', text: `Input round-trip: #name reads ${value}` })
  // Agent Vision: check what the browser actually saw. The DOM looked fine, but
  // this surfaces the failed request + console error the page produced.
  const vision = await executeTool(session, 'browser_inspect', { tab_id: tabId })
  log(session, {
    kind: vision.includes('console error') || vision.includes('failed') ? 'text' : 'error',
    text: `Agent Vision verified the page's network/console: ${vision.split('\n')[0]}`
  })
  await executeTool(session, 'browser_set_viewport', { tab_id: tabId, width: 390, height: 700 })
  await executeTool(session, 'browser_screenshot', { tab_id: tabId, path: 'agent-shot.png' })
  await executeTool(session, 'browser_set_viewport', { tab_id: tabId, width: 0, height: 0 })
  await executeTool(session, 'browser_record_stop', {
    tab_id: tabId,
    path: 'recordings/verify.html'
  })

  const output = await executeTool(session, 'run_command', { command: 'ls' })
  log(session, {
    kind: 'text',
    text: `Wrote AGENT_NOTE.md, verified the page interaction in the browser, and listed the workspace (${output.split('\n').length - 1} lines).`
  })
  update(session, { status: 'done' })
  log(session, { kind: 'status', text: 'Task complete.' })
}

/** Register the agent domain with webdeck-core (P1). The largest surface; live
 *  session updates are a separate broadcast, not requests. */
export function registerAgentRpc(): void {
  core.register(IpcChannels.agentStart, (task, attachments) => {
    const t = asString(task)?.trim()
    if (!t) throw new Error('empty task')
    const list = Array.isArray(attachments)
      ? (attachments as AgentAttachment[])
          .filter((a) => a && typeof a.path === 'string' && a.path.length > 0)
          .slice(0, 24)
          .map(
            (a) =>
              ({
                path: a.path.slice(0, 400),
                kind: a.kind === 'dir' ? 'dir' : a.kind === 'image' ? 'image' : 'file',
                pinned: a.pinned === true
              }) as AgentAttachment
          )
      : []
    return startAgentTask(t, list)
  })
  core.register(IpcChannels.agentApprove, (id) => {
    const s = asString(id)
    if (s) approveAgentPlan(s)
  })
  core.register(IpcChannels.agentReject, (id) => {
    const s = asString(id)
    if (s) rejectAgentPlan(s)
  })
  core.register(IpcChannels.agentStop, (id) => {
    const s = asString(id)
    if (s) stopAgent(s)
  })
  core.register(IpcChannels.agentUpdatePlan, (id, steps) => {
    const s = asString(id)
    if (s && Array.isArray(steps)) updateAgentPlan(s, steps as PlanStep[])
  })
  core.register(IpcChannels.agentResume, (id) => {
    const s = asString(id)
    if (s) resumeAgentTask(s)
  })
  core.register(IpcChannels.agentList, () => listAgentSessions())
  core.register(IpcChannels.agentOpenReport, (id) => {
    const s = asString(id)
    return s ? openAgentReport(s) : undefined
  })
  core.register(IpcChannels.agentClearFinished, () => {
    clearFinishedAgentSessions()
  })
  core.register(IpcChannels.agentRename, (id, title) => {
    const s = asString(id)
    if (s) renameAgentSession(s, asString(title) ?? '')
  })
  core.register(IpcChannels.agentDelete, (id) => {
    const s = asString(id)
    if (s) deleteAgentSession(s)
  })
  core.register(IpcChannels.agentExport, (id, format) => {
    const s = asString(id)
    if (!s) return { error: 'No such session.' }
    return exportAgentSession(s, format === 'json' ? 'json' : 'md')
  })
  core.register(IpcChannels.agentKeyStatus, () => getAgentKeyStatus())
  core.register(IpcChannels.agentSetKey, (key) => {
    setAgentApiKey(asString(key) ?? '')
    return getAgentKeyStatus()
  })
  core.register(IpcChannels.agentSetModel, (model) => {
    const m = asString(model)
    if (m) setAgentModel(m)
    return getAgentKeyStatus()
  })
}
