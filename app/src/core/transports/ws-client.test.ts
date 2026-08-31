import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import { startWebdeckCore } from '../server'
import { coreAuthSubprotocol } from './auth'
import { CoreClient, coreClientForWebUI, type WsLike } from './ws-client'
import type { WsServerHandle } from './ws-server'

/**
 * The chrome://webdeck data path, end to end: the WebUI's client talking to the
 * real standalone core over a real socket. If this passes, the renderer can be
 * rebuilt on `invoke`/`on` with no Electron preload — which is the whole point
 * of the WebUI.
 */

let handle: WsServerHandle
let dataDir: string
const clients: CoreClient[] = []

/** `ws` sockets expose addEventListener, so they satisfy WsLike directly. */
function makeSocket(url: string, protocols: string[] = []): WsLike {
  return new WebSocket(url, protocols) as unknown as WsLike
}

function newClient(): CoreClient {
  const client = new CoreClient({
    connect: () => makeSocket(`ws://127.0.0.1:${handle.port}`, [coreAuthSubprotocol(handle.token)])
  })
  clients.push(client)
  return client
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'webdeck-wsclient-'))
  handle = await startWebdeckCore({ userDataDir: dataDir, port: 0 })
})

afterAll(async () => {
  for (const client of clients) client.close()
  await handle?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('CoreClient against the real core', () => {
  it('invokes a CORE method and resolves its result', async () => {
    const policy = (await newClient().invoke(IpcChannels.policyGet)) as { mode: string }
    expect(['secure', 'review', 'agent', 'custom']).toContain(policy.mode)
  })

  it('passes arguments and persists real state', async () => {
    const client = newClient()
    const written = (await client.invoke(IpcChannels.appSettingsWrite, { doNotTrack: true })) as {
      doNotTrack: boolean
    }
    expect(written.doNotTrack).toBe(true)
    const read = (await client.invoke(IpcChannels.appSettingsRead)) as { doNotTrack: boolean }
    expect(read.doNotTrack).toBe(true)
  })

  it('rejects when the handler errors, with the real message', async () => {
    await expect(newClient().invoke(IpcChannels.agentStart, '')).rejects.toThrow(/empty task/)
  })

  it('rejects an unknown method rather than hanging', async () => {
    await expect(newClient().invoke('nope:missing')).rejects.toThrow()
  })

  it('multiplexes concurrent calls to the right callers', async () => {
    const client = newClient()
    const [policy, settings, sessions] = await Promise.all([
      client.invoke(IpcChannels.policyGet),
      client.invoke(IpcChannels.appSettingsRead),
      client.invoke(IpcChannels.agentList)
    ])
    expect(policy).toHaveProperty('mode')
    expect(settings).toHaveProperty('spellcheck')
    expect(Array.isArray(sessions)).toBe(true)
  })

  it('delivers server-pushed events to on() subscribers', async () => {
    const client = newClient()
    await client.connect()
    const seen = new Promise<{ mode: string }>((resolve) => {
      client.on(IpcEvents.policyChanged, (payload) => resolve(payload as { mode: string }))
    })
    // A policy change broadcasts to every connected client.
    await client.invoke(IpcChannels.policySetMode, 'agent')
    expect((await seen).mode).toBe('agent')
  })

  it('unsubscribes cleanly', async () => {
    const client = newClient()
    await client.connect()
    let hits = 0
    const off = client.on(IpcEvents.policyChanged, () => hits++)
    await client.invoke(IpcChannels.policySetMode, 'review')
    await new Promise((r) => setTimeout(r, 50))
    const afterFirst = hits
    off()
    await client.invoke(IpcChannels.policySetMode, 'agent')
    await new Promise((r) => setTimeout(r, 50))
    expect(hits).toBe(afterFirst)
    expect(afterFirst).toBeGreaterThan(0)
  })

  it('fails in-flight calls when the socket drops (no silent hang)', async () => {
    const client = newClient()
    await client.connect()
    const inFlight = client.invoke(IpcChannels.policyGet)
    client.close()
    await expect(inFlight).rejects.toThrow(/disconnected|closed/)
  })
})

describe('coreClientForWebUI', () => {
  it('uses an injected port', async () => {
    const client = coreClientForWebUI({ port: handle.port, token: handle.token, makeSocket })
    clients.push(client)
    expect(await client.invoke(IpcChannels.policyGet)).toHaveProperty('mode')
  })

  it('reads the port from the chrome://webdeck query string', async () => {
    const client = coreClientForWebUI({
      search: `?corePort=${handle.port}`,
      token: handle.token,
      makeSocket
    })
    clients.push(client)
    expect(await client.invoke(IpcChannels.policyGet)).toHaveProperty('mode')
  })

  it('fails loudly when the host provided no port', () => {
    expect(() => coreClientForWebUI({ makeSocket })).toThrow(/port not provided/)
  })
})
