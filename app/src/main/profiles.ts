import { session } from 'electron'
import type { ClearStorageDataOptions, Session } from 'electron'
import { JsonStore } from './json-store'
import { attachPermissionHandler } from './permissions'
import { attachDownloadHandler } from './downloads'
import { registerExtensionSession } from './extensions'
import { registerEmbedProxySession } from './embed-proxy'
import {
  onAppSettingsChanged,
  readAppSettings,
  type AppSettings,
  type ClearableData
} from './app-settings'

/**
 * Browser profiles — Chrome's "people".
 *
 * Each profile is a persistent Electron session partition, so its cookies,
 * logins, and site data are isolated from every other profile and survive a
 * restart. This is what makes "saved Google accounts, just like Chrome" work:
 * sign into Google in a profile once and it stays signed in, and a second
 * profile can hold a second account with no crossover.
 *
 * Two things beyond isolation are needed for Google sign-in specifically:
 *   1. A real Chrome user-agent. Google refuses OAuth in anything that
 *      advertises itself as an embedded/webview client — Electron's default UA
 *      contains "Electron/…" and "webdeck/…", which trips exactly that block.
 *      We strip both so the session presents as plain Chrome.
 *   2. A persistent partition (the `persist:` prefix), which we always use.
 */

export interface Profile {
  id: string
  name: string
  /** Accent chip in the switcher. */
  color: string
}

interface ProfilesState {
  profiles: Profile[]
  activeId: string
}

const DEFAULT_PROFILE: Profile = { id: 'default', name: 'Personal', color: '#4fd4c4' }

/**
 * Incognito is a built-in, never-persisted profile. Its partition has no
 * `persist:` prefix, so Chromium keeps its cookies and storage in memory only
 * and discards them when the app quits — genuine private browsing.
 */
export const INCOGNITO_ID = 'incognito'
const INCOGNITO_PROFILE: Profile = { id: INCOGNITO_ID, name: 'Incognito', color: '#39404d' }

export function isIncognito(profileId: string): boolean {
  return profileId === INCOGNITO_ID
}

const store = new JsonStore<ProfilesState>('profiles', {
  profiles: [DEFAULT_PROFILE],
  activeId: DEFAULT_PROFILE.id
})

/**
 * Active-profile override for incognito, kept in memory only.
 *
 * Switching into incognito must not be written to disk — otherwise the next
 * launch would start in incognito, which no browser does. So the persisted
 * `activeId` tracks the last *normal* profile, and this shadows it while
 * incognito is active.
 */
let incognitoActive = false

/** The Chromium version the shell is actually built on, for the UA string. */
function chromeVersion(): string {
  return process.versions.chrome
}

