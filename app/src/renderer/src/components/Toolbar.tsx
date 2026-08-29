import { useCallback, useEffect, useState } from 'react'
import { BLOCK_LABELS, useShellStore, type BlockType, type DeckPreset } from '@/store'
import { DeckIcon, PopOutIcon } from '@/components/icons'
import { BookmarkControls, FindBar, ZoomControls } from '@/components/BrowserControls'
import {
  ArrowBackIcon,
  ArrowForwardIcon,
  CloseIcon,
  HomeIcon as ChromeHomeIcon,
  IncognitoIcon,
  MoreVertIcon,
  PersonIcon,
  RefreshIcon,
  SettingsIcon,
  StopIcon,
  ExtensionIcon,
  HistoryIcon,
  SplitscreenIcon
} from '@/components/browser-icons'
import { GridIcon, ShieldIcon } from '@/components/UtilitiesBar'
import { DownloadsIndicator } from '@/components/DownloadsIndicator'
import { usePopover } from '@/popover'

const PRESETS: { id: DeckPreset; label: string; hint: string }[] = [
  { id: 'browsing', label: 'Browsing', hint: 'Deck hidden — just the web' },
  { id: 'building', label: 'Building', hint: 'Editor & files beside the page' },
  { id: 'debugging', label: 'Debugging', hint: 'Terminals, logs & agents forward' }
]

/** Local dev hosts: these serve plain http, so defaulting them to https
 *  would fail on the address a dev-focused browser is typed into most. */
const LOCAL_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^\s/]+\.localhost)(:\d+)?(\/.*)?$/i

