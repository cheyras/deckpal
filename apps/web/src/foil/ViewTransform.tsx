// foil/ViewTransform.tsx — pan + pinch-zoom for the workbench viewer while a
// mask (or the window rect) is being edited.
//
// WHY A "VIEW OFFSET" AND NOT A CSS SCALE OF THE WHOLE VIEWER: the card is a
// three.js render, so CSS-scaling the viewer would just magnify a 390px-wide
// framebuffer — useless for tracing a printed edge. Instead the SAME transform
// is expressed twice, in the two places that matter:
//
//   • three.js — camera.setViewOffset(W·z, H·z, x, y, W, H) renders the (x,y,W,H)
//     window OUT OF a virtual W·z × H·z image. The card is re-rasterized at the
//     zoomed size, so 4× zoom is 4× real detail, not 4× blur.
//   • the overlays — one wrapper div carries
//     `translate(-x,-y) scale(z)`, applied imperatively (no React re-render per
//     frame; the whole workbench keeps the settingsRef/tilt-ref ethos).
//
// Because the projection is a pure crop of a linearly-scaled virtual render,
// a point at base (unzoomed) coord u lands on screen at u·z − offset — which is
// EXACTLY what the CSS transform does to the overlays. So the mask canvas and
// the rendered card stay locked together at every zoom, and the pointer→texel
// math in MaskEditor needs no changes at all: getBoundingClientRect() on a
// transformed element already reports the on-screen rect.
//
// Gesture rules (edit/adjust mode only — normal viewing keeps tilt untouched):
//   two fingers   pinch-zoom + pan (midpoint anchored)
//   one finger    pans UNLESS it is a drawing finger ("Allow finger drawing")
//                 or it grabbed a window handle — Procreate's model
//   pen           always draws; while a pen is down, touches are ignored (palm)
//   mouse         wheel/trackpad-pinch zooms at the cursor; middle-drag or
//                 Space+drag pans; +/−/0 keys
//   a second finger landing mid-stroke ABORTS and rolls back that stroke.
//
// Pan is clamped to the virtual render, so the card can never be lost off-screen
// and "fit" is always one tap away anyway (⤢ in the HUD).

import { useEffect, useRef, useSyncExternalStore } from 'react'

/** Scale + view offset. offset is in px of the virtual (zoomed) render. */
export interface ViewTransform {
  zoom: number
  x: number
  y: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

export interface ViewOpts {
  /** Gestures are live only while an editing surface is open. */
  enabled: boolean
  /** Mask-paint surface open (vs. window-adjust). */
  editing: boolean
  /** "Allow finger drawing" — when on, one finger paints so pan needs two. */
  fingerDraws: boolean
}

export interface ViewController {
  /** Attach/detach the window-level listeners. MUST be symmetric — StrictMode
   *  runs mount → cleanup → mount, and a one-shot registration in the factory
   *  would be torn down on that simulated unmount and never come back (which
   *  silently kills pointerup, i.e. gestures that start and never end). */
  attach: () => void
  detach: () => void
  /** Live transform — read by CardViewer's rAF loop and the brush scaler. */
  view: React.RefObject<ViewTransform>
  /** Callback ref for the viewer host (gesture + wheel + iOS listeners). */
  hostRef: (el: HTMLElement | null) => void
  /** Callback ref for the transformed overlay wrapper. */
  wrapRef: (el: HTMLElement | null) => void
  /** True while a pan/pinch owns the pointers — the brush stands down. */
  gesturing: () => boolean
  /** MaskEditor registers a rollback for a stroke a gesture interrupts. */
  setStrokeAbort: (fn: (() => void) | null) => void
  zoomBy: (factor: number) => void
  reset: () => void
  subscribe: (fn: () => void) => () => void
  /** Rounded zoom percentage — a stable snapshot for useSyncExternalStore. */
  zoomPct: () => number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

function makeController(optsRef: { current: ViewOpts }): ViewController {
  const view = { current: { zoom: 1, x: 0, y: 0 } as ViewTransform }
  let hostEl: HTMLElement | null = null
  let wrapEl: HTMLElement | null = null

  const subs = new Set<() => void>()
  let pct = 100

  const touches = new Map<number, { x: number; y: number }>()
  let penDown = false
  let mode: 'none' | 'pan' | 'pinch' = 'none'
  let panId = -1
  let start = { zoom: 1, x: 0, y: 0, mx: 0, my: 0, dist: 1 }
  let space = false
  let abortStroke: (() => void) | null = null
  let moveBound = false

  const notify = () => {
    const p = Math.round(view.current.zoom * 100)
    if (p === pct) return
    pct = p
    for (const f of subs) f()
  }

  const cursor = (c: string | null) => {
    if (!hostEl) return
    if (c) hostEl.style.setProperty('--foil-cursor', c)
    else hostEl.style.removeProperty('--foil-cursor')
  }

  /** Keep the visible window inside the virtual render — the card can't escape. */
  const clampView = () => {
    const v = view.current
    v.zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM)
    if (!hostEl) return // no box to clamp against yet — don't zero the pan
    const W = hostEl.clientWidth
    const H = hostEl.clientHeight
    v.x = clamp(v.x, 0, Math.max(0, W * (v.zoom - 1)))
    v.y = clamp(v.y, 0, Math.max(0, H * (v.zoom - 1)))
  }

