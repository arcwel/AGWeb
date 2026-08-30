import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { coreEnv } from '../core/env'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import type {
  CustomPolicyRules,
  PolicyActionKind,
  PolicyDecision,
  PolicyDeniedInfo,
  PolicyPromptInfo,
  PolicyStatus
} from '@shared/ipc'
import { JsonStore } from './json-store'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'

/**
 * Permission policy engine (Phase 9): the central gate every agent-driven
 * file write, shell command, and browser navigation passes through.
 *
 * Modes:
 *  - secure: every gated action pauses on an explicit confirmation.
 *  - review: workspace file writes auto-approve; commands and non-local
 *    navigation confirm. The default.
 *  - agent:  autonomous inside the workspace and the host allowlist;
 *    navigation outside the allowlist still confirms.
 *  - custom: per-kind decisions plus an editable host allowlist.
 *
 * Every decision — automatic or human — is appended to an audit log
 * (userData/audit.jsonl). Confirmations resolve through the shell's inline
 * prompt; a session can be granted "don't ask again" per action kind.
 */

const DEFAULT_CUSTOM: CustomPolicyRules = {
  fileWrites: 'allow',
  commands: 'confirm',
  navigation: 'confirm',
  allowedHosts: []
}

/** Hosts every mode treats as local dev targets. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

const store = new JsonStore<PolicyStatus>('policy', { mode: 'review', custom: DEFAULT_CUSTOM })

interface PendingPrompt {
  resolve: (allow: boolean) => void
  sessionId: string
  kind: PolicyActionKind
}

let host: BrowserWindow | null = null
let nextPromptId = 1
const pending = new Map<string, PendingPrompt>()
/** `${sessionId}|${kind}` → the user granted "don't ask again" for this run. */
const sessionGrants = new Set<string>()

export function initPolicy(window: BrowserWindow): void {
  host = window
  for (const [id, prompt] of [...pending]) {
    pending.delete(id)
    prompt.resolve(false)
  }
}

// A change broadcaster injected at startup (index.ts wires it to the shell's
// window broadcast). Kept as an injected callback so policy.ts imports no
// Electron and stays unit-testable without a mock (P2-13).
let broadcastChange: ((status: PolicyStatus) => void) | null = null
export function setPolicyBroadcaster(fn: (status: PolicyStatus) => void): void {
  broadcastChange = fn
}

// Injected the same way: fired when an agent action is denied, so a silent block
// surfaces as a toast in the shell (P2-13). Kept a callback — no Electron here.
let notifyDenied: ((info: PolicyDeniedInfo) => void) | null = null
export function setPolicyDenyNotifier(fn: (info: PolicyDeniedInfo) => void): void {
  notifyDenied = fn
}

export function getPolicyStatus(): PolicyStatus {
  const saved = store.read()
  return { mode: saved.mode, custom: { ...DEFAULT_CUSTOM, ...saved.custom } }
}

export function setPolicyMode(mode: PolicyStatus['mode']): PolicyStatus {
  store.write({ ...getPolicyStatus(), mode })
  // A tightened policy must bind immediately: "don't ask again" grants taken
  // under the old rules cannot outlive the change (P1-4).
  sessionGrants.clear()
  audit({ event: 'mode-change', detail: mode, decision: 'allow' })
  const status = getPolicyStatus()
  broadcastChange?.(status) // every window's PolicyControls updates (P2-13)
  return status
}

export function setCustomRules(custom: CustomPolicyRules): PolicyStatus {
  store.write({ ...getPolicyStatus(), custom })
  sessionGrants.clear()
  // Rule edits change effective policy just like a mode switch — audit them
  // too, or the log misses how a later decision was reached (P2-2).
  audit({ event: 'mode-change', detail: `custom: ${JSON.stringify(custom)}`, decision: 'allow' })
  const status = getPolicyStatus()
  broadcastChange?.(status) // every window's PolicyControls updates (P2-13)
  return status
}

