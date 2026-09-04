// Who is calling.
//
// The sync engine sends an OAuth2 bearer token it obtained from whatever
// identity service the browser was pointed at. Against Google that is Google;
// against WebDeck's own service it will be ours. Either way the server's job
// is the same: turn the token into an account id, or refuse.
//
// This is the seam where that decision lives, on its own, because it is the
// part most likely to change and the part where being wrong is worst. Today it
// has one mode, and it is not a security boundary — see below.

/**
 * How the service decides who is calling.
 *
 * `trust-token`: the bearer token IS the account id. Anyone who can reach the
 * port can name any account, so it is only safe on a loopback service used by
 * one person — which is exactly the shape of a first local deployment, and
 * exactly what it must stop being before the service is reachable from
 * anywhere else. There is no second mode yet; adding one is the next piece of
 * work on this service, and until then the server refuses to bind to anything
 * but loopback (see cli.mjs).
 */
export const AUTH_MODE = 'trust-token'

/** A token has to look like one before it is treated as an identity. */
const TOKEN = /^[A-Za-z0-9._~+/-]{8,512}=*$/

/**
 * The account this request is for, or null to refuse it.
 *
 * Chromium sends `Authorization: Bearer <access token>`. Nothing else is
 * accepted: no query parameter, no cookie, no unauthenticated default account.
 * A default account would mean a service that silently merges two people's
 * data the first time it is misconfigured.
 */
export function accountForRequest(request) {
  const header = request.headers?.authorization ?? ''
  const [scheme, token] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  if (!TOKEN.test(token)) return null
  return accountForToken(token)
}

/** Exposed so tests and the CLI can resolve a token without an HTTP request. */
export function accountForToken(token) {
  if (!token || !TOKEN.test(token)) return null
  return token
}
