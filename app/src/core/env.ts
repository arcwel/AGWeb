/**
 * `CoreEnv` — the platform seam for webdeck-core.
 *
 * The CORE domains (secrets, settings, terminal, agent, debug, policy, …) need a
 * handful of host facts: where per-user data lives, the user's home dir, the app
 * install root, and an OS-backed secret store. Today those come from Electron
 * (`app.getPath`, `safeStorage`). Under the Chromium fork, `webdeck-core` runs as
 * a plain Node process with no Electron at all — so the domains must not import
 * `electron` directly. They read everything through this injected environment.
 *
 * One `setCoreEnv()` at startup wires the concrete host; the Electron adapter
 * lives in `src/main/core-env.ts`, a future standalone adapter in the core
 * process. Tests inject a fake env and need no Electron mock. This file imports
 * nothing platform-specific, so it runs anywhere Node does.
 */

export interface SecretStore {
  /** Whether an OS keychain is available to encrypt with. */
  isAvailable(): boolean
  /** Encrypt a UTF-8 string to opaque bytes (OS-keychain-backed). */
  encryptString(plain: string): Buffer
  /** Reverse `encryptString`. */
  decryptString(enc: Buffer): string
}

export interface CoreEnv {
  /** Per-user data dir — settings, secrets, and agent artifacts live here. */
  userDataDir: string
  /** The user's home dir — default cwd for terminals/agents with no workspace. */
  homeDir: string
  /** The app/install root — used to locate vendored tools (e.g. the DAP server). */
  appDir: string
  /** OS-keychain-backed secret encryption. */
  secrets: SecretStore
}

let current: CoreEnv | null = null

/** Wire the host environment. Call once at startup before any domain runs. */
export function setCoreEnv(env: CoreEnv): void {
  current = env
}

/** The wired environment. Throws if `setCoreEnv` has not run — a startup bug. */
export function coreEnv(): CoreEnv {
  if (!current) {
    throw new Error('CoreEnv not initialized — call setCoreEnv() at startup')
  }
  return current
}
