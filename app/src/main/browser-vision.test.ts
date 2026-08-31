import { describe, it, expect, vi } from 'vitest'

// The attach layer imports './browser' (Electron); stub it so the pure
// aggregation — the part worth unit-testing — loads without the shell.
vi.mock('./browser', () => ({ getTabWebContents: () => undefined }))

import {
  applyCdpEvent,
  formatSnapshot,
  newVisionState,
  redactSecrets,
  summarizeVision
} from './browser-vision'

/** Feed a sequence of CDP events into a fresh state and summarize. */
function run(events: Array<[string, unknown]>): ReturnType<typeof summarizeVision> {
  const state = newVisionState()
  for (const [method, params] of events) applyCdpEvent(state, method, params)
  return summarizeVision(state)
}

describe('applyCdpEvent + summarizeVision', () => {
  it('counts a normal request with no failures', () => {
    const s = run([
      [
        'Network.requestWillBeSent',
        { requestId: '1', request: { url: 'https://x/a', method: 'GET' } }
      ],
      ['Network.responseReceived', { requestId: '1', response: { status: 200 } }]
    ])
    expect(s.totalRequests).toBe(1)
    expect(s.failures).toHaveLength(0)
  })

  it('flags an HTTP error response as a failure with its status', () => {
    const s = run([
      [
        'Network.requestWillBeSent',
        { requestId: '1', request: { url: 'https://x/api', method: 'POST' } }
      ],
      ['Network.responseReceived', { requestId: '1', response: { status: 500 } }]
    ])
    expect(s.failures).toHaveLength(1)
    expect(s.failures[0]).toMatchObject({ url: 'https://x/api', method: 'POST', status: 500 })
  })

  it('flags a loadingFailed request (connection refused, no response)', () => {
    const s = run([
      [
        'Network.requestWillBeSent',
        { requestId: '9', request: { url: 'http://127.0.0.1:9/probe', method: 'GET' } }
      ],
      ['Network.loadingFailed', { requestId: '9', errorText: 'net::ERR_CONNECTION_REFUSED' }]
    ])
    expect(s.failures).toHaveLength(1)
    expect(s.failures[0].failed).toBe(true)
    expect(s.failures[0].error).toBe('net::ERR_CONNECTION_REFUSED')
  })

  it('records a loadingFailed with no prior requestWillBeSent', () => {
    const s = run([['Network.loadingFailed', { requestId: 'x', errorText: 'net::ERR_ABORTED' }]])
    expect(s.failures).toHaveLength(1)
    expect(s.failures[0].url).toBe('(unknown)')
  })

  it('captures console.error and console.warn, ignores console.log', () => {
    const s = run([
      ['Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'boom' }] }],
      ['Runtime.consoleAPICalled', { type: 'warning', args: [{ value: 'careful' }] }],
      ['Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'noise' }] }]
    ])
    expect(s.console).toHaveLength(2)
    expect(s.console[0]).toMatchObject({ level: 'error', text: 'boom' })
    expect(s.console[1]).toMatchObject({ level: 'warning', text: 'careful' })
  })

  it('normalizes console "warn" to "warning" and joins multiple args', () => {
    const s = run([
      ['Runtime.consoleAPICalled', { type: 'warn', args: [{ value: 'a' }, { value: 'b' }] }]
    ])
    expect(s.console[0]).toEqual({ level: 'warning', text: 'a b' })
  })

  it('captures Log.entryAdded errors (browser-level, e.g. failed subresource)', () => {
    const s = run([
      ['Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource' } }],
      ['Log.entryAdded', { entry: { level: 'verbose', text: 'ignored' } }]
    ])
    expect(s.console).toHaveLength(1)
    expect(s.console[0].text).toBe('Failed to load resource')
  })

  it('ignores unknown methods and malformed params', () => {
    const s = run([
      ['Some.unknownEvent', { foo: 'bar' }],
      ['Network.requestWillBeSent', {}],
      ['Network.responseReceived', { requestId: 'missing' }]
    ])
    expect(s.totalRequests).toBe(0)
    expect(s.failures).toHaveLength(0)
  })

  it('caps the request log so a polling tab cannot grow unbounded', () => {
    const state = newVisionState()
    for (let i = 0; i < 250; i++) {
      applyCdpEvent(state, 'Network.requestWillBeSent', {
        requestId: `r${i}`,
        request: { url: `https://x/${i}`, method: 'GET' }
      })
    }
    expect(state.requests.size).toBeLessThanOrEqual(200)
    // Oldest evicted, newest kept.
    expect(state.requests.has('r0')).toBe(false)
    expect(state.requests.has('r249')).toBe(true)
  })

  it('redacts secrets in captured console text', () => {
    const state = newVisionState()
    applyCdpEvent(state, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ value: 'refresh failed {"refresh_token":"s3cr3tvalue","x":1}' }]
    })
    expect(state.console[0].text).not.toContain('s3cr3tvalue')
    expect(state.console[0].text).toContain('«redacted»')
  })
})

