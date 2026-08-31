import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { CoreRegistry } from '../rpc'
import { coreAuthSubprotocol } from './auth'
import { serveCoreOverWebSocket, type WsServerHandle } from './ws-server'
import { CoreClient, type WsLike } from './ws-client'

/**
 * The core calling INTO the browser.
 *
 * Everything else in the app travels page → core: the page asks, the core
 * answers. The agent's browser tools have to go the other way, because the
 * agent runs in the core and the user's tabs are reachable only from the page
 * that lives inside the browser. This is the transport half of that.
 */

let handle: WsServerHandle
let client: CoreClient

beforeAll(async () => {
  const registry = new CoreRegistry()
  registry.register('echo', (v) => v)
  handle = await serveCoreOverWebSocket(registry, { port: 0, authToken: 'test-token-reverse' })
  client = new CoreClient({
    connect: () =>
      new WebSocket(`ws://127.0.0.1:${handle.port}`, [
        coreAuthSubprotocol(handle.token)
      ]) as unknown as WsLike
  })
  await client.connect()
})

afterAll(async () => {
  client?.close()
  await handle?.close()
})

describe('core → client requests', () => {
  it('calls a method the client serves and gets its result', async () => {
    client.serve('tabs:open', (url) => ({ tabId: 'tab-1', url }))

    const result = await handle.requestFromClient('tabs:open', ['https://example.com'], 5000)

    expect(result).toEqual({ tabId: 'tab-1', url: 'https://example.com' })
  })

  it('awaits an async handler', async () => {
    client.serve('slow', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return 'eventually'
    })
    await expect(handle.requestFromClient('slow', [], 5000)).resolves.toBe('eventually')
  })

  it('surfaces a handler that throws, rather than hanging', async () => {
    client.serve('boom', () => {
      throw new Error('tab is gone')
    })
    await expect(handle.requestFromClient('boom', [], 5000)).rejects.toThrow('tab is gone')
  })

  it('says so when the client serves no such method', async () => {
    await expect(handle.requestFromClient('nope', [], 5000)).rejects.toThrow(/no client handler/)
  })

  it('times out rather than waiting forever', async () => {
    client.serve('never', () => new Promise(() => {}))
    await expect(handle.requestFromClient('never', [], 200)).rejects.toThrow(/did not answer/)
  })

  it('the normal direction still works alongside it', async () => {
    // The two directions share one socket and one frame shape; a reply going
    // the wrong way would break the ordinary page → core path.
    await expect(client.invoke('echo', 'still fine')).resolves.toBe('still fine')
  })

  it('reports plainly when no browser is connected', async () => {
    const lonely = await serveCoreOverWebSocket(new CoreRegistry(), {
      port: 0,
      authToken: 'test-token-lonely'
    })
    await expect(lonely.requestFromClient('tabs:open', [], 1000)).rejects.toThrow(
      /no browser window is connected/
    )
    await lonely.close()
  })
})
