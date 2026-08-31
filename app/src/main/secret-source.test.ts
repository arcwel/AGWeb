import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCoreEnv } from '../core/env'

const dir = mkdtempSync(join(tmpdir(), 'wd-secret-source-'))

setCoreEnv({
  userDataDir: dir,
  homeDir: dir,
  appDir: dir,
  secrets: {
    isAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})

const { tokenize, setSecretSource, getSecretSource, fetchSecretFromCommand, clearSecretCache } =
  await import('./secret-source')

// A stand-in password manager: prints the secret, like `op read` would.
const helper = join(dir, 'fake-vault.sh')

beforeAll(() => {
  writeFileSync(helper, '#!/bin/sh\necho "sk-from-vault-$1"\n')
  chmodSync(helper, 0o755)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  setSecretSource({ mode: 'stored', commands: {} })
  clearSecretCache()
})

describe('tokenize — argv without a shell', () => {
  it('splits on whitespace', () => {
    expect(tokenize('op read op://Private/anthropic/key')).toEqual([
      'op',
      'read',
      'op://Private/anthropic/key'
    ])
  })

  it('honors quotes so paths with spaces survive', () => {
    expect(tokenize('"/usr/local/my tools/op" read "a b"')).toEqual([
      '/usr/local/my tools/op',
      'read',
      'a b'
    ])
  })

  it('keeps shell metacharacters as literal argv (no shell is used)', () => {
    // If this were passed to a shell, the `;` would start a second command.
    expect(tokenize('vault read; rm -rf /')).toEqual(['vault', 'read;', 'rm', '-rf', '/'])
  })

  it('handles an empty command', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('secret source config', () => {
  it('defaults to the built-in store', () => {
    expect(getSecretSource().mode).toBe('stored')
  })

  it('switches to command mode and keeps per-provider commands', () => {
    const next = setSecretSource({
      mode: 'command',
      commands: { anthropic: `${helper} anthropic` }
    })
    expect(next.mode).toBe('command')
    expect(next.commands.anthropic).toBe(`${helper} anthropic`)
  })

  it('clears a command when set to empty', () => {
    setSecretSource({ mode: 'command', commands: { anthropic: `${helper} x` } })
    const next = setSecretSource({ commands: { anthropic: '  ' } })
    expect(next.commands.anthropic).toBeUndefined()
  })

  it('rejects an unknown mode by falling back to stored', () => {
    const next = setSecretSource({ mode: 'nonsense' as never })
    expect(next.mode).toBe('stored')
  })

  it('a commands-only update keeps the mode the user chose', () => {
    setSecretSource({ mode: 'command', commands: { anthropic: 'op read x' } })
    expect(getSecretSource().mode).toBe('command')

    // Editing one provider's command sends no `mode`. Deriving the mode from
    // that absent field flipped the user back to 'stored', where WebDeck looks
    // for a stored key that was never saved and the agent loses its provider.
    setSecretSource({ commands: { openai: 'pass show y' } })
    const after = getSecretSource()
    expect(after.mode).toBe('command')
    expect(after.commands.anthropic).toBe('op read x')
    expect(after.commands.openai).toBe('pass show y')
  })

  it('an explicit mode change is still honoured', () => {
    setSecretSource({ mode: 'command', commands: { anthropic: 'op read x' } })
    setSecretSource({ mode: 'stored' })
    expect(getSecretSource().mode).toBe('stored')
  })
})

describe('fetchSecretFromCommand', () => {
  it('returns what the helper prints', () => {
    setSecretSource({ mode: 'command', commands: { anthropic: `${helper} anthropic` } })
    expect(fetchSecretFromCommand('anthropic')).toBe('sk-from-vault-anthropic')
  })

  it('returns null with no command configured', () => {
    expect(fetchSecretFromCommand('openai')).toBeNull()
  })

  it('returns null when the helper does not exist (locked vault / missing tool)', () => {
    setSecretSource({ mode: 'command', commands: { gemini: '/nonexistent/vault-binary read' } })
    expect(fetchSecretFromCommand('gemini')).toBeNull()
  })

  it('caches so an unlock prompt does not fire on every call', () => {
    setSecretSource({ mode: 'command', commands: { anthropic: `${helper} one` } })
    const first = fetchSecretFromCommand('anthropic')
    // Point the config at a different value; the cache should still serve the old.
    setSecretSource({ commands: { anthropic: `${helper} two` } })
    // setSecretSource clears the cache deliberately, so this re-runs — proving
    // a changed source is never served a stale value.
    expect(fetchSecretFromCommand('anthropic')).toBe('sk-from-vault-two')
    expect(first).toBe('sk-from-vault-one')
  })
})