/** Turn address-bar input into a navigable URL (or a search query). */
export function toNavigableUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^(https?|data|about|file):/i.test(trimmed)) return trimmed
  const bare = trimmed.replace(/^https?:\/\//, '')
  if (LOCAL_HOST_PATTERN.test(bare)) return `http://${bare}`
  if (/^[^\s]+\.[^\s/]+(\/.*)?$/.test(trimmed)) return `https://${bare}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

/** Ensure the tab's WebContentsView exists, then load the URL into it. */
export async function navigateTab(tabId: string, url: string): Promise<void> {
  const { tabs, markTabHasContent } = useShellStore.getState()
  const tab = tabs.find((t) => t.id === tabId)
  if (tab && !tab.hasContent) {
    await window.agweb.browser.create(tabId)
    markTabHasContent(tabId)
  }
  await window.agweb.browser.navigate(tabId, url)
}

export function Toolbar(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const homeUrl = useShellStore((s) => s.homeUrl)
  const activeTab = useShellStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const state = useShellStore((s) => s.browserStates[s.activeTabId])
  const deckRevealed = useShellStore((s) => s.deckRevealed)
  const deckMode = useShellStore((s) => s.deckMode)
  const toggleDeck = useShellStore((s) => s.toggleDeck)
  const detachDeck = useShellStore((s) => s.detachDeck)
  const applyPreset = useShellStore((s) => s.applyPreset)
  const addBlock = useShellStore((s) => s.addBlock)
  const [urlInput, setUrlInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [blocksOpen, setBlocksOpen] = useState(false)
  const proxyEnabled = useShellStore((s) => s.embedProxyEnabled)
  const setEmbedProxyEnabled = useShellStore((s) => s.setEmbedProxyEnabled)
  const utilitiesOpen = useShellStore((s) => s.utilitiesOpen)
  const setUtilitiesOpen = useShellStore((s) => s.setUtilitiesOpen)

  const blocksRef = usePopover(
    blocksOpen,
    useCallback(() => setBlocksOpen(false), [])
  )

  useEffect(() => {
    let cancelled = false
    void window.agweb.embedProxy.status().then((status) => {
      if (!cancelled) setEmbedProxyEnabled(status.enabled)
    })
    return () => {
      cancelled = true
    }
  }, [setEmbedProxyEnabled])

  const liveUrl = state?.url && state.url !== 'about:blank' ? state.url : ''
  const displayedUrl = editing ? urlInput : liveUrl

  const navigate = (): void => {
    const url = toNavigableUrl(urlInput)
    if (url) void navigateTab(activeTabId, url)
    setEditing(false)
  }

  const navButton = 'wd-icon'

  return (
    <div className="drag-region flex items-center gap-2 px-2 py-1.5">
      {/* Navigation */}
      <div className="flex items-center gap-px">
        <button
          className={navButton}
          disabled={!state?.canGoBack}
          onClick={() => void window.agweb.browser.back(activeTabId)}
          aria-label="Back"
        >
          <ArrowBackIcon />
        </button>
        <button
          className={navButton}
          disabled={!state?.canGoForward}
          onClick={() => void window.agweb.browser.forward(activeTabId)}
          aria-label="Forward"
        >
          <ArrowForwardIcon />
        </button>
        <button
          className={navButton}
          disabled={!state}
          onClick={() =>
            state?.isLoading
              ? void window.agweb.browser.stop(activeTabId)
              : void window.agweb.browser.reload(activeTabId)
          }
          aria-label={state?.isLoading ? 'Stop' : 'Reload'}
        >
          {state?.isLoading ? <StopIcon /> : <RefreshIcon />}
        </button>
        <button
          className={navButton}
          onClick={() => void navigateTab(activeTabId, homeUrl)}
          aria-label="Home"
          title={`Home — ${homeUrl}`}
          data-testid="nav-home"
        >
          <ChromeHomeIcon />
        </button>
      </div>

      {/* Address, centred: the icon clusters flank it on both sides. The
          bookmark star leads the bar on the far left; zoom sits on the right. */}
      <div className="relative flex min-w-0 flex-1 items-center">
        <div className="absolute left-1.5 flex items-center">
          <BookmarkControls
            tabId={activeTabId}
            url={state?.url ?? ''}
            title={state?.title ?? ''}
            align="left"
          />
        </div>
        <input
          value={activeTab?.kind === 'doc' ? `studio · ${activeTab.docPath}` : displayedUrl}
          disabled={activeTab?.kind === 'doc'}
          placeholder="Enter URL or search…"
          spellCheck={false}
          onChange={(e) => {
            setEditing(true)
            setUrlInput(e.target.value)
          }}
          onFocus={(e) => {
            setEditing(true)
            setUrlInput(liveUrl)
            e.target.select()
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === 'Enter' && navigate()}
          style={{ borderRadius: 'var(--wd-r-pill)' }}
          className="m w-full border border-[var(--wd-glass-border)] bg-[var(--wd-field)] py-1.5 pr-14 pl-[4.6rem] text-[12px] text-[var(--wd-text)] outline-none placeholder:text-[var(--wd-dim)] focus:border-[var(--wd-accent-line)]"
        />
        <div className="absolute right-1.5 flex items-center">
          <ZoomControls tabId={activeTabId} />
        </div>
      </div>

      {proxyEnabled && (
        <button
          onClick={() =>
            void window.agweb.embedProxy
              .setEnabled(false)
              .then((status) => setEmbedProxyEnabled(status.enabled))
          }
          className="wd-icon text-amber-400"
          title="Embed proxy is on for localhost — click to turn it off"
          data-testid="proxy-indicator"
        >
          <ShieldIcon />
        </button>
      )}

      {/* Everything from here sits hard right. */}
      <div className="ml-auto flex flex-none items-center gap-px">
        <button
          onClick={() => setUtilitiesOpen(!utilitiesOpen)}
          className={`wd-icon ${utilitiesOpen ? 'wd-icon-on' : ''}`}
          title="Favourites bar"
          aria-label="Favourites bar"
          data-testid="utilities-toggle"
        >
          <GridIcon />
        </button>
        <ExtensionsButton />
        <DownloadsIndicator />
        <FindBar tabId={activeTabId} />
        <BrowserMenu />
      </div>

      {/* Profiles sit directly left of the Deck button. */}
      <ProfileButton />

      {deckMode === 'detached' ? (
        <button
          onClick={() => void window.agweb.windows.focusDeck()}
          className="wd-icon"
          aria-label="Focus detached deck window"
          title="The deck is detached — click to focus its window"
          data-testid="deck-detached"
        >
          <PopOutIcon />
        </button>
      ) : (
        <button
          onClick={toggleDeck}
          className="wd-icon"
          style={{
            background: deckRevealed ? 'var(--wd-accent)' : 'var(--wd-accent-soft)',
            color: deckRevealed ? 'var(--wd-accent-ink)' : 'var(--wd-accent)'
          }}
          aria-label="Toggle Dev Deck"
          title="Dev Deck (⌘D)"
          data-testid="deck-toggle"
        >
          <DeckIcon />
        </button>
      )}

      {deckRevealed && deckMode === 'attached' && (
        <>
          <div className="relative flex-none" ref={blocksRef}>
            <button
              onClick={() => setBlocksOpen((o) => !o)}
              className="wd-icon"
              aria-label="Deck options"
              title="Deck options"
              data-testid="deck-menu"
            >
              <MoreVertIcon />
            </button>
            {blocksOpen && (
              <div className="glass absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-[14px] py-1">
                <div className="wd-cap px-3 py-1.5">Add block</div>
                {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      addBlock(type)
                      setBlocksOpen(false)
                    }}
                    className="block w-full px-3.5 py-1.5 text-left text-xs font-medium text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
                  >
                    {BLOCK_LABELS[type]}
                  </button>
                ))}
                <div className="wd-cap mt-1 border-t border-[var(--wd-hairline)] px-3 py-1.5">
                  Layout
                </div>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      applyPreset(preset.id)
                      setBlocksOpen(false)
                    }}
                    className="flex w-full flex-col gap-0.5 px-3.5 py-1.5 text-left hover:bg-[var(--wd-hover)]"
                  >
                    <span className="text-xs font-semibold text-[var(--wd-text)]">
                      {preset.label}
                    </span>
                    <span className="text-[11px] text-[var(--wd-dim)]">{preset.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={detachDeck}
            className="wd-icon"
            aria-label="Detach deck"
            title="Detach the deck into its own window"
          >
            <PopOutIcon />
          </button>
        </>
      )}
    </div>
  )
}

/** Extensions, with the notification dot the design shows. */
/**
 * Chrome's profile avatar. Switching the active profile changes which
 * persistent session new tabs open in, so each profile keeps its own signed-in
 * accounts (Google included). New tabs pick up the switch; existing tabs keep
 * the profile they were opened in, exactly as separate Chrome windows do.
 */
function ProfileButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{
    profiles: Array<{ id: string; name: string; color: string }>
    activeId: string
  } | null>(null)
  const [adding, setAdding] = useState('')
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  const refresh = useCallback(() => {
    void window.agweb.profiles.list().then(setState)
  }, [])
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const active = state?.profiles.find((p) => p.id === state.activeId)

  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="wd-icon relative"
        title={active ? `Profile: ${active.name}` : 'Profiles'}
        aria-label="Profiles"
        data-testid="profile-button"
      >
        {active ? (
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-[var(--wd-accent-ink)]"
            style={{ background: active.color }}
          >
            {active.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <PersonIcon size={15} />
        )}
      </button>
      {open && state && (
        <div className="glass absolute right-0 top-9 z-50 w-60 overflow-hidden rounded-[14px] p-1">
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
            Profiles
          </p>
          {state.profiles.map((profile) => (
            <div
              key={profile.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                profile.id === state.activeId
                  ? 'bg-[var(--wd-accent-soft)]'
                  : 'hover:bg-[var(--wd-hover)]'
              }`}
            >
              <button
                onClick={() => {
                  void window.agweb.profiles.setActive(profile.id).then(setState)
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold text-[var(--wd-accent-ink)]"
                  style={{ background: profile.color }}
                >
                  {profile.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate text-[12px] text-[var(--wd-text)]">{profile.name}</span>
                {profile.id === state.activeId && (
                  <span className="ml-auto text-[9.5px] font-semibold text-[var(--wd-accent)]">
                    ACTIVE
                  </span>
                )}
              </button>
              {profile.id !== 'default' && (
                <button
                  onClick={() => {
                    void window.agweb
                      .confirm(
                        `Remove the “${profile.name}” profile? Its cookies, logins, and site data are permanently deleted.`
                      )
                      .then((ok) => {
                        if (ok) void window.agweb.profiles.remove(profile.id).then(setState)
                      })
                  }}
                  className="hidden flex-none text-[var(--wd-dim)] hover:text-rose-500 group-hover:block"
                  title="Remove profile and its data"
                  aria-label="Remove profile"
                >
                  <CloseIcon size={13} />
                </button>
              )}
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (adding.trim() === '') return
              void window.agweb.profiles.create(adding.trim()).then((next) => {
                setState(next)
                setAdding('')
              })
            }}
            className="mt-1 flex items-center gap-1 border-t border-[var(--wd-glass-border)] px-2 pt-1.5"
          >
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="New profile…"
              className="min-w-0 flex-1 rounded-md bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-[var(--wd-accent)]"
            />
            <button
              type="submit"
              className="rounded-md bg-[var(--wd-accent)] px-2 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)]"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function ExtensionsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )
  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="wd-icon relative"
        title="Extensions"
        aria-label="Extensions"
        data-testid="extensions-button"
      >
        <ExtensionIcon />
      </button>
      {open && (
        <div className="glass absolute right-0 top-9 z-50 w-64 overflow-hidden rounded-[14px] p-1">
          <button
            onClick={() => {
              setOpen(false)
              void window.agweb.extensions.load()
            }}
            className="block w-full rounded-lg px-3 py-1.5 text-left text-[12px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
          >
            Load unpacked extension…
          </button>
          <p className="px-3 py-1.5 text-[10.5px] leading-relaxed text-[var(--wd-dim)]">
            Unpacked MV3 extensions load into the browser session only, never the shell.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Chrome's overflow menu — the settings entry point the design puts at the end
 * of the icon cluster, and which the app was missing entirely.
 */
function BrowserMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const proxyEnabled = useShellStore((s) => s.embedProxyEnabled)
  const setEmbedProxyEnabled = useShellStore((s) => s.setEmbedProxyEnabled)
  const addBlock = useShellStore((s) => s.addBlock)
  const theme = useShellStore((s) => s.theme)
  const setTheme = useShellStore((s) => s.setTheme)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  const item =
    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]'

  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="wd-icon"
        title="Menu"
        aria-label="Menu"
        data-testid="browser-menu"
      >
        <MoreVertIcon />
      </button>
      {open && (
        <div className="glass absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-[14px] py-1">
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              useShellStore.getState().newTab()
            }}
          >
            <span className="w-4 text-[var(--wd-dim)]">+</span> New tab
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              useShellStore.getState().setSettingsOpen(true)
            }}
            data-testid="menu-settings"
          >
            <SettingsIcon size={15} className="text-[var(--wd-dim)]" /> Settings
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              addBlock('agents')
            }}
          >
            <PersonIcon size={15} className="text-[var(--wd-dim)]" /> Agent
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              addBlock('logs')
            }}
          >
            <HistoryIcon size={15} className="text-[var(--wd-dim)]" /> Logs
          </button>
          <div className="my-1 border-t border-[var(--wd-hairline)]" />
          <button className={item} onClick={() => void window.agweb.extensions.load()}>
            <ExtensionIcon size={15} className="text-[var(--wd-dim)]" /> Load unpacked extension…
          </button>
          <button
            className={item}
            onClick={() =>
              void window.agweb.embedProxy
                .setEnabled(!proxyEnabled)
                .then((status) => setEmbedProxyEnabled(status.enabled))
            }
            aria-label="Toggle embed proxy"
          >
            <ShieldIcon size={15} />
            <span className={proxyEnabled ? 'text-[var(--wd-accent)]' : ''}>
              Embed proxy {proxyEnabled ? 'on' : 'off'}
            </span>
          </button>
          <div className="my-1 border-t border-[var(--wd-hairline)]" />
          <button className={item} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <IncognitoIcon size={15} className="text-[var(--wd-dim)]" />
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              void window.agweb.browser.openDevTools(useShellStore.getState().activeTabId)
            }}
          >
            <SplitscreenIcon size={15} className="text-[var(--wd-dim)]" /> Developer tools
          </button>
        </div>
      )}
    </div>
  )
}
