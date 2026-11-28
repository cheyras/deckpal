// THE CAMERA → LIST HAND-OFF: one capture, one visible image, at every frame
// (design §4; decision 2026-11-27 "a flip is always captured").
//
// The owner, 2026-11-27 (S5): "the thing doesn't actually, like, animate down
// into the cards list… it can't feel glitchy and it can't feel like it just…
// goes away and appears somewhere else… it needs to feel fluid and smooth".
//
// What it did: the row was inserted with its thumbnail already showing and
// playing a scaleY reveal, a THIRD image was flown from the tray thumbnail
// (still showing too) to a rect measured once, mid-reveal, while the rows
// around it slid. For 300 ms one capture was on screen three times, and the
// courier landed where the row had been, not where it was.
//
// Now each leg hands ONE image over:
//
//   capture → tray   the tray slot is inserted hidden; a courier flies from the
//                    captured quad's pose and, on the frame it lands, the slot
//                    is shown and the courier removed.
//   tray → row       the row is inserted (synchronously, flushSync) with its
//                    thumbnail hidden; in the same frame a courier is made at
//                    the tray thumbnail's exact rect — a clone, ring and tick
//                    included — and the tray thumbnail is hidden. It flies to
//                    the row thumbnail, and on landing the thumbnail is shown,
//                    the courier removed, and the thumbnail bumps.
//
// HOMING. Each courier is driven by requestAnimationFrame, not a fixed WAAPI
// keyframe: every frame its pose is lerp(start, target rect NOW, ease(t)), with
// the target re-measured. A list that scrolls, another row landing above, a
// printing list loading under it — none can leave it short or make it jump.
// This is a deliberate, documented exception to motion.ts's "WAAPI only" rule;
// what moves is still only `transform` and `opacity`.
//
// LANDINGS ARE QUEUED: launched in settle order, at least LAUNCH_GAP_MS apart.
// Flights may overlap; each homes on its own row.
//
// PURE DOM, no React: Scan.tsx and the motion test's fixture
// (tests/browser/scanReviewMotionFixture.tsx) drive this one module.

import { DURATION as TOKENS, EASE as TOKEN_EASE } from '../../lib/motion'
import { prefersReducedMotion } from './motion'

/** Capture → tray: `DURATION.slow`, on the sheet curve. */
export const TO_TRAY_MS = TOKENS.slow
/**
 * Tray → row: at least `DURATION.slower`, on the ENTER curve (decelerate:
 * "things arriving or settling"), and longer for a long flight — see
 * COURIER_MAX_SPEED. The design asked for 420 ms on the sheet curve; on a
 * 390x844 phone this flight is ~600 px, and the sheet curve's fastest frame
 * then moves 96 px at 60 Hz (measured, tests/browser/scanReviewMotion.mts) —
 * twice the design's own 48 px smoothness bar, and the "goes away and appears
 * somewhere else" it exists to catch.
 */
export const TO_ROW_MS = TOKENS.slower
/** ...and at most `DURATION.slower + DURATION.slow`. */
export const TO_ROW_MAX_MS = TOKENS.slower + TOKENS.slow
/**
 * No courier moves faster than this, px per ms (about 43 px a 60 Hz frame, under
 * the design's 48): a flight's duration grows with its distance, up to its cap,
 * until its fastest moment is this fast.
 */
