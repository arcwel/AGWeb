import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useShellStore } from '@/store'

/**
 * Shared behavior for toolbar/block popovers:
 *  - registers an overlay so the stage hides its native WebContentsView,
 *    which otherwise paints above the renderer DOM and swallows the menu;
 *  - closes on Escape and on a pointer press outside the menu.
 *
 * Returns a ref to attach to the popover's outermost element (trigger +
 * panel), so clicking the trigger itself doesn't count as "outside".
 */
export function usePopover(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const setOverlayOpen = useShellStore.getState().setOverlayOpen
    setOverlayOpen(true)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const node = ref.current
      if (node && !node.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
      setOverlayOpen(false)
    }
  }, [open, onClose])

  return ref
}
