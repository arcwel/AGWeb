import { createHmac, timingSafeEqual } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { Buffer } from 'node:buffer'
import { IpcChannels } from '@shared/ipc'
import { core } from '../rpc'
import { asString } from '../coerce'
import { grantFile } from './workspace'

/**
 * Files the BROWSER vouched for, opened at the path they actually live at.
 *
 * The shell can name any path it likes — it is a page, and a page that has
 * been taken over would name `~/.ssh/id_rsa`. So naming is not what opens a
 * file. The browser signs the path when, and only when, the user chose it: in
 * the browser's own open panel, or by dropping it on the window. The core
 * checks that signature before granting anything.
 *
 * The key is minted per core process and handed over in the environment, so it
 * never passes through a renderer and cannot outlive the browser that made it.
 * Without it nothing is grantable, which is the safe direction to fail in.
 */
const KEY_ENV_VAR = 'WEBDECK_GRANT_KEY'

/** Must match kGrantContext in webdeck_core_service.cc. */
const CONTEXT = 'webdeck-open-file\n'

function key(): Buffer | null {
  const encoded = process.env[KEY_ENV_VAR]
  if (!encoded) return null
  const bytes = Buffer.from(encoded, 'base64')
  return bytes.length >= 32 ? bytes : null
}

/** Whether `auth` is this browser's signature over `path`. */
export function isSignedPath(path: string, auth: string): boolean {
  const secret = key()
  if (!secret || !path || !auth) return false
  let offered: Buffer
  try {
    offered = Buffer.from(auth, 'base64')
  } catch {
    return false
  }
  const expected = createHmac('sha256', secret)
    .update(CONTEXT + path)
    .digest()
  // Length first: timingSafeEqual throws on a mismatch rather than returning.
  return offered.length === expected.length && timingSafeEqual(offered, expected)
}

/**
 * Open a file the browser vouched for: check the signature, then grant it.
 *
 * The grant is the same one a picker attachment gets — one file, this session,
 * never persisted. What is new is only how the core came to believe the user
 * chose it.
 */
export function openSignedPath(path: string, auth: string): { path?: string; error?: string } {
  if (!path || !isAbsolute(path)) return { error: 'That is not a file path.' }
  // Sign and grant the same string. Normalising after the check would let a
  // path verify as one file and be granted as another.
  const full = resolve(path)
  if (full !== path) return { error: 'That path is not in its plain form.' }
  if (!isSignedPath(full, auth)) return { error: 'The browser did not open that file.' }
  grantFile(full)
  return { path: full }
}

export function registerFileGrantsRpc(): void {
  core.register(IpcChannels.filesOpenSigned, (path, auth) =>
    openSignedPath(asString(path) ?? '', asString(auth) ?? '')
  )
}
