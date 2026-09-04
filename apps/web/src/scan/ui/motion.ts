// Motion system for the scanner UI — ported from the owner-approved reference,
// roadmap/plans/card-scanner-redesign/prototype.html (round 3)'s "R3 motion
// system" notes and its `arcFlight`/`flipPlay`/`staggerReveal` functions.
//
// theme.css ships exactly one motion token today (`--ease-standard: ease` —
// see its own comment: "UI-SPEC §1.9 — only these exist"). The prototype's
// swift-out/snap easings are NEW tokens it introduces for this feature and
// are not yet promoted into the shared design system; adding them to
// theme.css is a call for whoever owns that file; Scan.tsx's ownership here
// is scoped to routes/Scan.tsx and scan/ui/**, so they live here as the
// scanner's own constants instead. `spring` and `settle` below are NOT new —
// they are the literal cubic-beziers theme.css already uses inline for
// `sheet-panel-up` / `sheet-panel-in` (theme.css:697,702), copied verbatim so
// the scanner's reveals match the rest of the app's sheets.
//
// HARD RULE (prototype's own, kept): motion that moves or resizes something
// on screen animates `transform`/`opacity` only, via the Web Animations API,
// driven by refs — never a CSS `transition` on layout properties, never an
// animation library. A CSS `transition` is used only for discrete STATE
// recolors (a quad's stroke going cyan → green on lock), which is what the
// prototype itself does too (`.quad-inner { transition: border-color }`).
import { prefersReducedMotion } from '../../lib/reducedMotion'

// Re-exported rather than each caller importing two modules: every file in
// this directory already reaches for `./motion` for its easings/durations,
// and `lib/reducedMotion.ts` is the app-layer's one canonical probe (Sheet,
// Landing, GridView) — this used to be a second, private copy of the exact
// same check, which is the kind of duplication that quietly drifts.
export { prefersReducedMotion }

export const EASE = {
  /** Transit: capture → stack, stack → feed. */
  swift: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** Quad snap-on, duplicate-merge bump — slight overshoot. */
  snap: 'cubic-bezier(0.16, 1.25, 0.3, 1)',
  /** Sheet/spring arrivals (theme.css `sheet-panel-up`). */
  spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** Feed-entry reveal (theme.css `sheet-panel-in`). */
  settle: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
} as const

/** Milliseconds at 1x — prototype.html's `T` budget, unchanged. */
export const DURATION = {
  flash: 80,
  flyStack: 300,
  settle: 90,
  stackReflow: 200,
  flyFeed: 320,
  entryReveal: 300,
  stagger: 60,
  dupFly: 300,
  dupBump: 200,
} as const

/** `el`'s rect expressed relative to `origin` (both from getBoundingClientRect). */
export function rectRelativeTo(el: Element, origin: Element) {
  const o = origin.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return {
    left: r.left - o.left,
    top: r.top - o.top,
    width: r.width,
    height: r.height,
    cx: r.left - o.left + r.width / 2,
    cy: r.top - o.top + r.height / 2,
  }
}

export interface FlightPose {
  cx: number
  cy: number
  rotDeg?: number
  scale?: number
}

/** 3-waypoint transform keyframes: start pose → perpendicular-arc midpoint →
 *  end pose. Ported from prototype.html's `arcFlight` — the bow keeps a fast
 *  transit from reading as a straight-line teleport. `w`/`h` are the flying
 *  element's own box size (the translate keyframes position its CENTER). */
export function arcKeyframes(from: FlightPose, to: FlightPose, w: number, h: number, arcPx: number): Keyframe[] {
  const startRot = from.rotDeg ?? 0
  const endRot = to.rotDeg ?? 0
  const startScale = from.scale ?? 1
  const endScale = to.scale ?? 1
  const mx = (from.cx + to.cx) / 2
  const my = (from.cy + to.cy) / 2
  const ddx = to.cx - from.cx
  const ddy = to.cy - from.cy
  const len = Math.hypot(ddx, ddy) || 1
  const px = mx + (-ddy / len) * arcPx
  const py = my + (ddx / len) * arcPx
  const tl = (cx: number, cy: number) => `translate(${cx - w / 2}px, ${cy - h / 2}px)`
  return [
    { transform: `${tl(from.cx, from.cy)} rotate(${startRot}deg) scale(${startScale})` },
    {
      transform: `${tl(px, py)} rotate(${startRot * 0.5}deg) scale(${(startScale + endScale) / 2})`,
      offset: 0.5,
    },
    { transform: `${tl(to.cx, to.cy)} rotate(${endRot}deg) scale(${endScale})` },
  ]
}

/**
 * Fly `el` (already appended to a shared, absolutely-positioned overlay
 * layer, `position: absolute; left: 0; top: 0`) from `from` to `to` along an
 * arc. Resolves once the flight finishes; the caller removes `el`. Collapses
 * to a short, straight, reduced-motion-safe fade under
 * `prefers-reduced-motion`.
 */
