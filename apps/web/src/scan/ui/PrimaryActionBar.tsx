// The sticky bottom action bar — one slot, two jobs depending on the step
// (Scan.tsx's state machine): "Verify (N)" advances Step 1 → Step 2; "Add N
// cards" on the Verify screen is the actual commitFeed() write. Replaces
// CommitBar.tsx, which only ever knew about the commit half.
//
// TWO THINGS SHARE THE BOTTOM OF THE SCREEN WITH IT (owner session 2026-11-27):
//
//   * Deck-E's launcher, which floats at the bottom-right of every page and sat
//     on the right end of this button. `data-fab-bar` (theme.css) makes the bar
//     the band the launcher lives in — the button stops short of it, and the
//     bar is tall enough that it does not reach up into the list either.
//   * The app's toast — "Removed Galvantula · Undo" — which would otherwise land
//     on top of this button for six seconds. The bar publishes its height as
//     `--toast-lift` and the toast host (PwaUi) floats above it.
import { useLayoutEffect, useRef } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { Spinner } from '../../components/ui'

export function PrimaryActionBar({
  label,
  icon,
  count,
  busy,
  disabled,
  onClick,
}: {
  label: string
  icon: IconName
  /** Hides the bar entirely at 0 — there is nothing to verify or commit yet. */
  count: number
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const shown = count > 0
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!shown || !bar) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--toast-lift', `${Math.ceil(bar.getBoundingClientRect().height)}px`)
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(bar)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--toast-lift')
    }
  }, [shown])

  if (!shown) return null
  return (
    <div
      ref={barRef}
      data-fab-bar
      className="shrink-0 border-t border-divider-subtle bg-surface-secondary px-[14px] pb-[calc(10px+env(safe-area-inset-bottom))] pt-[10px]"
    >
      <button
        type="button"
        disabled={busy || disabled}
        onClick={onClick}
        className={`flex h-[44px] w-full items-center justify-center gap-[8px] rounded-full text-[15px] font-bold ${disabled ? 'bg-surface-tertiary text-text-muted' : 'bg-action-primary text-action-primary-text hover:bg-action-primary-hover disabled:opacity-60'}`}
      >
        {busy ? (
          <>
            <Spinner inline size={18} /> Adding…
          </>
        ) : (
          <>
            <Icon name={icon} size={18} /> {label}
          </>
        )}
      </button>
    </div>
  )
}
