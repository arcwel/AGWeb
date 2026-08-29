import { useEffect, useState } from 'react'
import { monacoReady } from '@/monaco'

/**
 * True once VS Code's services have booted (task 12.1).
 *
 * `initialize()` must finish before the first editor is created, so every
 * component that creates one gates on this and lists it as an effect dependency.
 * Returning a flag rather than awaiting inside the effect is what makes the
 * dependent effects — model mounting, theme, layout — re-run once the editor
 * actually exists.
 */
export function useMonacoReady(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void monacoReady.then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  return ready
}
