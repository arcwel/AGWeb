import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * What comes back when the window reopens.
 *
 * A blank tab carries nothing: restoring it hands the user an empty tab to
 * close by hand, and a session that accumulated five of them reopens as five.
 * The window always opens with one blank tab anyway, so restoring more is pure
 * cost. Pinned here because the filter runs at boot, where a regression is
 * invisible until someone counts their tabs.
 */

const TABS_KEY = 'agweb.tabs:default'

/** A real in-memory localStorage: jsdom's is not usable in this config. */
function installStorage(): Map<string, string> {
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
  return data
}

function installHost(): void {
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
    appSettings: { readSync: () => ({ restoreTabs: true }) },
    browser: { destroy: vi.fn(async () => {}) },
    profiles: { list: vi.fn(async () => ({ profiles: [], activeId: '' })) }
  }
}

async function freshStore(): Promise<typeof import('./store')> {
  vi.resetModules()
  return import('./store')
}

/** A saved session, in the shape serializeTabSession writes. */
function saveSession(
  data: Map<string, string>,
  tabs: { url?: string; title?: string; kind?: string; docPath?: string; groupId?: string }[],
  extra: { activeIndex?: number; groups?: unknown[] } = {}
): void {
  data.set(
    TABS_KEY,
    JSON.stringify({
      tabs: tabs.map((t) => ({ kind: t.kind ?? 'web', ...t })),
      activeIndex: extra.activeIndex ?? 0,
      groups: extra.groups ?? []
    })
  )
}

describe('restoring the tab strip', () => {
  let data: Map<string, string>
  beforeEach(() => {
    data = installStorage()
    installHost()
  })

  it('drops blank tabs and keeps the real ones', async () => {
    saveSession(data, [
      { url: 'https://example.com/one', title: 'One' },
      { url: '' },
      { url: 'about:blank' },
      { url: 'chrome://newtab/' },
      { url: 'https://example.com/two', title: 'Two' }
    ])
    const { useShellStore } = await freshStore()

    useShellStore.getState().restoreTabSession()

    const tabs = useShellStore.getState().tabs
    expect(tabs).toHaveLength(2)
    expect(tabs.map((t) => t.title)).toEqual(['One', 'Two'])
  })

  it('leaves the boot tab alone when every saved tab was blank', async () => {
    saveSession(data, [{ url: '' }, { url: 'about:blank' }])
    const { useShellStore } = await freshStore()
    const before = useShellStore.getState().tabs

    useShellStore.getState().restoreTabSession()

    // Nothing worth restoring: the window keeps the one tab it opened with,
    // rather than being emptied or handed two blanks.
    expect(useShellStore.getState().tabs).toEqual(before)
  })

  it('keeps a document tab, which is never blank', async () => {
    saveSession(data, [{ kind: 'doc', docPath: '/tmp/notes.md' }, { url: '' }])
    const { useShellStore } = await freshStore()

    useShellStore.getState().restoreTabSession()

    const tabs = useShellStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].kind).toBe('doc')
    expect(tabs[0].docPath).toBe('/tmp/notes.md')
  })

  it('moves the active tab to a tab that survived the filter', async () => {
    // The user was on the third tab, which was blank. Restoring an index into
    // the unfiltered list would point past the end.
    saveSession(data, [{ url: 'https://a.test', title: 'A' }, { url: '' }, { url: '' }], {
      activeIndex: 2
    })
    const { useShellStore } = await freshStore()

    useShellStore.getState().restoreTabSession()

    const { tabs, activeTabId } = useShellStore.getState()
    expect(tabs).toHaveLength(1)
    expect(activeTabId).toBe(tabs[0].id)
  })

  it('drops a group whose only tab was blank', async () => {
    saveSession(
      data,
      [
        { url: 'https://a.test', title: 'A' },
        { url: '', groupId: 'g1' }
      ],
      { groups: [{ id: 'g1', name: 'Research', color: 'blue', collapsed: false }] }
    )
    const { useShellStore } = await freshStore()

    useShellStore.getState().restoreTabSession()

    // An empty group would draw a header with nothing under it.
    expect(Object.keys(useShellStore.getState().tabGroups)).toHaveLength(0)
  })

  it('keeps a group that still has a tab', async () => {
    saveSession(
      data,
      [
        { url: 'https://a.test', title: 'A', groupId: 'g1' },
        { url: '', groupId: 'g1' }
      ],
      { groups: [{ id: 'g1', name: 'Research', color: 'blue', collapsed: false }] }
    )
    const { useShellStore } = await freshStore()

    useShellStore.getState().restoreTabSession()

    const groups = Object.values(useShellStore.getState().tabGroups)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Research')
    expect(useShellStore.getState().tabs[0].groupId).toBe(groups[0].id)
  })
})
