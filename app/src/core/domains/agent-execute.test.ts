import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionInfo } from '@shared/agents'
import { setCoreEnv } from '../env'
import { setAgentBrowserPort, type AgentBrowserPort } from '../agent-browser-port'

/**
 * The agent's approve → execute → verify loop (task 10.3), driven headless.
 *
 * agent.test.ts covers plan/approve/reject/edit but stops before execute,
 * because execute drives the real browser. Here we mock the browser + report
 * layers so the deterministic mock provider runs the full tool sequence in
 * Node, and assert BOTH the happy path (everything allowed → done, evidence on
 * disk) and the permission-denial path (commands denied → the run completes but
 * each command-class action is refused by the real policy gate and logged).
 */

const h = vi.hoisted(() => ({ dir: '' }))

vi.mock('./workspace', () => ({ getCurrentWorkspace: () => ({ path: h.dir, name: 'test' }) }))
vi.mock('./agent-report', () => ({
  artifactsRoot: () => join(h.dir, 'artifacts'),
  generateReport: async () => {},
  removeArtifacts: async () => {}
}))

h.dir = join(tmpdir(), `wd-agent-exec-${process.pid}`)
process.env.AGWEB_AGENT_MOCK = '1'

setCoreEnv({
  userDataDir: h.dir,
  homeDir: h.dir,
  appDir: h.dir,
  secrets: {
    isAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})

// A fake browser host: the agent drives its tools through the injected port, so
// the whole execute loop runs in Node with no Electron and no module mocking.
/** Where the mock tab claims to be. The gate asks before every click. */
// A genuinely local target. It used to be a data: URL, which the policy
// auto-allowed — and that auto-allow was a hole, since navigating to a data:
// URL runs script the same way browser_eval does.
let mockTabUrl = 'http://localhost:5173/'

const browserPort: AgentBrowserPort = {
  openTab: async () => 'tabId: agent-tab-1\ntitle: Mock\nurl: data:text/html,x',
  navigate: async () => 'title: Mock\nurl: x',
  readPage: async () => 'clicked-ok',
  // Expression-aware, because the policy gate now asks the tab where it is
  // before allowing a click or a keystroke. A mock that answered every
  // expression identically reported the tab's location as "agweb", which no
  // site rule can match — the mock's shortcut, surfacing as a policy denial.
  evaluate: async (_tabId: string, expression: string) =>
    expression === 'location.href' ? `"${mockTabUrl}"` : '"agweb"',
  click: async () => 'clicked',
  type: async () => 'typed',
  waitFor: async () => 'found',
  capture: async () => Buffer.from('png-bytes'),
  setViewport: () => 'viewport reset',
  recordStart: async () => 'recording agent-tab-1',
  recordStop: async () => '<!doctype html><html></html>',
  takeBlockedNavigation: () => null,
  visionReport: () => 'Browser saw 1 request(s); no network failures or console errors.',
  visionHasProblems: () => false
}
setAgentBrowserPort(browserPort)

const agent = await import('./agent')
const policy = await import('./policy')

const find = (id: string): AgentSessionInfo | undefined =>
  agent.listAgentSessions().find((s) => s.id === id)

async function waitForStatus(id: string, status: string, tries = 400): Promise<AgentSessionInfo> {
  for (let i = 0; i < tries; i++) {
    const s = find(id)
    if (s?.status === status) return s
    if (s && (s.status === 'error' || s.status === 'rejected') && status !== s.status) {
      throw new Error(`session ${id} ended in ${s.status} while waiting for ${status}`)
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`session ${id} never reached ${status} (was ${find(id)?.status})`)
}

beforeAll(() => {
  mkdirSync(h.dir, { recursive: true })
  // checkAction is fail-closed without a prompt host (no window → deny all), so
  // wire a fake window. These tests use only allow/deny rules (never 'confirm'),
  // so the host's send is never actually invoked.
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: () => {} }
  }
  policy.initPolicy(fakeWindow as unknown as Parameters<typeof policy.initPolicy>[0])
})
afterAll(() => rmSync(h.dir, { recursive: true, force: true }))

