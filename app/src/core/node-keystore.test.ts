import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeSecretStore } from './node-keystore'

// The standalone core's secret storage. secrets.ts refuses to write plaintext,
// so without a working store the fork simply cannot hold an API key — these
// tests pin the round-trip, the on-disk protections, and the failure modes.

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wd-keystore-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('nodeSecretStore', () => {
  it('round-trips a secret', () => {
    const store = nodeSecretStore(dir)
    const enc = store.encryptString('sk-ant-secret-value')
    expect(store.decryptString(enc)).toBe('sk-ant-secret-value')
  })

  it('reports itself available and creates a 0600 key file', () => {
    const store = nodeSecretStore(dir)
    expect(store.isAvailable()).toBe(true)
    const key = join(dir, 'keystore.key')
    expect(existsSync(key)).toBe(true)
    // Owner-only: the key must not be world/group readable.
    expect(statSync(key).mode & 0o077).toBe(0)
  })

  it('does not leave the plaintext anywhere in the ciphertext', () => {
    const enc = nodeSecretStore(dir).encryptString('super-secret-token')
    expect(enc.toString('utf8')).not.toContain('super-secret-token')
    expect(enc.toString('base64')).not.toContain('super-secret-token')
  })

  it('produces different ciphertext each time (random IV)', () => {
    const store = nodeSecretStore(dir)
    const a = store.encryptString('same input')
    const b = store.encryptString('same input')
    expect(a.equals(b)).toBe(false)
    expect(store.decryptString(a)).toBe(store.decryptString(b))
  })

  it('persists across store instances (same key file)', () => {
    const enc = nodeSecretStore(dir).encryptString('durable')
    expect(nodeSecretStore(dir).decryptString(enc)).toBe('durable')
  })

  it('refuses tampered ciphertext (GCM auth tag)', () => {
    const store = nodeSecretStore(dir)
    const enc = store.encryptString('authentic')
    enc[enc.length - 1] ^= 0xff // flip a bit in the body
    expect(() => store.decryptString(enc)).toThrow()
  })

  it('rejects a truncated buffer rather than misreading it', () => {
    const store = nodeSecretStore(dir)
    expect(() => store.decryptString(Buffer.alloc(4))).toThrow(/too short/)
  })

  it('cannot decrypt with a different key file (the key is what protects it)', () => {
    const other = mkdtempSync(join(tmpdir(), 'wd-keystore-other-'))
    try {
      const enc = nodeSecretStore(dir).encryptString('cross-machine')
      expect(() => nodeSecretStore(other).decryptString(enc)).toThrow()
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('reports unavailable (not silently rotating) on a malformed key file', () => {
    const broken = mkdtempSync(join(tmpdir(), 'wd-keystore-broken-'))
    try {
      writeFileSync(join(broken, 'keystore.key'), 'too-short')
      const store = nodeSecretStore(broken)
      expect(store.isAvailable()).toBe(false)
      // A silent rotation here would strand every stored secret.
      expect(readFileSync(join(broken, 'keystore.key'), 'utf8')).toBe('too-short')
    } finally {
      rmSync(broken, { recursive: true, force: true })
    }
  })
})
