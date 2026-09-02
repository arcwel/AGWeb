import { execFileSync } from 'node:child_process'
import { JsonStore } from './json-store'

/**
 * Where a provider API key comes from.
 *
 * Two sources, and the choice is a real security trade-off rather than a
 * preference:
 *
 * - **`stored`** (default) — WebDeck holds the key, encrypted. Under Electron
 *   that is the OS credential store (`safeStorage`); in the standalone core it
 *   is AES-256-GCM under a `0600` key file. Convenient, and the key is at rest
 *   on this machine.
 * - **`command`** — WebDeck holds *nothing*. It runs a command you configure
 *   (`op read op://vault/anthropic/key`, `pass show ai/anthropic`, `security
 *   find-generic-password -w -s anthropic`, `vault read -field=key ...`) and
 *   uses the value it prints. This is the stronger option: your password
 *   manager already gates access on an unlocked session, audits reads, rotates,
 *   and syncs — and a WebDeck data directory that leaks contains no key at all.
 *
 * This is the same shape as git's `credential.helper`, and for the same reason:
 * a tool that needs a secret is better off asking the system that specializes
 * in secrets than becoming a second place they live.
 *
 * The command is executed **without a shell** (argv is tokenized here), so
 * shell metacharacters in a configured command are inert.
 *
 * SECURITY: this configuration is deliberately excluded from WebDeck Sync. It
 * names a command to execute, so accepting it from a shared sync file would
 * hand anyone with write access to that folder arbitrary code execution.
 */

export type SecretSourceMode = 'stored' | 'command'

export interface SecretSourceConfig {
  mode: SecretSourceMode
  /** Per-provider command line, e.g. `op read op://Private/anthropic/key`. */
  commands: Record<string, string>
}

const DEFAULTS: SecretSourceConfig = { mode: 'stored', commands: {} }

const store = new JsonStore<SecretSourceConfig>('secret-source', DEFAULTS)

/** How long a fetched secret is held in memory before the command runs again. */
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { value: string; at: number }>()

export function getSecretSource(): SecretSourceConfig {
  const saved = store.read()
  return {
    mode: saved.mode === 'command' ? 'command' : 'stored',
    commands: saved.commands ?? {}
  }
}

export function setSecretSource(next: Partial<SecretSourceConfig>): SecretSourceConfig {
  const current = getSecretSource()
  // Only change the mode when the caller actually sent one. Deriving it from an
  // absent field meant that editing a single provider's command — a `commands`-
  // only update — silently flipped the user back to 'stored', where WebDeck
  // looks for a key it was never given and the agent loses its provider.
  const mode: SecretSourceMode =
    next.mode === undefined ? current.mode : next.mode === 'command' ? 'command' : 'stored'
  const commands = { ...current.commands }
  for (const [provider, command] of Object.entries(next.commands ?? {})) {
    if (typeof command !== 'string') continue
    if (command.trim() === '') delete commands[provider]
    else commands[provider] = command.trim()
  }
  store.write({ mode, commands })
  cache.clear() // a changed source must not serve a value fetched under the old one
  return getSecretSource()
}

/**
 * Split a command line into argv, honouring single/double quotes. No shell is
 * involved, so `;`, `|`, `$(…)` and friends are literal characters.
 */
export function tokenize(command: string): string[] {
  const argv: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started || current) argv.push(current)
      current = ''
      started = false
      continue
    }
    current += char
  }
  if (started || current) argv.push(current)
  return argv
}

/**
 * Run the configured command for a provider and return what it printed.
 * Returns null when nothing is configured or the command fails — the caller
 * then falls back to the stored key or the environment.
 */
export function fetchSecretFromCommand(provider: string): string | null {
  const { commands } = getSecretSource()
  const command = commands[provider]
  if (!command) return null

  const cached = cache.get(provider)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

  const argv = tokenize(command)
  if (argv.length === 0) return null
  try {
    const output = execFileSync(argv[0], argv.slice(1), {
      encoding: 'utf8',
      timeout: 30_000, // a password manager may prompt for a touch/unlock
      stdio: ['ignore', 'pipe', 'ignore'], // never surface the tool's stderr
      windowsHide: true
    })
    // Take the first non-empty line: helpers often print a trailing newline,
    // and some print a hint after the value.
    const value = output
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim()
    if (!value) return null
    cache.set(provider, { value, at: Date.now() })
    return value
  } catch {
    // Locked vault, missing binary, wrong path — treat as "no key from here".
    return null
  }
}

/** Drop cached secrets (e.g. after the user locks their vault). */
export function clearSecretCache(): void {
  cache.clear()
}
