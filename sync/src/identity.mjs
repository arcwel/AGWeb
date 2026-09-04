// The identity half: the endpoints Chromium's sign-in layer expects.
//
// Signing in to a Chromium build against Google is restricted by Google — the
// OAuth token that grants Chrome Sync is not issued to non-Chrome builds, and
// no API key changes that. But every one of those endpoints is configurable:
// `--gaia-config` replaces each URL and the API keys from a JSON file. So the
// browser can be pointed here instead, and this answers as Google would.
//
// The paths below are not invented. They are the suffixes in
// google_apis/gaia/gaia_urls.cc in the browser we ship, and they move when
// that file moves.
import { randomUUID, randomBytes, createHash } from 'node:crypto'

/** Endpoint paths, from gaia_urls.cc. */
export const PATHS = {
  token: '/oauth2/v4/token',
  tokenInfo: '/oauth2/v2/tokeninfo',
  userInfo: '/oauth2/v1/userinfo',
  revoke: '/o/oauth2/revoke',
  listAccounts: '/ListAccounts',
  checkConnection: '/GetCheckConnectionInfo',
  multilogin: '/oauth/multilogin',
  issueToken: '/v1/issuetoken'
}

/** Whether this path belongs to identity rather than to sync. */
export function isIdentityPath(pathname) {
  return Object.values(PATHS).includes(pathname)
}

/** How long an access token lasts. Chromium refreshes well before this. */
const ACCESS_TOKEN_TTL_SECONDS = 3600

const ACCOUNTS = `
CREATE TABLE IF NOT EXISTS identities (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  refresh_token TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_tokens (
  token       TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
`

export class IdentityStore {
  #db

  constructor(db) {
    this.#db = db
    this.#db.exec(ACCOUNTS)
  }

  /**
   * Create an account, or return the one that already has this email.
   *
   * The gaia id is derived from the email rather than random, so the same
   * person on two machines is the same account without a directory to consult.
   */
  addAccount(email, name = email.split('@')[0]) {
    const existing = this.#db.prepare('SELECT * FROM identities WHERE email = ?').get(email)
    if (existing) return existing
    const account = {
      id: createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 21),
      email,
      name,
      refresh_token: `wd-refresh-${randomBytes(24).toString('base64url')}`,
      created_at: new Date().toISOString()
    }
    this.#db
      .prepare(
        'INSERT INTO identities (id, email, name, refresh_token, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(account.id, account.email, account.name, account.refresh_token, account.created_at)
    return account
  }

  accounts() {
    return this.#db.prepare('SELECT id, email, name, created_at FROM identities ORDER BY email').all()
  }

  byRefreshToken(token) {
    return this.#db.prepare('SELECT * FROM identities WHERE refresh_token = ?').get(token) ?? null
  }

  byId(id) {
    return this.#db.prepare('SELECT * FROM identities WHERE id = ?').get(id) ?? null
  }

  /** Mint an access token for an account, and forget the expired ones. */
  issueAccessToken(identityId) {
    const token = `wd-access-${randomBytes(24).toString('base64url')}`
    const expiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000
    this.#db.prepare('DELETE FROM access_tokens WHERE expires_at < ?').run(Date.now())
    this.#db
      .prepare('INSERT INTO access_tokens (token, identity_id, expires_at) VALUES (?, ?, ?)')
      .run(token, identityId, expiresAt)
    return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
  }

  /** The account an access token belongs to, or null when it is no good. */
  byAccessToken(token) {
    const row = this.#db.prepare('SELECT * FROM access_tokens WHERE token = ?').get(token)
    if (!row || row.expires_at < Date.now()) return null
    return this.byId(row.identity_id)
  }

  revoke(token) {
    const removed = this.#db.prepare('DELETE FROM access_tokens WHERE token = ?').run(token)
    return removed.changes > 0
  }
}

const json = (response, status, body) => {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=UTF-8' })
  response.end(text)
}

/**
 * Answer one identity request, or return false to let another router try.
 *
 * `body` is the already-read request body, because the caller reads it once
 * and both halves of the service may want it.
 */
