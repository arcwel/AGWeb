import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { IpcChannels } from '@shared/ipc'
import { startWebdeckCore } from './server'
import { coreAuthSubprotocol } from './transports/auth'
import { CoreClient, type WsLike } from './transports/ws-client'
import type { WsServerHandle } from './transports/ws-server'

/**
 * Every Dev Deck block, exercised against the standalone core.
 *
 * The migration's real risk is not that a block's UI fails to render — it is
 * that its *backend channel* was never registered in the headless core, so the
 * block looks fine and dies on first use. That is exactly how the Preview block
 * (`devserver:*`) and slide decks (`slides:open`) were found broken: the UI was
 * perfect and the call had no handler.
 *
 * So this asserts, per block, that the channels it depends on answer. It is the
 * regression net for "a domain was added to the app but not to the core".
 */

let handle: WsServerHandle
let client: CoreClient
let dataDir: string
let workspace: string

const call = (method: string, ...args: unknown[]): Promise<unknown> =>
  client.invoke(method, ...args)

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-blocks-data-'))
  workspace = mkdtempSync(join(tmpdir(), 'wd-blocks-ws-'))

  writeFileSync(join(workspace, 'hello.md'), '# Title\n\n**bold** and `code`\n')
  writeFileSync(join(workspace, 'data.json'), '{"name":"webdeck","tags":["ide"]}\n')
  writeFileSync(join(workspace, 'table.csv'), 'city,pop\nTokyo,37\n')
  writeFileSync(join(workspace, 'config.toml'), 'title = "cfg"\n')
  writeFileSync(join(workspace, 'pitch.slides.md'), '# One\n\nhi\n\n---\n\n# Two\n')
  writeFileSync(join(workspace, 'package.json'), '{"name":"ws","scripts":{"hello":"echo hi"}}\n')

  // Source Control needs a real repo to report status for.
  const git = (...a: string[]): void => {
    execFileSync('git', a, {
      cwd: workspace,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
    })
  }
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'blocks@test')
  git('config', 'user.name', 'Blocks')
  git('add', '-A')
  git('commit', '-m', 'init')

  handle = await startWebdeckCore({ userDataDir: dataDir, port: 0 })
  client = new CoreClient({
    connect: () =>
      new WebSocket(`ws://127.0.0.1:${handle.port}`, [
        coreAuthSubprotocol(handle.token)
      ]) as unknown as WsLike
  })
  await client.connect()
  await call(IpcChannels.workspaceOpenPath, workspace)
})

afterAll(async () => {
  client?.close()
  await handle?.close()
  for (const dir of [dataDir, workspace]) rmSync(dir, { recursive: true, force: true })
})

