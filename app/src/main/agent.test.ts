import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionInfo } from '@shared/agents'
import type { AskResult, EditCodeResult } from '@shared/ipc'
import { setCoreEnv } from '../core/env'
import { core } from '../core/rpc'
import { IpcChannels } from '@shared/ipc'

// The agent session state machine, driven at the module surface with the
// deterministic offline provider (AGWEB_AGENT_MOCK). We cover the shell-free
// slice — start → plan → awaiting-approval → reject, plan editing, session
// management, and input validation. The execute path (approve → run) drives the
// real browser verification loop and is covered end-to-end by the smoke test.

// A mutable holder the mock factories read lazily (getCurrentWorkspace runs long
// after the dir is filled in below). vi.hoisted keeps it visible to the hoisted
// vi.mock call. Only the workspace needs stubbing now: the agent domain reaches
// events and browser tools through injected ports, so it pulls no Electron.
const h = vi.hoisted(() => ({ dir: '' }))

vi.mock('./workspace', () => ({
  getCurrentWorkspace: () => ({ path: h.dir, name: 'test' })
}))

h.dir = join(tmpdir(), `wd-agent-test-${process.pid}`)
process.env.AGWEB_AGENT_MOCK = '1' // before the module loads

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

const agent = await import('./agent')

const find = (id: string): AgentSessionInfo | undefined =>
  agent.listAgentSessions().find((s) => s.id === id)

/** Poll until the session reaches a status (the mock planner is async). */
async function waitForStatus(id: string, status: string, tries = 200): Promise<AgentSessionInfo> {
  for (let i = 0; i < tries; i++) {
    const s = find(id)
    if (s?.status === status) return s
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`session ${id} never reached ${status} (was ${find(id)?.status})`)
}

beforeAll(() => {
  mkdirSync(h.dir, { recursive: true })
  agent.registerAgentRpc() // once for the whole file — core.register rejects duplicates
})
afterAll(() => rmSync(h.dir, { recursive: true, force: true }))

describe('agent session lifecycle', () => {
  it('plans a task and parks it awaiting approval', async () => {
    const id = agent.startAgentTask('Do the thing')
    const s = await waitForStatus(id, 'awaiting_approval')
    expect(s.task).toBe('Do the thing')
    expect(s.plan.length).toBeGreaterThan(0) // the mock planner produces steps
    expect(s.workspacePath).toBe(h.dir)
  })

  it('rejecting a plan moves it to rejected without executing', async () => {
    const id = agent.startAgentTask('Reject me')
    await waitForStatus(id, 'awaiting_approval')
    agent.rejectAgentPlan(id)
    expect(find(id)?.status).toBe('rejected')
  })

  it('reject is a no-op for an unknown session', () => {
    expect(() => agent.rejectAgentPlan('agent-does-not-exist')).not.toThrow()
  })

  it('replaces the plan while it awaits approval', async () => {
    const id = agent.startAgentTask('Edit my plan')
    await waitForStatus(id, 'awaiting_approval')
    agent.updateAgentPlan(id, [{ id: '', kind: 'edit', title: 'the only step' }])
    const plan = find(id)?.plan ?? []
    expect(plan).toHaveLength(1)
    expect(plan[0].title).toBe('the only step')
  })

  it('will not edit the plan once it is no longer awaiting approval', async () => {
    const id = agent.startAgentTask('Locked plan')
    await waitForStatus(id, 'awaiting_approval')
    agent.rejectAgentPlan(id)
    agent.updateAgentPlan(id, [{ id: '', kind: 'edit', title: 'sneaky late edit' }])
    // Rejected: the plan is frozen, the late edit is ignored.
    expect(find(id)?.plan.some((p) => p.title === 'sneaky late edit')).toBe(false)
  })

  it('deletes a session from the list', async () => {
    const id = agent.startAgentTask('Delete me')
    await waitForStatus(id, 'awaiting_approval')
    agent.deleteAgentSession(id)
    expect(find(id)).toBeUndefined()
  })

  it('deletes a session even after it is rejected', async () => {
    const id = agent.startAgentTask('Delete after reject')
    await waitForStatus(id, 'awaiting_approval')
    agent.rejectAgentPlan(id)
    agent.deleteAgentSession(id)
    expect(find(id)).toBeUndefined()
  })
})