export const COURIER_MAX_SPEED = 2.6
/** The bow on the tray → row flight. */
export const ROW_ARC_PX = 12
/** The tray thumbnail's tick badge is gone by this share of the flight. */
export const BADGE_FADE_SHARE = 0.4
/** Landings launch at least this far apart. */
export const LAUNCH_GAP_MS = 150
/** A courier whose row is scrolled out of sight fades over this last share of its flight. */
export const OFFSCREEN_FADE_SHARE = 0.3
/** The bump the row thumbnail gives on landing. */
export const LAND_BUMP_PEAK = 1.04
/** Reduced motion: no travel, a cross-fade this long. */
export const REDUCED_FADE_MS = TOKENS.fast

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** A cubic-bezier easing as a function of t ∈ [0, 1] (CSS semantics). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s
  const dx = (s: number) => 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2)
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let s = t
    for (let i = 0; i < 8; i++) {
      const err = bx(s) - t
      const d = dx(s)
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break
      s -= err / d
    }
    // Newton can wander on flat stretches: finish by bisection.
    let lo = 0
    let hi = 1
    if (Math.abs(bx(s) - t) > 1e-4 || s < 0 || s > 1) {
      s = t
      for (let i = 0; i < 30; i++) {
        if (bx(s) < t) lo = s
        else hi = s
        s = (lo + hi) / 2
      }
    }
    return by(s)
  }
}

/** A CSS `cubic-bezier(...)` token as a function. */
export function easeOf(css: string): (t: number) => number {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css)
  if (!m) return (t) => t
  const [a, b, c, d] = m[1]!.split(',').map(Number)
  return bezier(a!, b!, c!, d!)
}
const EASE_SHEET = easeOf(TOKEN_EASE.sheet)
export const EASE_ENTER = easeOf(TOKEN_EASE.enter)

/** The steepest slope of an easing (progress per unit time, 1 = linear). */
const peaks = new WeakMap<(t: number) => number, number>()
export function peakSlope(ease: (t: number) => number): number {
  const hit = peaks.get(ease)
  if (hit !== undefined) return hit
  let peak = 1
  const dt = 0.002
  for (let t = 0; t < 1; t += dt) peak = Math.max(peak, (ease(Math.min(1, t + dt)) - ease(t)) / dt)
  peaks.set(ease, peak)
  return peak
}

/**
 * How long a flight of `distance` px takes: `min`, or longer until its fastest
 * moment is no faster than COURIER_MAX_SPEED, but never past `max`.
 */
export function flightMs(distance: number, ease: (t: number) => number, min: number, max: number): number {
  return Math.min(max, Math.max(min, (distance * peakSlope(ease)) / COURIER_MAX_SPEED))
}

export function rectIn(el: Element, origin: Element): Rect {
  const o = origin.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height }
}

/** Hide an element and keep it in layout (the "slot is held, the courier carries the image" half). */
export function hide(el: HTMLElement | null | undefined): void {
  if (!el) return
  el.style.visibility = 'hidden'
  el.dataset.incoming = ''
}
export function show(el: HTMLElement | null | undefined): void {
  if (!el) return
  el.style.visibility = ''
  delete el.dataset.incoming
}

export interface Flight {
  /** The courier element, already in the fly layer, at `from`'s size (position absolute, left/top 0). */
  el: HTMLElement
  /** Where it starts, relative to the fly layer's origin. */
  from: Rect
  /** Starting rotation, degrees (a capture's quad can be tilted). */
  fromRotDeg?: number
  /** Where it is going, re-measured every frame; null if the target is gone (the flight ends where it is). */
  target: () => Rect | null
  /** The flight's duration — the minimum, when `maxDuration` lets it grow with distance (flightMs). */
  duration: number
  maxDuration?: number
  ease?: (t: number) => number
  arcPx?: number
  /** Corner radius at the start and at the end, CSS px at those sizes. */
  radius?: [number, number]
  /** Fades over the first `fadeShare` of the flight (the tray thumbnail's tick badge). */
  fadeOut?: { el: HTMLElement | null; share: number }
  /** If the target is clipped out of view: clamp it to this edge (layer coordinates) and fade the courier out at the end. */
  clampTop?: () => number | null
  /** Called every frame with the courier's centre and size (the motion test reads the DOM instead; this is for callers). */
  onFrame?: (p: { cx: number; cy: number; w: number; h: number; t: number }) => void
}