describe('redactSecrets', () => {
  it('masks token/secret-shaped key:value pairs', () => {
    expect(redactSecrets('{"refresh_token":"abc123def"}')).not.toContain('abc123def')
    expect(redactSecrets('api_key=SUPERSECRET&x=1')).not.toContain('SUPERSECRET')
    // The shape that matters, and the one a no-space token silently hid: the
    // scheme and the credential are separated by a space, so a redactor that
    // stops at whitespace masks "Bearer" and prints the key.
    expect(redactSecrets('authorization: Bearer sk_live_abc123')).not.toContain('sk_live_abc123')
    expect(redactSecrets('Cookie: session=deadbeef; theme=dark')).not.toContain('deadbeef')
    // A masked value must not swallow the rest of a structured body.
    const body = redactSecrets('{"access_token":"zzz","status":"expired"}')
    expect(body).not.toContain('zzz')
    expect(body).toContain('expired')
  })

  it('masks JWT-shaped strings', () => {
    expect(redactSecrets('cookie eyJhbGc.eyJzdWIx.SflKxwRJ here')).toContain('«redacted-jwt»')
  })

  it('leaves ordinary diagnostic text intact', () => {
    const plain = 'GET https://x/api → 500 internal error'
    expect(redactSecrets(plain)).toBe(plain)
  })
})

describe('formatSnapshot', () => {
  it('reports a clean page plainly', () => {
    const s = run([
      [
        'Network.requestWillBeSent',
        { requestId: '1', request: { url: 'https://x/a', method: 'GET' } }
      ],
      ['Network.responseReceived', { requestId: '1', response: { status: 200 } }]
    ])
    expect(formatSnapshot(s)).toMatch(/no network failures or console errors/)
  })

  it('cites the failing request and console error together', () => {
    const s = run([
      [
        'Network.requestWillBeSent',
        { requestId: '1', request: { url: 'https://x/api', method: 'GET' } }
      ],
      ['Network.responseReceived', { requestId: '1', response: { status: 500 } }],
      ['Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'request failed' }] }]
    ])
    const text = formatSnapshot(s)
    expect(text).toContain('1 failed')
    expect(text).toContain('https://x/api')
    expect(text).toContain('500')
    expect(text).toContain('[error] request failed')
  })

  it('includes a captured response body when present', () => {
    const state = newVisionState()
    applyCdpEvent(state, 'Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'https://x/api', method: 'GET' }
    })
    applyCdpEvent(state, 'Network.responseReceived', { requestId: '1', response: { status: 503 } })
    // The Electron attach layer sets .body out of band; simulate that here.
    const s = summarizeVision(state)
    s.failures[0].body = '{"error":"upstream down"}'
    expect(formatSnapshot(s)).toContain('upstream down')
  })
})
