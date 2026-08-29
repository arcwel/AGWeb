import { useEffect, useState } from 'react'
import type { PermissionRequestInfo } from '@shared/ipc'

const PERMISSION_LABELS: Record<string, string> = {
  geolocation: 'know your location',
  notifications: 'show notifications',
  media: 'use your camera or microphone',
  midi: 'use MIDI devices',
  clipboard: 'read your clipboard',
  'clipboard-read': 'read your clipboard',
  pointerLock: 'lock your pointer',
  fullscreen: 'go fullscreen'
}

/**
 * Inline banner for web permission requests from browser tabs (Phase 2.7).
 * Rendered between the toolbar and the stage — native browser views paint
 * above the DOM, so an overlay would be hidden; a banner resizes the stage
 * and the view follows. Each request blocks its page until answered.
 */
export function PermissionPrompts(): React.JSX.Element | null {
  const [requests, setRequests] = useState<PermissionRequestInfo[]>([])
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    return window.agweb.permissions.onRequest((request) => {
      setRequests((existing) =>
        existing.some((r) => r.id === request.id) ? existing : [...existing, request]
      )
    })
  }, [])

  if (requests.length === 0) return null
  const request = requests[0]

  const respond = (allow: boolean): void => {
    void window.agweb.permissions.respond(request.id, allow, remember)
    setRequests((existing) => existing.filter((r) => r.id !== request.id))
    setRemember(false)
  }

  const action = PERMISSION_LABELS[request.permission] ?? `use "${request.permission}"`

  return (
    <div
      data-testid="permission-prompt"
      className="flex items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-[13px] dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <span>
        <span className="font-semibold">{request.origin}</span> wants to {action}.
      </span>
      {requests.length > 1 && (
        <span className="text-[11px] text-slate-500">+{requests.length - 1} more waiting</span>
      )}
      <label className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember for this site
      </label>
      <button
        onClick={() => respond(false)}
        data-testid="permission-block"
        className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Block
      </button>
      <button
        onClick={() => respond(true)}
        data-testid="permission-allow"
        className="shrink-0 rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500"
      >
        Allow
      </button>
    </div>
  )
}
