import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { coreEnv } from '../env'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import { DEFAULT_POLICY_GUARDS, POLICY_GUARDS } from '@shared/ipc'
import type {
  SitePermission,
  CustomPolicyRules,
  PolicyActionKind,
  PolicyDecision,
  PolicyDeniedInfo,
  PolicyGuard,
  PolicyGuards,
  PolicyPromptInfo,
  PolicyStatus
} from '@shared/ipc'
import { JsonStore } from './json-store'
import { core } from '../rpc'
import { asString } from '../coerce'

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

/**
 * Guards: classes of site the agent must ask about even under full autonomy,
 * each one switched on or off by the user (PolicyStatus.guards).
 *
 * SEED LISTS, not coverage, and it is important to be honest about that: there
 * is no way to enumerate every bank, broker, or patient portal from a keyword,
 * and pretending otherwise would sell a guarantee this cannot keep. Their job
 * is to make the highest-consequence destinations stop and ask by default, and
 * to give the user somewhere to add their own. Real protection is the user's
 * own per-site decisions.
 */
const GUARD_HOSTS: Record<PolicyGuard, readonly string[]> = {
  // Payment processors and wallets — an agent acting here moves money.
  payments: [
    'paypal.com',
    'stripe.com',
    'venmo.com',
    'wise.com',
    'cash.app',
    'pay.google.com',
    'pay.apple.com',
    'checkout.shopify.com'
  ],
  // Banks, brokerages and exchanges.
  banking: [
    'coinbase.com',
    'binance.com',
    'robinhood.com',
    'fidelity.com',
    'schwab.com',
    'vanguard.com',
    'chase.com',
    'bankofamerica.com',
    'wellsfargo.com',
    'citi.com',
    'capitalone.com',
    'americanexpress.com'
  ],
  // Identity and password stores — the keys to everything else.
  passwords: [
    'accounts.google.com',
    'appleid.apple.com',
    'account.apple.com',
    'login.microsoftonline.com',
    'login.live.com',
    '1password.com',
    'lastpass.com',
    'bitwarden.com',
    'dashlane.com'
  ],
  // Mail and chat: what is sent from here is sent as the user.
  messaging: [
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'mail.yahoo.com',
    'slack.com',
    'discord.com',
    'web.whatsapp.com',
    'messenger.com',
    'teams.microsoft.com',
    'web.telegram.org'
  ],
  // Publishing surfaces: a post is public the moment it lands.
  posting: [
    'x.com',
    'twitter.com',
    'linkedin.com',
    'reddit.com',
    'studio.youtube.com',
    'medium.com',
    'facebook.com',
    'instagram.com',
    'threads.net',
    'bsky.app',
    'mastodon.social'
  ]
}

/**
 * Path heuristics that extend a guard beyond its host list. Payments: any site
 * whose page looks like a checkout. Posting: the pages on a code host where
 * something becomes public (a new issue, a pull request, a release).
 */
const GUARD_PATHS: Partial<Record<PolicyGuard, RegExp>> = {
  payments: /\/(checkout|cart|basket|payment|payments|pay|billing|order)(\/|$|\?|#)/i,
  posting: /\/(issues\/new|compare|pull\/new|releases\/new)(\/|$|\?|#)/i
}
/** Hosts whose posting guard is decided by GUARD_PATHS.posting, not the host. */
const POSTING_PATH_HOSTS = ['github.com', 'gitlab.com']

const store = new JsonStore<PolicyStatus>('policy', {
  mode: 'review',
  custom: DEFAULT_CUSTOM,
  sites: [],
  guards: DEFAULT_POLICY_GUARDS
})

/** Does `url`'s host match `host`, or a subdomain of it? */
function hostMatches(url: string, host: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const target = host.toLowerCase()
    return hostname === target || hostname.endsWith(`.${target}`)
  } catch {
    return false
  }
}

/** The user's standing decision for this URL's site, if they made one. */
function siteDecision(url: string, sites: SitePermission[]): 'allow' | 'deny' | null {
  // Deny wins over allow: if both somehow exist, the restrictive one is what
  // the user most recently meant to be safe.
  const matching = sites.filter((s) => hostMatches(url, s.host))
  if (matching.some((s) => s.decision === 'deny')) return 'deny'
  if (matching.some((s) => s.decision === 'allow')) return 'allow'
  return null
}

/** Path plus query of a URL, or null when it does not parse. */
function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return null
  }
}

