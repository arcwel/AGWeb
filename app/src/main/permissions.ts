import { session } from 'electron'
import type { Session } from 'electron'
import type { BrowserWindow } from 'electron'
import { IpcEvents } from '@shared/ipc'
import type { PermissionRequestInfo } from '@shared/ipc'
import { audit } from './policy'
import { readAppSettings } from './app-settings'

/**
 * Web permission prompts for browser tabs (Phase 2.7). Every request pauses
 * until the user answers the shell's prompt UI; "remember" decisions live for
 * the app run only (the Phase 9 policy engine adds durable, per-mode rules).
 * Requests that can never be answered (window gone) resolve to deny.
 */

interface PendingRequest {
  resolve: (allow: boolean) => void
  origin: string
  permission: string
}

let host: BrowserWindow | null = null
let nextRequestId = 1
const pending = new Map<string, PendingRequest>()
/** `${origin}|${permission}` → remembered decision for this app run. */
const remembered = new Map<string, boolean>()

export function initPermissions(window: BrowserWindow): void {
  host = window
  // Re-setting the handler on a later createMainWindow call is harmless
  // (setPermissionRequestHandler replaces), but pending prompts from the old
  // window can never be answered — deny them.
  for (const [id, request] of [...pending]) {
    pending.delete(id)
    request.resolve(false)
  }
  // The default profile's session. Extra profiles attach the same handler when
  // they are first used (see attachPermissionHandler), so a permission prompt
  // works whichever profile the tab belongs to — without it, requests in a
  // second profile would hit no handler and be silently denied.
  attachPermissionHandler(session.fromPartition('persist:agweb-browser'))
}

/** Bind the prompt flow to one session. Idempotent — the handler replaces. */
export function attachPermissionHandler(ses: Session): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    // The "ask before granting" setting, when off, means "never grant without
    // asking" — so we deny outright rather than prompting or silently allowing.
    if (!readAppSettings().askForPermissions) {
      callback(false)
      return
    }
    const origin = originOf(details.requestingUrl ?? wc.getURL())
    const decision = remembered.get(`${origin}|${permission}`)
    if (decision !== undefined) {
      callback(decision)
      return
    }
    if (!host || host.isDestroyed()) {
      callback(false)
      return
    }
    const id = `perm-${nextRequestId++}`
    pending.set(id, { resolve: callback, origin, permission })
    const request: PermissionRequestInfo = { id, origin, permission }
    host.webContents.send(IpcEvents.permissionRequest, request)
  })
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export function respondToPermission(id: string, allow: boolean, remember: boolean): void {
  const request = pending.get(id)
  if (!request) return
  pending.delete(id)
  request.resolve(allow)
  if (remember) remembered.set(`${request.origin}|${request.permission}`, allow)
  audit({
    event: 'web-permission',
    origin: request.origin,
    permission: request.permission,
    decision: allow ? 'allow' : 'deny',
    byUser: true
  })
}
