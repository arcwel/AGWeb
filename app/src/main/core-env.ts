import { app, safeStorage } from 'electron'
import type { CoreEnv } from '../core/env'

/**
 * The Electron implementation of `CoreEnv` — the one place the CORE domains'
 * host facts still come from Electron. Under the Chromium fork this file is
 * replaced by a Node adapter (config-injected paths + a keystore lib); nothing
 * in the domains changes.
 *
 * Paths are resolved lazily via getters so `app.getPath` is only read when a
 * domain actually needs it (always after `app.whenReady`).
 */
export function electronCoreEnv(): CoreEnv {
  return {
    get userDataDir() {
      return app.getPath('userData')
    },
    get homeDir() {
      return app.getPath('home')
    },
    get appDir() {
      return app.getAppPath()
    },
    secrets: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (enc) => safeStorage.decryptString(enc)
    }
  }
}
