import { useEffect, useRef } from 'react'
import { applyRemoteState, currentSyncState, useShellStore } from '@/store'

/**
 * Mirrors the deck layout across shell windows. Every window applies syncs
 * broadcast by the others; only the main (browser) window answers boot-time
 * sync requests and reconciles OS windows to the deck state.
 */
export function useShellSync(roleKind: 'main' | 'deck' | 'float'): void {
  useEffect(() => {
    const offSync = window.agweb.windows.onStateSync(applyRemoteState)
    const offRequest =
      roleKind === 'main'
        ? window.agweb.windows.onRequestSync(() => {
            void window.agweb.windows.broadcastState(currentSyncState())
          })
        : () => {}
    return () => {
      offSync()
      offRequest()
    }
  }, [roleKind])

  // Every window tracks the shared workspace.
  useEffect(() => {
    const setWorkspace = useShellStore.getState().setWorkspace
    void window.agweb.getCurrentWorkspace().then(setWorkspace)
    return window.agweb.onWorkspaceChanged(setWorkspace)
  }, [])

  // Agent sessions live in main; every window mirrors them (Agents + Logs).
  useEffect(() => {
    const { setAgentSessions, upsertAgentSession } = useShellStore.getState()
    void window.agweb.agents.list().then(setAgentSessions)
    const offUpdate = window.agweb.agents.onUpdate(upsertAgentSession)
    const offReset = window.agweb.agents.onReset(setAgentSessions)
    return () => {
      offUpdate()
      offReset()
    }
  }, [])
}

/**
 * Main window only: keep the deck window and float windows matching state.
 *
 * On a host that cannot open windows (the Chromium fork, where WebDeck is a
 * page inside a real browser tab) this instead *repairs* state that would
 * otherwise render nowhere. A detached Deck asks for a window that never
 * opens, and `deckMode === 'detached'` stops <Deck /> rendering inline — so the
 * Deck vanishes, and because the layout is persisted it stays vanished across
 * restarts. A floating group is lost the same way. Both are recovered here
 * rather than guarded at each call site, so a layout carried over from Electron
 * (or synced from another device) heals on load instead of arriving broken.
 */
export function useWindowReconciler(): void {
  const deckMode = useShellStore((s) => s.deckMode)
  const floatingIds = useShellStore((s) =>
    s.groups
      .filter((g) => g.zone === 'floating')
      .map((g) => g.id)
      .join(',')
  )

  const singleWindow = !window.agweb.host.canOpenWindows

  useEffect(() => {
    if (!singleWindow) return
    const state = useShellStore.getState()
    if (state.deckMode === 'detached') {
      useShellStore.setState({ deckMode: 'attached', deckRevealed: true })
    }
    for (const group of state.groups) {
      if (group.zone === 'floating') state.moveGroup(group.id, { kind: 'zone', zone: 'right' })
    }
  }, [singleWindow, deckMode, floatingIds])

  const prevMode = useRef(deckMode)
  useEffect(() => {
    if (singleWindow) return
    // Docking back (from the deck window's button or its close) re-reveals the
    // deck here — deckRevealed is per-window UI state, not part of the sync.
    if (prevMode.current === 'detached' && deckMode === 'attached') {
      useShellStore.setState({ deckRevealed: true })
    }
    prevMode.current = deckMode
    if (deckMode === 'detached') void window.agweb.windows.openDeck()
    else void window.agweb.windows.closeDeck()
  }, [deckMode, singleWindow])

  useEffect(() => {
    if (singleWindow) return
    void window.agweb.windows.syncFloats(floatingIds ? floatingIds.split(',') : [])
  }, [floatingIds, singleWindow])

  useEffect(() => {
    return window.agweb.windows.onDeckClosed(() => {
      if (useShellStore.getState().deckMode === 'detached') {
        useShellStore.setState({ deckMode: 'attached', deckRevealed: true })
      }
    })
  }, [])

  // A float window closed from its title bar: dock the group back, or the
  // renderer would still list it as floating and recreate the window on the
  // next float change (P1-10).
  useEffect(() => {
    return window.agweb.windows.onFloatClosed((groupId) => {
      const { groups, moveGroup } = useShellStore.getState()
      if (groups.some((g) => g.id === groupId && g.zone === 'floating')) {
        moveGroup(groupId, { kind: 'zone', zone: 'right' })
      }
    })
  }, [])
}
