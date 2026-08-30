import { describe, it, expect } from 'vitest'
import { CoreRegistry } from '../rpc'
import { handleRpcMessage, type RpcResponse } from './socket'

function make(): CoreRegistry {
  const reg = new CoreRegistry()
  reg.register('add', (a, b) => (a as number) + (b as number))
  reg.register('boom', () => {
    throw new Error('kaboom')
  })
  return reg
}

const call = async (reg: CoreRegistry, frame: object | string): Promise<RpcResponse> =>
  JSON.parse(await handleRpcMessage(reg, typeof frame === 'string' ? frame : JSON.stringify(frame)))

describe('handleRpcMessage', () => {
  it('dispatches and echoes the id', async () => {
    expect(await call(make(), { id: 7, method: 'add', args: [2, 3] })).toEqual({ id: 7, result: 5 })
  })

  it('is the same result the Electron transport would produce', async () => {
    // The migration invariant: whichever transport carries the call, the
    // registry runs the identical handler.
    const reg = make()
    const viaSocket = await call(reg, { id: 1, method: 'add', args: [10, 20] })
    const viaDispatch = await reg.dispatch('add', [10, 20])
    expect(viaSocket.result).toBe(viaDispatch)
  })

  it('turns a handler throw into an error frame, never a throw', async () => {
    const res = await call(make(), { id: 9, method: 'boom' })
    expect(res).toEqual({ id: 9, error: 'kaboom' })
  })

  it('reports an unknown method as an error', async () => {
    const res = await call(make(), { id: 2, method: 'nope' })
    expect(res.error).toMatch(/no handler/)
  })

  it('rejects malformed JSON without throwing', async () => {
    expect(await call(make(), 'not json{')).toEqual({ id: null, error: 'malformed request' })
  })

  it('rejects a frame with no method', async () => {
    expect(await call(make(), { id: 3, method: undefined as unknown as string })).toEqual({
      id: 3,
      error: 'missing method'
    })
  })

  it('dispatches a notify frame and writes nothing back', async () => {
    const reg = make()
    let pushed: unknown
    reg.registerNotify('push', (v) => {
      pushed = v
    })
    const raw = await handleRpcMessage(
      reg,
      JSON.stringify({ notify: true, method: 'push', args: ['x'] })
    )
    expect(raw).toBe('') // no reply for a stream frame
    expect(pushed).toBe('x')
  })
})
