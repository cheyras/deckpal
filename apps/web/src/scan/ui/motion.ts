// Motion system for the scanner UI — ported from the owner-approved reference,
// roadmap/plans/card-scanner-redesign/prototype.html (round 3)'s "R3 motion
// system" notes and its `arcFlight`/`flipPlay`/`staggerReveal` functions.
//
// When this was written theme.css shipped exactly one motion token
// (`--ease-standard: ease`). It now has a full set (`--duration-*`,
// `--ease-*`, mirrored for JS in lib/motion.ts): `spring` and `settle` below
// are `EASE.sheet` and `EASE.enter` there, and could import them. The prototype's
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
//
// ONE DOCUMENTED EXCEPTION (2026-11-27): the camera → list couriers
// (handoff.ts) are driven by requestAnimationFrame, not WAAPI. A courier homes
// on its target's rect AS IT IS EACH FRAME (the list scrolling, another row
// landing above it), and a keyframe fixed at launch cannot. It still moves by
// `transform` and `opacity` only.
import { prefersReducedMotion } from '../../lib/reducedMotion'
import { DURATION as TOKENS, EASE as TOKEN_EASE } from '../../lib/motion'

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

/**
 * THE CAPTURE FLASH (2026-11-27, design §3.1). The owner (S1): "make it way
 * more clear when there's a scan, like have the whole camera like flash to
 * white and then fade back… there's no question that it captured just now".
 * It was 80 ms peaking at 0.75 for about one frame. Now, from the #410 motion
 * tokens (lib/motion.ts), with no new token:
 *
 *   0 → 50 ms     up to 0.92, linear
 *   50 → 120 ms   held (DURATION.instant)
 *   120 → 540 ms  down to 0 on EASE.enter (DURATION.instant + DURATION.slower):
 *                 a fast fall, then a long tail
 *
 * Reduced motion keeps the feedback, gentler (theme.css: "reduced motion
 * removes TRAVEL, not feedback"): up to 0.5 with no hold, gone over
 * DURATION.fast. Captures are never closer than presentation.ts's
 * MIN_FIRE_GAP_MS (400 ms), so this is under 3 flashes a second.
 */
export const FLASH = {
  total: TOKENS.instant + TOKENS.slower,
  rise: 50,
  hold: TOKENS.instant,
  peak: 0.92,
  reducedPeak: 0.5,
  reducedTotal: TOKENS.fast,
} as const

/** The flash's keyframes and timing, for `el.animate` (opacity only). */
export function flashAnimation(reduced: boolean): { keyframes: Keyframe[]; options: KeyframeAnimationOptions } {
  if (reduced) {
    return {
      keyframes: [
        { opacity: FLASH.reducedPeak, easing: TOKEN_EASE.enter },
        { opacity: 0 },
      ],
      options: { duration: FLASH.reducedTotal },
    }
  }
  return {
    keyframes: [
      { opacity: 0, offset: 0, easing: 'linear' },
      { opacity: FLASH.peak, offset: FLASH.rise / FLASH.total, easing: 'linear' },
      { opacity: FLASH.peak, offset: FLASH.hold / FLASH.total, easing: TOKEN_EASE.enter },
      { opacity: 0, offset: 1 },
    ],
    options: { duration: FLASH.total },
  }
}

/** Milliseconds at 1x — prototype.html's `T` budget, unchanged. */
export const DURATION = {
  // `flyStack`, `settle`, `flyFeed`, `entryReveal` and `dupFly` timed the
  // keyframed couriers and the row's scaleY reveal until 2026-11-27; the
  // hand-off (handoff.ts) and the capture flash take the #410 tokens in
  // lib/motion.ts instead.
  stackReflow: 200,
  stagger: 60,
  // `dupBump` was here until 2026-09-07. It timed the bump a row played when a
  // re-presentation of the same card merged INTO it; there is no merge any more
  // (every scan is its own row — `feed.ts`), and a token nothing can spend reads
  // to the next person as a beat that is available to them.
  /** NEW, and not from the prototype: how long the confident tick holds on a
   *  stack thumbnail before the courier launches it at the list. The prototype
   *  had no such beat because a capture flew unconditionally; the 2026-09-05
   *  ruling puts a decision in front of the flight, and a decision the reader
   *  cannot see happen looks like a glitch. Long enough to read as "yes", short
   *  enough that it never becomes a queue — the flight itself is 320 ms. */
  confirmTick: 240,
} as const

// The keyframed flights that lived here (`arcKeyframes`, `flyArc`, `bump`,
// `rectRelativeTo`) were the capture → tray → row couriers until 2026-11-27.
// They flew to a rect measured once at launch, and the row they aimed at was
// still moving; the couriers are handoff.ts's now, homing every frame.

/** Staggered reveal of a feed entry's inner content — opacity + translateY,
 *  ~60ms step, the first part `startDelay` in. Ported from prototype.html's
 *  `staggerReveal`. */
export function staggerReveal(container: HTMLElement, selector: string, startDelay = 0) {
  if (prefersReducedMotion()) return
  const parts = container.querySelectorAll<HTMLElement>(selector)
  parts.forEach((p, i) => {
    const anim = p.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], {
      duration: 240,
      delay: startDelay + DURATION.stagger * i,
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
// `springBack` relaxes the card back to centre when a drag doesn't cross the
// decision threshold; a confirmed card leaves through SwipeReview's own
// `LeavingCard` (see below).

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

// The fling that used to live here (`flingOut`) cancelled its own animation on
// finish, which dropped its fill and snapped the card back to where the drag
// had left it for a frame before React swapped the next entry in: the owner's
// "same card comes back from the right edge" (2026-11-26). SwipeReview's
// `LeavingCard` flies a confirmed card off on a layer of its own and removes it
// without ever cancelling the animation.

/**
 * The entry's own open reveal: OPACITY ONLY (2026-11-27). It was a scaleY from
 * the top, and a courier flying at a row that was still scaling landed where the
 * row had been (design §1.3, S5). The row takes its full height at once; the
 * rows below slide (VerifyFeed's FLIP) and this fades it in.
 */
export function revealEntry(el: HTMLElement): void {
  const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: TOKENS.base,
    easing: TOKEN_EASE.enter,
    fill: 'backwards',
  })
  anim.finished.then(() => anim.cancel()).catch(() => {})
}
