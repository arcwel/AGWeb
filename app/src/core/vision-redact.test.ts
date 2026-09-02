import { describe, expect, it } from 'vitest'
import { redactSecrets } from './vision'

/**
 * Redaction on every path that can carry a secret into the agent's context
 * (13.8f). Agent Vision captures response bodies and console lines; before
 * either reaches the model or the on-disk transcript it passes through here.
 */
describe('redactSecrets', () => {
  it('masks the whole value after a secret-looking key, not just its first word', () => {
    // The classic miss: "Bearer" redacted, the token printed.
    expect(redactSecrets('authorization: Bearer abc.def-ghi')).toBe('authorization: «redacted»')
    expect(redactSecrets('Authorization: Bearer x y z\nnext: line')).toBe(
      'Authorization: «redacted»\nnext: line'
    )
  })

  it('handles JSON bodies, query-string style and cookies', () => {
    expect(redactSecrets('{"api_key":"sk-live-123","name":"ok"}')).toBe(
      '{"api_key":«redacted»,"name":"ok"}'
    )
    expect(redactSecrets('access_token=abc123&user=me')).toBe('access_token=«redacted»&user=me')
    expect(redactSecrets('set-cookie: session=deadbeef; Path=/')).toBe(
      'set-cookie: «redacted»; Path=/'
    )
  })

  it('masks JWTs wherever they appear, even without a key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc_DEF-123'
    expect(redactSecrets(`saw ${jwt} in a log line`)).toBe('saw «redacted-jwt» in a log line')
  })

  it('leaves ordinary text alone', () => {
    const plain = 'GET /api/items 200 — 12 results, tokens per second: 40'
    expect(redactSecrets(plain)).toBe(plain)
  })
})
