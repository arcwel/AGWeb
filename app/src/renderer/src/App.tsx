import { useCallback, useEffect } from 'react'
import { TabStrip } from '@/components/TabStrip'
import { UtilitiesBar } from '@/components/UtilitiesBar'
import { Toolbar } from '@/components/Toolbar'
import { Stage } from '@/components/Stage'
import { Deck } from '@/components/Deck'
import { PermissionPrompts } from '@/components/PermissionPrompts'
import { SettingsOverlay } from '@/components/SettingsOverlay'
import { ToastHost } from '@/components/ToastHost'
import { useShellStore } from '@/store'
import { useThemeEffect } from '@/theme'
import { useShortcut } from '@/shortcuts'
import { useAppCommands } from '@/commands'
import { useWindowReconciler } from '@/windowSync'

export default function App(): React.JSX.Element {
  const deckRevealed = useShellStore((s) => s.deckRevealed)
  const deckMode = useShellStore((s) => s.deckMode)
  const deckSizes = useShellStore((s) => s.deckSizes)
  // An empty zone must not reserve space — a permanent empty band at the
  // bottom was the most obvious thing wrong with the first build.
  const groups = useShellStore((s) => s.groups)
  const dockEmpty = !groups.some((g) => g.zone === 'bottom')
  const leftEmpty = !groups.some((g) => g.zone === 'left')
  const hasRail = useShellStore((s) => s.rail.length > 0)
  const toggleDeck = useShellStore((s) => s.toggleDeck)
  const newTab = useShellStore((s) => s.newTab)
  const closeTab = useShellStore((s) => s.closeTab)
  const setTheme = useShellStore((s) => s.setTheme)
  const applyPreset = useShellStore((s) => s.applyPreset)

  useThemeEffect()
  useWindowReconciler()

  // Load the active profile's bookmarks at boot (they are stored per profile).
  useEffect(() => {
    void window.agweb.profiles.list().then((state) => {
      useShellStore.getState().syncProfile(state.activeId)
    })
  }, [])

  // Route embedded-browser events into the store: live navigation state, and
  // pages requesting a new window become new browser tabs.
  useEffect(() => {
    const offState = window.agweb.browser.onState(useShellStore.getState().updateBrowserState)
    const offOpen = window.agweb.browser.onOpenTab((url) => {
      useShellStore.getState().newTab(url)
    })
    const offAdopt = window.agweb.browser.onAdoptTab((tabId) => {
      useShellStore.getState().adoptBrowserTab(tabId)
    })
    // A file: navigation to a workspace doc renders it in Document Studio (P3-3).
    const offDoc = window.agweb.browser.onOpenDoc((path) => {
      useShellStore.getState().openDoc(path)
    })
    return () => {
      offState()
      offOpen()
      offAdopt()
      offDoc()
    }
  }, [])

  // Surface denied agent actions as a toast, so a silently-blocked action isn't
  // invisible — especially an automatic policy deny with no prompt (P2-13).
  useEffect(() => {
    return window.agweb.policy.onDenied((info) => {
      const what =
        info.kind === 'file_write'
          ? 'file write'
          : info.kind === 'command'
            ? 'command'
            : 'navigation'
      useShellStore
        .getState()
        .pushToast(
          info.byUser
            ? `Denied the agent's ${what} — it was told.`
            : `Policy auto-denied the agent's ${what}.`,
          'warn'
        )
    })
  }, [])

  // A pull applied settings from another device — never silent, since one of the
  // synced sections is the agent's permission policy (the security gate).
  useEffect(() => {
    return window.agweb.sync.onPulled(() => {
      useShellStore.getState().pushToast('Settings updated from a synced device.', 'info')
    })
  }, [])

  useShortcut(
    'mod+d',
    'Reveal / hide the Dev Deck',
    useCallback(() => {
      if (useShellStore.getState().deckMode === 'detached') void window.agweb.windows.focusDeck()
      else toggleDeck()
    }, [toggleDeck])
  )
  useShortcut(
    'mod+t',
    'New browser tab',
    useCallback(() => newTab(), [newTab])
  )
  useShortcut(
    'mod+w',
    'Close active tab',
    useCallback(() => closeTab(useShellStore.getState().activeTabId), [closeTab])
  )
  useShortcut(
    'mod+shift+l',
    'Toggle light/dark theme',
    useCallback(() => {
      setTheme(useShellStore.getState().theme === 'dark' ? 'light' : 'dark')
    }, [setTheme])
  )
  // Layout presets — one keystroke swaps the whole Dev Deck arrangement (P3-7).
  useShortcut(
    'mod+1',
    'Layout preset: Browsing',
    useCallback(() => applyPreset('browsing'), [applyPreset])
  )
  useShortcut(
    'mod+2',
    'Layout preset: Building',
    useCallback(() => applyPreset('building'), [applyPreset])
  )
  useShortcut(
    'mod+3',
    'Layout preset: Debugging',
    useCallback(() => applyPreset('debugging'), [applyPreset])
  )

  // Commands the native menu sends. They ride the same registry as keyboard
  // combos — a menu item and its accelerator are then one handler, not two
  // implementations that can drift apart.
  useAppCommands()

  const revealed = deckRevealed && deckMode === 'attached'

  return (
    <div className="wd-shell flex h-full flex-col">
      {/* Chrome is flush with the top of the window and shares its ground, so
          there is no seam between the app and its title bar. Tabs occupy the
          title-bar row itself, inline with the traffic lights. */}
      {/* Under the Chromium fork the page sits inside a real browser tab, so
          Chromium already draws the tab strip and address bar. Drawing ours too
          would stack a second, non-functional copy beneath the working one —
          and the user would reach for whichever is nearer the content. */}
      {!window.agweb.host.ownsBrowserChrome && (
        <div className="wd-chrome flex flex-none flex-col">
          <TabStrip />
          <Toolbar />
        </div>
      )}
      {!window.agweb.host.ownsBrowserChrome && <UtilitiesBar />}
      <PermissionPrompts />
      <SettingsOverlay />
      <ToastHost />
      <div
        className={`workspace ${revealed ? 'revealed' : ''} ${hasRail ? 'has-rail' : ''} ${
          dockEmpty ? 'dock-empty' : ''
        } ${leftEmpty ? 'left-empty' : ''}`}
        style={
          {
            '--deck-col-w': `${deckSizes.colWidth}px`,
            // Computed here, not in CSS: these are inline custom properties, so
            // a `.dock-empty` class rule would lose to them on specificity and
            // the stage would keep reserving space for a dock that isn't there.
            '--deck-left-w': `${leftEmpty ? 0 : deckSizes.leftWidth || 320}px`,
            // -12px cancels the 12px gutter, so an empty dock costs nothing.
            '--deck-dock-h': `${dockEmpty ? -12 : deckSizes.dockHeight}px`
          } as React.CSSProperties
        }
      >
        <Stage />
        {deckMode === 'attached' && <Deck />}
        <ViewportChip />
      </div>
    </div>
  )
}

/**
 * The viewport chip (P3-4): a small ambient label that fades in on the spotlit
 * stage once it lands, naming what you're building around — "localhost:5173 ·
 * inspecting". Visibility and the land-timed fade are driven by the `.revealed`
 * parent in CSS; this only supplies the label for the active tab.
 */
function ViewportChip(): React.JSX.Element | null {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const url = useShellStore((s) => s.browserStates[s.activeTabId]?.url)
  const activeTab = useShellStore((s) => s.tabs.find((t) => t.id === activeTabId))

  let label = ''
  let state = 'inspecting'
  if (activeTab?.kind === 'doc') {
    label = (activeTab.docPath ?? '').split('/').pop() ?? 'document'
    state = 'reading'
  } else if (url) {
    try {
      label = new URL(url).host
    } catch {
      label = ''
    }
  }
  if (!label) return null

  return (
    <div className="viewport-chip" aria-hidden="true">
      <span className="truncate">{label}</span>
      <span className="viewport-chip-sep">·</span>
      <span className="viewport-chip-state">{state}</span>
    </div>
  )
}
