import { useEffect, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { StartPage } from '@/components/StartPage'
import { DocStudio } from '@/components/DocStudio'

/**
 * The stage hosts the active tab's page. With content, the main-process
 * WebContentsView is layered over this element — its bounds are streamed
 * here every frame of the Stage reveal animation, so the native view rides
 * the CSS transition. Without content, the start page renders in-DOM.
 */
/** Tab ids with a native-view creation in flight (module-scoped: it must
 *  survive the component's own remounts). */
const creating = new Set<string>()

export function Stage(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const activeTab = useShellStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const hasContent = (activeTab?.kind === 'web' && activeTab.hasContent) ?? false
  const initialUrl = activeTab?.kind === 'web' ? activeTab.initialUrl : undefined
  const deckRevealed = useShellStore((s) => s.deckRevealed)
  const overlayCount = useShellStore((s) => s.overlayCount)
  const loadError = useShellStore((s) => s.browserStates[s.activeTabId]?.loadError)
  const splitTabId = useShellStore((s) => s.splitTabId)
  const splitRatio = useShellStore((s) => s.splitRatio)
  const ref = useRef<HTMLDivElement>(null)

  // Load link-opened tabs on first activation. `hasContent` only flips once
  // the async create resolves, so a second effect run (StrictMode remount, or
  // a re-render before the round-trip lands) would create a second native view
  // for the same tab — the in-flight set makes creation idempotent per tab.
  useEffect(() => {
    if (!initialUrl || hasContent || creating.has(activeTabId)) return
    creating.add(activeTabId)
    const { markTabHasContent } = useShellStore.getState()
    void window.agweb.browser
      .create(activeTabId)
      .then(() => {
        markTabHasContent(activeTabId)
        void window.agweb.browser.navigate(activeTabId, initialUrl)
      })
      .finally(() => creating.delete(activeTabId))
  }, [activeTabId, initialUrl, hasContent])

  // Keep the native view glued to this element and visible only while its
  // tab is active. During the deck transition the element resizes every
  // frame, so the ResizeObserver streams bounds continuously.
  useEffect(() => {
    const el = ref.current
    if (!el || !hasContent) return

    const syncBounds = (): void => {
      const rect = el.getBoundingClientRect()
      if (!splitTabId) {
        void window.agweb.browser.setBounds(activeTabId, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        })
        return
      }
      // Split view (12.x / feedback 5): two live pages share the stage, with a
      // 6px gutter between them so the divider is grabbable.
      const gutter = 6
      const left = Math.round((rect.width - gutter) * splitRatio)
      void window.agweb.browser.setBounds(activeTabId, {
        x: rect.x,
        y: rect.y,
        width: left,
        height: rect.height
      })
      void window.agweb.browser.setBounds(splitTabId, {
        x: rect.x + left + gutter,
        y: rect.y,
        width: rect.width - left - gutter,
        height: rect.height
      })
    }

    syncBounds()
    // Menus/prompts render in the renderer DOM but the native view paints
    // above it — hide the view while one is open or it swallows them (P1-12).
    void window.agweb.browser.setVisible(activeTabId, overlayCount === 0)
    if (splitTabId) {
      // The companion pane may never have been opened; create it on demand.
      const companion = useShellStore.getState().tabs.find((t) => t.id === splitTabId)
      if (companion && !companion.hasContent) {
        void window.agweb.browser.create(splitTabId).then(() => {
          useShellStore.getState().markTabHasContent(splitTabId)
          if (companion.initialUrl) {
            void window.agweb.browser.navigate(splitTabId, companion.initialUrl)
          }
          syncBounds()
        })
      }
      void window.agweb.browser.setVisible(splitTabId, overlayCount === 0)
    }

    const observer = new ResizeObserver(syncBounds)
    observer.observe(el)
    window.addEventListener('resize', syncBounds)
    el.addEventListener('transitionend', syncBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      el.removeEventListener('transitionend', syncBounds)
      void window.agweb.browser.setVisible(activeTabId, false)
      if (splitTabId) void window.agweb.browser.setVisible(splitTabId, false)
    }
  }, [activeTabId, hasContent, overlayCount, splitTabId, splitRatio])

  // Round the native view's corners to match the spotlit stage frame.
  useEffect(() => {
    if (hasContent) void window.agweb.browser.setCornerRadius(activeTabId, deckRevealed ? 10 : 0)
  }, [activeTabId, hasContent, deckRevealed])

  return (
    <div ref={ref} className="stage bg-white dark:bg-[#101418]">
      {activeTab?.kind === 'doc' && activeTab.docPath ? (
        <DocStudio key={activeTab.id} path={activeTab.docPath} />
      ) : (
        !hasContent && <StartPage />
      )}
      {loadError && !splitTabId && <LoadError error={loadError} tabId={activeTabId} />}
      {splitTabId && <SplitDivider />}
    </div>
  )
}

