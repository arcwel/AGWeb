import { describe, it, expect } from 'vitest'
import { createWebUiIpc } from './ipc-adapter'
import { IpcChannels } from '@shared/ipc'
import type { CoreClient } from '../core/transports/ws-client'

/**
 * The adapter makes the core socket look like `ipcRenderer` to the renderer,
 * which was written against Electron. Where the two disagree about listener
 * bookkeeping, the renderer leaks — silently, and only under the fork.
 */

/** A CoreClient stand-in that records subscriptions and can emit to them. */
function fakeClient(): CoreClient & {
  emit(channel: string, payload: unknown): void
  live(): number
} {
  const subs = new Map<string, Set<(payload: unknown) => void>>()
  return {
    on(channel: string, listener: (payload: unknown) => void) {
      let set = subs.get(channel)
      if (!set) subs.set(channel, (set = new Set()))
      set.add(listener)
      return () => set!.delete(listener)
    },
    emit(channel: string, payload: unknown) {
      for (const l of subs.get(channel) ?? []) l(payload)
    },
    live: () => [...subs.values()].reduce((n, s) => n + s.size, 0)
  } as unknown as CoreClient & { emit(c: string, p: unknown): void; live(): number }
}

describe('createWebUiIpc listener bookkeeping', () => {
  it('delivers the payload with a null event, as ipcRenderer does', () => {
    const client = fakeClient()
    const ipc = createWebUiIpc(client)
    const seen: unknown[] = []
    ipc.on('event:x', (_e, payload) => seen.push(payload))

    client.emit('event:x', { ok: true })

    expect(seen).toEqual([{ ok: true }])
  })

  it('removeListener actually unsubscribes', () => {
    const client = fakeClient()
    const ipc = createWebUiIpc(client)
    const listener = (): void => {}
    ipc.on('event:x', listener)
    expect(client.live()).toBe(1)

    ipc.removeListener('event:x', listener)

    expect(client.live()).toBe(0)
  })

  it('subscribing the same listener twice leaves nothing behind (regression)', () => {
    const client = fakeClient()
    const ipc = createWebUiIpc(client)
    let calls = 0
    const listener = (): void => {
      calls += 1
    }

    // Electron allows this and fires twice; the adapter must match, and must
    // still be able to detach both. Keeping only the newest wrapper orphaned
    // the first subscription forever — it fired on every event and no
    // removeListener call could ever reach it.
    ipc.on('event:x', listener)
    ipc.on('event:x', listener)
    client.emit('event:x', 1)
    expect(calls).toBe(2)

    ipc.removeListener('event:x', listener)
    ipc.removeListener('event:x', listener)

    expect(client.live()).toBe(0)
    client.emit('event:x', 1)
    expect(calls).toBe(2) // no orphan still listening
  })

  it('removing a listener that was never added is a no-op', () => {
    const client = fakeClient()
    const ipc = createWebUiIpc(client)
    expect(() => ipc.removeListener('event:x', () => {})).not.toThrow()
    expect(client.live()).toBe(0)
  })
})

/** A client whose invoke resolves, so "went to the core" is visible in a result. */
function reachableCore(): CoreClient {
  return {
    invoke: (channel: string) => Promise.resolve({ reachedCore: channel }),
    on: () => () => {}
  } as unknown as CoreClient
}

describe('channels that need a path a browser will not give', () => {
  it('workspace:open reports that there is no picker instead of a silent cancel', async () => {
    const ipc = createWebUiIpc(reachableCore())

    // `null` is the value that means "the user cancelled", so answering with one
    // would leave the caller with nothing to say and nothing to show.
    await expect(ipc.invoke(IpcChannels.workspaceOpen)).rejects.toThrow(/typing its path/)
  })

  it('choose-download-dir points at the setting Chromium actually uses', async () => {
    const ipc = createWebUiIpc(reachableCore())

    await expect(ipc.invoke(IpcChannels.appSettingsChooseDownloadDir)).rejects.toThrow(
      /chrome:\/\/settings\/downloads/
    )
  })

  it('ext:load-path answers in its own error field, which the UI already renders', async () => {
    const ipc = createWebUiIpc(reachableCore())

    await expect(ipc.invoke(IpcChannels.extLoadPath, '/some/unpacked')).resolves.toEqual({
      error: expect.stringContaining('chrome://extensions')
    })
  })

  it('none of the three are forwarded to the core', async () => {
    const ipc = createWebUiIpc(reachableCore())

    // Before they were adapted these fell through to `client.invoke`, where the
    // headless core has no handler and the call rejected as an unknown method —
    // or, worse under a laxer transport, hung.
    const results = await Promise.allSettled([
      ipc.invoke(IpcChannels.workspaceOpen),
      ipc.invoke(IpcChannels.appSettingsChooseDownloadDir),
      ipc.invoke(IpcChannels.extLoadPath, '/some/unpacked')
    ])

    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value).not.toHaveProperty('reachedCore')
    }
  })
})