describe('agent registry validation', () => {
  it('sanitizes and caps attachments (the registry handler filters them)', async () => {
    const dirty = [
      { path: 'good.ts', kind: 'file', pinned: true },
      { path: '', kind: 'file' }, // dropped: empty path
      { path: 'pic.png', kind: 'image' }
    ]
    const id = (await core.dispatch(IpcChannels.agentStart, ['With context', dirty])) as string
    const atts = find(id)?.attachments ?? []
    expect(atts.map((a) => a.path)).toEqual(['good.ts', 'pic.png'])
    expect(atts[0].pinned).toBe(true)
    expect(atts[1].kind).toBe('image')
  })

  it('refuses an empty task through the registry', async () => {
    await expect(core.dispatch(IpcChannels.agentStart, [''])).rejects.toThrow(/empty task/)
    await expect(core.dispatch(IpcChannels.agentStart, ['   '])).rejects.toThrow(/empty task/)
  })

  it('reports agent key status as a plain object', () => {
    const status = agent.getAgentKeyStatus()
    expect(status).toBeTypeOf('object')
    expect(status).not.toBeNull()
  })
})

// True backend cancellation for the one-shot streamed calls. Driven with the
// mock provider, so it is deterministic and offline: the abort is triggered
// from inside an onToken callback (function level) or once the call is in the
// in-flight registry (register level), never on a wall-clock timer.
describe('one-shot stream cancellation', () => {
  /** Poll a predicate until true (the handler registers its controller a
   *  microtask after dispatch is called). */
  async function waitUntil(pred: () => boolean, tries = 200): Promise<void> {
    for (let i = 0; i < tries; i++) {
      if (pred()) return
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error('condition never became true')
  }

  it('askOmnibox aborts mid-stream and emits no tokens after abort', async () => {
    const controller = new AbortController()
    const tokens: string[] = []
    const promise = agent.askOmnibox(
      'Cancel me',
      {},
      (token) => {
        tokens.push(token)
        // Abort as soon as the stream is visibly flowing.
        if (tokens.length === 2) controller.abort()
      },
      controller.signal
    )
    // The mock provider throws an AbortError once the signal fires.
    await expect(promise).rejects.toThrowError(/abort/i)
    const countAtAbort = tokens.length
    // Give any stray scheduled emissions a chance to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 200))
    expect(tokens.length).toBe(countAtAbort) // nothing streamed past the abort
    expect(countAtAbort).toBeGreaterThanOrEqual(2)
  })

  it('editCode is abortable too (shared signal path)', async () => {
    const controller = new AbortController()
    const tokens: string[] = []
    const promise = agent.editCode(
      'rename x to y',
      'const x = 1\n',
      'typescript',
      (token) => {
        tokens.push(token)
        if (tokens.length === 1) controller.abort()
      },
      controller.signal
    )
    await expect(promise).rejects.toThrowError(/abort/i)
    const countAtAbort = tokens.length
    await new Promise((r) => setTimeout(r, 200))
    expect(tokens.length).toBe(countAtAbort)
  })

  it('agentCancel aborts an in-flight ask and settles cancelled:true', async () => {
    const askId = `ask-cancel-${process.pid}-${Date.now()}`
    const dispatched = core.dispatch(IpcChannels.agentAsk, [
      askId,
      'Cancel via the registry',
      {}
    ]) as Promise<AskResult>

    // The handler stores its AbortController before awaiting the stream.
    await waitUntil(() => agent.inFlightCount() > 0)
    await core.dispatch(IpcChannels.agentCancel, [askId])

    const result = await dispatched
    expect(result.cancelled).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.text).toBe('')
    // The register layer cleaned up its in-flight entry in the finally.
    expect(agent.inFlightCount()).toBe(0)
  })

  it('agentCancel is a no-op for an unknown id', async () => {
    await expect(core.dispatch(IpcChannels.agentCancel, ['not-a-real-id'])).resolves.not.toThrow()
    expect(agent.inFlightCount()).toBe(0)
  })

  it('a normal edit still settles when never cancelled', async () => {
    const result = (await core.dispatch(IpcChannels.agentEditCode, [
      `edit-${Date.now()}`,
      'add a comment',
      'let a = 1\n',
      'typescript'
    ])) as EditCodeResult
    expect(result.cancelled).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.text).toContain('let a = 1')
    expect(agent.inFlightCount()).toBe(0)
  })
})