/** Fly one courier home. Resolves once it has landed (the caller removes it). Never rejects. */
export function flyHome(f: Flight, raf: (cb: FrameRequestCallback) => number = requestAnimationFrame): Promise<{ rect: Rect | null; clamped: boolean }> {
  const ease = f.ease ?? EASE_SHEET
  const reduced = prefersReducedMotion()
  const el = f.el
  const w0 = f.from.width || 1
  const h0 = f.from.height || 1
  el.style.position = 'absolute'
  el.style.left = '0px'
  el.style.top = '0px'
  el.style.width = `${w0}px`
  el.style.height = `${h0}px`
  el.style.transformOrigin = '50% 50%'
  el.style.willChange = 'transform, opacity'
  el.style.margin = '0'
  const arc = reduced ? 0 : (f.arcPx ?? 0)
  const r0 = f.radius?.[0] ?? 6
  const r1 = f.radius?.[1] ?? r0
  const place = (cx: number, cy: number, w: number, rot: number) => {
    const s = w / w0
    el.style.transform = `translate(${cx - w0 / 2}px, ${cy - h0 / 2}px) rotate(${rot}deg) scale(${s})`
  }
  return new Promise((resolve) => {
    let start: number | null = null
    let last: Rect | null = null
    let clamped = false
    const cx0 = f.from.left + w0 / 2
    const cy0 = f.from.top + h0 / 2
    const rot0 = f.fromRotDeg ?? 0
    /** Where the courier is going this frame: its target now, clamped to the list's visible top. */
    const aimNow = (): Rect | null => {
      let target = f.target() ?? last
      if (target) last = target
      const clampTop = f.clampTop?.()
      // More than half of it above the list's visible top (under the sticky
      // header, or scrolled out): not somewhere the reader can see it land.
      if (target && clampTop != null && target.top + target.height / 2 < clampTop) {
        // The row is above the visible part of the list (the reader scrolled
        // down): fly to the list's top edge and fade there.
        clamped = true
        target = { ...target, top: clampTop - target.height / 2 }
      }
      return target
    }
    const aim = aimNow()
    const duration =
      f.maxDuration && aim
        ? flightMs(Math.hypot(aim.left + aim.width / 2 - cx0, aim.top + aim.height / 2 - cy0), ease, f.duration, f.maxDuration)
        : f.duration
    place(cx0, cy0, w0, rot0)
    if (reduced) {
      // No travel: the courier is not shown; the caller cross-fades the two
      // ends (REDUCED_FADE_MS). Resolve on the next frame.
      el.style.opacity = '0'
      raf(() => resolve({ rect: f.target(), clamped: false }))
      return
    }
    const frame = (now: number) => {
      if (start === null) start = now
      const t = Math.min(1, (now - start) / duration)
      const e = ease(t)
      const target = aimNow()
      const tx = target ? target.left + target.width / 2 : cx0
      const ty = target ? target.top + target.height / 2 : cy0
      const tw = target ? target.width : w0
      // Straight line, plus a bow perpendicular to it that is 0 at both ends.
      const dx = tx - cx0
      const dy = ty - cy0
      const len = Math.hypot(dx, dy) || 1
      const bow = arc * Math.sin(Math.PI * e)
      const cx = cx0 + dx * e + (-dy / len) * bow
      const cy = cy0 + dy * e + (dx / len) * bow
      const w = w0 + (tw - w0) * e
      place(cx, cy, w, rot0 * (1 - e))
      // The corner radius is set in the courier's own (unscaled) pixels.
      el.style.borderRadius = `${(r0 + (r1 - r0) * e) / (w / w0)}px`
      if (f.fadeOut?.el) f.fadeOut.el.style.opacity = String(Math.max(0, 1 - t / f.fadeOut.share))
      if (clamped) el.style.opacity = String(t < 1 - OFFSCREEN_FADE_SHARE ? 1 : Math.max(0, (1 - t) / OFFSCREEN_FADE_SHARE))
      f.onFrame?.({ cx, cy, w, h: (h0 * w) / w0, t })
      if (t < 1) raf(frame)
      else resolve({ rect: target, clamped })
    }
    raf(frame)
  })
}

