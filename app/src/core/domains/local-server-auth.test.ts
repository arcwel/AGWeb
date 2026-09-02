import { describe, it, expect } from 'vitest'
import { mintServerToken, takeToken, hostAllowed } from './local-server-auth'

/**
 * The preview and slide servers hand out the workspace over loopback HTTP.
 * Before this, both checked only the Host header — which stops a rebound DNS
 * name reaching them through the user's browser, and does nothing about the
 * threat that actually applies to a loopback port: any other process running as
 * this user could set the right Host and read the workspace root, source and
 * dotfiles included.
 */

describe('the URL carries a capability', () => {
  it('mints tokens that are unguessable and URL-safe', () => {
    const a = mintServerToken()
    const b = mintServerToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    // base64url only — anything else would need escaping in a path segment.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('accepts the right token and hands back the rest of the path', () => {
    const token = mintServerToken()
    expect(takeToken(`/${token}/index.html`, token)).toBe('/index.html')
    expect(takeToken(`/${token}/`, token)).toBe('/')
    expect(takeToken(`/${token}/a/b/c.js`, token)).toBe('/a/b/c.js')
  })

  it('refuses a request with no token at all', () => {
    // The whole point: this is what a local attacker sends.
    const token = mintServerToken()
    expect(takeToken('/index.html', token)).toBeNull()
    expect(takeToken('/', token)).toBeNull()
    expect(takeToken('/../../etc/passwd', token)).toBeNull()
  })

  it('refuses a wrong, truncated or extended token', () => {
    const token = mintServerToken()
    expect(takeToken(`/${token.slice(0, -1)}/x`, token)).toBeNull()
    expect(takeToken(`/${token}x/x`, token)).toBeNull()
    expect(takeToken(`/${mintServerToken()}/x`, token)).toBeNull()
  })

  it('is not fooled by a token in the query string', () => {
    // A capability in the path is the contract; accepting it elsewhere would
    // widen the surface for no benefit.
    const token = mintServerToken()
    expect(takeToken(`/index.html?k=${token}`, token)).toBeNull()
  })

  it('ignores a query string after a valid token', () => {
    const token = mintServerToken()
    expect(takeToken(`/${token}/index.html?v=2`, token)).toBe('/index.html')
  })
})

describe('the Host check still holds', () => {
  it('accepts the loopback forms on the right port', () => {
    expect(hostAllowed('127.0.0.1:4321', 4321)).toBe(true)
    expect(hostAllowed('localhost:4321', 4321)).toBe(true)
    expect(hostAllowed('[::1]:4321', 4321)).toBe(true)
    expect(hostAllowed('LOCALHOST:4321', 4321)).toBe(true)
  })

  it('refuses a rebound name or the wrong port', () => {
    // A page on the internet resolving its own hostname to 127.0.0.1 is the
    // attack this stops; the token does not, if the URL ever leaks.
    expect(hostAllowed('evil.test:4321', 4321)).toBe(false)
    expect(hostAllowed('127.0.0.1:9999', 4321)).toBe(false)
    expect(hostAllowed(undefined, 4321)).toBe(false)
    expect(hostAllowed('', 4321)).toBe(false)
  })
})