  const apply = () => {
    clampView()
    const v = view.current
    if (wrapEl) {
      wrapEl.style.transformOrigin = '0 0'
      wrapEl.style.transform = `translate(${-v.x}px, ${-v.y}px) scale(${v.zoom})`
      // Handles/outlines counter-scale off this so they stay finger-sized.
      wrapEl.style.setProperty('--foil-zoom', String(v.zoom))
    }
    notify()
  }

  const pt = (e: { clientX: number; clientY: number }) => {
    if (!hostEl) return { x: 0, y: 0 }
    const r = hostEl.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /** Zoom keeping the base-space point under (cx,cy) pinned there. */
  const zoomAbout = (factor: number, cx: number, cy: number) => {
    const v = view.current
    const z0 = v.zoom
    const z1 = clamp(z0 * factor, MIN_ZOOM, MAX_ZOOM)
    if (z1 === z0) return
    const ux = (cx + v.x) / z0
    const uy = (cy + v.y) / z0
    v.zoom = z1
    v.x = ux * z1 - cx
    v.y = uy * z1 - cy
    apply()
  }

  // ── gesture bookkeeping ──────────────────────────────────────────────────

  const bindMove = () => {
    if (moveBound) return
    moveBound = true
    window.addEventListener('pointermove', onWinMove, { passive: false })
  }
  const endGesture = () => {
    mode = 'none'
    panId = -1
    if (moveBound) {
      moveBound = false
      window.removeEventListener('pointermove', onWinMove)
    }
    cursor(space ? 'grab' : null)
  }

  const beginPan = (id: number, p: { x: number; y: number }) => {
    abortStroke?.()
    mode = 'pan'
    panId = id
    const v = view.current
    start = { zoom: v.zoom, x: v.x, y: v.y, mx: p.x, my: p.y, dist: 1 }
    bindMove()
    cursor('grabbing')
  }

  const beginPinch = () => {
    abortStroke?.()
    const pts = [...touches.values()]
    const a = pts[0]!
    const b = pts[1]!
    const v = view.current
    start = {
      zoom: v.zoom,
      x: v.x,
      y: v.y,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    }
    mode = 'pinch'
    panId = -1
    bindMove()
  }

  // ── listeners ────────────────────────────────────────────────────────────

  function onWinMove(e: PointerEvent) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, pt(e))
    const v = view.current
    if (mode === 'pinch') {
      const pts = [...touches.values()]
      if (pts.length < 2) return
      const a = pts[0]!
      const b = pts[1]!
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const z1 = clamp(start.zoom * (dist / start.dist), MIN_ZOOM, MAX_ZOOM)
      // Anchor: the base-space point under the gesture's ORIGINAL midpoint
      // rides the CURRENT midpoint — one formula gives zoom and pan together.
      const ux = (start.mx + start.x) / start.zoom
      const uy = (start.my + start.y) / start.zoom
      v.zoom = z1
      v.x = ux * z1 - mx
      v.y = uy * z1 - my
      apply()
    } else if (mode === 'pan' && e.pointerId === panId) {
      const p = pt(e)
      // Recomputed from the gesture start every move (never accumulated), so
      // clamping at an edge can't drift the anchor.
      v.zoom = start.zoom
      v.x = start.x + (start.mx - p.x)
      v.y = start.y + (start.my - p.y)
      apply()
    }
  }

