import { useEffect, useRef } from 'react'

/**
 * A single tappable count box for a card variant. Tap = +1, long-press or
 * right-click = -1 (floored at 0 via the disabled state). Sits above or
 * inside a card tile, so every handler stops propagation to keep the parent's
 * link navigation inert.
 *
 * Previously duplicated byte-for-byte in CardTile.tsx and TableView.tsx.
 * The hardcoded `#15181f`/`#fff` for filled-chip text colour has been
 * replaced with `var(--color-surface-primary)`/`var(--color-text-primary)`.
 */
export function CounterBox({
  label,
  color,
  fill,
  dark,
  qty,
  disabled,
  onInc,
  onDec,
}: {
  label: string
  /** Solid accent. Used for the empty state's border, where a gradient is invalid. */
  color: string
  /** Gradient for the filled state. Falls back to the solid when absent. */
  fill?: string
  dark: boolean
  qty: number
  disabled: boolean
  onInc: () => void
  onDec: () => void
}) {
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const clear = () => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(() => clear, [])

  const startPress = () => {
    longPressed.current = false
    clear()
    timer.current = window.setTimeout(() => {
      longPressed.current = true
      if (qty > 0) onDec()
    }, 500)
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label}: ${qty} owned. Tap to add one, long-press to remove one.`}
      title={`${label} — ${qty} owned · tap +1, hold −1`}
      onPointerDown={(e) => {
        e.stopPropagation()
        startPress()
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (qty > 0) onDec()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (longPressed.current) {
          longPressed.current = false
          return
        }
        onInc()
      }}
      className="flex h-[24px] min-w-[22px] items-center justify-center rounded-[6px] px-[5px] text-[14px] font-extrabold leading-none tabular-nums shadow-panel transition-opacity enabled:hover:opacity-90 disabled:opacity-60"
      style={
        qty > 0
          ? { background: fill ?? color, color: dark ? 'var(--color-surface-primary)' : 'var(--color-text-primary)' }
          : {
              background: 'var(--color-surface-tertiary-transparent)',
              color: 'var(--color-text-muted)',
              border: `2px solid ${color}`,
            }
      }
    >
      {qty > 0 ? qty : ''}
    </button>
  )
}
