import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The boundary test for the agent's authority (13.8c/f).
 *
 * Every tool the model can call is either read-only or passes the policy gate
 * before it does anything. This reads `agent.ts` and fails when a tool escapes:
 * a new `case` in `executeTool` with no `gate(` / `gateInteraction(` call and
 * no entry in READ_ONLY below. Adding a name to READ_ONLY is a decision someone
 * has to justify in review — the list is the allowlist, not a way to go quiet.
 *
 * It also pins two facts the prompt-injection story rests on: the model has no
 * tool that touches the policy itself, and every declared tool has a handler
 * (an undeclared handler would be reachable without ever being reviewed).
 */

const SOURCE = readFileSync(join(__dirname, 'agent.ts'), 'utf8')

/** Tools that read or observe and never write, run, navigate or type. */
const READ_ONLY = new Set([
  'read_file',
  'list_dir',
  'search',
  'stop_command', // ends a command the gate already allowed
  'browser_read',
  'browser_wait_for',
  'browser_inspect',
  'browser_set_viewport',
  'browser_record_start', // recording writes nothing until record_stop, which is gated
  'editor_list_commands'
])

/** Names declared to the model. */
function declaredTools(): string[] {
  const start = SOURCE.indexOf('const EXEC_TOOLS')
  const end = SOURCE.indexOf('\n]', start)
  return [...SOURCE.slice(start, end).matchAll(/^\s{4}name: '([a-z_]+)'/gm)].map((m) => m[1])
}

/** `case 'tool': { … }` bodies inside executeTool, keyed by tool name. */
function handlers(): Map<string, string> {
  const start = SOURCE.indexOf('async function executeTool(')
  const body = SOURCE.slice(SOURCE.indexOf('switch (name) {', start))
  const out = new Map<string, string>()
  const re = /\n {4}case '([a-z_]+)':/g
  const marks = [...body.matchAll(re)].map((m) => ({ name: m[1], at: m.index! }))
  const defaultAt = body.search(/\n {4}default:/)
  marks.forEach((mark, i) => {
    const next = marks[i + 1]?.at ?? defaultAt
    out.set(mark.name, body.slice(mark.at, next))
  })
  return out
}

describe('agent tools and the policy gate', () => {
  const tools = declaredTools()
  const cases = handlers()

  it('finds the tool table and the handlers', () => {
    expect(tools.length).toBeGreaterThan(15)
    expect(cases.size).toBeGreaterThan(15)
  })

  it('has a handler for every declared tool, and no handler for an undeclared one', () => {
    for (const tool of tools) expect([...cases.keys()], `handler for ${tool}`).toContain(tool)
    for (const name of cases.keys()) expect(tools, `declaration for ${name}`).toContain(name)
  })

  it('gates every tool that can write, run, navigate, type or leave the machine', () => {
    for (const [name, body] of cases) {
      if (READ_ONLY.has(name)) continue
      expect(
        /\b(gate|gateInteraction)\(/.test(body),
        `${name} must call gate()/gateInteraction() before acting`
      ).toBe(true)
    }
  })

  it('gives the model no tool over the policy itself', () => {
    for (const tool of tools) expect(tool).not.toMatch(/policy|permission|mode|approve|grant/)
    // Nor does any handler reach into the policy's setters.
    for (const [name, body] of cases) {
      expect(body, name).not.toMatch(/setPolicyMode|setCustomRules|respondToPolicyPrompt/)
    }
  })

  it('keeps read-only tools free of side-effecting calls', () => {
    for (const name of READ_ONLY) {
      const body = cases.get(name) ?? ''
      expect(body, name).not.toMatch(/writeFile|spawn\(|\.navigate\(|\.click\(|\.type\(/)
    }
  })
})
