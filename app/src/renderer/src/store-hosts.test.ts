import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The shell state must stay renderable on the host it is actually running on.
 *
 * Both bugs below lost user data with no error and no undo, because the state
 * they produce is legal but has nowhere to render: a detached Deck needs a
 * second window, and a profile id the host does not have needs a bookmark store
 * that was never written. Under Electron the window opens and the id is real,
 * so neither shows up until the fork — where the layout is still persisted, so
 * the loss survives a restart.
 */

/** A real in-memory localStorage: jsdom's is not usable in this config, and the
 *  store persists layout and bookmarks through it. */
function installStorage(): void {
  const data = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size
      }
    }
  })
}

/** Install a `window.agweb` with just the surface the store touches. */
function installHost(canOpenWindows: boolean): void {
  ;(window as unknown as { agweb: unknown }).agweb = {
    host: {
      kind: canOpenWindows ? 'electron' : 'chromium',
      ownsBrowserChrome: !canOpenWindows,
      ownsBrowserFeatures: !canOpenWindows,
      canOpenWindows,
      canPickPaths: canOpenWindows,
      canExport: canOpenWindows
    },
    windows: {
      broadcastState: vi.fn(),
      openDeck: vi.fn(),
      closeDeck: vi.fn(),
      syncFloats: vi.fn(),
      focusDeck: vi.fn()
    },
    profiles: { list: vi.fn(async () => ({ profiles: [], activeId: '' })) }
  }
}

async function freshStore(): Promise<typeof import('./store')> {
  vi.resetModules()
  return import('./store')
}

describe('Deck detach on a host with no second window', () => {
  beforeEach(() => installStorage())

  it('stays attached rather than detaching into a window that never opens', async () => {
    installHost(false)
    const { useShellStore } = await freshStore()

    useShellStore.getState().detachDeck()

    // 'detached' stops <Deck /> rendering inline AND asks for a window the host
    // cannot open — the Deck would simply be gone, and persisted that way.
    expect(useShellStore.getState().deckMode).toBe('attached')
    expect(useShellStore.getState().deckRevealed).toBe(true)
  })

  it('still detaches on a host that can open one', async () => {
    installHost(true)
    const { useShellStore } = await freshStore()

    useShellStore.getState().detachDeck()

    expect(useShellStore.getState().deckMode).toBe('detached')
  })
})

describe('syncProfile', () => {
  beforeEach(() => installStorage())

  it('ignores an empty profile id instead of adopting it', async () => {
    installHost(false)
    const { useShellStore } = await freshStore()
    useShellStore.getState().addBookmark('https://example.com', 'Example')
    const before = useShellStore.getState().activeProfileId

    // What profiles:list returns on the fork: no profiles, activeId ''. Taking
    // it at face value swapped the bookmarks for the empty set and pointed
    // every later save at a key nothing reads back.
    useShellStore.getState().syncProfile('')

    expect(useShellStore.getState().activeProfileId).toBe(before)
    expect(useShellStore.getState().bookmarks.map((b) => b.url)).toContain('https://example.com')
  })

  it('switches when given a real profile id', async () => {
    installHost(true)
    const { useShellStore } = await freshStore()
    useShellStore.getState().addBookmark('https://a.test', 'A')

    useShellStore.getState().syncProfile('work')

    expect(useShellStore.getState().activeProfileId).toBe('work')
    expect(useShellStore.getState().bookmarks).toEqual([])
  })
})
