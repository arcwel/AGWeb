import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { CoreEnv } from './env'
import { nodeSecretStore } from './node-keystore'

/**
 * Where this core keeps its state. Exported because the CLI needs the same
 * answer before a `CoreEnv` exists, to park the connection handoff file there.
 */
export function resolveUserDataDir(userDataDir?: string): string {
  return userDataDir || process.env.WEBDECK_USER_DATA || join(homedir(), '.webdeck')
}

/**
 * The Node implementation of `CoreEnv` — host facts for `webdeck-core` running
 * as a standalone process, with no Electron. This is what the Chromium fork
 * launches: the same CORE domains, the same registry, host facts from plain
 * Node instead of `app.getPath`/`safeStorage`.
 *
 * Secrets are encrypted by `nodeSecretStore` — AES-256-GCM under a `0600` key
 * file, since a plain Node process has no OS credential store. See that module
 * for exactly what that does and does not protect.
 */
export function nodeCoreEnv(opts: { userDataDir?: string; appDir?: string } = {}): CoreEnv {
  const userDataDir = resolveUserDataDir(opts.userDataDir)
  try {
    mkdirSync(userDataDir, { recursive: true })
  } catch {
    // best-effort; a read/write will surface a real error if the dir is unusable
  }
  return {
    userDataDir,
    homeDir: homedir(),
    appDir: opts.appDir || process.cwd(),
    secrets: nodeSecretStore(userDataDir)
  }
}