/** Cross-fade two ends with no travel (reduced motion): `out` fades out, `into` fades in. */
export function crossFade(out: HTMLElement | null, into: HTMLElement | null, ms = REDUCED_FADE_MS): Promise<void> {
  const anims: Animation[] = []
  if (out?.animate) anims.push(out.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }))
  if (into?.animate) {
    show(into)
    anims.push(into.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, fill: 'backwards' }))
  }
  return Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
    for (const a of anims) a.cancel()
  })
}

/** The landing bump on the row thumbnail: 1 → 1.04 → 1 over DURATION.fast on the spring curve. */
export function landBump(el: HTMLElement | null): void {
  if (!el?.animate || prefersReducedMotion()) return
  const a = el.animate([{ transform: 'scale(1)' }, { transform: `scale(${LAND_BUMP_PEAK})`, offset: 0.5 }, { transform: 'scale(1)' }], {
    duration: TOKENS.fast,
    easing: TOKEN_EASE.spring,
  })
  a.finished.then(() => a.cancel()).catch(() => {})
}

/**
 * The launch queue: landings take off in the order they are asked for, at
 * least LAUNCH_GAP_MS apart. `wait()` resolves when this landing may launch.
 */
export function createLaunchQueue(gapMs = LAUNCH_GAP_MS, clock: () => number = () => performance.now()) {
  let next = -Infinity
  return {
    wait(): Promise<void> {
      const now = clock()
      const at = Math.max(now, next)
      next = at + gapMs
      const delay = at - now
      return delay > 0 ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve()
    },
  }
}

/** Clone a tray thumbnail into a courier: pixel-identical (ring, wash, tick), not interactive. */
export function cloneCourier(src: HTMLElement, id: string): HTMLElement {
  const el = src.cloneNode(true) as HTMLElement
  el.removeAttribute('data-stack-id')
  el.removeAttribute('data-stack-phase')
  el.removeAttribute('data-current-episode')
  el.dataset.courierId = id
  el.style.visibility = ''
  el.style.pointerEvents = 'none'
  el.style.boxShadow = '0 10px 20px rgba(0,0,0,0.45)'
  el.getAnimations?.().forEach((a) => a.cancel())
  return el
}

/** The bin follows its newest row only while the reader is within this of the top. */
export const FOLLOW_TOP_PX = 160
/** ...and not within this long of their own scroll. */
export const USER_SCROLL_QUIET_MS = 1_000

/**
 * Has the reader taken this list somewhere other than its top? Scrolled down,
 * a finger on it, or a scroll of their own in the last second (design §4.5:
 * "never call scrollTo while a touch is active or within 1 s of a user
 * scroll"). VerifyFeed keeps the marks (`data-touch`, `data-user-scroll-at`);
 * the list's own follow and the courier's clamp both read them here.
 */
export function listScrolledAway(scroller: HTMLElement, now = performance.now()): boolean {
  if (scroller.scrollTop >= FOLLOW_TOP_PX) return true
  if (scroller.dataset.touch) return true
  const at = Number(scroller.dataset.userScrollAt)
  return Number.isFinite(at) && now - at < USER_SCROLL_QUIET_MS && scroller.scrollTop > 0
}

/**
 * CAPTURE → TRAY. The slot was inserted hidden (the caller's flushSync, this
 * same task); a courier carrying the capture flies from the captured quad's
 * pose and homes on the slot, and on the frame it lands the slot is shown and
 * the courier removed.
 */