/** The first ENABLED guard that covers `url`, or null. Exported for tests. */
export function guardFor(url: string, guards: PolicyGuards): PolicyGuard | null {
  const path = pathOf(url)
  if (path === null) return null
  for (const { id } of POLICY_GUARDS) {
    if (!guards[id]) continue
    if (GUARD_HOSTS[id].some((host) => hostMatches(url, host))) return id
    const pattern = GUARD_PATHS[id]
    if (!pattern) continue
    if (id === 'posting') {
      if (POSTING_PATH_HOSTS.some((host) => hostMatches(url, host)) && pattern.test(path)) return id
      continue
    }
    if (pattern.test(path)) return id
  }
  return null
}

/**
 * The guards as stored, tolerant of older files: a file written when the
 * protection was one switch (`blockSensitiveSites`) keeps that choice for the
 * three guards it used to cover, and a file with no setting at all protects by
 * default rather than inheriting "off" from an older version.
 */
function normalizeGuards(
  saved: Partial<PolicyStatus> & { blockSensitiveSites?: boolean }
): PolicyGuards {
  if (saved.guards && typeof saved.guards === 'object') {
    return { ...DEFAULT_POLICY_GUARDS, ...saved.guards }
  }
  if (saved.blockSensitiveSites === false) {
    return { ...DEFAULT_POLICY_GUARDS, payments: false, banking: false, passwords: false }
  }
  return { ...DEFAULT_POLICY_GUARDS }
}

interface PendingPrompt {
  resolve: (allow: boolean) => void
  sessionId: string
  kind: PolicyActionKind
  /** The URL or path in question — "always" scopes the grant to its site. */
  detail: string
}

/**
 * Delivers a confirmation prompt to whatever is driving the UI, and reports
 * whether it could. Injected, so this engine has no idea whether that UI is an
 * Electron window (`webContents.send`) or the Chromium fork's `chrome://webdeck`
 * client over the WebSocket transport — the answer comes back through
 * `respondToPolicyPrompt` either way.
 */
export type PolicyPromptSink = (prompt: PolicyPromptInfo) => boolean

let promptSink: PolicyPromptSink | null = null
let nextPromptId = 1
const pending = new Map<string, PendingPrompt>()
/** `${sessionId}|${kind}` → the user granted "don't ask again" for this run. */
const sessionGrants = new Set<string>()

/**
 * Wire (or clear) the confirmation channel. Any prompt still waiting is failed
 * closed, because the UI that was going to answer it is gone.
 */
export function setPolicyPromptSink(sink: PolicyPromptSink | null): void {
  promptSink = sink
  abortPendingPrompts()
}

/**
 * Fail every waiting confirmation closed. Called when the UI that was going to
 * answer them goes away — an Electron window replaced, or (under the fork) the
 * last WebSocket client disconnecting. Without this an agent would wait forever
 * on a prompt no one can ever answer.
 */
export function abortPendingPrompts(): void {
  for (const [id, prompt] of [...pending]) {
    pending.delete(id)
    prompt.resolve(false)
  }
}

/** A window that can carry prompts. Structural, so `BrowserWindow` satisfies it
 *  and this module still imports no Electron. */
interface PromptHostWindow {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: unknown): void }
}

/** Shell convenience: route confirmations to an Electron window. The fork calls
 *  `setPolicyPromptSink` directly with a transport push instead. */