function isLocalNavigation(url: string): boolean {
  // Inert or workspace-local targets: data pages, blank tabs, local files.
  if (/^(data|about|file|blob):/i.test(url)) return true
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function hostAllowlisted(url: string, allowedHosts: string[]): boolean {
  try {
    const hostname = new URL(url).hostname
    return allowedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** The mode's verdict for one action, before any human is consulted. */
export function decide(kind: PolicyActionKind, detail: string): PolicyDecision {
  const { mode, custom } = getPolicyStatus()
  // Secure mode confirms everything, local targets included (P2-1); the other
  // modes treat localhost/data:/file: navigation as the safe default.
  if (mode === 'secure') return 'confirm'
  if (kind === 'browser_navigate' && isLocalNavigation(detail)) return 'allow'
  switch (mode) {
    case 'review':
      return kind === 'file_write' ? 'allow' : 'confirm'
    case 'agent':
      if (kind !== 'browser_navigate') return 'allow'
      return hostAllowlisted(detail, custom.allowedHosts) ? 'allow' : 'confirm'
    case 'custom':
      if (kind === 'file_write') return custom.fileWrites
      if (kind === 'command') return custom.commands
      return hostAllowlisted(detail, custom.allowedHosts) ? 'allow' : custom.navigation
    default:
      return 'confirm'
  }
}

/** Full gate: mode verdict, then the user's answer when it says confirm.
 *  Resolves true when the action may proceed. */
export async function checkAction(
  kind: PolicyActionKind,
  detail: string,
  sessionId: string
): Promise<boolean> {
  const verdict = decide(kind, detail)
  // Deny is evaluated first: an explicit deny rule outranks any session grant.
  if (verdict === 'deny' || !host || host.isDestroyed()) {
    audit({ event: 'action', kind, detail, sessionId, decision: 'deny' })
    notifyDenied?.({ kind, detail, byUser: false })
    return false
  }
  if (verdict === 'allow' || sessionGrants.has(`${sessionId}|${kind}`)) {
    audit({ event: 'action', kind, detail, sessionId, decision: 'allow' })
    return true
  }
  const allowed = await new Promise<boolean>((resolve) => {
    const id = `policy-${nextPromptId++}`
    pending.set(id, { resolve, sessionId, kind })
    const prompt: PolicyPromptInfo = { id, kind, detail, sessionId }
    host?.webContents.send(IpcEvents.policyPrompt, prompt)
  })
  audit({
    event: 'action',
    kind,
    detail,
    sessionId,
    decision: allowed ? 'allow' : 'deny',
    byUser: true
  })
  if (!allowed) notifyDenied?.({ kind, detail, byUser: true })
  return allowed
}

export function respondToPolicyPrompt(id: string, allow: boolean, always: boolean): void {
  const prompt = pending.get(id)
  if (!prompt) return
  pending.delete(id)
  prompt.resolve(allow)
  if (allow && always) sessionGrants.add(`${prompt.sessionId}|${prompt.kind}`)
}

/* ---- Audit log (9.6) ---- */

interface AuditEntry {
  event: 'action' | 'web-permission' | 'mode-change'
  decision: 'allow' | 'deny'
  kind?: PolicyActionKind
  detail?: string
  sessionId?: string
  origin?: string
  permission?: string
  byUser?: boolean
}

export function audit(entry: AuditEntry): void {
  try {
    const dir = coreEnv().userDataDir
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, 'audit.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), mode: getPolicyStatus().mode, ...entry }) +
        '\n',
      'utf8'
    )
  } catch {
    // auditing must never break the action path
  }
}

/** Register the policy/permission-engine domain with webdeck-core (P1) — the
 *  agent<->system boundary. */
export function registerPolicyRpc(): void {
  core.register(IpcChannels.policyGet, () => getPolicyStatus())
  core.register(IpcChannels.policySetMode, (mode) => {
    const valid: PolicyStatus['mode'][] = ['secure', 'review', 'agent', 'custom']
    return valid.includes(mode as PolicyStatus['mode'])
      ? setPolicyMode(mode as PolicyStatus['mode'])
      : getPolicyStatus()
  })
  core.register(IpcChannels.policySetCustom, (rules) => {
    const r = rules as CustomPolicyRules
    const decisions = ['allow', 'confirm', 'deny']
    if (
      !r ||
      !decisions.includes(r.fileWrites) ||
      !decisions.includes(r.commands) ||
      !decisions.includes(r.navigation) ||
      !Array.isArray(r.allowedHosts) ||
      !r.allowedHosts.every((h) => typeof h === 'string')
    ) {
      return getPolicyStatus()
    }
    return setCustomRules({
      fileWrites: r.fileWrites,
      commands: r.commands,
      navigation: r.navigation,
      allowedHosts: r.allowedHosts.map((h) => h.trim()).filter(Boolean)
    })
  })
  core.register(IpcChannels.policyRespond, (id, allow, always) => {
    const s = asString(id)
    if (s) respondToPolicyPrompt(s, allow === true, always === true)
  })
}
