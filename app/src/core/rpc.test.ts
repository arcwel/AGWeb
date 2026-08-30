import { describe, it, expect } from 'vitest'
import { CoreRegistry, type CoreTransport } from './rpc'

describe('CoreRegistry', () => {
  it('dispatches a registered method with its args', async () => {
    const reg = new CoreRegistry()
    reg.register('add', (a, b) => (a as number) + (b as number))
    expect(await reg.dispatch('add', [2, 3])).toBe(5)
  })

  it('awaits async handlers', async () => {
    const reg = new CoreRegistry()
    reg.register('later', async (x) => (x as number) * 2)
    expect(await reg.dispatch('later', [21])).toBe(42)
  })

  it('rejects an unknown method', async () => {
    const reg = new CoreRegistry()
    await expect(reg.dispatch('nope')).rejects.toThrow(/no handler/)
  })

  it('refuses a duplicate registration', () => {
    const reg = new CoreRegistry()
    reg.register('x', () => 1)
    expect(() => reg.register('x', () => 2)).toThrow(/duplicate/)
  })

  it('binds every method onto a transport exactly once', () => {
    const reg = new CoreRegistry()
    reg.register('a', () => 1)
    reg.register('b', () => 2)
    const bound: string[] = []
    const transport: CoreTransport = { handle: (m) => bound.push(m) }
    reg.bind(transport)
    expect(bound.sort()).toEqual(['a', 'b'])
  })

  it('a transport-bound handler runs the same code as dispatch', async () => {
    // The invariant that makes the Electron→Chromium swap safe: whichever
    // transport carries a call, the handler behind it is identical.
    const reg = new CoreRegistry()
    reg.register('echo', (v) => v)
    let captured: unknown
    reg.bind({ handle: (_m, h) => void Promise.resolve(h('hi')).then((r) => (captured = r)) })
    await Promise.resolve()
    expect(captured).toBe('hi')
    expect(await reg.dispatch('echo', ['hi'])).toBe('hi')
  })

  it('lists registered methods sorted', () => {
    const reg = new CoreRegistry()
    reg.register('zeta', () => 0)
    reg.register('alpha', () => 0)
    reg.registerNotify('stream', () => 0)
    expect(reg.methods()).toEqual({ request: ['alpha', 'zeta'], notify: ['stream'] })
  })

  it('fires a notifier fire-and-forget and only binds notifiers to transports that stream', () => {
    const reg = new CoreRegistry()
    let seen: unknown
    reg.registerNotify('push', (v) => {
      seen = v
    })
    reg.notify('push', ['x'])
    expect(seen).toBe('x')

    // A transport without notify() binds only request handlers — no throw.
    reg.register('req', () => 1)
    const bound: string[] = []
    reg.bind({ handle: (m) => bound.push(m) })
    expect(bound).toEqual(['req'])

    // One that streams gets the notifiers too.
    const streamed: string[] = []
    reg.bind({ handle: () => {}, notify: (m) => streamed.push(m) })
    expect(streamed).toEqual(['push'])
  })

  it('an unknown notifier is a silent no-op (streams have no reply to error to)', () => {
    const reg = new CoreRegistry()
    expect(() => reg.notify('nope', [1])).not.toThrow()
  })
})
