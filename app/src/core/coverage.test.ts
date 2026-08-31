import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import { startWebdeckCore } from './server'
import { core } from './rpc'
import { SHELL_OWNED } from '../webui/ipc-adapter'
import type { WsServerHandle } from './transports/ws-server'

/**
 * The boundary test for the Electron→Chromium migration.
 *
 * Every other test asserts that one thing works. This asserts that *nothing was
 * forgotten* — that each channel the UI can call is either served by the
 * headless core, answered by the shell adapter, or named below as deliberately
 * host-owned. It is the only test that fails when someone adds a channel and
 * wires it up under Electron alone.
 *
 * That is exactly how Preview (`devserver:*`) and Reveal.js (`slides:open`)
 * broke: the UI was perfect, the block rendered, and the call had no handler on
 * the fork. Per-block tests found them one at a time, after the fact. This finds
 * the next one before it ships.
 */

/**
 * Channels the *host* answers, not webdeck-core — each with the reason, so that
 * adding a name here is a decision someone has to justify rather than a way to
 * make the test go quiet.
 */
const HOST_OWNED: Record<string, string> = {
  // Chromium is the browser. Under the fork these are the real tab strip,
  // omnibox, find bar and print dialog — reimplementing them over the socket
  // would put a second, worse browser inside the real one.
  'browser:create': 'Chromium owns tabs',
  'browser:destroy': 'Chromium owns tabs',
  'browser:navigate': 'Chromium owns navigation',
  'browser:back': 'Chromium owns navigation',
  'browser:forward': 'Chromium owns navigation',
  'browser:reload': 'Chromium owns navigation',
  'browser:stop': 'Chromium owns navigation',
  'browser:set-bounds': 'Electron-only view geometry; the fork uses real tabs',
  'browser:set-visible': 'Electron-only view geometry; the fork uses real tabs',
  'browser:set-corner-radius': 'Electron-only view geometry; the fork uses real tabs',
  'browser:devtools': 'Chromium owns DevTools',
  'browser:find': 'Chromium owns the find bar',
  'browser:find-stop': 'Chromium owns the find bar',
  'browser:print': 'Chromium owns printing',
  'permission:respond':
    'Chromium owns camera/mic/geolocation prompts (agent policy is policy:respond, which IS in the core)',

  // Chromium has its own profile and extension machinery.
  'profiles:set-active': 'Chromium owns profiles',
  'profiles:create': 'Chromium owns profiles',
  'profiles:remove': 'Chromium owns profiles',
  'profiles:google-status': 'Chromium owns sign-in',
  'ext:load': 'Chromium owns extensions',
  'ext:load-packed': 'Chromium owns extensions',
  'ext:remove': 'Chromium owns extensions',

  // Answered synchronously from a primed cache, never over the async socket.
  'app-settings:read-sync': 'served by primeSyncCache (sendSync has no await)',
  'app-settings:clear-data': 'clears the host session store',
  'shell:broadcast': 'cross-window sync; the fork has one window (host.canOpenWindows)'
}

let handle: WsServerHandle
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-coverage-'))
  handle = await startWebdeckCore({ userDataDir: dataDir, port: 0 })
})

afterAll(async () => {
  await handle?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('IPC channel coverage on the Chromium fork', () => {
  it('every channel is served by the core, the adapter, or a named host owner', () => {
    const { request, notify } = core.methods()
    const served = new Set([...request, ...notify, ...Object.keys(SHELL_OWNED)])

    const unaccounted = Object.values(IpcChannels).filter(
      (channel) => !served.has(channel) && !(channel in HOST_OWNED)
    )

    expect(
      unaccounted,
      'These channels have no handler on the Chromium fork. Register them in ' +
        'src/core/server.ts, add them to SHELL_OWNED, or name them in HOST_OWNED ' +
        'with the reason they cannot be served headlessly.'
    ).toEqual([])
  })

  it('the host-owned list has no stale entries', () => {
    const { request, notify } = core.methods()
    const served = new Set([...request, ...notify, ...Object.keys(SHELL_OWNED)])
    const all = new Set<string>(Object.values(IpcChannels))

    // An entry that is now served by the core is a leftover excuse; an entry for
    // a channel that no longer exists is dead weight. Both should be deleted.
    const nowServed = Object.keys(HOST_OWNED).filter((c) => served.has(c))
    const gone = Object.keys(HOST_OWNED).filter((c) => !all.has(c))

    expect(nowServed, 'now served by the core — remove from HOST_OWNED').toEqual([])
    expect(gone, 'no longer a channel — remove from HOST_OWNED').toEqual([])
  })

  it('the blocks a developer works in are served headlessly, not by the host', () => {
    const { request } = core.methods()
    const served = new Set(request)
    // The IDE half of the app must never regress into needing Electron: these
    // are the channels whose absence broke a block in this migration before.
    for (const channel of [
      IpcChannels.fsList,
      IpcChannels.fsRead,
      IpcChannels.fsWrite,
      IpcChannels.searchQuery,
      IpcChannels.gitStatus,
      IpcChannels.taskList,
      IpcChannels.devServerStatus,
      IpcChannels.slidesOpen,
      IpcChannels.agentList,
      IpcChannels.policyGet,
      IpcChannels.policyRespond,
      IpcChannels.workspaceOpenPath,
      IpcChannels.termCreate,
      IpcChannels.lspStart,
      IpcChannels.debugStart
    ]) {
      expect(served.has(channel), `${channel} must be served by webdeck-core`).toBe(true)
    }
  })
})
