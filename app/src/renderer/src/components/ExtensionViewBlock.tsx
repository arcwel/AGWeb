import { useEffect, useRef, useState } from 'react'
import { mountViewContainer, type MountedViewContainer } from '@/editor-views'

/**
 * A Deck block hosting one extension view container (task 12.8).
 *
 * The block owns a DOM host; VS Code's ViewPaneContainer renders the
 * container's views into it and is kept sized by a ResizeObserver, so the
 * panes relayout as the block is resized, docked or floated. If the container
 * is gone (extension uninstalled) the block says so instead of sitting empty —
 * a persisted layout can outlive the extension it referenced.
 */
export function ExtensionViewBlock({ containerId }: { containerId: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'mounting' | 'ready' | 'missing' | 'error'>('mounting')
  const [detail, setDetail] = useState('')
  // A container can be legitimately empty: many extensions gate their views
  // behind a `when` clause (a file open in their editor, a repository found).
  // Say so rather than showing a blank block.
  const [viewCount, setViewCount] = useState(-1)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !containerId) return
    let live = true
    let mounted: MountedViewContainer | null = null
    let observer: ResizeObserver | null = null
    let offViews: (() => void) | null = null

    void mountViewContainer(containerId, host)
      .then((m) => {
        if (!live) {
          m?.dispose()
          return
        }
        if (!m) {
          setState('missing')
          return
        }
        mounted = m
        const relayout = (): void => {
          const rect = host.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) m.layout(rect.width, rect.height)
        }
        relayout()
        observer = new ResizeObserver(relayout)
        observer.observe(host)
        setViewCount(m.viewCount())
        offViews = m.onDidChangeViews(() => setViewCount(m.viewCount()))
        setState('ready')
      })
      .catch((err: unknown) => {
        if (!live) return
        setDetail((err as Error).message)
        setState('error')
      })

    return () => {
      live = false
      observer?.disconnect()
      offViews?.()
      mounted?.dispose()
    }
  }, [containerId])

  return (
    <div
      className="relative h-full min-h-0 w-full"
      data-testid="extview-block"
      data-container={containerId}
      data-state={state}
    >
      {/* VS Code paints its panes into this host; it must fill the block. */}
      <div ref={hostRef} className="absolute inset-0 overflow-hidden" />
      {state === 'ready' && viewCount === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-[11px] text-[var(--wd-dim)]">
          Nothing to show yet. This extension reveals its views when they apply — for example once a
          file is open in its editor or a repository is found.
        </div>
      )}
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[11px] text-[var(--wd-dim)]">
          {state === 'mounting' && 'Loading extension view…'}
          {state === 'missing' &&
            'This view belongs to an extension that is no longer installed. Close the block, or reinstall the extension from the Extensions block.'}
          {state === 'error' && `Could not show this view: ${detail}`}
        </div>
      )}
    </div>
  )
}
