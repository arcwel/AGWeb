import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * A capability in the URL, for the HTTP servers WebDeck runs on loopback.
 *
 * The preview server and the slide server hand out the workspace over plain
 * HTTP. Both checked only the Host header, which stops a remote page from
 * reaching them via DNS rebinding — but does nothing about the threat that
 * actually applies to a loopback port: any other process running as this user
 * can set whatever Host it likes and read the entire workspace root, source,
 * secrets in dotfiles and all.
 *
 * The core's WebSocket already answers this with a per-boot token. These do the
 * same, carried as the first path segment rather than a query parameter, for
 * two reasons: relative links inside the served pages then resolve under it
 * without rewriting anything, and a query string is the part of a URL that most
 * often ends up in a log or a referrer.
 *
 * This is a capability, not authentication: whoever holds the URL has access.
 * That is the right model here — the URL only ever goes to the WebDeck page,
 * and an attacker who can read our memory or our files has already won.
 */

/** 24 bytes of CSPRNG, base64url — URL-safe with no escaping. */
export function mintServerToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Split a request path into its token and the rest.
 *
 * Returns null when the token is absent or wrong, so callers cannot
 * accidentally treat a failed check as a path — the compare is constant-time
 * so a wrong token leaks nothing about the right one through timing.
 */
export function takeToken(path: string, expected: string): string | null {
  const withoutQuery = path.split('?')[0]
  const segments = withoutQuery.replace(/^\/+/, '').split('/')
  const presented = segments.shift() ?? ''
  if (!matches(presented, expected)) return null
  return `/${segments.join('/')}`
}

function matches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, which is itself a leak-free
  // answer: a token of the wrong length is wrong.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Is this Host header one of ours?
 *
 * Kept alongside the token: it is what stops a page on the internet from
 * pointing a hostname at 127.0.0.1 and reaching us through the user's browser,
 * which the token alone would not prevent if the URL ever leaked.
 */
export function hostAllowed(header: string | undefined, port: number): boolean {
  if (!header) return false
  const host = header.toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}