/**
 * Why a page did not load.
 *
 * Without this a failed navigation leaves a blank stage and no explanation —
 * indistinguishable from the app simply not working. Chromium's own error
 * codes are unreadable, so the common ones get plain-language causes.
 */
const ERROR_CAUSES: Record<number, string> = {
  [-2]: 'The connection failed.',
  [-6]: 'That file does not exist.',
  [-7]: 'The server took too long to respond.',
  [-21]: 'The network changed while loading.',
  [-100]: 'The connection was closed.',
  [-102]: 'The server refused the connection.',
  [-105]: 'That address could not be resolved — check the spelling, or your DNS.',
  [-106]: 'This computer appears to be offline.',
  [-109]: 'The server is unreachable.',
  [-118]: 'The connection timed out.',
  [-137]: 'That address could not be resolved.'
}

function LoadError({
  error,
  tabId
}: {
  error: { code: number; description: string; url: string }
  tabId: string
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white p-8 text-center dark:bg-[#101418]"
      data-testid="page-load-error"
    >
      <div className="text-[15px] font-semibold text-slate-700 dark:text-slate-200">
        This page didn&apos;t load
      </div>
      <div className="max-w-md text-[13px] leading-relaxed text-slate-500">
        {ERROR_CAUSES[error.code] ?? 'The page could not be reached.'}
      </div>
      <div className="max-w-lg truncate font-mono text-[11px] text-slate-400" title={error.url}>
        {error.url}
      </div>
      <button
        onClick={() => void window.agweb.browser.reload(tabId)}
        className="mt-1 rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-600"
      >
        Try again
      </button>
      <div className="font-mono text-[10px] text-slate-400">
        {error.description} ({error.code})
      </div>
    </div>
  )
}

/**
 * The grabbable divider between two split pages.
 *
 * It lives in the renderer's DOM over the gutter the bounds calculation
 * leaves; the native views sit either side of it, so there is nothing painted
 * above to fight with.
 */
function SplitDivider(): React.JSX.Element {
  const splitRatio = useShellStore((s) => s.splitRatio)
  const setSplitRatio = useShellStore((s) => s.setSplitRatio)
  const setSplit = useShellStore((s) => s.setSplit)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent): void => {
      const stage = document.querySelector('.stage')?.getBoundingClientRect()
      if (!stage) return
      setSplitRatio((e.clientX - stage.left) / stage.width)
    }
    const end = (): void => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, setSplitRatio])

  return (
    <div
      className="absolute inset-y-0 z-20 flex w-1.5 cursor-col-resize items-center justify-center"
      style={{ left: `calc(${splitRatio * 100}% - 3px)` }}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDoubleClick={() => setSplit(null)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split view (double-click to close)"
      data-testid="split-divider"
    >
      <span
        className="h-10 w-1 rounded-full"
        style={{ background: dragging ? 'var(--wd-accent)' : 'var(--wd-glass-border)' }}
      />
    </div>
  )
}
