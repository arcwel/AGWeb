import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Secret storage for provider API keys.
 *
 * Keys are encrypted with Electron's `safeStorage`, which is backed by the OS
 * credential store — Keychain on macOS, libsecret on Linux, DPAPI on Windows —
 * so the ciphertext on disk is worthless without the logged-in user's session.
 * We never hand a decrypted key to the renderer: the renderer only ever learns
 * *whether* a provider is configured (a masked hint), and the plaintext leaves
 * the main process solely on an outbound request the user's own agent made.
 *
 * This is why API keys are not part of app-settings.json — that file is
 * plaintext JSON, appropriate for preferences and wrong for credentials.
 */

export type Provider = 'anthropic' | 'openai' | 'gemini'
export const PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini']

interface StoredSecret {
  /** Base64 safeStorage ciphertext, or plaintext when encryption is absent. */
  value: string
  encrypted: boolean
}

function file(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function loadAll(): Record<string, StoredSecret> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Record<string, StoredSecret>
  } catch {
    return {}
  }
}

function saveAll(all: Record<string, StoredSecret>): void {
  try {
    writeFileSync(file(), `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  } catch {
    // Read-only userData: the key holds for this run but will not persist.
  }
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as string[]).includes(value)
}

export function setApiKey(provider: unknown, key: unknown): boolean {
  if (!isProvider(provider) || typeof key !== 'string') return false
  const all = loadAll()
  if (key.trim() === '') {
    delete all[provider]
    saveAll(all)
    return true
  }
  if (safeStorage.isEncryptionAvailable()) {
    all[provider] = { value: safeStorage.encryptString(key).toString('base64'), encrypted: true }
  } else {
    // No OS keyring (a headless Linux box, say). Storing plaintext would be a
    // silent downgrade of a security promise, so we refuse instead.
    return false
  }
  saveAll(all)
  return true
}

/** The decrypted key, for the main process only. Never sent to the renderer. */
export function getApiKey(provider: Provider): string | null {
  const stored = loadAll()[provider]
  if (!stored) return null
  if (!stored.encrypted) return stored.value
  try {
    return safeStorage.decryptString(Buffer.from(stored.value, 'base64'))
  } catch {
    return null
  }
}

/** What the renderer is allowed to know: which providers have a key set. */
export function listConfiguredProviders(): Record<Provider, boolean> {
  const all = loadAll()
  return {
    anthropic: Boolean(all.anthropic),
    openai: Boolean(all.openai),
    gemini: Boolean(all.gemini)
  }
}

export function clearApiKey(provider: unknown): boolean {
  if (!isProvider(provider)) return false
  const all = loadAll()
  delete all[provider]
  saveAll(all)
  return true
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