export async function deliverToTray(o: {
  id: string
  previewUrl: string
  layer: HTMLElement
  /** The quad's pose, in the layer's coordinates. */
  from: Rect
  fromRotDeg?: number
  slot: () => HTMLElement | null
}): Promise<void> {
  const courier = imageCourier(o.previewUrl, o.id)
  o.layer.appendChild(courier)
  try {
    await withDeadline(
      flyHome({
        el: courier,
        from: o.from,
        fromRotDeg: o.fromRotDeg,
        target: () => {
          const s = o.slot()
          return s ? rectIn(s, o.layer) : null
        },
        duration: TO_TRAY_MS,
        maxDuration: TOKENS.slower,
        radius: [4, 6],
      }),
      TOKENS.slower + 1_500,
    )
  } finally {
    show(o.slot())
    courier.remove()
  }
}

/**
 * TRAY → ROW. `insertRow` must COMMIT the row synchronously (flushSync) — the
 * row goes in with its picture hidden, and in the same frame a courier is
 * cloned from the tray thumbnail and the thumbnail hidden. The courier homes on
 * the row's picture every frame; on landing the picture is shown, the courier
 * removed, and the picture bumps. Returns how it went: `flown`, `faded`
 * (reduced motion: no travel, a cross-fade), or `none` (no tray thumbnail on
 * screen — the camera hidden — so the row simply fades in on its own). The
 * caller then takes the tray item away.
 */
export async function deliverToRow(o: {
  id: string
  layer: HTMLElement
  stackEl: HTMLElement | null
  insertRow: () => void
  thumb: () => HTMLElement | null
  /** The bin's scroller, for the clamp when the reader has scrolled it down. */
  scroller: HTMLElement | null
}): Promise<'flown' | 'faded' | 'none'> {
  const stackEl = o.stackEl
  const showing = !!stackEl && stackEl.getBoundingClientRect().width > 0
  o.insertRow()
  const thumbEl = o.thumb()
  if (!stackEl || !showing || !thumbEl) return 'none'
  hide(thumbEl)
  if (prefersReducedMotion()) {
    await withDeadline(crossFade(stackEl, thumbEl), 1_000)
    show(o.thumb())
    return 'faded'
  }
  const courier = cloneCourier(stackEl, o.id)
  o.layer.appendChild(courier)
  const from = rectIn(stackEl, o.layer)
  hide(stackEl)
  try {
    await withDeadline(
      flyHome({
        el: courier,
        from,
        target: () => {
          const t = o.thumb()
          return t ? rectIn(t, o.layer) : null
        },
        duration: TO_ROW_MS,
        maxDuration: TO_ROW_MAX_MS,
        ease: EASE_ENTER,
        arcPx: ROW_ARC_PX,
        radius: [6, 6],
        fadeOut: { el: courier.querySelector<HTMLElement>('[data-stack-overlay]'), share: BADGE_FADE_SHARE },
        // The reader scrolled the bin down: the new row is above what they can
        // see. Fly to the list's top edge and fade there ("1 new ↑" says the rest).
        clampTop: () => {
          const sc = o.scroller
          if (!sc || !listScrolledAway(sc)) return null
          const head = sc.firstElementChild as HTMLElement | null
          return rectIn(sc, o.layer).top + (head?.offsetHeight ?? 0)
        },
      }),
      TO_ROW_MAX_MS + 1_500,
    )
  } finally {
    const landed = o.thumb()
    show(landed)
    courier.remove()
    landBump(landed)
  }
  return 'flown'
}

/** Never let an animation block the pipeline: rAF stops in a hidden tab. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))])
}

/** A courier for the capture → tray leg: the capture itself, at the quad's pose. */
export function imageCourier(previewUrl: string, id: string): HTMLElement {
  const el = document.createElement('div')
  el.dataset.courierId = id
  el.style.overflow = 'hidden'
  el.style.pointerEvents = 'none'
  el.style.boxShadow = '0 10px 20px rgba(0,0,0,0.45)'
  const img = document.createElement('img')
  img.src = previewUrl
  img.alt = ''
  img.style.width = '100%'
  img.style.height = '100%'
  img.style.objectFit = 'cover'
  img.style.display = 'block'
  el.appendChild(img)
  return el
}