describe('agent execute → verify (happy path, all allowed)', () => {
  it('runs the full tool sequence to done and writes evidence to disk', async () => {
    policy.setPolicyMode('agent') // allow file writes + commands; data: nav is local-allowed
    const id = agent.startAgentTask('Do the mock task')
    await waitForStatus(id, 'awaiting_approval')
    agent.approveAgentPlan(id)
    const done = await waitForStatus(id, 'done')

    // The write_file tool ran (real fs in the workspace).
    expect(existsSync(join(h.dir, 'AGENT_NOTE.md'))).toBe(true)
    expect(readFileSync(join(h.dir, 'AGENT_NOTE.md'), 'utf8')).toContain('Do the mock task')
    // The browser screenshot + recording tools ran and reached disk.
    expect(existsSync(join(h.dir, 'agent-shot.png'))).toBe(true)
    expect(existsSync(join(h.dir, 'recordings', 'verify.html'))).toBe(true)
    // No denial in the log — everything was allowed.
    expect(done.log.some((e) => e.text.includes('Denied by permission policy'))).toBe(false)
    // Agent Vision surfaced in the verify step.
    expect(done.log.some((e) => e.text.includes('Agent Vision'))).toBe(true)
  })
})

describe('agent execute (permission-denial path)', () => {
  it('refuses command-class actions and logs the denial, still completing', async () => {
    policy.setPolicyMode('custom')
    policy.setCustomRules({
      fileWrites: 'allow',
      commands: 'deny', // browser_eval + run_command are command-class
      navigation: 'allow',
      allowedHosts: []
    })
    const id = agent.startAgentTask('Do the mock task under a deny rule')
    await waitForStatus(id, 'awaiting_approval')
    agent.approveAgentPlan(id)
    const done = await waitForStatus(id, 'done')

    // At least one command-class action was denied by the real policy gate.
    const denials = done.log.filter((e) => e.text.includes('Denied by permission policy: command'))
    expect(denials.length).toBeGreaterThan(0)
    // File writes were still allowed, so the note was written.
    expect(existsSync(join(h.dir, 'AGENT_NOTE.md'))).toBe(true)
  })

  it('restores allow-all for isolation', () => {
    policy.setPolicyMode('agent')
    expect(policy.getPolicyStatus().mode).toBe('agent')
  })
})

describe('clicking and typing pass the permission gate', () => {
  it('refuses a click and a keystroke when navigation is denied', async () => {
    // browser_eval was gated from the start because injected JS is an egress
    // channel. Clicking and typing were not — and a click can submit a
    // purchase, send a message, or fire a state-changing XHR without ever
    // navigating, with typing filling the form first. Checking the destination
    // AFTER a click, which is all that used to happen, catches only the subset
    // that navigates.
    //
    // It matters most in session mode, where the agent's clicks carry the
    // user's own cookies and are indistinguishable from theirs. They are now
    // checked against the tab's current site, so they ride the per-site
    // permissions rather than prompting on every click.
    // A standing per-site DENY outranks everything, autonomy included — so the
    // click is refused without stalling the rest of the run on confirmations.
    mockTabUrl = 'https://blocked.test/checkout'
    policy.setPolicyMode('autonomous')
    policy.setSitePermission('blocked.test', 'deny')
    const id = agent.startAgentTask('Do the mock task on a denied site')
    await waitForStatus(id, 'awaiting_approval')
    agent.approveAgentPlan(id)
    const done = await waitForStatus(id, 'done')

    const refusals = done.log.filter((e) => e.text.startsWith('Refused: '))
    expect(refusals.length).toBeGreaterThan(0)
    expect(refusals.some((e) => e.text.includes('click'))).toBe(true)
    expect(refusals.some((e) => e.text.includes('blocked.test'))).toBe(true)

    policy.clearSitePermission('blocked.test')
    mockTabUrl = 'http://localhost:5173/'
    policy.setPolicyMode('agent')
  })
})
