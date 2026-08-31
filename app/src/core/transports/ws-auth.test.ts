import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, mkdtempSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { CoreRegistry } from '../rpc'
import { coreAuthSubprotocol, tokenFromSubprotocolHeader } from './auth'
import { generateCoreToken, serveCoreOverWebSocket, type WsServerHandle } from './ws-server'

/**
 * The guard on the only door into webdeck-core.
 *
 * Behind this socket sit the user's files, their terminals, the agent's provider
 * key and the policy that decides what the agent may do without asking. A
 * loopback port protects none of that: every process running as this user can
 * dial it, and every web page the user opens can try to. So this file asserts
 * the two refusals directly — no token, wrong token, foreign Origin — rather
 * than trusting that the happy path implies them.
 */

const TOKEN = 'test-token-auth-fixture'

let server: WsServerHandle

beforeAll(async () => {
  const registry = new CoreRegistry()
  registry.register('ping', () => 'pong')
  server = await serveCoreOverWebSocket(registry, { port: 0, authToken: TOKEN })
})

afterAll(async () => {
  await server?.close()
})

/**
 * Try to connect, and report which way it went.
 *
 * Refusals arrive as an `error` (the upgrade is answered 401 and never becomes a
 * socket), so both outcomes have to be raced rather than awaited in order.
 */
function tryConnect(
  protocols: string[],
  headers?: Record<string, string>
): Promise<{ open: boolean; error?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, protocols, { headers })
    ws.on('open', () => {
      ws.close()
      resolve({ open: true })
    })
    ws.on('error', (err: Error) => resolve({ open: false, error: err.message }))
  })
}