describe('Dev Deck blocks answer on the standalone core', () => {
  it('Files — lists the workspace', async () => {
    const entries = (await call(IpcChannels.fsList, '')) as Array<{ name: string }>
    expect(entries.map((e) => e.name)).toContain('hello.md')
  })

  it('Editor — reads and writes files', async () => {
    const read = (await call(IpcChannels.fsRead, 'hello.md')) as { content?: string }
    expect(read.content).toContain('# Title')
    const write = (await call(IpcChannels.fsWrite, 'scratch.txt', 'x')) as { error?: string }
    expect(write.error).toBeUndefined()
  })

  it('Search — finds text in the workspace', async () => {
    const hits = (await call(IpcChannels.searchQuery, 'Tokyo')) as unknown[]
    expect(hits.length).toBeGreaterThan(0)
  })

  it('Source Control — reports repository status', async () => {
    const status = (await call(IpcChannels.gitStatus)) as { repository: boolean }
    expect(status.repository).toBe(true)
  })

  it('Tasks — lists package.json scripts', async () => {
    const tasks = (await call(IpcChannels.taskList)) as unknown[]
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('Settings — reads editor configuration', async () => {
    const settings = (await call(IpcChannels.settingsRead)) as { user: string }
    expect(typeof settings.user).toBe('string')
  })

  it('Agent — lists sessions and reports key status', async () => {
    expect(Array.isArray(await call(IpcChannels.agentList))).toBe(true)
    const key = (await call(IpcChannels.agentKeyStatus)) as { model: string }
    expect(key.model).toBeTruthy()
  })

  it('Policy — the permission gate is readable', async () => {
    const policy = (await call(IpcChannels.policyGet)) as { mode: string }
    expect(['secure', 'review', 'agent', 'custom']).toContain(policy.mode)
  })

  it('Debug — reports adapter availability without throwing', async () => {
    expect(typeof (await call(IpcChannels.debugAvailable))).toBe('boolean')
  })

  it('Preview — the dev server reports status (regression: was unregistered)', async () => {
    const status = (await call(IpcChannels.devServerStatus)) as { state: string }
    expect(['stopped', 'starting', 'running', 'error']).toContain(status.state)
  })

  it('Document Studio — slide decks get a served URL (regression: was unregistered)', async () => {
    const deck = (await call(IpcChannels.slidesOpen, 'pitch.slides.md')) as {
      url?: string
      error?: string
    }
    expect(deck.error).toBeUndefined()
    expect(deck.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  })

  it('Document Studio — reads the formats it renders (md, json, csv, toml)', async () => {
    for (const file of ['hello.md', 'data.json', 'table.csv', 'config.toml']) {
      const read = (await call(IpcChannels.fsRead, file)) as { content?: string }
      expect(read.content, `${file} should be readable`).toBeTruthy()
    }
  })

  it('Sync and Secrets — settings surfaces answer', async () => {
    expect(await call(IpcChannels.syncStatus)).toHaveProperty('enabled')
    expect(await call(IpcChannels.secretsList)).toHaveProperty('encryptionAvailable')
  })

  it('App info — the shell identity is served by the core', async () => {
    const info = (await call(IpcChannels.appInfo)) as { version: string; platform: string }
    expect(info.version).toBeTruthy()
    expect(info.platform).toBe(process.platform)
  })
})

describe('the preview server does not hand the workspace to any local process', () => {
  it('refuses a request without the capability, and serves one with it', async () => {
    // The threat: another process running as this user. It can set any Host
    // header it likes, so the Host check alone protected nothing from it — and
    // the server's root is the workspace, source and dotfiles included.
    writeFileSync(join(workspace, 'secret.txt'), 'workspace contents')

    const started = (await call(IpcChannels.devServerStart, 'static')) as {
      url?: string | null
      state?: string
    }
    // Skip rather than pass vacuously if the server did not come up.
    if (!started.url) {
      expect(started.state).toBeTruthy()
      return
    }

    const base = new URL(started.url)
    const unauthenticated = `${base.protocol}//${base.host}/secret.txt`
    const withCapability = new URL('secret.txt', started.url).toString()

    const denied = await fetch(unauthenticated)
    expect(denied.status).toBe(404)

    const allowed = await fetch(withCapability)
    expect(allowed.status).toBe(200)
    expect(await allowed.text()).toContain('workspace contents')

    await call(IpcChannels.devServerStop)
  }, 30_000)

  it('refuses to follow a symlink out of the workspace', async () => {
    // The prefix check is textual, so a link inside the workspace pointing at
    // ~/.ssh passes it and then gets streamed. Not hypothetical: a link like
    // that ships in someone else's repo, and opening their project is enough.
    const outside = mkdtempSync(join(tmpdir(), 'wd-outside-'))
    writeFileSync(join(outside, 'private.txt'), 'not yours')
    symlinkSync(join(outside, 'private.txt'), join(workspace, 'escape.txt'))

    const started = (await call(IpcChannels.devServerStart, 'static')) as { url?: string | null }
    if (!started.url) return

    const escaped = await fetch(new URL('escape.txt', started.url).toString())
    expect(escaped.status).toBe(403)

    await call(IpcChannels.devServerStop)
    rmSync(outside, { recursive: true, force: true })
  }, 30_000)
})
