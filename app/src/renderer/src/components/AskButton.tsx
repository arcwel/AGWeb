import { useEffect, useState } from 'react'
import { askAboutPage } from '@/ask-page'
import { useShellStore } from '@/store'

/**
 * Ask: the agent, pointed at the page you are on — where Chrome keeps its
 * Gemini button.
 *
 * Pinned to the right of the title bar rather than placed at the end of the tab
 * strip, so it stays put once enough tabs are open to make the strip scroll.
 * Hidden when Settings → Application → "Show the Ask button" is off.
 */
export function AskButton(): React.JSX.Element | null {
  const [shown, setShown] = useState(true)
  // The toggle lives in Settings, and there is no change event for app
  // settings — so re-read whenever that sheet closes, which is the only moment
  // the answer can have changed.
  const settingsOpen = useShellStore((s) => s.settingsOpen)

  useEffect(() => {
    if (settingsOpen) return
    let live = true
    void window.agweb.appSettings
      .read()
      .then((settings) => {
        if (live) setShown(settings.showAskButton !== false)
      })
      .catch(() => {
        // An unreadable settings file should not remove the button.
      })
    return () => {
      live = false
    }
  }, [settingsOpen])

  if (!shown) return null
  return (
    <button
      onClick={() => void askAboutPage()}
      className="no-drag mr-1 flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--wd-glass-border)] bg-[var(--wd-accent-soft)] px-2.5 text-[11.5px] font-medium text-[var(--wd-accent)] hover:brightness-110"
      aria-label="Ask about this page"
      title="Ask the agent about this page"
      data-testid="ask-page"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8L12 2zm7 12l1.1 3 3 1.1-3 1.1L19 22l-1.1-2.8-3-1.1 3-1.1L19 14z" />
      </svg>
      Ask
    </button>
  )
}
