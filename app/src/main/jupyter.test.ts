import { describe, it, expect } from 'vitest'
import { buildExecuteRequest, parseIopubMessage, wsUrlFromBase, isReplyTo } from './jupyter'

/**
 * jupyter.ts speaks the Jupyter v5.3 messaging protocol by hand, so its
 * correctness lives in a handful of pure functions: building a well-formed
 * `execute_request`, deriving the kernel WebSocket URL from a server base URL,
 * correlating replies to the request that produced them, and mapping raw iopub
 * frames to the typed outputs the block renders. These are regression tests for
 * exactly those pieces — deterministic, with ids/sessions passed in rather than
 * asserted against randomness.
 */

/** Narrow the opaque request into the header/content shapes the tests read. */
function parts(request: Record<string, unknown>): {
  header: Record<string, unknown>
  content: Record<string, unknown>
} {
  return {
    header: request.header as Record<string, unknown>,
    content: request.content as Record<string, unknown>
  }
}

describe('buildExecuteRequest', () => {
  it('builds a v5.3 execute_request on the shell channel', () => {
    // Arrange / Act
    const request = buildExecuteRequest('print(1)', 'sess-1')
    const { header, content } = parts(request)

    // Assert: envelope shape
    expect(request.channel).toBe('shell')
    expect(request.parent_header).toEqual({})
    expect(request.metadata).toEqual({})
    expect(header.msg_type).toBe('execute_request')
    expect(header.version).toBe('5.3')
    expect(header.username).toBe('webdeck')
    expect(typeof header.date).toBe('string')
    // The code is carried verbatim.
    expect(content.code).toBe('print(1)')
  })

  it('threads the session id through the header', () => {
    const request = buildExecuteRequest('x = 1', 'my-session')
    expect(parts(request).header.session).toBe('my-session')
  })

  it('sets the execution content flags the block relies on', () => {
    const { content } = parts(buildExecuteRequest('1+1', 's'))
    expect(content.silent).toBe(false)
    expect(content.store_history).toBe(true)
    expect(content.allow_stdin).toBe(false)
    expect(content.stop_on_error).toBe(true)
    expect(content.user_expressions).toEqual({})
  })

  it('gives every request a unique msg_id', () => {
    // Assert on difference, never on the specific (random) value.
    const a = parts(buildExecuteRequest('a', 's')).header.msg_id
    const b = parts(buildExecuteRequest('b', 's')).header.msg_id
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)
  })
})

describe('wsUrlFromBase', () => {
  it('maps http to a ws URL with the kernel channels path and token query', () => {
    const url = wsUrlFromBase('http://localhost:8888', 'kern-1', 'secret')
    expect(url).toBe('ws://localhost:8888/api/kernels/kern-1/channels?token=secret')
  })

  it('maps https to wss', () => {
    const url = wsUrlFromBase('https://hub.example.com', 'k9', 'tok')
    expect(url).toBe('wss://hub.example.com/api/kernels/k9/channels?token=tok')
  })

  it('preserves a base path prefix and a trailing slash is ignored', () => {
    const url = wsUrlFromBase('http://localhost:8888/jupyter/', 'k', 't')
    expect(url).toBe('ws://localhost:8888/jupyter/api/kernels/k/channels?token=t')
  })

  it('omits the token query when there is no token', () => {
    const url = wsUrlFromBase('http://localhost:8888', 'k', '')
    expect(url).toBe('ws://localhost:8888/api/kernels/k/channels')
  })

  it('url-encodes a token with reserved characters', () => {
    const url = wsUrlFromBase('http://localhost:8888', 'k', 'a b&c')
    expect(url).toBe('ws://localhost:8888/api/kernels/k/channels?token=a%20b%26c')
  })
})

describe('isReplyTo', () => {
  it('is true when parent_header.msg_id matches', () => {
    expect(isReplyTo({ parent_header: { msg_id: 'req-1' } }, 'req-1')).toBe(true)
  })

  it('is false for an unrelated parent_header', () => {
    expect(isReplyTo({ parent_header: { msg_id: 'other' } }, 'req-1')).toBe(false)
  })

  it('is false when there is no parent_header', () => {
    expect(isReplyTo({ header: { msg_type: 'status' } }, 'req-1')).toBe(false)
    expect(isReplyTo(null, 'req-1')).toBe(false)
    expect(isReplyTo('not an object', 'req-1')).toBe(false)
  })
})

describe('parseIopubMessage', () => {
  it('maps a stream message to a stream output', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'stream' },
      content: { name: 'stdout', text: 'hello\n' }
    })
    expect(output).toEqual({ kind: 'stream', name: 'stdout', text: 'hello\n' })
  })

  it('defaults a stream with no name to stdout', () => {
    const output = parseIopubMessage({ header: { msg_type: 'stream' }, content: { text: 'x' } })
    expect(output).toEqual({ kind: 'stream', name: 'stdout', text: 'x' })
  })

  it('maps execute_result to a result output carrying text/plain', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'execute_result' },
      content: { data: { 'text/plain': '42', 'application/json': { ignored: true } } }
    })
    expect(output).toEqual({ kind: 'result', data: { 'text/plain': '42' } })
  })

  it('maps display_data and keeps image/png and text/html representations', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'display_data' },
      content: { data: { 'image/png': 'AAAA', 'text/html': '<b>hi</b>' } }
    })
    expect(output).toEqual({
      kind: 'result',
      data: { 'image/png': 'AAAA', 'text/html': '<b>hi</b>' }
    })
  })

  it('maps an error message to an error output with its traceback', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'error' },
      content: { ename: 'ValueError', evalue: 'boom', traceback: ['line 1', 'line 2'] }
    })
    expect(output).toEqual({
      kind: 'error',
      ename: 'ValueError',
      evalue: 'boom',
      traceback: ['line 1', 'line 2']
    })
  })

  it('maps a status message with execution_state idle to done', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'status' },
      content: { execution_state: 'idle' }
    })
    expect(output).toEqual({ kind: 'done' })
  })

  it('returns null for a busy status (not a terminal signal)', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'status' },
      content: { execution_state: 'busy' }
    })
    expect(output).toBeNull()
  })

  it('returns null for an unrelated message type (execute_input)', () => {
    const output = parseIopubMessage({
      header: { msg_type: 'execute_input' },
      content: { code: 'x', execution_count: 3 }
    })
    expect(output).toBeNull()
  })

  it('parses a raw JSON string frame the same way as an object', () => {
    const raw = JSON.stringify({
      header: { msg_type: 'stream' },
      content: { name: 'stderr', text: 'oops' }
    })
    expect(parseIopubMessage(raw)).toEqual({ kind: 'stream', name: 'stderr', text: 'oops' })
  })

  it('returns null for an unparseable frame', () => {
    expect(parseIopubMessage('{ not json')).toBeNull()
    expect(parseIopubMessage(null)).toBeNull()
  })
})
