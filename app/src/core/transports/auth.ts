/**
 * How a client proves it is allowed to talk to `webdeck-core`.
 *
 * The core's socket is not a toy: through it a caller reads and writes the
 * user's files, spawns terminals, runs tasks, reads the agent's provider key and
 * rewrites the policy that gates the agent. A loopback port is NOT a security
 * boundary — on a shared machine every process running as that user can dial it.
 * So every connection has to present a per-boot shared secret, handed to the
 * browser through the port file (mode 0600) the core already writes.
 *
 * WHERE THE SECRET RIDES: the WebSocket subprotocol.
 *
 * The page connects with `new WebSocket(url, protocols)` and browsers refuse to
 * set arbitrary request headers on a WebSocket, so an `Authorization` header is
 * simply not available to us. That leaves two realistic carriers:
 *
 * - **Subprotocol** (chosen). The token travels in `Sec-WebSocket-Protocol`, a
 *   request *header*: it never appears in a URL, so it cannot leak through
 *   access logs, `document.URL`, a referrer, an error message that echoes the
 *   endpoint, or a screenshot of DevTools' network list. The cost is that the
 *   value must be an HTTP token (RFC 7230) — which is why the secret is minted
 *   as base64url (`A-Za-z0-9-_`) and prefixed with a dotted name.
 * - **Query parameter** (`?token=`). Simpler, but a URL is the single most
 *   copied, logged and forwarded part of a request. Rejected for that reason.
 *
 * A first-frame handshake was the third option: it works, but it leaves a real
 * connection open for an unauthenticated peer while we wait for its first frame,
 * which then needs its own timeout and its own state machine. Refusing at the
 * HTTP upgrade means an unauthorized caller never gets a socket at all.
 *
 * This module is deliberately free of Node imports: the same encoding has to run
 * in the `chrome://webdeck` page bundle and in the server.
 */

/**
 * Names the subprotocol as ours and versions it, so a future change of scheme is
 * distinguishable from a wrong token rather than looking like the same failure.
 */
export const CORE_AUTH_SUBPROTOCOL_PREFIX = 'webdeck.token.v1.'

/** The subprotocol a client offers to present `token`. */
export function coreAuthSubprotocol(token: string): string {
  return `${CORE_AUTH_SUBPROTOCOL_PREFIX}${token}`
}

/**
 * Pull the presented token out of a `Sec-WebSocket-Protocol` request header.
 *
 * Returns null when the client offered no protocol of ours — which is a refusal,
 * never a pass: the caller must fail closed on null.
 */
export function tokenFromSubprotocolHeader(header: string | undefined): string | null {
  if (!header) return null
  for (const entry of header.split(',')) {
    const offered = entry.trim()
    if (offered.startsWith(CORE_AUTH_SUBPROTOCOL_PREFIX)) {
      const token = offered.slice(CORE_AUTH_SUBPROTOCOL_PREFIX.length)
      // An empty token is not a token. Say no rather than comparing "" to "".
      return token.length > 0 ? token : null
    }
  }
  return null
}