  const onDown = (e: PointerEvent) => {
    const o = optsRef.current
    if (!o.enabled) return
    if (e.pointerType === 'pen') {
      penDown = true
      touches.clear()
      if (mode !== 'none') endGesture()
      return
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 1 || space) {
        e.preventDefault()
        beginPan(e.pointerId, pt(e))
      }
      return
    }
    if (penDown) return // palm rejection: a pen owns the surface
    touches.set(e.pointerId, pt(e))
    if (touches.size === 2) {
      beginPinch()
      return
    }
    if (touches.size !== 1) return
    const target = e.target as Element | null
    const onHandle = Boolean(target?.closest?.('[data-window-handle]'))
    const fingerPaints = o.editing && o.fingerDraws
    if (!onHandle && !fingerPaints) beginPan(e.pointerId, pt(e))
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerType === 'pen') penDown = false
    touches.delete(e.pointerId)
    if (mode === 'pinch' && touches.size < 2) endGesture()
    else if (mode === 'pan' && e.pointerId === panId) endGesture()
  }

  const onWheel = (e: WheelEvent) => {
    if (!optsRef.current.enabled || !hostEl) return
    e.preventDefault() // trackpad pinch arrives here as ctrlKey+wheel
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? hostEl.clientHeight || 400 : 1
    const dy = clamp(e.deltaY * unit, -240, 240)
    const p = pt(e)
    zoomAbout(Math.exp(-dy * 0.0028), p.x, p.y)
  }

  // Safari (iOS + macOS) still page-zooms on a pinch even with touch-action:none
  // — its gesture* events are the only reliable veto.
  const onSafariGesture = (e: Event) => {
    if (optsRef.current.enabled) e.preventDefault()
  }
  // Belt and braces for iOS: kill the scroll/zoom default for touches that
  // started in the viewer while editing.
  const onTouchMove = (e: TouchEvent) => {
    if (optsRef.current.enabled && e.cancelable) e.preventDefault()
  }
  // Fix 2: no text/image selection, no drag ghost, ever, on the viewer.
  const onSelectStart = (e: Event) => e.preventDefault()
  const onDragStart = (e: Event) => e.preventDefault()

  const onKey = (e: KeyboardEvent) => {
    const o = optsRef.current
    if (!o.enabled) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.code === 'Space') {
      // Both halves are prevented: Space is the pan modifier here, and a
      // <button> in the HUD activates on keyUP — an unprevented keyup would
      // re-fire whichever zoom button was last clicked.
      e.preventDefault()
      if (e.type === 'keydown') {
        if (!space) {
          space = true
          if (mode !== 'pan') cursor('grab')
        }
      } else {
        space = false
        if (mode !== 'pan') cursor(null)
      }
      return
    }
    if (e.type !== 'keydown') return
    if (e.key === '0') ctl.reset()
    else if (e.key === '+' || e.key === '=') ctl.zoomBy(1.5)
    else if (e.key === '-' || e.key === '_') ctl.zoomBy(1 / 1.5)
  }

  const onBlur = () => {
    space = false
    if (mode !== 'pan') cursor(null)
  }

  const HOST_EVENTS: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', onDown as EventListener],
    ['wheel', onWheel as EventListener, { passive: false }],
    ['touchmove', onTouchMove as EventListener, { passive: false }],
    ['gesturestart', onSafariGesture, { passive: false }],
    ['gesturechange', onSafariGesture, { passive: false }],
    ['gestureend', onSafariGesture, { passive: false }],
    ['selectstart', onSelectStart],
    ['dragstart', onDragStart],
  ]

  let ro: ResizeObserver | null = null
  let attached = false

  const ctl: ViewController = {
    attach: () => {
      if (attached) return
      attached = true
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('keydown', onKey)
      window.addEventListener('keyup', onKey)
      window.addEventListener('blur', onBlur)
    },
    detach: () => {
      if (!attached) return
      attached = false
      endGesture()
      touches.clear()
      penDown = false
      space = false
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    },
    view,
    hostRef: (el) => {
      if (hostEl === el) return
      if (hostEl) {
        for (const [type, fn] of HOST_EVENTS) hostEl.removeEventListener(type, fn)
        ro?.disconnect()
        ro = null
      }
      hostEl = el
      if (!el) return
      for (const [type, fn, opt] of HOST_EVENTS) el.addEventListener(type, fn, opt)
      // A resize changes the clamp envelope (and the virtual render size).
      ro = new ResizeObserver(() => apply())
      ro.observe(el)
      apply()
    },
    wrapRef: (el) => {
      wrapEl = el
      apply()
    },
    gesturing: () => mode !== 'none',
    setStrokeAbort: (fn) => {
      abortStroke = fn
    },
    zoomBy: (factor) => {
      const W = hostEl?.clientWidth ?? 0
      const H = hostEl?.clientHeight ?? 0
      zoomAbout(factor, W / 2, H / 2)
    },
    reset: () => {
      view.current = { zoom: 1, x: 0, y: 0 }
      apply()
    },
    subscribe: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    zoomPct: () => pct,
  }

  return ctl
}

