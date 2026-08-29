import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Minimal fixed-row-height windowing for large lists/tables: render only the
 * rows in view (plus overscan), pad the rest with spacers.
 */
export function useVirtualRows(
  total: number,
  rowHeight: number,
  overscan = 12
): {
  containerRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  start: number
  end: number
  padTop: number
  padBottom: number
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewport(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (el) setScrollTop(el.scrollTop)
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
  return {
    containerRef,
    onScroll,
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (total - end) * rowHeight)
  }
}
