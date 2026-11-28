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
 *
 * And three things it does the same way everywhere, so no caller draws its own:
 *
 * - **The top bar** (`SheetBar`): a grab handle on phones and one shared
 *   `CloseButton` pinned at the same inset from the top as from the side.
 * - **Drag to dismiss.** On a phone the bar can be pulled down, and so can the
 *   body once it is scrolled to the top. The panel follows the finger 1:1 on
 *   `transform` alone, written straight to the element each frame — no React
 *   render per move, no layout. Let go, and it either leaves at the speed it
 *   was thrown or springs back from where it was, carrying the release
 *   velocity (sheetDrag.ts has the physics and why).
 * - **The scroll edge.** Content scrolling under the bar fades and blurs into
 *   it instead of being sliced off (theme.css "The scroll edge").
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
  type Ref,
  type RefCallback,
} from 'react'
import { createPortal } from 'react-dom'
import { CloseButton } from './CloseButton'
import { prefersReducedMotion } from '../../lib/reducedMotion'
import { useScrollEdge, SCROLL_EDGE_PIN } from '../../lib/useScrollEdge'
import { DURATION, EASE } from '../../lib/motion'
import {
  createVelocityTracker,
  dragOffset,
  releaseDecision,
  springEasing,
  throwDuration,
  velocityCubic,
} from './sheetDrag'

/**
 * Closes the sheet WITH its exit animation. A sheet that draws its own header
 * (`headerSlot`) needs this for its close button — calling the caller's raw
 * `onClose` would unmount instantly and skip the slide-down.
 */
const SheetCloseContext = createContext<(() => void) | null>(null)
export function useSheetClose(): () => void {
  const close = useContext(SheetCloseContext)
  if (!close) throw new Error('useSheetClose must be used inside a <Sheet>')
  return close
}

/** Kept in step with the exit animations in theme.css (`--duration-base`). */
const EXIT_MS = DURATION.base

/** The bar's drag affordance. Every top bar a sheet draws must carry it. */
const HANDLE = 'data-sheet-handle'

/**
 * A sheet's top bar: the phone grab handle, an optional title row, and the
 * shared close control in the corner.
 *
 * The whole bar is the drag handle (`data-sheet-handle`), not just the pill —
 * a 36×5 target is a thing you aim at, a full-width bar is a thing you grab.
 * The bar is `sheet-bar` tall: the ✕'s 44px plus its inset above and below,
 * so a one-line title centres on the ✕ and the ✕ has equal room on every side.
 *
 * Used by Sheet's default header and by any `headerSlot` that wants the same
 * chrome around its own content (the card sheet, whose art is its heading).
 */
export function SheetBar({ children, className = '' }: { children?: ReactNode; className?: string }) {
  const close = useSheetClose()
  return (
    <div {...{ [HANDLE]: '' }} className={`sheet-bar relative flex shrink-0 items-center ${className}`}>
      <span aria-hidden className="sheet-grabber" />
      {children}
      <CloseButton corner onClick={close} />
    </div>
  )
}

/** Merge the caller's `contentRef` with the sheet's own. */
function useMergedRef<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  const latest = useRef(refs)
  latest.current = refs
  return useCallback((node: T | null) => {
    for (const ref of latest.current) {
      if (!ref) continue
      if (typeof ref === 'function') ref(node)
      else (ref as { current: T | null }).current = node
    }
  }, [])
}

/** `linear()` easing, which a spring needs, is Safari 17.2+/Chrome 113+. */
const supportsLinearEasing = (() => {
  try {
    return typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)')
  } catch {
    return false
  }
})()

/** The translateY a panel is currently drawn at, animations included. */
function currentTranslateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  try {
    return new DOMMatrixReadOnly(t).m42
  } catch {
    return 0
  }
}

