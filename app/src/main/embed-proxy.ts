import { session } from 'electron'
import type { Session } from 'electron'
import type { EmbedProxyStatus } from '@shared/ipc'

/**
 * Dev-preview embed proxy (Phase 2.5/2.6): rewrites response headers so local
 * dev servers can be embedded in preview frames — X-Frame-Options is dropped
 * and the frame-ancestors CSP directive is stripped (the rest of the CSP is
 * kept intact).
 *
 * Safety rails: applies only to the hardcoded localhost allowlist, is off by
 * default, and is never persisted — every run starts with it disabled. The
 * toolbar shows an indicator whenever it is on.
 */

/** Chromium match patterns ignore ports, so these cover every localhost port. */
const ALLOWLIST = ['http://localhost/*', 'http://127.0.0.1/*']

let enabled = false

const STRIPPED = new Set(['x-frame-options'])

function rewriteHeaders(
  headers: Record<string, string[]> | undefined
): Record<string, string[]> | undefined {
  if (!headers) return headers
  const out: Record<string, string[]> = {}
  for (const [name, values] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (STRIPPED.has(lower)) continue
    if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
      const rewritten = values
        .map((v) =>
          v
            .split(';')
            .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
            .join(';')
            .trim()
        )
        .filter((v) => v.length > 0)
      if (rewritten.length > 0) out[name] = rewritten
      continue
    }
    out[name] = values
  }
  return out
}

// Every browser-profile session, plus the shell's default session (Phase 4
// preview iframes). Profiles register theirs as they are configured, so the
// proxy covers all profiles rather than only the default partition. Populated
// lazily — `session.defaultSession` must not be touched before app-ready.
const proxySessions = new Set<Session>()

function allSessions(): Set<Session> {
  proxySessions.add(session.defaultSession)
  return proxySessions
}

function applyTo(ses: Session): void {
  if (enabled) {
    ses.webRequest.onHeadersReceived({ urls: ALLOWLIST }, (details, callback) => {
      callback({ responseHeaders: rewriteHeaders(details.responseHeaders) })
    })
  } else {
    ses.webRequest.onHeadersReceived(null)
  }
}

/** Register a profile session; the proxy's current state is applied at once. */
export function registerEmbedProxySession(ses: Session): void {
  if (proxySessions.has(ses)) return
  proxySessions.add(ses)
  applyTo(ses)
}

export function setEmbedProxyEnabled(value: boolean): EmbedProxyStatus {
  enabled = value
  for (const ses of allSessions()) applyTo(ses)
  return getEmbedProxyStatus()
}

export function getEmbedProxyStatus(): EmbedProxyStatus {
  return { enabled, allowlist: [...ALLOWLIST] }
}
