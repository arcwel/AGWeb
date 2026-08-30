import { useEffect } from 'react'
import { useShellStore, type Toast } from '@/store'
import { CloseIcon } from '@/components/icons'

/**
 * The toast host: transient, self-dismissing notifications stacked at the
 * bottom-right. Anchored there deliberately — when the agent runs (the main
 * source of toasts, e.g. a denied action, P2-13) the Dev Deck is open, so this
 * corner sits over the deck's own DOM rather than the native browser view.
 */

const TONE_BORDER: Record<Toast['tone'], string> = {
  info: 'border-slate-300 dark:border-slate-700',
  warn: 'border-amber-400/60',
  error: 'border-rose-500/60'
}
const TONE_DOT: Record<Toast['tone'], string> = {
  info: 'bg-slate-400',
  warn: 'bg-amber-400',
  error: 'bg-rose-500'
}

const AUTO_DISMISS_MS = 4500

function ToastRow({ toast }: { toast: Toast }): React.JSX.Element {
  const dismissToast = useShellStore((s) => s.dismissToast)
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.id, dismissToast])

  return (
    <div
      role="status"
      className={`glass pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs text-[var(--wd-text)] ${TONE_BORDER[toast.tone]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[toast.tone]}`} />
      <span className="min-w-0 flex-1">{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
        aria-label="Dismiss notification"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

export function ToastHost(): React.JSX.Element | null {
  const toasts = useShellStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
