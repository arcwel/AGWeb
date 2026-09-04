import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * What the tab strip looks like after a drop.
 *
 * A dropped file gets a tab of its own, so every failure has to take that tab
 * back with it. It did not: `browser.create` throws when the browser cannot be
 * reached, the throw escaped past the cleanup, and the user was left with a
 * permanently empty tab and no reason for it.
 */

const openDroppedFileMock = vi.fn(async (_tabId: string, _name: string) => true)
vi.mock('../../webui/shell', () => ({
  browserPrefs: {
    openDroppedFile: (tabId: string, name: string) => openDroppedFileMock(tabId, name)
  }
}))

function installStorage(): void {
  const data = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size
      }
    }
  })
}

interface HostOptions {
  staged: { name?: string; docPath?: string; error?: string }
  createThrows?: boolean
}

function installHost({ staged, createThrows }: HostOptions): void {
  ;(window as unknown as { agweb: unknown }).agweb = {
    host: {
      kind: 'chromium',
      ownsBrowserChrome: true,
      ownsBrowserFeatures: true,
      canOpenWindows: false,
      canPickPaths: false,
      canExport: false
    },
    windows: {
      broadcastState: vi.fn(),
      openDeck: vi.fn(),
      closeDeck: vi.fn(),
      syncFloats: vi.fn(),
      focusDeck: vi.fn()
    },
    appSettings: { readSync: () => ({ restoreTabs: false }) },
    profiles: { list: vi.fn(async () => ({ profiles: [], activeId: '' })) },
    drops: { write: vi.fn(async () => staged) },
    browser: {
      create: vi.fn(async () => {
        if (createThrows) throw new Error('the WebDeck shell cannot reach the browser on this host')
      }),
      destroy: vi.fn(async () => {})
    }
  }
}

async function load(): Promise<{
  openDroppedFile: typeof import('./drop-file').openDroppedFile
  useShellStore: typeof import('./store').useShellStore
}> {
  vi.resetModules()
  const store = await import('./store')
  const drop = await import('./drop-file')
  return { openDroppedFile: drop.openDroppedFile, useShellStore: store.useShellStore }
}

/** Just the surface openDroppedFile touches. jsdom's File has no
 *  arrayBuffer(), so a real one fails to read before any of this is reached. */
const aFile = (name: string, bytes = new Uint8Array([1, 2, 3])): File =>
  ({
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer
  }) as unknown as File

describe('opening a dropped file', () => {
  beforeEach(() => {
    installStorage()
    openDroppedFileMock.mockClear()
    openDroppedFileMock.mockResolvedValue(true)
  })

  it('leaves no tab behind when the browser cannot be reached', async () => {
    installHost({ staged: { name: 'stage/report.pdf' }, createThrows: true })
    const { openDroppedFile, useShellStore } = await load()
    const before = useShellStore.getState().tabs.length

    const result = await openDroppedFile(aFile('report.pdf'))

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cannot reach the browser/)
    expect(useShellStore.getState().tabs).toHaveLength(before)
  })

  it('leaves no tab behind when the browser refuses the file', async () => {
    installHost({ staged: { name: 'stage/report.pdf' } })
    openDroppedFileMock.mockResolvedValue(false)
    const { openDroppedFile, useShellStore } = await load()
    const before = useShellStore.getState().tabs.length

    const result = await openDroppedFile(aFile('report.pdf'))

    expect(result.ok).toBe(false)
    expect(useShellStore.getState().tabs).toHaveLength(before)
  })

  it('opens a browser tab for a file the browser renders', async () => {
    installHost({ staged: { name: 'stage/report.pdf' } })
    const { openDroppedFile, useShellStore } = await load()
    const before = useShellStore.getState().tabs.length

    const result = await openDroppedFile(aFile('report.pdf'))

    expect(result.ok).toBe(true)
    expect(useShellStore.getState().tabs).toHaveLength(before + 1)
    expect(openDroppedFileMock).toHaveBeenCalledWith(expect.any(String), 'stage/report.pdf')
  })

  it('opens a document in Document Studio and never asks the browser', async () => {
    installHost({ staged: { docPath: '/tmp/drops/x/notes.md' } })
    const { openDroppedFile, useShellStore } = await load()

    const result = await openDroppedFile(aFile('notes.md'))

    expect(result.ok).toBe(true)
    expect(openDroppedFileMock).not.toHaveBeenCalled()
    const doc = useShellStore.getState().tabs.find((t) => t.kind === 'doc')
    expect(doc?.docPath).toBe('/tmp/drops/x/notes.md')
  })

  it('mints no tab at all when staging failed', async () => {
    installHost({ staged: { error: 'That file was empty.' } })
    const { openDroppedFile, useShellStore } = await load()
    const before = useShellStore.getState().tabs.length

    const result = await openDroppedFile(aFile('report.pdf'))

    expect(result.ok).toBe(false)
    expect(result.error).toBe('That file was empty.')
    expect(useShellStore.getState().tabs).toHaveLength(before)
  })

  it('refuses an empty file before it reaches the core', async () => {
    installHost({ staged: { name: 'stage/x.pdf' } })
    const { openDroppedFile, useShellStore } = await load()
    const before = useShellStore.getState().tabs.length

    const result = await openDroppedFile(aFile('empty.pdf', new Uint8Array()))

    expect(result.ok).toBe(false)
    expect(useShellStore.getState().tabs).toHaveLength(before)
    expect(window.agweb.drops.write).not.toHaveBeenCalled()
  })
})
