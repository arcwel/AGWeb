import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { CoreRegistry } from '../rpc'
import { serveCoreOverWebSocket, type WsServerHandle } from './ws-server'

// A real WebSocket round-trip through the webdeck-core server — the P0 bridge
// deliverable, exercised end to end rather than just as a pure function.

let server: WsServerHandle | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(d.toString())))
}

describe('serveCoreOverWebSocket', () => {
  it('round-trips a request from a socket client to a handler and back', async () => {
    const reg = new CoreRegistry()
    reg.register('add', (a, b) => (a as number) + (b as number))
    server = await serveCoreOverWebSocket(reg)
    const ws = await connect(server.port)

    ws.send(JSON.stringify({ id: 1, method: 'add', args: [2, 3] }))
    expect(JSON.parse(await nextMessage(ws))).toEqual({ id: 1, result: 5 })

    ws.close()
  })

  it('processes a notify frame (no reply) before the next request', async () => {
    const reg = new CoreRegistry()
    let pushed: unknown
    reg.registerNotify('push', (v) => {
      pushed = v
    })
    reg.register('ping', () => 'pong')
    server = await serveCoreOverWebSocket(reg)
    const ws = await connect(server.port)

    ws.send(JSON.stringify({ notify: true, method: 'push', args: ['x'] }))
    ws.send(JSON.stringify({ id: 2, method: 'ping' }))
    // The only reply is to the request; receiving it proves the notify (sent
    // first, in order) was already handled with no reply of its own.
    expect(JSON.parse(await nextMessage(ws))).toEqual({ id: 2, result: 'pong' })
    expect(pushed).toBe('x')

    ws.close()
  })

  it('surfaces a handler error as an error frame', async () => {
    const reg = new CoreRegistry()
    reg.register('boom', () => {
      throw new Error('kaboom')
    })
    server = await serveCoreOverWebSocket(reg)
    const ws = await connect(server.port)

    ws.send(JSON.stringify({ id: 3, method: 'boom' }))
    expect(JSON.parse(await nextMessage(ws))).toEqual({ id: 3, error: 'kaboom' })

    ws.close()
  })

  it('binds loopback and reports an ephemeral port', async () => {
    server = await serveCoreOverWebSocket(new CoreRegistry())
    expect(server.port).toBeGreaterThan(0)
  })
})