describe('connecting to webdeck-core', () => {
  it('accepts a client presenting the right token', async () => {
    await expect(tryConnect([coreAuthSubprotocol(server.token)])).resolves.toEqual({ open: true })
  })

  it('refuses a client presenting NO token', async () => {
    const result = await tryConnect([])
    expect(result.open).toBe(false)
    expect(result.error).toMatch(/401/)
  })

  it('refuses a client presenting the WRONG token', async () => {
    const result = await tryConnect([coreAuthSubprotocol('not-the-token')])
    expect(result.open).toBe(false)
    expect(result.error).toMatch(/401/)
  })

  it('refuses a token that is a prefix of the real one', async () => {
    // Guards the comparison itself: a truncated secret must not pass on a
    // startsWith-style check.
    const result = await tryConnect([coreAuthSubprotocol(TOKEN.slice(0, -1))])
    expect(result.open).toBe(false)
  })

  it('refuses an empty token', async () => {
    const result = await tryConnect([coreAuthSubprotocol('')])
    expect(result.open).toBe(false)
  })

  it('refuses a subprotocol that is not ours at all', async () => {
    const result = await tryConnect(['chat', 'superchat'])
    expect(result.open).toBe(false)
  })

  it('refuses a foreign Origin even WITH the right token', async () => {
    // The attack this stops: a page the user has open on the internet opening a
    // WebSocket to 127.0.0.1. It cannot forge Origin, so this is the check that
    // sees it — and it must not be bypassable by anything else.
    const result = await tryConnect([coreAuthSubprotocol(server.token)], {
      origin: 'https://evil.example'
    })
    expect(result.open).toBe(false)
    expect(result.error).toMatch(/401/)
  })

  it('refuses a chrome:// page that is not the WebDeck WebUI', async () => {
    const result = await tryConnect([coreAuthSubprotocol(server.token)], {
      origin: 'chrome://settings'
    })
    expect(result.open).toBe(false)
  })

  it('accepts the WebDeck WebUI origin', async () => {
    await expect(
      tryConnect([coreAuthSubprotocol(server.token)], { origin: 'chrome://webdeck' })
    ).resolves.toEqual({ open: true })
  })

  it('honours an explicit origin allowlist', async () => {
    const other = await serveCoreOverWebSocket(new CoreRegistry(), {
      port: 0,
      authToken: TOKEN,
      allowedOrigins: ['chrome://webdeck', 'http://localhost:5173']
    })
    const connect = (origin: string): Promise<boolean> =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${other.port}`, [coreAuthSubprotocol(TOKEN)], {
          headers: { origin }
        })
        ws.on('open', () => {
          ws.close()
          resolve(true)
        })
        ws.on('error', () => resolve(false))
      })
    expect(await connect('http://localhost:5173')).toBe(true)
    expect(await connect('http://localhost:5174')).toBe(false)
    await other.close()
  })

  it('never even opens a socket for a refused client', async () => {
    // Refusing at the HTTP upgrade rather than after connecting is the point:
    // an unauthorized caller gets no socket to send a first frame on.
    await tryConnect([])
    expect([...server.clients].length).toBe(0)
  })

  it('mints a distinct high-entropy token per boot', async () => {
    const a = generateCoreToken()
    const b = generateCoreToken()
    expect(a).not.toBe(b)
    // 32 random bytes, base64url — no padding, URL/header-token safe.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('the handoff file', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wd-handoff-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('publishes the port and token at mode 0600', async () => {
    const portFile = join(dir, 'core-port.json')
    const handle = await serveCoreOverWebSocket(new CoreRegistry(), {
      port: 0,
      authToken: TOKEN,
      portFile
    })
    const published = JSON.parse(readFileSync(portFile, 'utf8')) as {
      port: number
      token: string
    }
    expect(published.port).toBe(handle.port)
    expect(published.token).toBe(TOKEN)
    // The token is a full-privilege credential sitting in a shared temp tree:
    // nothing but the owner may read it.
    expect(statSync(portFile).mode & 0o777).toBe(0o600)
    await handle.close()
  })

  it('fails the boot when the handoff cannot be written', async () => {
    // Silently carrying on would leave a server no legitimate client can ever
    // reach, since the token exists nowhere else.
    await expect(
      serveCoreOverWebSocket(new CoreRegistry(), {
        port: 0,
        authToken: TOKEN,
        portFile: join(dir, 'no', 'such', 'dir', 'core-port.json')
      })
    ).rejects.toThrow(/handoff file/)
  })
})

describe('tokenFromSubprotocolHeader', () => {
  it('reads our protocol out of a list', () => {
    expect(tokenFromSubprotocolHeader(`chat, ${coreAuthSubprotocol('abc')}, other`)).toBe('abc')
  })

  it('returns null — never a pass — for anything else', () => {
    expect(tokenFromSubprotocolHeader(undefined)).toBeNull()
    expect(tokenFromSubprotocolHeader('')).toBeNull()
    expect(tokenFromSubprotocolHeader('chat')).toBeNull()
    expect(tokenFromSubprotocolHeader(coreAuthSubprotocol(''))).toBeNull()
  })
})

describe('the core binds loopback only', () => {
  it('refuses a routable host rather than exposing the service to the network', async () => {
    // The token gates other local processes. It was never meant to be the only
    // thing between the user's files, terminals and API keys and the internet,
    // and the docs claimed loopback-only while nothing enforced it.
    const { execFileSync } = await import('node:child_process')
    const bundle = join(process.cwd(), 'out', 'core', 'webdeck-core.cjs')
    if (!existsSync(bundle)) return // build:core has not run; nothing to assert

    let refused = false
    let message = ''
    try {
      execFileSync(
        'node',
        [bundle, '--host', '0.0.0.0', '--user-data', mkdtempSync(join(tmpdir(), 'wd-host-'))],
        {
          encoding: 'utf8',
          timeout: 10_000,
          stdio: 'pipe'
        }
      )
    } catch (err) {
      refused = true
      message = String((err as { stderr?: string }).stderr ?? '')
    }
    expect(refused).toBe(true)
    expect(message).toContain('loopback only')
  }, 20_000)
})
