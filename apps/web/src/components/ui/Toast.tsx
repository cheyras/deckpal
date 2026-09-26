import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { dismissToast, useToast, type Toast } from '../../lib/toast'

/**
 * Toast — the one transient message: a save that failed (with Retry) or a
 * destructive change that can still be undone (with Undo). See lib/toast.ts for
 * the one-at-a-time rule and lib/writes.ts for when the app raises one.
 *
 * Same sticker treatment as the PWA update toast it stacks with (UI-SPEC §3.14).
 * One line of copy, at most one action, always dismissable.
 */
export interface ToastViewProps {
  tone: Toast['tone']
  message: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
}

export function ToastView({ tone, message, actionLabel, onAction, onDismiss }: ToastViewProps) {
  return (
    <div className="pointer-events-auto flex w-full max-w-[480px] items-center gap-[12px] rounded-lg bg-surface-quaternary py-[8px] pl-[14px] pr-[8px] shadow-2xl ring-1 ring-border-default">
      <Icon
        name={tone === 'error' ? 'alert' : 'check-circle'}
        size={18}
        className={`shrink-0 ${tone === 'error' ? 'text-error' : 'text-action-primary'}`}
      />
      <p className="min-w-0 flex-1 py-[4px] text-[14px] leading-[19px] text-text-primary">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="h-[36px] shrink-0 rounded-md bg-action-primary px-[14px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-[36px] w-[32px] shrink-0 items-center justify-center rounded-md text-icon-default hover:bg-action-default-hover"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

/** Errors stay long enough to read and act on; an Undo offer is shorter-lived. */
const SHOWN_MS = { error: 10_000, info: 6_000 } as const

/** Host for the current toast. Mounted once, in PwaUi's bottom-right stack. */
export function Toaster() {
  const toast = useToast()
  // Hovering or focusing the toast holds it open — nobody should lose a Retry
  // button while their pointer is on its way to it.
  const [held, setHeld] = useState(false)
  // A toast dismissed from under the pointer never sees it leave; the next one
  // must not inherit that hold and stay up forever.
  const id = toast?.id
  useEffect(() => setHeld(false), [id])
  useEffect(() => {
    if (!toast || held) return
    const t = window.setTimeout(() => dismissToast(toast.id), SHOWN_MS[toast.tone])
    return () => window.clearTimeout(t)
  }, [toast, held])

  // The announcement and the visible toast are separate elements. Both live
  // regions are always mounted, so a screen reader is already watching them
  // when a message arrives (an error interrupts, the rest wait their turn), and
  // being visually hidden they take no room in the stack they share with the
  // offline banner while nothing is showing.
  return (
    <>
      <div role="alert" aria-atomic="true" className="sr-only">
        {toast?.tone === 'error' ? toast.message : ''}
      </div>
      <div role="status" aria-atomic="true" className="sr-only">
        {toast?.tone === 'info' ? toast.message : ''}
      </div>
      {toast && (
        <div
          className="flex w-full justify-end"
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <ToastView
            tone={toast.tone}
            message={toast.message}
            actionLabel={toast.action?.label}
            onAction={
              toast.action &&
              (() => {
                dismissToast(toast.id)
                toast.action!.run()
              })
            }
            onDismiss={() => dismissToast(toast.id)}
          />
        </div>
      )}
    </>
  )
}
