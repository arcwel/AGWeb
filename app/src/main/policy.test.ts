import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { PolicyDeniedInfo, PolicyPromptInfo, PolicyStatus } from '@shared/ipc'
import { setCoreEnv } from '../core/env'
import {
  decide,
  checkAction,
  setPolicyMode,
  setCustomRules,
  initPolicy,
  respondToPolicyPrompt,
  setPolicyBroadcaster,
  setPolicyDenyNotifier
} from './policy'

// The permission gate is the security spine: every agent file-write, command,
// and navigation passes through decide()/checkAction(). These tests exercise the
// mode matrix and the confirm/deny/grant paths directly — possible only because
// policy.ts now reads its host facts through the injected CoreEnv (no Electron).

const dir = join(tmpdir(), `wd-policy-test-${process.pid}`)

// A stand-in for the shell window checkAction sends confirm prompts to. The
// callback captures the prompt so a test can answer it via respondToPolicyPrompt.
function fakeWindow(onPrompt?: (p: PolicyPromptInfo) => void, destroyed = false): BrowserWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: (_channel: string, prompt: PolicyPromptInfo) => onPrompt?.(prompt) }
  } as unknown as BrowserWindow
}

const flush = (): Promise<void> => Promise.resolve()

beforeAll(() => {
  mkdirSync(dir, { recursive: true })
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
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  // Known baseline: review mode also clears any "don't ask again" grants.
  setPolicyMode('review')
})

describe('decide — the mode verdict', () => {
  it('secure mode confirms everything, local targets included (P2-1)', () => {
    setPolicyMode('secure')
    expect(decide('file_write', 'a.txt')).toBe('confirm')
    expect(decide('command', 'ls')).toBe('confirm')
    expect(decide('browser_navigate', 'http://localhost:3000')).toBe('confirm')
  })

  it('review auto-allows file writes, confirms commands and remote navigation', () => {
    setPolicyMode('review')
    expect(decide('file_write', 'a.txt')).toBe('allow')
    expect(decide('command', 'ls')).toBe('confirm')
    expect(decide('browser_navigate', 'https://evil.example')).toBe('confirm')
  })

  it('treats localhost/data:/file: navigation as allowed outside secure mode', () => {
    setPolicyMode('review')
    expect(decide('browser_navigate', 'http://127.0.0.1:5173')).toBe('allow')
    expect(decide('browser_navigate', 'data:text/html,<h1>hi</h1>')).toBe('allow')
    expect(decide('browser_navigate', 'file:///tmp/x.html')).toBe('allow')
    expect(decide('browser_navigate', 'about:blank')).toBe('allow')
  })

  it('agent mode runs free except non-allowlisted navigation', () => {
    setCustomRules({
      fileWrites: 'allow',
      commands: 'allow',
      navigation: 'confirm',
      allowedHosts: ['example.com']
    })
    setPolicyMode('agent')
    expect(decide('file_write', 'a.txt')).toBe('allow')
    expect(decide('command', 'rm x')).toBe('allow')
    expect(decide('browser_navigate', 'https://api.example.com/v1')).toBe('allow') // subdomain
    expect(decide('browser_navigate', 'https://evil.example')).toBe('confirm')
  })

  it('custom mode follows the per-kind rules, allowlist overriding navigation', () => {
    setCustomRules({
      fileWrites: 'deny',
      commands: 'confirm',
      navigation: 'deny',
      allowedHosts: ['trusted.dev']
    })
    setPolicyMode('custom')
    expect(decide('file_write', 'a.txt')).toBe('deny')
    expect(decide('command', 'ls')).toBe('confirm')
    expect(decide('browser_navigate', 'https://untrusted.io')).toBe('deny')
    expect(decide('browser_navigate', 'https://trusted.dev/x')).toBe('allow')
  })
})