function isDesktop(): boolean {
  try {
    return window.matchMedia('(min-width: 1068px)').matches
  } catch {
    return false
  }
}

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
  headerRight,
  contentClassName = '',
  contentRef,
  scrollEdgePins,
}: {
  /** Rendered as the sheet's heading and used as its accessible name. */
  title: string
  /**
   * Close the sheet — or REFUSE, by returning `false`.
   *
   * ⚠️ Refusing is why this returns anything. The exit is played optimistically
   * (see `requestClose`), so a caller that declines to unmount leaves a panel
   * and a full-screen scrim animated to `opacity: 0 forwards` and still
   * mounted: an invisible, pointer-eating, focus-trapped overlay. Returning
   * `false` tells the sheet to put itself back. The billing sheet does this
   * while a payment is in flight; almost nothing else should need to.
   *
   * A sheet dragged off the screen asks the same question when it lands, and
   * a refusal springs it back up.
   */
  onClose: () => void | boolean
  children: ReactNode
  /** Pinned below the scroll area — actions stay reachable on a short screen. */
  footer?: ReactNode
  size?: SheetSize
  /** Overrides the accessible name when the visible title is not the right one. */
  ariaLabel?: string
  /**
   * Replaces the default title bar, still rendered in the sheet's fixed header
   * region rather than inside the scroll area. Wrap it in `SheetBar` to keep
   * the grab handle, the drag gesture and the shared close control — the card
   * sheet does exactly that with no title in it, because its art is its
   * heading.
   */
  headerSlot?: ReactNode
  /**
   * A small mark or control sitting between the title and the close button.
   *
   * Distinct from `headerSlot`, which REPLACES the whole bar. This is for the
   * common case of wanting one badge in the corner without inheriting all of
   * that — the billing prompt puts "Powered by Stripe" here, where a payment
   * surface expects it, rather than spending a horizontal rule and a centred
   * line in the body to say four words.
   *
   * It is given `shrink-0` and the title `min-w-0`, so a long title wraps
   * rather than crushing the accessory.
   */
  headerRight?: ReactNode
  contentClassName?: string
  /** Access to the sole scrolling body for bounded, programmatic content navigation. */
  contentRef?: Ref<HTMLDivElement>
  /**
   * Extra selector for sticky content the scroll edge must keep clear of
   * (`[data-scroll-edge-pin]` is always included). See `useScrollEdge`.
   */
  scrollEdgePins?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  /**
   * The scrim's COLOUR, as its own layer. The scrim element is the panel's
   * parent (it lays the panel out), so fading the scrim itself fades the
   * panel with it — a dragged sheet went see-through. The drag dims this
   * instead; the scrim's own opacity stays the entrance/exit fade.
   */
  const backdropRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const edgeHostRef = useRef<HTMLDivElement>(null)
  const scrimDownRef = useRef(false)
  // Where focus goes back to on close, read during the FIRST RENDER. By the
  // time any effect runs, a child's `autoFocus` (React applies it at commit,
  // before effects) has already moved focus into the sheet — which made the
  // sheet "return" focus to its own unmounted field, i.e. to <body>.
  const [openedFrom] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)))
  const returnFocusRef = useRef<HTMLElement | null>(openedFrom)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // ── Drag state. Refs, never React state: a re-render per pointer move is
  // exactly the work a 60fps drag cannot afford.
  const drag = useRef<DragState | null>(null)
  const pending = useRef<{ id: number; y: number; t: number } | null>(null)
  const settling = useRef<Animation[]>([])
  const thrown = useRef(false)
  const [tracker] = useState(() => createVelocityTracker())

  const stopSettling = () => {
    for (const a of settling.current) a.cancel()
    settling.current = []
  }

  // Play the exit, THEN tell the caller. Doing it here rather than in every
  // caller is what keeps a sheet from vanishing on one screen and sliding away
  // on another; callers still just pass a plain `onClose`.
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null || thrown.current) return
    // A close asked for mid-gesture (Escape while dragging) or mid-spring
    // takes the sheet from wherever the CSS exit would expect it: at rest.
    pending.current = null
    if (drag.current) {
      if (drag.current.frame) cancelAnimationFrame(drag.current.frame)
      drag.current = null
    }
    stopSettling()
    const panel = panelRef.current
    if (panel) {
      panel.removeAttribute('data-dragging')
      panel.style.transform = ''
    }
    if (backdropRef.current) backdropRef.current.style.opacity = ''
    if (prefersReducedMotion()) {
      onClose()
      return
    }
    setClosing(true)
    // ⚠️ THE LATCH MUST CLEAR ITSELF, because `onClose` MAY REFUSE.
    //
    // This used to leave `closeTimer.current` set for ever and never undo
    // `closing`, on the assumption that the caller always unmounts a frame
    // after the exit animation — the invariant `theme.css` states. The
    // billing sheet made that false: it refuses to close while a payment is in
    // flight (`SupportPrompt`'s `writing` ref). So pressing Escape during a
    // bank challenge faded the panel AND the full-screen scrim to
    // `opacity: 0 forwards`, left them mounted, and dead-latched every
    // subsequent Escape, ✕ and backdrop click. The reader was left under an
    // invisible, pointer-eating, focus-trapped `fixed inset-0` overlay until
    // they reloaded — and reloading loses the done screen that is a one-off's
    // only in-app record (057).
    //
    // ⚠️ AND `setClosing(false)` ONLY ON A REFUSAL. Round forty-four cleared it
    // unconditionally, which is invisible where `onClose` unmounts by a plain
    // `setState` (React batches the two) and NOT invisible where it unmounts
    // through TanStack Router, which commits navigation inside
    // `startTransition` after an async `router.load()`. There the restore lands
    // as its own painted frame with the panel still mounted and no longer
    // closing, so `animation-name` flips back to `sheet-panel-up` — and a
    // name change RESTARTS the animation. The card sheet, on five routes, read
    // as "slide out, slide back in, vanish".
    //
    // A refusal is the only case that needs the restore, and the caller is the
    // only thing that knows: `onClose` returns `false` to say so.
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      if (onClose() === false) setClosing(false)
    }, EXIT_MS)
  }, [onClose])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      if (drag.current?.frame) cancelAnimationFrame(drag.current.frame)
    },
    [],
  )

  // ── Drag to dismiss ────────────────────────────────────────────────────────

  /** The scrim dims in step with how much of the sheet is still on screen. */
  const scrimOpacity = (d: DragState) => (d.offset <= 0 ? d.scrimFrom : d.scrimFrom * Math.max(0, 1 - d.offset / d.height))

  const paint = () => {
    const d = drag.current
    const panel = panelRef.current
    if (!d || !panel) return
    d.frame = 0
    panel.style.transform = `translate3d(0, ${d.offset}px, 0)`
    if (backdropRef.current) backdropRef.current.style.opacity = String(scrimOpacity(d))
  }

  /**
   * Take hold of the panel. It is caught WHERE IT IS DRAWN — part-way through
   * its entrance, or part-way back from a previous spring — so the grab never
   * jumps: the running animation is read, then removed, and the inline
   * transform takes over from exactly that point.
   */
  const startDrag = (clientY: number, t: number, pointerId: number | null): boolean => {
    const panel = panelRef.current
    const scrim = scrimRef.current
    if (!panel || thrown.current || closeTimer.current !== null || isDesktop()) return false
    const origin = currentTranslateY(panel)
    // The scrim may still be fading in. Its entrance is taken off below, so
    // the dimming carries on from here on the backdrop layer instead.
    const scrimFrom = scrim ? Number(getComputedStyle(scrim).opacity) || 1 : 1
    stopSettling()
    panel.setAttribute('data-dragged', '')
    panel.setAttribute('data-dragging', '')
    scrim?.setAttribute('data-dragged', '')
    drag.current = { startY: clientY, origin, offset: origin, height: panel.offsetHeight || 1, scrimFrom, pointerId, frame: 0 }
    tracker.reset()
    tracker.add(t, clientY)
    paint()
    return true
  }

  const moveDrag = (clientY: number, t: number) => {
    const d = drag.current
    if (!d) return
    d.offset = dragOffset(d.origin, clientY - d.startY)
    tracker.add(t, clientY)
    if (!d.frame) d.frame = requestAnimationFrame(paint)
  }

  /** Back to rest, carrying the release velocity into a spring. */
  const springBack = (from: number, velocity: number, scrimNow: number) => {
    const panel = panelRef.current
    const scrim = backdropRef.current
    if (!panel) return
    // The resting state is what the animation lands on; it plays over it.
    panel.style.transform = ''
    if (scrim) scrim.style.opacity = ''
    const anims: Animation[] = []
    if (!prefersReducedMotion() && Math.abs(from) >= 0.5) {
      const spring = !supportsLinearEasing
        ? { easing: EASE.sheet, duration: DURATION.slow }
        : from > 0
          ? // Coming back UP: critically damped, and never past rest — a
            // bottom sheet that overshoots upward opens a gap between itself
            // and the screen edge. Only a hard upward throw reaches the clamp.
            springEasing({ from, to: 0, velocity, response: 0.36, damping: 1, clampOvershoot: true })
          : // Let go after a pull UP: it drops back with a small settle, which
            // is the rubber band letting go.
            springEasing({ from, to: 0, velocity })
      anims.push(
        panel.animate([{ transform: `translate3d(0, ${from}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }], {
          duration: spring.duration,
          easing: spring.easing,
        }),
      )
    }
    if (scrim && scrimNow < 1) {
      anims.push(
        scrim.animate([{ opacity: scrimNow }, { opacity: 1 }], { duration: DURATION.base, easing: EASE.enter }),
      )
    }
    settling.current = anims
  }

  /**
   * Off the bottom of the screen at the speed it was thrown, then close.
   * Calls `onClose` directly: the travel IS the exit animation, so the
   * keyframed one is suppressed (`data-thrown`) rather than played twice.
   */
  const throwAway = (d: DragState, velocity: number) => {
    const panel = panelRef.current
    const scrim = backdropRef.current
    if (!panel) return
    thrown.current = true
    panel.setAttribute('data-thrown', '')
    scrimRef.current?.setAttribute('data-thrown', '')
    const target = d.height + 16
    const distance = target - d.offset
    const reduce = prefersReducedMotion()
    const duration = reduce ? DURATION.base : throwDuration(distance, velocity)
    const scrimNow = scrimOpacity(d)
    const travel = reduce
      ? panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: EASE.standard, fill: 'forwards' })
      : panel.animate(
          [{ transform: `translate3d(0, ${d.offset}px, 0)` }, { transform: `translate3d(0, ${target}px, 0)` }],
          { duration, easing: velocityCubic({ distance, velocity, duration }), fill: 'forwards' },
        )
    const anims = [travel]
    if (scrim) anims.push(scrim.animate([{ opacity: scrimNow }, { opacity: 0 }], { duration, easing: EASE.standard, fill: 'forwards' }))
    settling.current = anims
    travel.onfinish = () => {
      if (onCloseRef.current() !== false) return
      // REFUSED (a payment in flight): come back up from where it landed.
      thrown.current = false
      panel.removeAttribute('data-thrown')
      scrimRef.current?.removeAttribute('data-thrown')
      panel.style.transform = reduce ? '' : `translate3d(0, ${target}px, 0)`
      stopSettling()
      springBack(reduce ? 0 : target, 0, 0)
    }
  }

  const endDrag = (t: number) => {
    const d = drag.current
    drag.current = null
    const panel = panelRef.current
    if (!d || !panel) return
    if (d.frame) cancelAnimationFrame(d.frame)
    panel.removeAttribute('data-dragging')
    const velocity = tracker.velocity(t)
    if (releaseDecision({ offset: d.offset, velocity, height: d.height }) === 'dismiss') throwAway(d, velocity)
    else springBack(d.offset, velocity, scrimOpacity(d))
  }

  // The bar: pointer events, so a mouse can drag it in a narrow window as
  // well as a finger on a phone. Delegated from the panel, which is also what
  // holds the capture, so a bar supplied through `headerSlot` drags with no
  // wiring of its own beyond carrying `data-sheet-handle`.
  const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    const target = e.target as Element
    if (!target.closest(`[${HANDLE}]`)) return
    // The ✕ and anything else pressable in the bar keep their own taps.
    if (target.closest('button, a, input, select, textarea, [role="button"]')) return
    if (isDesktop() || thrown.current || closeTimer.current !== null) return
    pending.current = { id: e.pointerId, y: e.clientY, t: e.timeStamp }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A pointer that is already gone cannot be captured; the move never comes.
    }
  }
  const onPanelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current && drag.current.pointerId === e.pointerId) {
      moveDrag(e.clientY, e.timeStamp)
      return
    }
    const p = pending.current
    if (!p || p.id !== e.pointerId) return
    // A few pixels of slop, so a tap on the bar stays a tap.
    if (Math.abs(e.clientY - p.y) < 3) return
    pending.current = null
    if (startDrag(p.y, p.t, e.pointerId)) moveDrag(e.clientY, e.timeStamp)
  }
  const onPanelPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pending.current?.id === e.pointerId) pending.current = null
    if (drag.current && drag.current.pointerId === e.pointerId) endDrag(e.timeStamp)
  }

  // The body: a pull down while it is scrolled to the top moves the SHEET, the
  // way an iOS sheet does, and every other touch scrolls. Touch events rather
  // than pointer events because only a non-passive `touchmove` can take a
  // gesture away from the browser's scrolling once it has begun; the decision
  // is made on the first move, while it is still cancelable.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    let start: { x: number; y: number; t: number } | null = null
    let mode: 'idle' | 'pending' | 'drag' | 'scroll' = 'idle'
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || isDesktop() || thrown.current || closeTimer.current !== null) {
        mode = 'idle'
        return
      }
      const touch = e.touches[0]
      start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp }
      mode = el.scrollTop <= 0 && !insideScrolledOrRange(e.target, el) ? 'pending' : 'scroll'
    }
    const onMove = (e: TouchEvent) => {
      if (!start || mode === 'idle' || mode === 'scroll') return
      const touch = e.touches[0]
      if (mode === 'pending') {
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        // Up or sideways is the content's, and so is anything the browser has
        // already committed to scrolling.
        if (dy <= 0 || Math.abs(dx) > dy || !e.cancelable || !startDrag(start.y, start.t, null)) {
          mode = 'scroll'
          return
        }
        mode = 'drag'
      }
      e.preventDefault()
      moveDrag(touch.clientY, e.timeStamp)
    }
    const onEnd = (e: TouchEvent) => {
      if (mode === 'drag') endDrag(e.timeStamp)
      mode = 'idle'
      start = null
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
    // The handlers read refs only; binding once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const edgeRef = useScrollEdge({
    host: edgeHostRef,
    pins: scrollEdgePins ? `${SCROLL_EDGE_PIN}, ${scrollEdgePins}` : SCROLL_EDGE_PIN,
    // Without a footer the sheet's bottom IS the screen's bottom edge, where
    // iOS lets content run to the glass rather than fading it.
    trailing: !!footer,
  })
  const setBodyRef = useMergedRef<HTMLDivElement>(contentRef, bodyRef, edgeRef)

  // Escape closes. Tab is trapped inside the panel (plus any write toast).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const panel = panelRef.current
      // Only the topmost dialog owns Tab. A sheet under another (the support
      // prompt opening over a card sheet) would otherwise pull focus back to
      // itself on every press.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (dialogs[dialogs.length - 1] !== panel) return
      const focusable = (root: HTMLElement | null) =>
        root
          ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
              (el) => el.offsetParent !== null || el === document.activeElement,
            )
          : []
      const nodes = focusable(panel)
      // The write-feedback toast (components/ui/Toast.tsx) lives outside every
      // sheet, and a save that fails INSIDE one — a card-sheet stepper, the Add
      // Cards picker — puts its Retry there. The loop therefore runs panel →
      // toast → panel; trapped without it, a keyboard could never reach Retry.
      const toastRoot = document.querySelector<HTMLElement>('[data-toaster]')
      const toast = focusable(toastRoot)
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inToast = !!active && !!toastRoot?.contains(active)
      const inPanel = !!active && panel.contains(active)
      const move = (to: HTMLElement) => {
        e.preventDefault()
        to.focus()
      }
      if (e.shiftKey) {
        if (inToast && active === toast[0]) move(last)
        else if (!inToast && (active === first || !inPanel)) move(toast.at(-1) ?? last)
      } else if (active === last) move(toast[0] ?? first)
      else if (inToast && active === toast.at(-1)) move(first)
      // Focus can fall out to <body> — a focused button that becomes disabled
      // while its save runs drops it — and Tab must come back in, not wander
      // through the page under the scrim.
      else if (!inToast && !inPanel) move(first)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [requestClose])

  // Lock the page, then move focus in. On the way out, put focus back where the
  // user left it — otherwise the next Tab starts from the top of the document.
  useEffect(() => {
    lockScroll()
    const mounted = panelRef.current
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
      // Only when the sheet has really gone (its panel is out of the document;
      // StrictMode's rehearsal unmount leaves it in, and refocusing then would
      // pull focus off the field `autoFocus` chose), and only to something
      // still on the page — focusing a detached node is a silent no-op that
      // leaves focus on <body>.
      const back = returnFocusRef.current
      if (!mounted?.isConnected && back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [])

  // Close on scrim click only when the gesture STARTED on the scrim. Without
  // this, selecting text in the sheet and releasing outside it closes the sheet.
  // "The scrim" is the container or its backdrop layer, whichever is hit.
  const onScrim = (target: EventTarget) => target === scrimRef.current || target === backdropRef.current
  const onScrimPointerDown = useCallback((e: React.PointerEvent) => {
    scrimDownRef.current = onScrim(e.target)
  }, [])
  const onScrimClick = useCallback(
    (e: React.MouseEvent) => {
      if (onScrim(e.target) && scrimDownRef.current) requestClose()
      scrimDownRef.current = false
    },
    [requestClose],
  )

  return createPortal(
    <SheetCloseContext.Provider value={requestClose}>
    <div
      ref={scrimRef}
      className="px-sheet-scrim fixed inset-0 z-(--z-modal) flex items-end justify-center overflow-hidden overscroll-none p-0 nav:items-center nav:p-4"
      data-closing={closing || undefined}
      onPointerDown={onScrimPointerDown}
      onClick={onScrimClick}
    >
      <div
        ref={backdropRef}
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'var(--color-overlay-scrim-strong)' }}
      />
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
        onPointerDown={onPanelPointerDown}
        onPointerMove={onPanelPointerMove}
        onPointerUp={onPanelPointerUp}
        onPointerCancel={onPanelPointerUp}
      >
        {headerSlot ?? (
          // `pr-16` keeps a long title clear of the ✕ in the corner: its 44px
          // box, its 8px inset, and a 12px gap.
          <SheetBar className="gap-3 border-b border-border-default pl-5 pr-16 nav:pl-6">
            <h2 id={titleId} className="min-w-0 flex-1 py-2 text-[18px] font-bold text-text-primary">
              {title}
            </h2>
            {headerRight && <div className="flex shrink-0 items-center">{headerRight}</div>}
          </SheetBar>
        )}

        <div ref={edgeHostRef} className="relative flex min-h-0 flex-1 flex-col">
          {/* The ONLY scroll container. overscroll-contain stops a flick at the
              end of the list from scrolling the page underneath. */}
          <div
            ref={setBodyRef}
            data-sheet-content
            className={[
              'scroll-edge min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 nav:p-6',
              contentClassName,
            ].join(' ')}
            style={footer ? undefined : { paddingBottom: 'calc(var(--spacing) * 5 + env(safe-area-inset-bottom))' }}
          >
            {children}
          </div>
          {/* The blur half of the scroll edge — see theme.css. Siblings of the
              scroller, because a backdrop filter inside the masked scroller
              would have nothing behind it to blur. */}
          <div aria-hidden className="scroll-edge-blur" />
          {footer && <div aria-hidden className="scroll-edge-blur" data-edge="bottom" />}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t border-border-default px-5 py-3.5 nav:px-6"
            style={{ paddingBottom: 'calc(var(--spacing) * 3.5 + env(safe-area-inset-bottom))' }}
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

interface DragState {
  /** clientY where the gesture began. */
  startY: number
  /** Where the panel was drawn when it was caught. */
  origin: number
  /** Where it is drawn now, px below rest (negative is a rubber-banded pull up). */
  offset: number
  height: number
  /** The scrim's opacity when it was caught (it may still have been fading in). */
  scrimFrom: number
  /** The pointer that owns the drag; `null` for a touch on the body. */
  pointerId: number | null
  /** The pending paint, so moves between frames coalesce into one write. */
  frame: number
}

/**
 * A touch that starts inside something that scrolls on its own (and is not at
 * its top), or on a slider, belongs to that thing rather than to the sheet.
 */
function insideScrolledOrRange(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== root) {
    if (node instanceof HTMLInputElement && node.type === 'range') return true
    if (node instanceof HTMLElement && node.scrollTop > 0 && node.scrollHeight > node.clientHeight) return true
    node = node.parentElement
  }
  return false
}