export function handleIdentity({ request, response, url, body, identities, log }) {
  const path = url.pathname
  const form = new URLSearchParams(body?.toString('utf8') ?? '')

  switch (path) {
    case PATHS.token: {
      // Chromium exchanges a refresh token for an access token on every
      // startup and whenever one expires. This is the endpoint sync depends
      // on more than any other.
      const grant = form.get('grant_type')
      const refresh = form.get('refresh_token')
      const account = grant === 'refresh_token' && refresh ? identities.byRefreshToken(refresh) : null
      if (!account) {
        // The exact shape Chromium expects for a bad grant; anything else and
        // it reports a generic failure the user cannot act on.
        log?.({ kind: 'token-denied', account: null })
        return json(response, 400, { error: 'invalid_grant' }), true
      }
      const { token, expiresIn } = identities.issueAccessToken(account.id)
      log?.({ kind: 'token', account: account.email })
      return (
        json(response, 200, {
          access_token: token,
          expires_in: expiresIn,
          token_type: 'Bearer',
          id_token: '',
          scope: 'https://www.googleapis.com/auth/chromesync'
        }),
        true
      )
    }

    case PATHS.userInfo: {
      const account = accountFromAuthorization(request, identities)
      if (!account) return json(response, 401, { error: 'invalid_token' }), true
      return (
        json(response, 200, {
          id: account.id,
          email: account.email,
          verified_email: true,
          name: account.name,
          given_name: account.name,
          locale: 'en'
        }),
        true
      )
    }

    case PATHS.tokenInfo: {
      const token = form.get('access_token') ?? url.searchParams.get('access_token') ?? ''
      const account = identities.byAccessToken(token)
      if (!account) return json(response, 400, { error: 'invalid_token' }), true
      return (
        json(response, 200, {
          sub: account.id,
          email: account.email,
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          scope: 'https://www.googleapis.com/auth/chromesync'
        }),
        true
      )
    }

    case PATHS.revoke: {
      identities.revoke(form.get('token') ?? url.searchParams.get('token') ?? '')
      return json(response, 200, {}), true
    }

    case PATHS.listAccounts: {
      // The cookie-jar view of who is signed in. Chromium parses a fixed
      // positional shape here, not named fields.
      const accounts = identities.accounts()
      const list = accounts.map((a) => [
        'gaia.l.a.r',
        1,
        a.name,
        a.email,
        '',
        null,
        null,
        null,
        1,
        a.id
      ])
      return json(response, 200, ['gaia.l.a.r', list]), true
    }

    case PATHS.checkConnection:
      // No third-party sign-in services to check.
      return json(response, 200, []), true

    case PATHS.multilogin:
      return json(response, 200, { status: 'OK', cookies: [] }), true

    case PATHS.issueToken: {
      const account = accountFromAuthorization(request, identities)
      if (!account) return json(response, 401, { error: 'invalid_token' }), true
      const { token, expiresIn } = identities.issueAccessToken(account.id)
      return json(response, 200, { token, expiresIn, issueAdvice: 'auto' }), true
    }

    default:
      return false
  }
}

function accountFromAuthorization(request, identities) {
  const [scheme, token] = (request.headers?.authorization ?? '').split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  return identities.byAccessToken(token)
}

/**
 * The config that points a browser here.
 *
 * Every URL Chromium would send to Google, redirected to this origin, plus API
 * keys so the build stops behaving like one with none. The keys are not
 * Google's and are not secret: nothing here talks to Google, and the only
 * service that reads them is this one.
 */
export function gaiaConfig(origin) {
  const url = (path) => ({ url: `${origin}${path}` })
  return {
    urls: {
      gaia_url: { url: origin },
      google_url: { url: origin },
      secure_google_url: { url: origin },
      lso_origin_url: { url: origin },
      google_apis_origin_url: { url: `${origin}/` },
      oauth_account_manager_origin_url: { url: origin },
      account_capabilities_origin_url: { url: origin },
      oauth2_token_url: url(PATHS.token),
      oauth2_token_info_url: url(PATHS.tokenInfo),
      oauth_user_info_url: url(PATHS.userInfo),
      oauth2_revoke_url: url(PATHS.revoke),
      list_accounts_url: url(`${PATHS.listAccounts}?json=standard&laf=b64bin`),
      get_check_connection_info_url: url(PATHS.checkConnection),
      oauth_multilogin_url: url(PATHS.multilogin)
    },
    api_keys: {
      GOOGLE_API_KEY: `webdeck-${randomUUID()}`,
      GOOGLE_CLIENT_ID_MAIN: 'webdeck-main.apps.webdeck.local',
      GOOGLE_CLIENT_SECRET_MAIN: `webdeck-${randomBytes(12).toString('hex')}`
    }
  }
}