describe('checkAction — the full gate', () => {
  it('allows an auto-approved action without prompting', async () => {
    setPolicyMode('review')
    let prompted = false
    initPolicy(fakeWindow(() => (prompted = true)))
    expect(await checkAction('file_write', 'a.txt', 's1')).toBe(true)
    expect(prompted).toBe(false)
  })

  it('resolves a confirm through the inline prompt', async () => {
    setPolicyMode('review')
    let prompt: PolicyPromptInfo | null = null
    initPolicy(fakeWindow((p) => (prompt = p)))
    const decision = checkAction('command', 'ls', 's1')
    await flush()
    expect(prompt).not.toBeNull()
    respondToPolicyPrompt(prompt!.id, true, false)
    expect(await decision).toBe(true)
  })

  it('denies when the user rejects the prompt', async () => {
    setPolicyMode('review')
    let prompt: PolicyPromptInfo | null = null
    initPolicy(fakeWindow((p) => (prompt = p)))
    const decision = checkAction('command', 'rm -rf /', 's1')
    await flush()
    respondToPolicyPrompt(prompt!.id, false, false)
    expect(await decision).toBe(false)
  })

  it('fails closed when the shell window is gone', async () => {
    initPolicy(fakeWindow(undefined, /* destroyed */ true))
    expect(await checkAction('command', 'ls', 's1')).toBe(false)
  })

  it('honors a "don\'t ask again" grant for the same session+kind', async () => {
    setPolicyMode('review')
    let prompt: PolicyPromptInfo | null = null
    let promptCount = 0
    initPolicy(
      fakeWindow((p) => {
        prompt = p
        promptCount++
      })
    )
    const first = checkAction('command', 'ls', 's1')
    await flush()
    respondToPolicyPrompt(prompt!.id, true, /* always */ true)
    expect(await first).toBe(true)
    // A second command in the same session is auto-allowed — no new prompt.
    expect(await checkAction('command', 'pwd', 's1')).toBe(true)
    expect(promptCount).toBe(1)
  })

  it('does not leak a grant across sessions', async () => {
    setPolicyMode('review')
    let prompt: PolicyPromptInfo | null = null
    let promptCount = 0
    initPolicy(
      fakeWindow((p) => {
        prompt = p
        promptCount++
      })
    )
    const first = checkAction('command', 'ls', 's1')
    await flush()
    respondToPolicyPrompt(prompt!.id, true, true)
    await first
    // A different session must prompt again.
    const other = checkAction('command', 'ls', 's2')
    await flush()
    expect(promptCount).toBe(2)
    respondToPolicyPrompt(prompt!.id, false, false)
    expect(await other).toBe(false)
  })

  it('clears session grants when the policy tightens (P1-4)', async () => {
    setPolicyMode('review')
    let prompt: PolicyPromptInfo | null = null
    let promptCount = 0
    initPolicy(
      fakeWindow((p) => {
        prompt = p
        promptCount++
      })
    )
    const first = checkAction('command', 'ls', 's1')
    await flush()
    respondToPolicyPrompt(prompt!.id, true, true)
    await first
    // Tightening the mode must void the grant taken under the old rules.
    setPolicyMode('secure')
    const after = checkAction('command', 'ls', 's1')
    await flush()
    expect(promptCount).toBe(2) // prompted again despite the earlier grant
    respondToPolicyPrompt(prompt!.id, false, false)
    expect(await after).toBe(false)
  })

  it('broadcasts mode and rule changes to a registered broadcaster (P2-13)', () => {
    const seen: PolicyStatus[] = []
    setPolicyBroadcaster((s) => seen.push(s))
    try {
      setPolicyMode('agent')
      expect(seen.at(-1)?.mode).toBe('agent')
      setCustomRules({
        fileWrites: 'deny',
        commands: 'allow',
        navigation: 'confirm',
        allowedHosts: []
      })
      expect(seen.at(-1)?.custom.fileWrites).toBe('deny')
    } finally {
      setPolicyBroadcaster(() => {}) // don't leak into other tests
    }
  })

  it('notifies a deny listener when an action is auto-denied (P2-13)', async () => {
    const denials: PolicyDeniedInfo[] = []
    setPolicyDenyNotifier((info) => denials.push(info))
    try {
      setCustomRules({
        fileWrites: 'deny',
        commands: 'deny',
        navigation: 'deny',
        allowedHosts: []
      })
      setPolicyMode('custom')
      initPolicy(fakeWindow())
      expect(await checkAction('command', 'rm -rf /', 's1')).toBe(false)
      expect(denials.at(-1)).toEqual({ kind: 'command', detail: 'rm -rf /', byUser: false })
    } finally {
      setPolicyDenyNotifier(() => {})
    }
  })

  it('lets an explicit deny outrank everything, without prompting', async () => {
    setCustomRules({
      fileWrites: 'deny',
      commands: 'deny',
      navigation: 'deny',
      allowedHosts: []
    })
    setPolicyMode('custom')
    let prompted = false
    initPolicy(fakeWindow(() => (prompted = true)))
    expect(await checkAction('command', 'rm -rf /', 's1')).toBe(false)
    expect(await checkAction('file_write', 'a.txt', 's1')).toBe(false)
    expect(prompted).toBe(false)
  })
})