export function useViewTransform(opts: ViewOpts): ViewController {
  const optsRef = useRef<ViewOpts>(opts)
  optsRef.current = opts
  const ref = useRef<ViewController | null>(null)
  if (!ref.current) ref.current = makeController(optsRef)
  const ctl = ref.current

  // Symmetric on purpose — see ViewController.attach. The host/wrap listeners
  // and the ResizeObserver ride React's own ref cleanup, so there is nothing
  // else to tear down on unmount.
  useEffect(() => {
    ctl.attach()
    return () => ctl.detach()
  }, [ctl])
  // Leaving the editing surfaces returns the viewer to its normal framing.
  useEffect(() => {
    if (!opts.enabled) ctl.reset()
  }, [ctl, opts.enabled])

  return ctl
}

/** Zoom readout + steppers + fit — the way back, one-handed at 390px. */
export function ZoomHud({ ctl, className = '' }: { ctl: ViewController; className?: string }) {
  const pct = useSyncExternalStore(ctl.subscribe, ctl.zoomPct, ctl.zoomPct)
  // Deliberately compact: at 390px this floats over the card he is tracing, so
  // it buys back every px it can while staying a 32px thumb target.
  const btn =
    'flex h-[32px] w-[32px] items-center justify-center rounded-full text-[15px] leading-none text-text-primary hover:bg-surface-tertiary disabled:opacity-35'
  return (
    <div
      data-testid="zoom-hud"
      className={`flex select-none items-center rounded-full border border-border-default bg-surface-secondary/85 p-[2px] backdrop-blur-sm ${className}`}
    >
      <button className={btn} aria-label="Zoom out" disabled={pct <= MIN_ZOOM * 100} onClick={() => ctl.zoomBy(1 / 1.5)}>
        −
      </button>
      <span data-testid="zoom-pct" className="min-w-[42px] text-center text-[12px] tabular-nums text-text-muted">
        {pct}%
      </span>
      <button className={btn} aria-label="Zoom in" disabled={pct >= MAX_ZOOM * 100} onClick={() => ctl.zoomBy(1.5)}>
        +
      </button>
      <button className={btn} aria-label="Fit to view" title="Fit to view (0)" onClick={ctl.reset}>
        ⤢
      </button>
    </div>
  )
}
