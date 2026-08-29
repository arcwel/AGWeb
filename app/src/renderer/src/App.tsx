import { useCallback, useEffect } from 'react'
import { TabStrip } from '@/components/TabStrip'
import { UtilitiesBar } from '@/components/UtilitiesBar'
import { Toolbar } from '@/components/Toolbar'
import { Stage } from '@/components/Stage'
import { Deck } from '@/components/Deck'
import { PermissionPrompts } from '@/components/PermissionPrompts'
import { SettingsOverlay } from '@/components/SettingsOverlay'
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

  useThemeEffect()
  useWindowReconciler()

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
    return () => {
      offState()
      offOpen()
      offAdopt()
    }
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
      <div className="wd-chrome flex flex-none flex-col">
        <TabStrip />
        <Toolbar />
      </div>
      <UtilitiesBar />
      <PermissionPrompts />
      <SettingsOverlay />
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
      </div>
    </div>
  )
}
