import { generateKeyPairSync } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  EXIT_INSECURE,
  EXIT_UP_TO_DATE,
  EXIT_UPDATE,
  buildResult,
  canonicalize,
  exitCodeFor,
  signManifest,
  verifyAppcast
} from './update-check.mjs'

// A throwaway signing key per run — the crypto is real, no fixture key is
// committed (the release key is minted by --genkey and held out of band).
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' })
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' })

const manifest = {
  channel: 'stable',
  version: '0.2.0',
  url: 'https://dl.example.com/WebDeck-0.2.0-arm64.dmg',
  sha256: 'a'.repeat(64),
  size: 123456789,
  notes: 'https://example.com/releases/v0.2.0',
  critical: false,
  pubDate: '2026-09-01T00:00:00Z'
}
const sign = (m) => ({ manifest: m, signature: signManifest(m, privPem), keyId: 'test' })

describe('canonicalize', () => {
  it('is independent of key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
  })
  it('sorts nested object keys too', () => {
    expect(canonicalize({ x: { c: 1, a: 2 } })).toBe('{"x":{"a":2,"c":1}}')
  })
})

describe('verifyAppcast', () => {
  it('accepts a manifest signed with the matching key', () => {
    expect(verifyAppcast(sign(manifest), pubPem).ok).toBe(true)
  })

  it('rejects a tampered manifest (fail closed)', () => {
    const appcast = sign(manifest)
    appcast.manifest = { ...manifest, url: 'https://evil.example.com/x.dmg' }
    const res = verifyAppcast(appcast, pubPem)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/signature/)
  })

  it('rejects a signature from a different key', () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem'
    })
    const appcast = { manifest, signature: signManifest(manifest, other), keyId: 'test' }
    expect(verifyAppcast(appcast, pubPem).ok).toBe(false)
  })

  it('never throws on malformed input — returns a reason instead', () => {
    expect(verifyAppcast(null, pubPem).ok).toBe(false)
    expect(verifyAppcast({}, pubPem).ok).toBe(false)
    expect(verifyAppcast({ manifest, signature: '' }, pubPem).ok).toBe(false)
    expect(verifyAppcast({ manifest, signature: 'not-base64!!' }, pubPem).ok).toBe(false)
  })
})

describe('buildResult', () => {
  it('reports an available update when the manifest is newer', () => {
    const r = buildResult({ current: '0.1.0', manifest, channel: 'stable', verified: true })
    expect(r.status).toBe('update-available')
    expect(r.latest).toBe('0.2.0')
    expect(r.url).toBe(manifest.url)
  })

  it('reports up-to-date when current is equal or newer', () => {
    expect(
      buildResult({ current: '0.2.0', manifest, channel: 'stable', verified: true }).status
    ).toBe('up-to-date')
    expect(
      buildResult({ current: '0.3.0', manifest, channel: 'stable', verified: true }).status
    ).toBe('up-to-date')
  })

  it('is insecure when the caller could not verify', () => {
    expect(
      buildResult({ current: '0.1.0', manifest, channel: 'stable', verified: false }).status
    ).toBe('insecure')
  })

  it('errors on a channel mismatch rather than offering the wrong build', () => {
    const r = buildResult({ current: '0.1.0', manifest, channel: 'beta', verified: true })
    expect(r.status).toBe('error')
  })

  it('does not leak a download URL when up to date', () => {
    const r = buildResult({ current: '0.2.0', manifest, channel: 'stable', verified: true })
    expect(r.url).toBeUndefined()
  })
})

describe('exitCodeFor', () => {
  it('maps each status to its documented code', () => {
    expect(exitCodeFor({ status: 'up-to-date' })).toBe(EXIT_UP_TO_DATE)
    expect(exitCodeFor({ status: 'update-available' })).toBe(EXIT_UPDATE)
    expect(exitCodeFor({ status: 'insecure' })).toBe(EXIT_INSECURE)
    expect(exitCodeFor({ status: 'error' })).toBe(2)
  })
})
