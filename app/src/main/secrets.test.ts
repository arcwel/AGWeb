import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setCoreEnv } from '../core/env'
import * as secrets from './secrets'

// A real temp dir (no fs mocking, which is brittle) that secrets.ts writes to
// via the injected CoreEnv. Cleaned between tests and at the end. No Electron
// mock: the platform seam is filled directly, which is the whole point of the
// webdeck-core decoupling — the domain runs unchanged off a fake host here and
// the real Electron host in the app.
const state = { encryptionAvailable: true }
const dir = join(tmpdir(), `wd-secrets-test-${process.pid}`)
const file = (): string => join(dir, 'secrets.json')

beforeAll(() => {
  mkdirSync(dir, { recursive: true })
  setCoreEnv({
    userDataDir: dir,
    homeDir: dir,
    appDir: dir,
    secrets: {
      isAvailable: () => state.encryptionAvailable,
      // Reversible stand-in for the OS keychain: prefix so we can assert the
      // ciphertext on disk isn't the plaintext.
      encryptString: (s) => Buffer.from(`enc:${s}`),
      decryptString: (b) => b.toString().replace(/^enc:/, '')
    }
  })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(file(), { force: true })
  state.encryptionAvailable = true
})

describe('secrets', () => {
  it('round-trips a key through the encrypted store', () => {
    expect(secrets.setApiKey('anthropic', 'sk-ant-123')).toBe(true)
    expect(secrets.getApiKey('anthropic')).toBe('sk-ant-123')
  })

  it('never persists the key in plaintext on disk', () => {
    secrets.setApiKey('openai', 'sk-secret-xyz')
    expect(secrets.getApiKey('openai')).toBe('sk-secret-xyz')
    const onDisk = readFileSync(file(), 'utf8')
    expect(onDisk).not.toContain('sk-secret-xyz')
  })

  it('reports configured providers without exposing the key', () => {
    secrets.setApiKey('gemini', 'AIza-key')
    const status = secrets.listConfiguredProviders()
    expect(status.gemini).toBe(true)
    expect(status.anthropic).toBe(false)
  })

  it('refuses to store when no OS keychain is available', () => {
    state.encryptionAvailable = false
    expect(secrets.setApiKey('anthropic', 'sk-ant-999')).toBe(false)
    expect(secrets.getApiKey('anthropic')).toBeNull()
  })

  it('rejects an unknown provider', () => {
    expect(secrets.setApiKey('hackerman' as never, 'x')).toBe(false)
  })

  it('clears a key', () => {
    secrets.setApiKey('anthropic', 'sk-ant-123')
    secrets.setApiKey('anthropic', '')
    expect(secrets.getApiKey('anthropic')).toBeNull()
  })
})