/** A believable desktop-Chrome UA with no Electron/app tokens. */
function chromeUserAgent(): string {
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion()}.0.0.0 Safari/537.36`
}

export function partitionFor(profileId: string): string {
  // No `persist:` prefix → an in-memory session that is wiped on quit.
  if (profileId === INCOGNITO_ID) return 'agweb-incognito'
  return profileId === DEFAULT_PROFILE.id ? 'persist:agweb-browser' : `persist:profile-${profileId}`
}

/** Partition → its configured Session, so settings changes can reach them all. */
const configured = new Map<string, Session>()

/**
 * Apply the live browsing settings (spellcheck, Do-Not-Track) to one session.
 *
 * The DNT header handler is installed once and reads the setting live on every
 * request, so a later toggle takes effect without re-registering. Spellcheck is
 * re-applied whenever settings change.
 */
function applyBrowsingPrefs(ses: Session, settings: AppSettings, firstTime: boolean): void {
  ses.setSpellCheckerEnabled(settings.spellcheck)
  if (settings.spellcheck && settings.spellcheckLanguages.length > 0) {
    try {
      ses.setSpellCheckerLanguages(settings.spellcheckLanguages)
    } catch {
      // An unsupported language code is the user's typo, not a failure worth
      // aborting the whole save for.
    }
  }
  if (firstTime) {
    // Do-Not-Track: add the DNT:1 request header while the setting is on. Read
    // live inside the handler so the toggle needs no re-registration.
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      if (readAppSettings().doNotTrack) headers['DNT'] = '1'
      else delete headers['DNT']
      callback({ requestHeaders: headers })
    })
  }
}

// Re-apply to every already-configured session whenever settings change.
onAppSettingsChanged((settings) => {
  for (const ses of configured.values()) applyBrowsingPrefs(ses, settings, false)
})

/**
 * The session for a profile, configured on first use.
 *
 * The UA override is applied once per partition and sticks for the session's
 * lifetime, so every tab opened in that profile presents as Chrome.
 */
export function sessionForProfile(profileId: string): Session {
  const partition = partitionFor(profileId)
  const ses = session.fromPartition(partition)
  if (!configured.has(partition)) {
    ses.setUserAgent(chromeUserAgent())
    // Every profile gets the shell's permission prompt, download capture and
    // embed-proxy — not just the default. Extensions are skipped for incognito,
    // matching Chrome, where extensions are off in private windows.
    attachPermissionHandler(ses)
    attachDownloadHandler(ses)
    if (!isIncognito(profileId)) registerExtensionSession(ses, profileId)
    registerEmbedProxySession(ses)
    applyBrowsingPrefs(ses, readAppSettings(), true)
    configured.set(partition, ses)
  }
  return ses
}

/**
 * Configure the sessions for every known profile at startup, so spellcheck and
 * DNT are in force before the first tab and clear-data can reach them all.
 */
export function initProfileSessions(): void {
  for (const profile of store.read().profiles) sessionForProfile(profile.id)
}

/**
 * Clear browsing data across every profile — Chrome's "Clear browsing data".
 *
 * Scoped to what this shell actually keeps, and run against the profile
 * partitions where browsing happens (not `defaultSession`, which no tab uses,
 * so clearing it would be a privacy no-op). Destructive and irreversible, so it
 * is only ever reached from an explicit click in Settings — never an agent.
 */
export async function clearBrowsingData(kinds: ClearableData[]): Promise<void> {
  const storages: NonNullable<ClearStorageDataOptions['storages']> = []
  if (kinds.includes('cookies')) storages.push('cookies')
  if (kinds.includes('storage')) {
    storages.push('localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage')
  }
  for (const profile of store.read().profiles) {
    const ses = session.fromPartition(partitionFor(profile.id))
    if (kinds.includes('cache')) await ses.clearCache()
    if (storages.length > 0) await ses.clearStorageData({ storages })
    if (kinds.includes('history')) await ses.clearAuthCache()
  }
}

export function listProfiles(): { profiles: Profile[]; activeId: string } {
  const state = store.read()
  return {
    // Incognito is always offered, at the end of the list, but never stored.
    profiles: [...state.profiles, INCOGNITO_PROFILE],
    activeId: incognitoActive ? INCOGNITO_ID : state.activeId
  }
}

export function activeProfile(): Profile {
  if (incognitoActive) return INCOGNITO_PROFILE
  const state = store.read()
  return state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0] ?? DEFAULT_PROFILE
}

export function activePartition(): string {
  return partitionFor(activeProfile().id)
}

export function setActiveProfile(id: unknown): { profiles: Profile[]; activeId: string } {
  if (id === INCOGNITO_ID) {
    incognitoActive = true
    return listProfiles()
  }
  const state = store.read()
  if (typeof id === 'string' && state.profiles.some((p) => p.id === id)) {
    incognitoActive = false
    store.write({ ...state, activeId: id })
  }
  return listProfiles()
}

const CHIP_COLORS = ['#4fd4c4', '#7a8cff', '#e0b04f', '#e07a7a', '#8fd07a', '#c78ce0']

export function createProfile(name: unknown): { profiles: Profile[]; activeId: string } {
  const state = store.read()
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '') return listProfiles()
  const id = `p${Date.now().toString(36)}`
  const color = CHIP_COLORS[state.profiles.length % CHIP_COLORS.length]
  incognitoActive = false
  store.write({
    profiles: [...state.profiles, { id, name: trimmed.slice(0, 40), color }],
    activeId: id
  })
  return listProfiles()
}

/**
 * Whether a profile is signed in to Google.
 *
 * A profile is a Google profile in the Chrome sense: an isolated identity you
 * sign a Google account into. We read that account's own session cookies —
 * `SID`/`SAPISID` on `.google.com`, set only after a real sign-in — to report
 * whether this profile holds a Google login, with no Google API and no scraping
 * of account details we have no right to.
 */
export async function googleSignedIn(profileId: string): Promise<boolean> {
  try {
    const cookies = await session
      .fromPartition(partitionFor(profileId))
      .cookies.get({ domain: '.google.com' })
    return cookies.some((c) => c.name === 'SID' || c.name === 'SAPISID')
  } catch {
    return false
  }
}

/** Google sign-in status for every profile, keyed by id (incognito is never signed in). */
export async function googleStatus(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    store.read().profiles.map(async (p) => [p.id, await googleSignedIn(p.id)] as const)
  )
  return Object.fromEntries(entries)
}

export async function removeProfile(
  id: unknown
): Promise<{ profiles: Profile[]; activeId: string }> {
  const state = store.read()
  // The default and incognito profiles can't be removed.
  if (typeof id !== 'string' || id === DEFAULT_PROFILE.id || id === INCOGNITO_ID) {
    return listProfiles()
  }
  const profiles = state.profiles.filter((p) => p.id !== id)
  if (profiles.length === state.profiles.length) return listProfiles()

  // Wipe the removed profile's data so "remove" actually forgets the account.
  try {
    await session.fromPartition(partitionFor(id)).clearStorageData()
  } catch {
    // Best effort — the profile is gone from the list regardless.
  }
  const activeId = state.activeId === id ? profiles[0].id : state.activeId
  store.write({ profiles, activeId })
  return listProfiles()
}
