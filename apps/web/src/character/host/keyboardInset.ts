/**
 * THE SOFTWARE KEYBOARD, MEASURED — so the panel does not have to be scrolled
 * into view and then scrolled back.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE COMPLAINT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"I'm still seeing that downward drift happening after the keyboard is
 * dismissed. The chat bar goes down most of the way with the keyboard, but then
 * it slowly animates downward until it hits its final resting place."*
 *
 * Reported a second time, after a pass that made DECK-E settle in one hop
 * instead of six. That pass was right about him and could not have fixed this:
 * he was faithfully tracking a composer that is itself sliding. The thing that
 * drifts is the panel.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THE PANEL DRIFTS, WHICH IS NOT AN ANIMATION ANYONE WROTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The chat panel is `position: fixed; bottom: 0`, so its floor is the LAYOUT
 * viewport's floor. On iOS the layout viewport does not shrink when the
 * keyboard opens — only the visual viewport does — so a bottom-anchored
 * composer would sit behind the keyboard. WebKit's answer is to SCROLL THE
 * DOCUMENT to reveal the focused input, and it does this even to a document
 * held with `overflow: hidden` (there is a WebKit regression test asserting
 * exactly that). Fixed layers ride that scroll; `viewport.ts` records the
 * measurement on a real iPhone:
 *
 *   keyboard down   canvas client rect     0 .. 760
 *   keyboard up     canvas client rect  -268 .. 492
 *
 * So the panel is lifted 268 px by a scroll nobody in this codebase asked for,
 * and the composer lands above the keyboard. That half WORKS, and the previous
 * pass wrote it down as the fix for that path.
 *
 * The other half is what the reader is watching. When the keyboard goes away,
 * iOS unwinds that scroll — and it ANIMATES the unwind, on its own clock, after
 * the keyboard itself has finished. The bar "goes down most of the way with the
 * keyboard" (the keyboard's own animation) "then slowly animates downward until
 * it hits its final resting place" (WebKit returning the document to 0). Every
 * fixed layer on the page rides all of it. There is no CSS transition to
 * remove and no timing to shorten, because none of it is ours.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE FIX IS TO STOP DEPENDING ON THAT SCROLL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * If the panel's own floor tracks the VISUAL viewport, the composer is already
 * above the keyboard and there is nothing for WebKit to reveal — so there is no
 * reveal-scroll, and therefore no unwind to animate. The drift is not damped or
 * shortened; the mechanism that produced it is gone.
 *
 * Two halves, and they ship together or not at all:
 *
 *   1. `keyboardInset` — how far the panel's floor must rise, from the visual
 *      viewport. Applied as the panel's `bottom`.
 *   2. Pinning `window.scrollY` at 0 — WebKit may still take a run at scrolling
 *      (a focus that lands before the inset applies, a hardware keyboard
 *      appearing), and one frame of that is one frame of drift.
 *
 * **HALF 2 IS ONLY SAFE BECAUSE OF HALF 1**, and that is the load-bearing
 * sentence in this file. Pinning the scroll on its own would take away the only
 * thing lifting the composer clear of the keyboard and leave the reader typing
 * into a box they cannot see. `shouldPinScroll` therefore refuses unless the
 * inset is actually being applied, so the two cannot be separated by a later
 * edit that only reads one of them.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A `.ts` SIBLING
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Same reason as `markWatch.ts`, `composerRuler.ts` and `parkFloor.ts`: a
 * `.tsx` throws under `node --import tsx` on `import.meta.env`, so a decision
 * that lives inside the component cannot be tested. This one is arithmetic
 * against a platform quirk that cannot be reproduced in a headless browser, so
 * being able to assert it against the numbers measured on real hardware is the
 * only proof available.
 */

/** What the visual viewport tells us. `null` where the API does not exist. */
export type ViewportSample = {
  /** The LAYOUT viewport's height — `window.innerHeight`. */
  innerHeight: number
  /** `visualViewport.height`, or `null` if there is no `visualViewport`. */
  visualHeight: number | null
  /** `visualViewport.offsetTop` — how far the visual viewport is scrolled down. */
  visualOffsetTop: number
}

