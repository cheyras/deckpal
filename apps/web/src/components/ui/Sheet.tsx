/**
 * Sheet — the one overlay primitive.
 *
 * A bottom sheet on phones, a centred dialog from `nav:` up. Every modal in the
 * app goes through this so the same four things are true everywhere: it is
 * anchored to the viewport, it can never be taller than the viewport, the page
 * behind it does not move, and the keyboard cannot leave it.
 *
 * Three bugs are designed out here rather than patched per-caller:
 *
 * 1. **The containing-block trap.** `position: fixed` resolves against the
 *    nearest ancestor with a transform/filter/contain, not the viewport. The
 *    premium skin's entrance animation used to leave an identity transform on
 *    the routed page wrapper, which pinned every modal to page coordinates —
 *    the card sheet opened ~18,000px down a long set page. That CSS is fixed,
 *    but rendering into a portal on `document.body` means no future ancestor
 *    can reintroduce it.
 *
 * 2. **The flex overflow trap.** `align-items: flex-end` + `overflow-y: auto`
 *    on the scrim looks like it scrolls, but a panel taller than the container
 *    overflows the START edge, and scrollable overflow only ever extends
 *    towards the end — `scrollHeight` equals `clientHeight`, so there is
 *    nothing to scroll to. The bug reporter's top (with its text input) sat
 *    83px above the screen on a 667px phone and 430px above it with the
 *    keyboard open, unreachable. Here the scrim never scrolls; the panel is
 *    capped with `max-height` and its BODY is the scroll container.
 *
 * 3. **Background scroll-through.** The page behind stayed scrollable, so the
 *    sheet appeared to drift away. Locked below, position preserved.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { prefersReducedMotion } from '../../lib/reducedMotion'

/**
 * Closes the sheet WITH its exit animation. A sheet that draws its own header
 * (`hideHeader`) needs this for its close button — calling the caller's raw
 * `onClose` would unmount instantly and skip the slide-down.
 */
const SheetCloseContext = createContext<(() => void) | null>(null)
export function useSheetClose(): () => void {
  const close = useContext(SheetCloseContext)
  if (!close) throw new Error('useSheetClose must be used inside a <Sheet>')
  return close
}

/** Kept in step with the exit animations in theme.css. */
const EXIT_MS = 220

// ── Body scroll lock ─────────────────────────────────────────────────────────
// Ref-counted, because a sheet can open a confirm sheet on top of itself and
// the inner one closing must not unlock the page under the outer one.
//
// `overflow: hidden` alone is not enough on iOS — Safari keeps scrolling the
// document under a fixed overlay. Pinning the body and offsetting it by the
// current scroll is the technique that actually holds, so long as the exact
// scroll position is restored on the way out.
let lockCount = 0
let restore: (() => void) | null = null

/**
 * EXPORTED for Deck-E's chat overlay, which freezes the page the same way and
 * must share this refcount rather than keep its own. Two independent locks race
 * on `body.style` and the second one to unlock restores a stale scroll position.
 *
 * Two things a second caller has to know. It captures `window.scrollY` at lock
 * time and pins the body with `position: fixed`, so **`window.scrollY` reads 0
 * for as long as the lock is held** — anything computing a delta against a
 * previously-recorded scroll offset (the character's pinned-station drift, for
 * one) must be released BEFORE locking. And `restore()` closes over the scroll
 * position captured at lock time, so a lock/unlock/lock cycle around a
 * programmatic scroll re-captures correctly, but reusing a stale `restore`
 * would not.
 */
export function lockScroll() {
  if (lockCount++ > 0) return
  const { body } = document
  const scrollY = window.scrollY
  const prev = {
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
    overflow: body.style.overflow,
    overscroll: body.style.overscrollBehavior,
  }
  body.style.position = 'fixed'
  body.style.top = `-${scrollY}px`
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  body.style.overscrollBehavior = 'none'
  restore = () => {
    body.style.position = prev.position
    body.style.top = prev.top
    body.style.width = prev.width
    body.style.overflow = prev.overflow
    body.style.overscrollBehavior = prev.overscroll
    // Instant, not smooth: a smooth restore fights the closing animation.
    window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })
  }
}

export function unlockScroll() {
  if (--lockCount > 0) return
  lockCount = 0
  restore?.()
  restore = null
}

// ── Focus management ─────────────────────────────────────────────────────────
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export type SheetSize = 'sm' | 'md' | 'lg' | 'full'

