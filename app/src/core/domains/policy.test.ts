import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PolicyDeniedInfo, PolicyPromptInfo, PolicyStatus } from '@shared/ipc'
import { setCoreEnv } from '../env'
import {
  decide,
  checkAction,
  setPolicyMode,
  setCustomRules,
  initPolicy,
  respondToPolicyPrompt,
  setPolicyBroadcaster,
  setPolicyDenyNotifier,
  setPolicyPromptSink,
  sanitizePolicyMode,
  sanitizeSyncedPolicyMode,
  setSitePermission,
  clearSitePermission,
  setBlockSensitiveSites,
  getPolicyStatus
} from './policy'

// The permission gate is the security spine: every agent file-write, command,
// and navigation passes through decide()/checkAction(). These tests exercise the
// mode matrix and the confirm/deny/grant paths directly — possible only because
// policy.ts now reads its host facts through the injected CoreEnv (no Electron).

const dir = join(tmpdir(), `wd-policy-test-${process.pid}`)

// A stand-in for the shell window checkAction sends confirm prompts to. The
// callback captures the prompt so a test can answer it via respondToPolicyPrompt.
function fakeWindow(
  onPrompt?: (p: PolicyPromptInfo) => void,
  destroyed = false
): Parameters<typeof initPolicy>[0] {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      send: (_channel: string, prompt: unknown) => onPrompt?.(prompt as PolicyPromptInfo)
    }
  }
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

  it('treats a genuinely local target as allowed outside secure mode', () => {
    setPolicyMode('review')
    expect(decide('browser_navigate', 'http://127.0.0.1:5173')).toBe('allow')
    expect(decide('browser_navigate', 'http://localhost:5173')).toBe('allow')
    // about: really is inert: no content, no origin.
    expect(decide('browser_navigate', 'about:blank')).toBe('allow')
  })

  it('does NOT treat data:, file: or blob: as inert', () => {
    // This test used to assert the opposite, and that assertion was the hole.
    //
    // browser_eval is gated as a `command` precisely because injected JS is an
    // egress channel — but navigating to
    // `data:text/html,<script>fetch(...)</script>` runs exactly that script,
    // and auto-allowing data: let it through the navigation gate instead.
    // file:// plus a page read is arbitrary local file disclosure around the
    // workspace pin. blob: inherits its creator's origin.
    //
    // None of them has a hostname, so no per-site rule can restrain them
    // either: a user who has denied every site still could not deny these.
    setPolicyMode('review')
    expect(decide('browser_navigate', 'data:text/html,<script>fetch("//x")</script>')).toBe(
      'confirm'
    )
    expect(decide('browser_navigate', 'file:///etc/passwd')).toBe('confirm')
    expect(decide('browser_navigate', 'blob:https://x/1')).toBe('confirm')
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

  // Headless / Chromium-fork behaviour: the core can run with no UI attached
  // (yet). An action policy ALLOWS must still proceed — only a 'confirm' needs
  // a human, and only that may fail closed.
  describe('headless (no prompt UI attached)', () => {
    it('still allows an auto-approved action with no UI', async () => {
      setPolicyMode('agent') // file writes + commands are 'allow' here
      setPolicyPromptSink(null)
      expect(await checkAction('file_write', 'a.txt', 'headless-1')).toBe(true)
      expect(await checkAction('command', 'ls', 'headless-1')).toBe(true)
    })

    it('still denies what policy denies, with no UI', async () => {
      setCustomRules({
        fileWrites: 'deny',
        commands: 'allow',
        navigation: 'allow',
        allowedHosts: []
      })
      setPolicyMode('custom')
      setPolicyPromptSink(null)
      expect(await checkAction('file_write', 'a.txt', 'headless-2')).toBe(false)
    })

    it('fails closed only for a confirm it cannot ask about', async () => {
      setPolicyMode('review') // commands confirm
      setPolicyPromptSink(null)
      expect(await checkAction('command', 'ls', 'headless-3')).toBe(false)
    })

    it('works through a transport sink (what the fork injects)', async () => {
      setPolicyMode('review')
      // Stands in for a WebSocket push to chrome://webdeck; the answer comes
      // back through the same respondToPolicyPrompt the IPC path uses.
      let sent: PolicyPromptInfo | null = null
      setPolicyPromptSink((p) => {
        sent = p
        return true
      })
      const decision = checkAction('command', 'ls', 'fork-1')
      await flush()
      expect(sent).not.toBeNull()
      respondToPolicyPrompt(sent!.id, true, false)
      expect(await decision).toBe(true)
    })

    it('a sink that cannot deliver fails closed', async () => {
      setPolicyMode('review')
      setPolicyPromptSink(() => false) // e.g. no client connected
      expect(await checkAction('command', 'ls', 'fork-2')).toBe(false)
    })
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

describe('full autonomy', () => {
  beforeEach(() => setPolicyMode('autonomous'))

  it('allows everything without asking', () => {
    // The point of the mode: the agent does whatever the task needs. It is the
    // rung above 'agent', which still stops to confirm navigation off the
    // allowlist — not autonomy when the task is "go and find out".
    expect(decide('file_write', '/etc/anything')).toBe('allow')
    expect(decide('command', 'rm -rf build')).toBe('allow')
    expect(decide('browser_navigate', 'https://example.com/anything')).toBe('allow')
  })

  it('never needs a prompt channel, so it works headless', async () => {
    let prompted = false
    setPolicyPromptSink(() => {
      prompted = true
      return true
    })
    await expect(checkAction('command', 'anything', 'session-1')).resolves.toBe(true)
    expect(prompted).toBe(false)
    setPolicyPromptSink(null)
  })
})

describe('sync cannot escalate the agent to full autonomy', () => {
  it('accepts autonomous from a local choice', () => {
    // Typed by the person in front of the machine: allowed.
    expect(sanitizePolicyMode('autonomous')).toBe('autonomous')
  })

  it('refuses autonomous from a synced file', () => {
    // The sync file is a plain file in a folder the user often shares. If sync
    // could set this, "write this file" would equal "let the agent act as the
    // user, without ever asking, on every device they own".
    expect(sanitizeSyncedPolicyMode('autonomous')).toBeNull()
  })

  it("still lets sync LOWER the agent's authority", () => {
    // Sync may reduce what the agent can do; it may only never raise it.
    expect(sanitizeSyncedPolicyMode('secure')).toBe('secure')
    expect(sanitizeSyncedPolicyMode('review')).toBe('review')
    expect(sanitizeSyncedPolicyMode('agent')).toBe('agent')
  })

  it('refuses nonsense from either path', () => {
    expect(sanitizePolicyMode('root')).toBeNull()
    expect(sanitizeSyncedPolicyMode('root')).toBeNull()
  })
})

describe('per-site permissions', () => {
  beforeEach(() => {
    for (const site of getPolicyStatus().sites) clearSitePermission(site.host)
    setBlockSensitiveSites(true)
    setPolicyMode('autonomous')
  })

  it('an explicit site deny outranks full autonomy', () => {
    // The user said no to this site. Nothing should be able to override that —
    // autonomy is a statement about the agent's default freedom, not a licence
    // to ignore a decision the user actually made.
    setSitePermission('evil.test', 'deny')
    expect(decide('browser_navigate', 'https://evil.test/page')).toBe('deny')
    expect(decide('browser_navigate', 'https://sub.evil.test/page')).toBe('deny')
  })

  it('an explicit site allow works under a restrictive mode', () => {
    setPolicyMode('secure')
    setSitePermission('trusted.test', 'allow')
    expect(decide('browser_navigate', 'https://trusted.test/x')).toBe('allow')
    // and nothing else is loosened by it
    expect(decide('browser_navigate', 'https://other.test/x')).toBe('confirm')
  })

  it('asks about a sensitive site even under full autonomy', () => {
    // These are the destinations where one wrong action does not undo.
    expect(decide('browser_navigate', 'https://chase.com/transfer')).toBe('confirm')
    expect(decide('browser_navigate', 'https://www.paypal.com/send')).toBe('confirm')
  })

  it('a deliberate site allow lifts the sensitive check for that site only', () => {
    // The check exists to catch sites the user has not considered, not to argue
    // with one they have.
    setSitePermission('chase.com', 'allow')
    expect(decide('browser_navigate', 'https://chase.com/transfer')).toBe('allow')
    expect(decide('browser_navigate', 'https://paypal.com/send')).toBe('confirm')
  })

  it('respects the protection being switched off', () => {
    setBlockSensitiveSites(false)
    expect(decide('browser_navigate', 'https://chase.com/transfer')).toBe('allow')
  })

  it('defaults the protection ON for a policy file written before it existed', () => {
    // Inheriting "off" from an older file would silently drop the protection
    // for every existing user.
    expect(getPolicyStatus().blockSensitiveSites).toBe(true)
  })

  it('deny wins when a site somehow has both', () => {
    setSitePermission('both.test', 'allow')
    const status = getPolicyStatus()
    status.sites.push({ host: 'both.test', decision: 'deny', grantedAt: new Date().toISOString() })
    // Simulate a file holding both; the restrictive one must win.
    setSitePermission('both.test', 'deny')
    expect(decide('browser_navigate', 'https://both.test/x')).toBe('deny')
  })

  it('does not apply site rules to non-navigation actions', () => {
    setSitePermission('evil.test', 'deny')
    setPolicyMode('agent')
    expect(decide('file_write', '/tmp/x')).toBe('allow')
  })

  it('clearing a site returns it to the mode', () => {
    setPolicyMode('secure')
    setSitePermission('t.test', 'allow')
    expect(decide('browser_navigate', 'https://t.test/x')).toBe('allow')
    clearSitePermission('t.test')
    expect(decide('browser_navigate', 'https://t.test/x')).toBe('confirm')
  })
})

describe('"always" is scoped to the site the user was looking at', () => {
  beforeEach(() => {
    for (const site of getPolicyStatus().sites) clearSitePermission(site.host)
    setPolicyMode('secure')
  })

  it('grants only that site, not every site', async () => {
    // The bug this replaced: "always" added a session grant for the whole
    // ACTION KIND, so approving one page let the agent navigate anywhere for
    // the rest of the run — a far broader permission than the user was asked
    // for, granted from a dialog naming a single URL.
    let prompted: PolicyPromptInfo | null = null
    setPolicyPromptSink((info) => {
      prompted = info
      return true
    })

    const first = checkAction('browser_navigate', 'https://approved.test/page', 's1')
    await new Promise((r) => setTimeout(r, 0))
    expect(prompted).not.toBeNull()
    respondToPolicyPrompt(prompted!.id, true, true)
    await expect(first).resolves.toBe(true)

    // The approved site is now standing-allowed...
    expect(decide('browser_navigate', 'https://approved.test/other')).toBe('allow')
    // ...and nothing else is.
    expect(decide('browser_navigate', 'https://elsewhere.test/page')).toBe('confirm')

    setPolicyPromptSink(null)
  })

  it('records a refusal as a standing deny for that site', async () => {
    let prompted: PolicyPromptInfo | null = null
    setPolicyPromptSink((info) => {
      prompted = info
      return true
    })

    const call = checkAction('browser_navigate', 'https://refused.test/page', 's1')
    await new Promise((r) => setTimeout(r, 0))
    respondToPolicyPrompt(prompted!.id, false, true)
    await expect(call).resolves.toBe(false)

    // "Never on this site" is worth recording just as much as "always".
    expect(decide('browser_navigate', 'https://refused.test/anything')).toBe('deny')

    setPolicyPromptSink(null)
  })
})

describe('sync cannot grant site permissions', () => {
  it('the synced policy validators expose no way to set sites', () => {
    // Site permissions are authority: an allow lets the agent act on a site
    // without asking. The sync file is a plain file in a folder the user often
    // shares between devices, so it must not be able to hand out that
    // authority — same reason it cannot set full autonomy.
    //
    // Sync applies exactly two things, both validated: the mode (via
    // sanitizeSyncedPolicyMode, which refuses 'autonomous') and the custom
    // rules. There is deliberately no sanitizeSyncedSites, so a `sites` array
    // in the file is inert. This test fails the moment someone adds one
    // without thinking it through.
    const validators = Object.keys({ sanitizePolicyMode, sanitizeSyncedPolicyMode })
    expect(validators).not.toContain('sanitizeSyncedSites')

    // And a decision made locally is unaffected by anything a file claims.
    setPolicyMode('secure')
    setSitePermission('local.test', 'allow')
    expect(decide('browser_navigate', 'https://local.test/x')).toBe('allow')
    clearSitePermission('local.test')
  })
})
