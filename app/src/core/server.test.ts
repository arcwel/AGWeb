import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { IpcChannels } from '@shared/ipc'
import { coreAuthSubprotocol } from './transports/auth'
import { startWebdeckCore } from './server'
import type { WsServerHandle } from './transports/ws-server'

/**
 * The "app runs on the fork" proof: boot webdeck-core as a standalone service
 * and drive real domain handlers over a WebSocket — with NO Electron and NO
 * electron mock. If any CORE domain still needed Electron to load or register,
 * this file would fail to import or the server would fail to start. That it
 * round-trips real calls is the whole decoupling, demonstrated.
 */

let handle: WsServerHandle
let dataDir: string
let nextId = 1

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'webdeck-core-'))
  handle = await startWebdeckCore({ userDataDir: dataDir, port: 0 })
})

afterAll(async () => {
  await handle?.close()
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // best effort
  }
})

/** Wait until no WS client is open, so "nobody to ask" tests are deterministic
 *  (the rpc helper's sockets close asynchronously). */
async function waitForNoClients(tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const open = [...handle.clients].filter((c) => c.readyState === c.OPEN).length
    if (open === 0) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('clients never drained')
}

/** One request/response round-trip over a fresh WS connection. */
function rpc(method: string, args: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, [coreAuthSubprotocol(handle.token)])
    const id = nextId++
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`rpc timeout: ${method}`))
    }, 5000)
    ws.on('open', () => ws.send(JSON.stringify({ id, method, args })))
    ws.on('message', (data) => {
      const res = JSON.parse(data.toString()) as { id: unknown; result?: unknown; error?: string }
      if (res.id !== id) return
      clearTimeout(timer)
      ws.close()
      if (res.error) reject(new Error(res.error))
      else resolve(res.result)
    })
    ws.on('error', reject)
  })
}

describe('webdeck-core standalone server (headless, no Electron)', () => {
  it('serves the permission policy over WebSocket', async () => {
    const status = (await rpc(IpcChannels.policyGet)) as { mode: string }
    expect(['secure', 'review', 'agent', 'custom']).toContain(status.mode)
  })

  it('round-trips app settings through the store (real persisted state)', async () => {
    const written = (await rpc(IpcChannels.appSettingsWrite, [{ doNotTrack: true }])) as {
      doNotTrack: boolean
    }
    expect(written.doNotTrack).toBe(true)
    const read = (await rpc(IpcChannels.appSettingsRead)) as { doNotTrack: boolean }
    expect(read.doNotTrack).toBe(true)
  })

  it('validates policy mode on the write path (rejects garbage, accepts valid)', async () => {
    const unchanged = (await rpc(IpcChannels.policySetMode, ['bogus'])) as { mode: string }
    expect(['secure', 'review', 'agent', 'custom']).toContain(unchanged.mode)
    const applied = (await rpc(IpcChannels.policySetMode, ['agent'])) as { mode: string }
    expect(applied.mode).toBe('agent')
  })

  it('reports WebDeck Sync status', async () => {
    const s = (await rpc(IpcChannels.syncStatus)) as { enabled: boolean; sections: string[] }
    expect(s).toHaveProperty('enabled')
    expect(Array.isArray(s.sections)).toBe(true)
  })

  it('answers an editor-settings read', async () => {
    const cfg = await rpc(IpcChannels.settingsRead)
    expect(cfg).toBeDefined()
  })

  it('rejects an unknown method with an error frame (never hangs)', async () => {
    await expect(rpc('does:not-exist')).rejects.toThrow()
  })

  it('serves the agent domain headless (it reaches the browser through a port)', async () => {
    const sessions = await rpc(IpcChannels.agentList)
    expect(Array.isArray(sessions)).toBe(true)
    // Validation still runs over the transport.
    await expect(rpc(IpcChannels.agentStart, [''])).rejects.toThrow(/empty task/)
  })
})

describe('policy confirmation over the transport (the fork path)', () => {
  it('pushes a prompt to the connected client and honors its answer', async () => {
    await rpc(IpcChannels.policySetMode, ['review']) // commands confirm
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, [coreAuthSubprotocol(handle.token)])
    await new Promise((r) => ws.on('open', r))

    // The client answers whatever prompt arrives — this is what chrome://webdeck
    // does: render the inline prompt, then call policyRespond.
    const prompted = new Promise<{ kind: string }>((resolve) => {
      ws.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as {
          type?: string
          channel?: string
          payload?: { id: string; kind: string }
        }
        if (frame.type === 'event' && frame.channel === 'event:policy-prompt' && frame.payload) {
          resolve({ kind: frame.payload.kind })
          void rpc(IpcChannels.policyRespond, [frame.payload.id, true, false])
        }
      })
    })

    // Drive a real gated action through the engine (checkAction is not an RPC,
    // so call it directly — the transport is what's under test here).
    const { checkAction } = await import('./domains/policy')
    const verdict = checkAction('command', 'ls', 'fork-session')
    const seen = await prompted
    expect(seen.kind).toBe('command')
    expect(await verdict).toBe(true)
    ws.close()
  })

  it('fails closed when no client is connected to ask', async () => {
    await rpc(IpcChannels.policySetMode, ['review'])
    await waitForNoClients()
    const { checkAction } = await import('./domains/policy')
    expect(await checkAction('command', 'ls', 'fork-nobody')).toBe(false)
  })

  it('fails a pending prompt closed if the last client disconnects', async () => {
    await rpc(IpcChannels.policySetMode, ['review'])
    await waitForNoClients()
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, [coreAuthSubprotocol(handle.token)])
    await new Promise((r) => ws.on('open', r))
    const { checkAction } = await import('./domains/policy')
    // Ask, then have the only client vanish without answering. Without the
    // disconnect hook this would hang the agent forever.
    const verdict = checkAction('command', 'ls', 'fork-drop')
    await new Promise((r) => ws.on('message', r)) // the prompt arrived
    ws.close()
    expect(await verdict).toBe(false)
  })
})