const MAX_W: Record<SheetSize, string> = {
  sm: 'nav:max-w-[420px]',
  md: 'nav:max-w-[560px]',
  lg: 'nav:max-w-[720px]',
  full: 'nav:max-w-[920px]',
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  ariaLabel,
  headerSlot,
  contentClassName = '',
}: {
  /** Rendered as the sheet's heading and used as its accessible name. */
  title: string
  onClose: () => void
  children: ReactNode
  /** Pinned below the scroll area — actions stay reachable on a short screen. */
  footer?: ReactNode
  size?: SheetSize
  /** Overrides the accessible name when the visible title is not the right one. */
  ariaLabel?: string
  /**
   * Replaces the default title bar, still rendered in the sheet's fixed header
   * region rather than inside the scroll area. The card sheet uses it for a
   * grab handle and a floating close button in place of a heading.
   */
  headerSlot?: ReactNode
  contentClassName?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrimDownRef = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)

  // Play the exit, THEN tell the caller. Doing it here rather than in every
  // caller is what keeps a sheet from vanishing on one screen and sliding away
  // on another; callers still just pass a plain `onClose`.
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return
    if (prefersReducedMotion()) {
      onClose()
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, EXIT_MS)
  }, [onClose])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // Escape closes. Tab is trapped inside the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (nodes.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [requestClose])

  // Lock the page, then move focus in. On the way out, put focus back where the
  // user left it — otherwise the next Tab starts from the top of the document.
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    lockScroll()
    const id = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      // React's own `autoFocus` has already run by now. If it put focus on
      // something inside the sheet, leave it there — stealing it would land the
      // caret on the close button instead of the field the caller chose.
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body && panel.contains(active)) return
      const first = panel.querySelector<HTMLElement>('[data-autofocus]')
        ?? panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(id)
      unlockScroll()
      returnFocusRef.current?.focus?.({ preventScroll: true })
    }
  }, [])

  // Close on scrim click only when the gesture STARTED on the scrim. Without
  // this, selecting text in the sheet and releasing outside it closes the sheet.
  const onScrimPointerDown = useCallback((e: React.PointerEvent) => {
    scrimDownRef.current = e.target === e.currentTarget
  }, [])
  const onScrimClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && scrimDownRef.current) requestClose()
      scrimDownRef.current = false
    },
    [requestClose],
  )

  return createPortal(
    <SheetCloseContext.Provider value={requestClose}>
    <div
      className="px-sheet-scrim fixed inset-0 z-(--z-modal) flex items-end justify-center overflow-hidden overscroll-none p-0 nav:items-center nav:p-[16px]"
      style={{ background: 'var(--color-overlay-scrim-strong)' }}
      data-closing={closing || undefined}
      onPointerDown={onScrimPointerDown}
      onClick={onScrimClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        data-closing={closing || undefined}
        className={[
          'px-sheet-panel relative flex w-full flex-col overflow-hidden',
          // The cap is the whole trick: the panel can never outgrow the screen,
          // so nothing ever lands off the top. dvh (not vh) so a mobile URL bar
          // or an open keyboard shrinks it instead of pushing it out of view.
          'max-h-[92dvh] nav:max-h-[min(86dvh,860px)]',
          'rounded-t-2xl border border-border-default bg-surface-secondary shadow-xl nav:rounded-2xl',
          MAX_W[size],
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        {headerSlot ?? (
          <div className="shrink-0 border-b border-border-default">
            {/* Grab handle: reads as "this came up from the bottom" on touch. */}
            <div className="flex justify-center pt-[8px] nav:hidden">
              <span className="h-[4px] w-[40px] rounded-full bg-surface-tertiary" />
            </div>
            <div className="flex items-center justify-between px-[20px] py-[12px] nav:px-[24px] nav:py-[18px]">
              <h2 id={titleId} className="text-[18px] font-bold text-text-primary">
                {title}
              </h2>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="-mr-[6px] flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg text-icon-default hover:bg-surface-tertiary"
              >
                <Icon name="close" size={22} />
              </button>
            </div>
          </div>
        )}

        {/* The ONLY scroll container. overscroll-contain stops a flick at the
            end of the list from scrolling the page underneath. */}
        <div
          className={[
            'min-h-0 flex-1 overflow-y-auto overscroll-contain p-[20px] nav:p-[24px]',
            contentClassName,
          ].join(' ')}
          style={footer ? undefined : { paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t border-border-default px-[20px] py-[14px] nav:px-[24px]"
            style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
    </SheetCloseContext.Provider>,
    document.body,
  )
}