export function initPolicy(window: PromptHostWindow): void {
  setPolicyPromptSink((prompt) => {
    if (window.isDestroyed()) return false
    window.webContents.send(IpcEvents.policyPrompt, prompt)
    return true
  })
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
  return {
    mode: saved.mode,
    custom: { ...DEFAULT_CUSTOM, ...saved.custom },
    sites: Array.isArray(saved.sites) ? saved.sites : [],
    guards: normalizeGuards(saved)
  }
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
  // `about:` really is inert — a blank tab has no content and no origin.
  if (/^about:/i.test(url)) return true

  // data:, file: and blob: are NOT. They were treated as inert here, and that
  // quietly reopened the hole browser_eval's gate exists to close:
  //   - `data:text/html,<script>fetch(...)</script>` runs attacker JS with a
  //     fetch of its own, so navigating there is injecting a script — which is
  //     gated as a `command` when it goes through browser_eval, and was
  //     auto-allowed when it went through navigation.
  //   - `file:///Users/...` plus the ungated page read is arbitrary local file
  //     disclosure, around the workspace pin that read_file enforces.
  //   - `blob:` inherits the creator's origin.
  // None of them has a hostname, so no per-site rule can restrain them either:
  // a user who denies every site still cannot deny these. They go to the mode.
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

/**
 * The verdict for one action, before any human is consulted.
 *
 * Precedence, most binding first — the order is the security property:
 *
 *  1. An explicit per-site DENY. The user said no to this site; nothing,
 *     including full autonomy, overrides that.
 *  2. An explicit per-site ALLOW. They said yes to this site specifically, so
 *     it also lifts the guards below — they exist to catch
 *     sites they have not considered, not to argue with ones they have.
 *  3. A site an ENABLED guard covers: ask, even under full autonomy, because
 *     these are the destinations where one wrong action is not recoverable.
 *  4. The mode.
 */
export function decide(kind: PolicyActionKind, detail: string): PolicyDecision {
  const { mode, custom, sites, guards } = getPolicyStatus()

  if (kind === 'browser_navigate') {
    const site = siteDecision(detail, sites)
    if (site === 'deny') return 'deny'
    if (site !== 'allow' && guardFor(detail, guards)) return 'confirm'
    if (site === 'allow') return 'allow'
  }
  // Secure mode confirms everything, local targets included (P2-1); the other
  // modes treat localhost/data:/file: navigation as the safe default.
  if (mode === 'secure') return 'confirm'
  // Full autonomy: the agent does whatever the task needs, and the audit log
  // is the record. Checked before the local-navigation shortcut because there
  // is nothing left for that shortcut to decide.
  if (mode === 'autonomous') return 'allow'
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
  if (verdict === 'deny') {
    audit({ event: 'action', kind, detail, sessionId, decision: 'deny' })
    notifyDenied?.({ kind, detail, byUser: false })
    return false
  }
  // Allow is settled without any UI. This must come BEFORE the prompt-channel
  // check: an allowed action needs no human, so a headless run (the Chromium
  // fork's core with no window attached yet) must not deny what policy permits.
  if (verdict === 'allow' || sessionGrants.has(`${sessionId}|${kind}`)) {
    audit({ event: 'action', kind, detail, sessionId, decision: 'allow' })
    return true
  }
  // Only a 'confirm' verdict needs a human. With no channel to ask on, fail
  // closed — but say why, so this is distinguishable from a policy deny.
  const id = `policy-${nextPromptId++}`
  const guard = kind === 'browser_navigate' ? guardFor(detail, getPolicyStatus().guards) : null
  const prompt: PolicyPromptInfo = { id, kind, detail, sessionId, ...(guard ? { guard } : {}) }
  // Register the waiter BEFORE delivering, so a synchronous answer can't be lost.
  const allowed = await new Promise<boolean>((resolve) => {
    pending.set(id, { resolve, sessionId, kind, detail })
    if (!promptSink || !promptSink(prompt)) {
      pending.delete(id)
      audit({
        event: 'action',
        kind,
        detail: `${detail} [no prompt UI attached]`,
        sessionId,
        decision: 'deny'
      })
      resolve(false)
    }
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
  if (!always) return

  // "Always" used to grant the whole ACTION KIND for the rest of the session,
  // so answering it once about one page let the agent navigate anywhere for the
  // rest of the run. A grant should be no broader than what the user was
  // looking at when they gave it, so a navigation answer becomes a decision
  // about that site — in both directions, since "never on this site" is worth
  // recording just as much.
  if (prompt.kind === 'browser_navigate') {
    const host = hostOf(prompt.detail)
    if (host) {
      setSitePermission(host, allow ? 'allow' : 'deny')
      return
    }
    // No host to scope to — data:, file:, blob:, about:. Falling through to a
    // session grant here turned "always" on a blank tab into permission to
    // navigate ANYWHERE for the rest of the run, which is the opposite of what
    // the dialog offered. A grant we cannot scope is a grant we do not make.
    return
  }
  // Other kinds have no site to scope to, so they stay session-scoped — and
  // only when the answer was yes.
  if (allow) sessionGrants.add(`${prompt.sessionId}|${prompt.kind}`)
}

/** The host of a URL, or null if it is not one. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** Record a standing decision for a site, replacing any previous one. */
export function setSitePermission(host: string, decision: 'allow' | 'deny'): PolicyStatus {
  const current = getPolicyStatus()
  const sites = current.sites.filter((s) => s.host.toLowerCase() !== host.toLowerCase())
  sites.push({ host: host.toLowerCase(), decision, grantedAt: new Date().toISOString() })
  store.write({ ...current, sites })
  audit({ event: 'mode-change', detail: `site ${decision}: ${host}`, decision: 'allow' })
  broadcastChange?.(getPolicyStatus())
  return getPolicyStatus()
}

/** Forget a standing decision, so the site is governed by the mode again. */
export function clearSitePermission(host: string): PolicyStatus {
  const current = getPolicyStatus()
  store.write({
    ...current,
    sites: current.sites.filter((s) => s.host.toLowerCase() !== host.toLowerCase())
  })
  audit({ event: 'mode-change', detail: `site cleared: ${host}`, decision: 'allow' })
  broadcastChange?.(getPolicyStatus())
  return getPolicyStatus()
}

/** Turn one guard on or off. */
export function setGuard(guard: PolicyGuard, enabled: boolean): PolicyStatus {
  const current = getPolicyStatus()
  store.write({ ...current, guards: { ...current.guards, [guard]: enabled } })
  audit({
    event: 'mode-change',
    detail: `guard ${guard}: ${enabled ? 'on' : 'off'}`,
    decision: 'allow'
  })
  broadcastChange?.(getPolicyStatus())
  return getPolicyStatus()
}

/** Is this an untrusted string naming a guard? */
export function sanitizeGuard(guard: unknown): PolicyGuard | null {
  const g = POLICY_GUARDS.find((entry) => entry.id === guard)
  return g ? g.id : null
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

/** Validate an untrusted mode value (from IPC or a synced file). Null if invalid. */
export function sanitizePolicyMode(mode: unknown): PolicyStatus['mode'] | null {
  const valid: PolicyStatus['mode'][] = ['secure', 'review', 'agent', 'autonomous', 'custom']
  return valid.includes(mode as PolicyStatus['mode']) ? (mode as PolicyStatus['mode']) : null
}

/**
 * The mode a SYNCED file is allowed to set.
 *
 * Sync may lower the agent's authority, never raise it to the top rung. The
 * sync file is a plain file in a folder the user often shares between devices
 * — and sometimes with other people — so treating it as able to grant
 * `autonomous` would make "write this file" equivalent to "let the agent act
 * as the user, without ever asking, on every device they own". Escalating to
 * full autonomy has to be a deliberate local choice, made in front of the
 * person who owns the session.
 *
 * Returns null for anything invalid, and for an attempted escalation — the
 * caller leaves the local mode alone.
 */
export function sanitizeSyncedPolicyMode(mode: unknown): PolicyStatus['mode'] | null {
  const valid = sanitizePolicyMode(mode)
  // 'custom' with every rule set to allow is autonomy under another name, and
  // sanitizeCustomRules only checks the SHAPE of those rules. Refusing the
  // named mode while accepting the equivalent one would have been a guard in
  // name only.
  if (valid === 'autonomous' || valid === 'custom') {
    audit({
      event: 'action',
      kind: 'command',
      detail: `refused a synced escalation to "${String(mode)}"`,
      decision: 'deny'
    })
    return null
  }
  return valid
}

/** Validate untrusted custom rules (from IPC or a synced file). Null if invalid. */
export function sanitizeCustomRules(rules: unknown): CustomPolicyRules | null {
  const r = rules as CustomPolicyRules
  const decisions = ['allow', 'confirm', 'deny']
  if (
    !r ||
    typeof r !== 'object' ||
    !decisions.includes(r.fileWrites) ||
    !decisions.includes(r.commands) ||
    !decisions.includes(r.navigation) ||
    !Array.isArray(r.allowedHosts) ||
    !r.allowedHosts.every((h) => typeof h === 'string')
  ) {
    return null
  }
  return {
    fileWrites: r.fileWrites,
    commands: r.commands,
    navigation: r.navigation,
    allowedHosts: r.allowedHosts.map((h) => h.trim()).filter(Boolean)
  }
}

/** Register the policy/permission-engine domain with webdeck-core (P1) — the
 *  agent<->system boundary. */
export function registerPolicyRpc(): void {
  core.register(IpcChannels.policyGet, () => getPolicyStatus())
  core.register(IpcChannels.policySetMode, (mode) => {
    const valid = sanitizePolicyMode(mode)
    return valid ? setPolicyMode(valid) : getPolicyStatus()
  })
  core.register(IpcChannels.policySetCustom, (rules) => {
    const clean = sanitizeCustomRules(rules)
    return clean ? setCustomRules(clean) : getPolicyStatus()
  })
  core.register(IpcChannels.policySetSite, (host, decision) => {
    const h = asString(host)
    // Untrusted input: only the two decisions exist, and a host is required.
    if (!h || (decision !== 'allow' && decision !== 'deny')) return getPolicyStatus()
    return setSitePermission(h, decision)
  })
  core.register(IpcChannels.policyClearSite, (host) => {
    const h = asString(host)
    return h ? clearSitePermission(h) : getPolicyStatus()
  })
  core.register(IpcChannels.policySetGuard, (guard, enabled) => {
    const g = sanitizeGuard(guard)
    return g ? setGuard(g, enabled === true) : getPolicyStatus()
  })
  core.register(IpcChannels.policyRespond, (id, allow, always) => {
    const s = asString(id)
    if (s) respondToPolicyPrompt(s, allow === true, always === true)
  })
}
