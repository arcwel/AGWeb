import { useCallback, useEffect } from 'react'
import { useShellStore } from '@/store'
import { registerShortcut } from '@/shortcuts'
import { navigateTab } from '@/components/Toolbar'

/**
 * The commands behind the native application menu.
 *
 * The menu sends `app:*` strings over the same channel the shell already uses
 * for shortcuts pressed while a page had focus, so these register in the
 * shortcut registry alongside real combos. That keeps a menu item and its
 * accelerator on one handler instead of two that drift apart, and it means the
 * menu can drive anything the shell can do — including work that only the page
 * process can perform (print, zoom, devtools), which is why several of these
 * go back out over IPC rather than touching the DOM.
 */

export function useAppCommands(): void {
  const run = useCallback(async (command: string): Promise<void> => {
    const store = useShellStore.getState()
    const tabId = store.activeTabId

    switch (command) {
      case 'app:settings':
        // Settings opens as its own overlay, not a deck block — it configures
        // the app and browser, not the developer workspace.
        store.setSettingsOpen(true)
        return

      case 'app:new-window':
        await window.agweb.windows.newWindow()
        return

      case 'app:new-incognito':
        // Switch into the incognito profile and open a fresh private tab.
        await window.agweb.profiles.setActive('incognito')
        store.syncProfile('incognito')
        store.newTab()
        return

      case 'app:save':
        // Editors own their own buffers; the one with focus takes the save.
        window.dispatchEvent(new CustomEvent('agweb:save'))
        return

      case 'app:print':
        await window.agweb.browser.print(tabId)
        return

      case 'app:find':
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))
        return

      case 'app:reload':
        await window.agweb.browser.reload(tabId)
        return

      case 'app:force-reload':
        // ⌘⇧R bypasses the cache, as it does in Chrome.
        await window.agweb.browser.reload(tabId, true)
        return

      case 'app:zoom-reset':
        // The IPC layer speaks Chromium zoom *levels*, where 0 is 100% — the
        // same units the toolbar's ZoomControls uses. (An earlier version set
        // level 1 here, which is ~120%, so "Actual Size" didn't restore 100%.)
        await window.agweb.browser.zoom(tabId, 0)
        return

      case 'app:zoom-in':
      case 'app:zoom-out': {
        const current = await window.agweb.browser.zoom(tabId)
        await window.agweb.browser.zoom(tabId, current + (command === 'app:zoom-in' ? 1 : -1))
        return
      }

      case 'app:utilities':
        store.setUtilitiesOpen(!store.utilitiesOpen)
        return

      case 'app:split':
        store.toggleSplit()
        return

      case 'app:devtools':
        await window.agweb.browser.openDevTools(tabId)
        return

      case 'app:back':
        await window.agweb.browser.back(tabId)
        return

      case 'app:forward':
        await window.agweb.browser.forward(tabId)
        return

      case 'app:home':
        await navigateTab(tabId, store.homeUrl)
        return

      case 'app:reopen-tab':
        store.reopenTab()
        return
    }
  }, [])

  useEffect(() => {
    const commands = [
      'app:settings',
      'app:new-window',
      'app:new-incognito',
      'app:save',
      'app:print',
      'app:find',
      'app:reload',
      'app:force-reload',
      'app:zoom-reset',
      'app:zoom-in',
      'app:zoom-out',
      'app:utilities',
      'app:split',
      'app:devtools',
      'app:back',
      'app:forward',
      'app:home',
      'app:reopen-tab'
    ]
    const offs = commands.map((combo) =>
      registerShortcut({ combo, description: combo, handler: () => void run(combo) })
    )
    return () => offs.forEach((off) => off())
  }, [run])
}
