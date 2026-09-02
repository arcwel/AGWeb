import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The chrome://webdeck Content Security Policy, held to its promises (13.8f).
 *
 * The policy is set in C++ (`webdeck_ui.cc`, vendored under chromium/patches);
 * nothing at runtime checks it, and a one-line "temporary" loosening would ship
 * silently. This reads the source and fails on the things SECURITY.md says the
 * page never does: eval, remote origins, being framed, unguarded script sinks.
 */

const SOURCE = join(
  __dirname,
  '..',
  '..',
  '..',
  'chromium',
  'patches',
  'chrome',
  'browser',
  'ui',
  'webui',
  'webdeck',
  'webdeck_ui.cc'
)

/** Every string literal handed to OverrideContentSecurityPolicy, concatenated. */
function overrides(source: string): string[] {
  const out: string[] = []
  const re =
    /OverrideContentSecurityPolicy\(\s*network::mojom::CSPDirectiveName::(\w+),\s*((?:"[^"]*"\s*)+)\)/g
  for (const match of source.matchAll(re)) {
    const value = [...match[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('')
    out.push(`${match[1]}: ${value}`)
  }
  return out
}

describe('chrome://webdeck CSP (webdeck_ui.cc)', () => {
  const source = readFileSync(SOURCE, 'utf8')
  const csp = overrides(source)

  it("script-src is the WebUI default plus 'wasm-unsafe-eval', and nothing else", () => {
    // 'wasm-unsafe-eval' permits WebAssembly.instantiate (the TextMate
    // tokenizer and the extension host are wasm) and nothing else; eval() and
    // inline script stay refused. The exact string is pinned so that adding a
    // source — 'unsafe-eval', a remote origin, a hash — is a reviewed change.
    expect(csp).toContain("ScriptSrc: script-src chrome://resources 'self' 'wasm-unsafe-eval';")
    expect(source).not.toMatch(/'unsafe-eval'/)
    expect(source).not.toMatch(/unsafe-inline/)
  })

  it('keeps require-trusted-types-for: only policy *names* are opened up', () => {
    expect(source).not.toMatch(/RequireTrustedTypesFor/)
    expect(csp).toContain('TrustedTypes: trusted-types *;')
  })

  it('reaches only loopback and its own resources — no remote origin anywhere', () => {
    for (const directive of csp) {
      for (const origin of directive.match(/(?:https?|wss?):\/\/[^\s;']+/g) ?? []) {
        expect(origin, directive).toMatch(/^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\*)?$/)
      }
    }
  })

  it('cannot be framed, and frames only loopback dev/slide servers', () => {
    expect(csp).toContain("FrameAncestors: frame-ancestors 'none';")
    const frameSrc = csp.find((d) => d.startsWith('FrameSrc'))
    expect(frameSrc).toBeDefined()
    expect(frameSrc).not.toMatch(/https:/)
  })

  it('runs workers only from itself or same-origin blobs', () => {
    expect(csp).toContain("WorkerSrc: worker-src blob: 'self';")
  })
})
