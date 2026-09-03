import { useLayoutEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * A popover that is never clipped by the block it opens from.
 *
 * Deck groups, columns and the dock are `overflow: hidden` (a block fits its
 * zone; it never spills). That is the right rule for blocks and the wrong one
 * for a menu: a 300px panel opened from a 330px block, or a tall list opened
 * near the block's bottom edge, was cut off at the block boundary. This panel
 * renders through a portal into the document body with fixed positioning
 * computed from the anchor, clamped to the viewport, and flips sides when the
 * preferred side has no room. Its height is capped to the space it has, so it
 * scrolls instead of running off screen.
 *
 * Pair it with `usePopover(open, onClose, panelRef)` so a press inside the
 * portalled panel does not read as "outside".
 */

const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 6
/** Below this much room, the popover flips to the other side of the anchor. */
const FLIP_BELOW = 160
const MIN_HEIGHT = 80

export type PopoverPlacement = 'above' | 'below'
export type PopoverAlign = 'start' | 'end'

interface Box {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

function measure(
  anchor: HTMLElement,
  placement: PopoverPlacement,
  align: PopoverAlign,
  width: number,
  maxHeight: number | undefined
): Box {
  const win = anchor.ownerDocument.defaultView ?? window
  const rect = anchor.getBoundingClientRect()
  const vw = win.innerWidth
  const vh = win.innerHeight
  const w = Math.max(0, Math.min(width, vw - VIEWPORT_MARGIN * 2))
  const start = align === 'start' ? rect.left : rect.right - w
  const left = Math.max(VIEWPORT_MARGIN, Math.min(start, vw - w - VIEWPORT_MARGIN))
  const roomAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN
  const roomBelow = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
  let side = placement
  if (side === 'above' && roomAbove < FLIP_BELOW && roomBelow > roomAbove) side = 'below'
  if (side === 'below' && roomBelow < FLIP_BELOW && roomAbove > roomBelow) side = 'above'
  const room = side === 'above' ? roomAbove : roomBelow
  const cap = Math.max(MIN_HEIGHT, maxHeight === undefined ? room : Math.min(room, maxHeight))
  return side === 'above'
    ? { left, bottom: vh - rect.top + ANCHOR_GAP, width: w, maxHeight: cap }
    : { left, top: rect.bottom + ANCHOR_GAP, width: w, maxHeight: cap }
}

export function AnchoredPopover({
  anchorRef,
  panelRef,
  placement = 'below',
  align = 'start',
  width,
  maxHeight,
  className,
  children,
  ...rest
}: {
  /** The trigger the panel is positioned against. */
  anchorRef: RefObject<HTMLElement | null>
  /** Handed to `usePopover` so presses inside the panel are not "outside". */
  panelRef?: RefObject<HTMLDivElement | null>
  placement?: PopoverPlacement
  align?: PopoverAlign
  /** Preferred width; shrinks to the viewport when the window is narrower. */
  width: number
  /** Optional cap on the panel's height, on top of the space available. */
  maxHeight?: number
  className?: string
  children: ReactNode
  'data-testid'?: string
  role?: string
  'aria-label'?: string
}): React.JSX.Element | null {
  const [box, setBox] = useState<Box | null>(null)
  // The portal target: the anchor's document, so a popover opened inside a
  // popped-out Deck window lands in that window. Read in the layout effect —
  // never during render — and held as state.
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const win = anchor.ownerDocument.defaultView ?? window
    setHost(anchor.ownerDocument.body)
    const update = (): void => setBox(measure(anchor, placement, align, width, maxHeight))
    update()
    win.addEventListener('resize', update)
    // Capture phase: a scroll anywhere up the tree moves the anchor.
    win.addEventListener('scroll', update, true)
    return () => {
      win.removeEventListener('resize', update)
      win.removeEventListener('scroll', update, true)
    }
  }, [anchorRef, placement, align, width, maxHeight])

  if (!host) return null
  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        zIndex: 90,
        left: box?.left ?? 0,
        top: box?.top,
        bottom: box?.bottom,
        width: box?.width ?? width,
        maxHeight: box?.maxHeight,
        visibility: box ? 'visible' : 'hidden'
      }}
      className={`overflow-y-auto ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>,
    host
  )
}
