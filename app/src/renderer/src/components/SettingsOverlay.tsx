import { useEffect } from 'react'
import { useShellStore } from '@/store'
import { SettingsBlock } from '@/components/SettingsBlock'
import { CloseIcon } from '@/components/browser-icons'

/**
 * Settings as its own surface, not a Dev Deck block.
 *
 * Settings configures the application and the browser — it is not part of the
 * developer workspace, so opening it should not reveal the whole Deck. It
 * renders here as an overlay sheet over the stage instead.
 *
 * Browser tabs are native WebContentsViews that paint above the renderer DOM,
 * so a plain modal would hide behind the page. Raising the shared overlay
 * count (the same mechanism menus use) hides the active view while the sheet is
 * open, so the DOM shows through — and restores it on close.
 */
export function SettingsOverlay(): React.JSX.Element | null {
  const open = useShellStore((s) => s.settingsOpen)
  const setSettingsOpen = useShellStore((s) => s.setSettingsOpen)
  const setOverlayOpen = useShellStore((s) => s.setOverlayOpen)

  useEffect(() => {
    if (!open) return
    setOverlayOpen(true)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      setOverlayOpen(false)
    }
  }, [open, setOverlayOpen, setSettingsOpen])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(2px)' }}
      onClick={() => setSettingsOpen(false)}
      data-testid="settings-overlay"
    >
      <div
        className="glass flex h-[min(680px,88vh)] w-[min(860px,94vw)] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--wd-r-stage)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-none items-center justify-between border-b border-[var(--wd-glass-border)] px-4 py-2.5">
          <span className="text-[13px] font-semibold text-[var(--wd-text)]">Settings</span>
          <button
            onClick={() => setSettingsOpen(false)}
            className="wd-icon"
            aria-label="Close settings"
            title="Close (Esc)"
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <SettingsBlock />
        </div>
      </div>
    </div>
  )
}