export function flyArc(
  el: HTMLElement,
  from: FlightPose,
  to: FlightPose,
  w: number,
  h: number,
  opts: { duration: number; arcPx?: number; easing?: string },
): Promise<void> {
  const reduced = prefersReducedMotion()
  const duration = reduced ? Math.min(150, opts.duration) : opts.duration
  const arcPx = reduced ? 0 : (opts.arcPx ?? 20)
  const kf = arcKeyframes(from, to, w, h, arcPx)
  const anim = el.animate(kf, { duration, easing: opts.easing ?? EASE.swift, fill: 'forwards' })
  return anim.finished
    .then(() => {
      anim.cancel()
    })
    .catch(() => {
      /* animation was cancelled (e.g. unmount mid-flight) — the caller's cleanup still runs */
    })
}

/** A short scale bump — 1 → peak → 1. Used for the micro-settle after a
 *  courier lands, and the duplicate-merge bounce. */
export function bump(el: HTMLElement, peak: number, duration: number): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve()
  const anim = el.animate([{ transform: 'scale(1)' }, { transform: `scale(${peak})`, offset: 0.5 }, { transform: 'scale(1)' }], {
    duration,
    easing: EASE.swift,
    fill: 'both',
  })
  return anim.finished.then(() => anim.cancel()).catch(() => {})
}

/**
 * FLIP a set of nodes that just moved because a sibling was inserted or
 * removed. `first` is each node's rect BEFORE the DOM mutation (captured at
 * the end of the previous run); nodes are measured again now (AFTER).
 * Transform-only, no transitions on layout properties.
 */
export function flipReflow(entries: { el: HTMLElement; first: DOMRect }[], duration: number, easing: string) {
  if (prefersReducedMotion()) return
  for (const { el, first } of entries) {
    const last = el.getBoundingClientRect()
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (!dx && !dy) continue
    const anim = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration,
      easing,
      fill: 'both',
    })
    anim.finished.then(() => anim.cancel()).catch(() => {})
  }
}

/** Staggered reveal of a feed entry's inner content — opacity + translateY,
 *  ~60ms step. Ported from prototype.html's `staggerReveal`. */
export function staggerReveal(container: HTMLElement, selector: string) {
  if (prefersReducedMotion()) return
  const parts = container.querySelectorAll<HTMLElement>(selector)
  parts.forEach((p, i) => {
    const anim = p.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], {
      duration: 240,
      delay: DURATION.stagger * i,
      easing: EASE.swift,
      fill: 'backwards',
    })
    anim.finished.then(() => anim.cancel()).catch(() => {})
  })
}

// ── Swipe-review gesture motion ─────────────────────────────────────────────
// The drag itself is NEVER React state — `SwipeReview.tsx` writes `transform`
// straight to the card's style during `pointermove` (a re-render per pixel of
// drag is exactly the jank the "refs, not a library" rule exists to avoid).
// These two calls are the only WAAPI this needs: relax back to centre when a
// drag doesn't cross the decision threshold, or finish the gesture by flying
// the card off screen (also reachable from the confirm/reject BUTTONS, which
// call `flingOut` directly with no drag at all — same finish, same feel).

/** Card didn't cross the swipe threshold — ease back to (0,0), a slight
 *  overshoot (`--snap`) so it reads as physical, not merely undone. */
export function springBack(el: HTMLElement, duration = 320): Promise<void> {
  const from = el.style.transform || 'none' // the drag's current position — captured BEFORE it is cleared
  if (prefersReducedMotion()) {
    el.style.transform = ''
    return Promise.resolve()
  }
  const anim = el.animate([{ transform: from }, { transform: 'none' }], {
    duration,
    easing: EASE.snap,
    fill: 'backwards',
  })
  return anim.finished
    .then(() => {
      anim.cancel()
      el.style.transform = '' // the animation's own fill already reverted the visual; this just stops fighting future drags
    })
    .catch(() => {
      el.style.transform = ''
    })
}

/** Send the card off in `dir` (-1 left/reject, 1 right/confirm) and resolve
 *  once it's clear of the viewport. Reduced motion: a quick fade in place —
 *  the DECISION still needs a moment to register before the next card swaps
 *  in, just not a physical throw. */
export function flingOut(el: HTMLElement, dir: -1 | 1, viewportW: number): Promise<void> {
  if (prefersReducedMotion()) {
    const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
    return anim.finished.then(() => anim.cancel()).catch(() => {})
  }
  const dx = dir * (viewportW * 0.9 + 200)
  const rot = dir * 24
  const anim = el.animate(
    [{ transform: el.style.transform || 'none', opacity: 1 }, { transform: `translate(${dx}px, -10px) rotate(${rot}deg)`, opacity: 0 }],
    { duration: 260, easing: EASE.swift, fill: 'forwards' },
  )
  return anim.finished.then(() => anim.cancel()).catch(() => {})
}

/** The entry's own open reveal: `scaleY` from the top, plus opacity. */
export function revealEntry(el: HTMLElement): Promise<void> {
  const reduced = prefersReducedMotion()
  el.style.transformOrigin = 'top center'
  const from = reduced ? { opacity: 0, transform: 'translateY(-6px)' } : { opacity: 0, transform: 'scaleY(0.82) translateY(-10px)' }
  const anim = el.animate([from, { opacity: 1, transform: 'none' }], {
    duration: reduced ? 150 : DURATION.entryReveal,
    easing: EASE.swift,
    fill: 'backwards',
  })
  return anim.finished
    .then(() => {
      anim.cancel()
      el.style.transformOrigin = ''
    })
    .catch(() => {})
}