/**
 * Below this many pixels, nothing is treated as a keyboard.
 *
 * The visual viewport moves for things that are not keyboards — Safari's own
 * toolbars sliding, a rubber-band at the top of a scroll, sub-pixel rounding on
 * a fractional-DPR device. Lifting the panel by 4 px because a toolbar twitched
 * would be a new small drift of exactly the kind this file exists to remove.
 *
 * 80 px is comfortably under any software keyboard (the shortest iPhone
 * keyboard is ~216 px) and comfortably over every toolbar and rounding artefact
 * on the platforms this ships to.
 */
export const KEYBOARD_MIN_PX = 80

/**
 * How far the panel's floor has to rise to clear the keyboard, in CSS pixels.
 *
 * The keyboard occupies whatever the layout viewport has and the visual
 * viewport does not, BELOW the visual viewport — which is why `offsetTop` is in
 * the subtraction rather than ignored. With the page scrolled down to reveal an
 * input, the visual viewport's top has moved and the gap at the bottom is
 * smaller than the height difference alone suggests.
 *
 * ZERO IS THE ANSWER FOR EVERY UNCERTAIN CASE, and that is deliberate. No
 * `visualViewport`, a nonsensical reading, a viewport taller than the layout
 * (which happens transiently on some Android browsers), anything under
 * `KEYBOARD_MIN_PX`: all of them return 0, which is exactly today's behaviour —
 * a panel anchored to the bottom of the layout viewport. This can decline to
 * act; it must never act on a number it does not believe.
 */
export function keyboardInset(s: ViewportSample | null): number {
  if (!s) return 0
  const { innerHeight, visualHeight, visualOffsetTop } = s
  if (visualHeight === null) return 0
  if (!Number.isFinite(innerHeight) || !Number.isFinite(visualHeight)) return 0
  if (!Number.isFinite(visualOffsetTop)) return 0
  if (innerHeight <= 0 || visualHeight <= 0) return 0
  const gap = Math.round(innerHeight - (visualHeight + visualOffsetTop))
  if (!(gap >= KEYBOARD_MIN_PX)) return 0
  // A keyboard cannot be taller than the screen it is on. A reading that says
  // otherwise is a reading to ignore, not one to clamp and use — clamping it
  // would put the panel's floor at the top of the screen with full confidence.
  if (gap >= innerHeight) return 0
  return gap
}

/**
 * May the document's scroll be pinned at 0 right now?
 *
 * ONLY WHILE THE INSET IS DOING ITS JOB. Pinning the scroll is what stops the
 * panel riding WebKit's reveal-scroll and its slow unwind — but that same
 * scroll is the ONLY thing lifting the composer clear of the keyboard when the
 * inset is not applied. Pinning without it puts the reader's cursor behind the
 * keyboard, which is a worse defect than the one being fixed and a silent one.
 *
 * So: pin when there is no keyboard (nothing to reveal, nothing to lose), and
 * pin when there is a keyboard AND we have lifted the panel over it ourselves.
 * Never pin when a keyboard is up and the inset is 0, which is precisely the
 * "we could not measure it" case.
 */
export function shouldPinScroll(sample: ViewportSample | null, appliedInset: number): boolean {
  if (!sample || sample.visualHeight === null) return false
  const wanted = keyboardInset(sample)
  if (wanted === 0) {
    // No keyboard detected. Safe to hold the page still — and worth doing,
    // because the unwind from the LAST keyboard is exactly what runs here.
    return true
  }
  return appliedInset >= wanted
}

/** Read the live viewport, or `null` where the API is not there. */
export function readViewport(win: Window = window): ViewportSample | null {
  const vv = win.visualViewport
  if (!vv) return null
  return {
    innerHeight: win.innerHeight,
    visualHeight: vv.height,
    visualOffsetTop: vv.offsetTop,
  }
}
