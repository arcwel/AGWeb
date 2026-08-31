import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SecretStore } from './env'

/**
 * A file-backed secret store for `webdeck-core` running outside Electron.
 *
 * Electron's `safeStorage` hands encryption to the OS credential store; a plain
 * Node process has no such thing without a native module, and `secrets.ts`
 * (correctly) refuses to write plaintext. So this encrypts with AES-256-GCM
 * under a 32-byte key kept in a `0600` file beside the data.
 *
 * **What this does and does not protect.** It protects the ciphertext wherever
 * it travels *without* the key file: a copied or cloud-synced `secrets.json`, a
 * backup, a support bundle, an image of the data directory. It does **not**
 * protect against an attacker who can already read the whole user-data directory
 * as this user — they get the key file too. That is strictly weaker than an OS
 * keychain, which can require a live unlocked session. It is strictly stronger
 * than the alternatives available here (plaintext, or storing nothing at all).
 *
 * When the fork supplies a real OS keyring binding, swap this implementation out
 * — `SecretStore` is the only contract the secrets domain knows about.
 */

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

function keyPath(userDataDir: string): string {
  return join(userDataDir, 'keystore.key')
}

/** Load the local key, creating it (0600) on first use. */
function loadOrCreateKey(userDataDir: string): Buffer {
  const path = keyPath(userDataDir)
  if (existsSync(path)) {
    const existing = readFileSync(path)
    if (existing.length === KEY_BYTES) return existing
    // A truncated or corrupt key can't decrypt anything; refuse rather than
    // silently rotating it and stranding every stored secret.
    throw new Error(`keystore key at ${path} is malformed (${existing.length} bytes)`)
  }
  const key = randomBytes(KEY_BYTES)
  writeFileSync(path, key, { mode: 0o600 })
  try {
    chmodSync(path, 0o600) // umask can widen the create mode
  } catch {
    // best effort; the file exists and holds the key either way
  }
  return key
}

export function nodeSecretStore(userDataDir: string): SecretStore {
  let cached: Buffer | null = null
  const key = (): Buffer => {
    if (!cached) cached = loadOrCreateKey(userDataDir)
    return cached
  }

  return {
    isAvailable: () => {
      try {
        key()
        return true
      } catch {
        return false
      }
    },
    encryptString: (plain) => {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key(), iv)
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      // [iv][tag][ciphertext] — self-describing, so decrypt needs no extra state.
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decryptString: (enc) => {
      if (enc.length < IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short')
      const iv = enc.subarray(0, IV_BYTES)
      const tag = enc.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const body = enc.subarray(IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', key(), iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    }
  }
}
