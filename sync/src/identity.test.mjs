// The identity endpoints, exercised over HTTP the way the browser calls them.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startSyncServer } from './server.mjs'
import { gaiaConfig, PATHS, isIdentityPath } from './identity.mjs'

let service
let account

before(async () => {
  service = await startSyncServer({ port: 0, dbPath: ':memory:' })
  account = service.identities.addAccount('anthony@example.com', 'Anthony')
})
after(async () => {
  await service.close()
})

const form = (fields) =>
  fetch(`${service.url}${PATHS.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  })

async function accessToken() {
  const response = await form({ grant_type: 'refresh_token', refresh_token: account.refresh_token })
  return (await response.json()).access_token
}

describe('exchanging a refresh token', () => {
  test('returns a bearer token the sync engine can use', async () => {
    const body = await (
      await form({ grant_type: 'refresh_token', refresh_token: account.refresh_token })
    ).json()

    assert.equal(body.token_type, 'Bearer')
    assert.ok(body.access_token.length > 0)
    assert.ok(body.expires_in > 0)
  })

  test('refuses a token it did not issue', async () => {
    const response = await form({ grant_type: 'refresh_token', refresh_token: 'not-a-token' })
    const body = await response.json()

    // Chromium acts on this exact shape; anything else surfaces as a failure
    // the user cannot do anything about.
    assert.equal(response.status, 400)
    assert.equal(body.error, 'invalid_grant')
  })

  test('refuses a grant type it does not implement', async () => {
    const response = await form({ grant_type: 'password', username: 'a', password: 'b' })
    assert.equal(response.status, 400)
  })

  test('issues a different token every time', async () => {
    const [one, two] = [await accessToken(), await accessToken()]
    assert.notEqual(one, two)
  })
})

describe('who the token belongs to', () => {
  test('userinfo names the account', async () => {
    const body = await (
      await fetch(`${service.url}${PATHS.userInfo}`, {
        headers: { authorization: `Bearer ${await accessToken()}` }
      })
    ).json()

    assert.equal(body.email, 'anthony@example.com')
    assert.equal(body.id, account.id)
    assert.equal(body.verified_email, true)
  })

  test('userinfo refuses a token it never issued', async () => {
    const response = await fetch(`${service.url}${PATHS.userInfo}`, {
      headers: { authorization: 'Bearer wd-access-made-up' }
    })
    assert.equal(response.status, 401)
  })

  test('a revoked token stops working', async () => {
    const token = await accessToken()
    await fetch(`${service.url}${PATHS.revoke}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token })
    })

    const after = await fetch(`${service.url}${PATHS.userInfo}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(after.status, 401)
  })

  test('ListAccounts reports the signed-in account', async () => {
    const body = await (await fetch(`${service.url}${PATHS.listAccounts}?json=standard`)).json()
    const [, accounts] = body

    assert.equal(accounts.length, 1)
    assert.equal(accounts[0][3], 'anthony@example.com')
  })
})

describe('the same email on two machines', () => {
  test('is one account, not two', () => {
    const again = service.identities.addAccount('anthony@example.com', 'Anthony')

    // The id is derived from the email, so two installs converge without a
    // directory to consult — which is the whole point of syncing.
    assert.equal(again.id, account.id)
    assert.equal(again.refresh_token, account.refresh_token)
  })
})

describe('the config that points a browser here', () => {
  test('redirects every identity URL to this service', () => {
    const config = gaiaConfig('http://127.0.0.1:8384')

    for (const [key, value] of Object.entries(config.urls)) {
      assert.ok(
        value.url.startsWith('http://127.0.0.1:8384'),
        `${key} still points somewhere else: ${value.url}`
      )
    }
  })

  test('carries API keys, so the build stops behaving like one with none', () => {
    const config = gaiaConfig('http://127.0.0.1:8384')

    assert.ok(config.api_keys.GOOGLE_CLIENT_ID_MAIN.length > 0)
    assert.ok(config.api_keys.GOOGLE_CLIENT_SECRET_MAIN.length > 0)
  })

  test('names the token endpoint this service actually serves', () => {
    const config = gaiaConfig('http://x')

    assert.equal(config.urls.oauth2_token_url.url, `http://x${PATHS.token}`)
    assert.ok(isIdentityPath(PATHS.token))
  })
})

describe('identity and sync share one origin', () => {
  test('a sync request still reaches the sync endpoint', async () => {
    const response = await fetch(`${service.url}/command/`, { method: 'POST' })

    // 401 rather than 404: the sync route was reached and asked for a token.
    assert.equal(response.status, 401)
  })

  test('an unknown path is still a 404', async () => {
    const response = await fetch(`${service.url}/nothing-here`)
    assert.equal(response.status, 404)
  })
})
