/**
 * Hand a viewport overlay to the compositor, so that following the page costs
 * no frames at all.
 *
 * THE DEFECT, and it is not in this runtime's code. The character is drawn into
 * a `position: fixed` canvas and re-solved against `getBoundingClientRect()`
 * once per `requestAnimationFrame`, so how smoothly he follows the page is
 * capped by how often the browser calls us. On the owner's iPhone, measured on
 * the device with `DeckeDiag`:
 *
 *     FRAME  37/s   p95 gap 36.0ms   worst 358ms
 *     OURS   tick p95 5.0ms   worst 7.0ms   render @2x
 *
 * Our whole frame — update, render and the beacon's second pass — is 5 ms, and
 * the browser calls us every 36. We idle for 31 ms of every frame while WebKit
 * scrolls the page on its own thread at up to 120 Hz. That is the whole of the
 * complaint: "the scroll is pretty smooth, but his scroll is really chunky.
 * There's a lot of jutter, and then sometimes on a fast scroll he'll lose it
 * entirely." Cutting fill rate to 44% of the pixels changed the frame interval
 * by nothing (see `MAX_PIXEL_RATIO`), because there was never any time to save.
 * No cheaper loop closes a gap that exists ABOVE the loop.
 *
 * THE OBSERVATION THAT FIXES IT. While he is parked beside an element and on
 * screen, his position in DOCUMENT space is constant. The element is not moving;
 * the viewport is moving over it. So there is nothing to compute per frame —
 * only something to stop computing.
 *
 * Take the overlay out of the viewport and put it in the page: `position:
 * absolute` at the document offset the viewport currently sits at. It is then
 * part of the scrolling contents, and every engine's compositor translates the
 * scrolling contents itself, at the display's rate, with no main thread
 * involvement whatsoever. He does not track the page any more. He IS the page,
 * which is what "he should just stay scrolling directly with the page" asked
 * for in the first place.
 *
 * WHY NOT `animation-timeline: scroll()`. It expresses the same idea and is also
 * compositor-driven, and it was the first design. It is WebKit-only from Safari
 * 26.0 and only threaded from 26.4, and the bar here was set as "buttery smooth
 * no matter what device is used" — so a path that needs a 2025 browser is a path
 * that needs a fallback, and the fallback would be the thing that had to be
 * right. Document flow needs no feature detection, no version gate and no second
 * code path: it is how every browser has laid out absolutely positioned content
 * since long before any of them had a compositor.
 *
 * IT ALSO GETS THE RUBBER BAND FOR FREE, on both engines. The elastic bounce is
 * a transform on the SCROLLING CONTENTS layer, so anything in document flow
 * bounces with it — including on Chrome, where the offset is deliberately
 * unreadable from script (`FixedElementsDontOverscroll`) and `followElastic` can
 * therefore never see it. Pinned, there is nothing to see and nothing to apply.
 * See `viewport.ts` for what that costs when the overlay is fixed instead.
 *
 * THE ONE THING THIS MODULE REFUSES TO ASSUME is where the containing block is.
 * `absolute` resolves against the nearest positioned ancestor, and whether there
 * is one is a fact about whatever page mounted the overlay rather than something
 * a character runtime gets to decide. So it is measured, twice a park, instead
 * of being asserted in a comment and silently violated later.
 *
 * THE ONE THING IT DOES ASSUME, stated here so the next mount does not discover
 * it: that the containing block SCROLLS WITH THE DOCUMENT. Measuring where it is
 * says nothing about whether it moves. Mount either overlay inside a
 * `position: fixed` ancestor — or inside a transformed descendant of one — and
 * the pinned box stays glued to the viewport while the character runtime shears
 * its frustum every frame to compensate for a scroll that never reaches it: he
 * would sit frozen on screen while his element scrolls away. The dev page mounts
 * the canvas under plain static divs and the ring layer on `body`, and anything
 * else has to keep that property.
 */

/** Everything this module writes, so unpinning is an exact round trip rather
 *  than a guess at what the element used to look like. */
const PROPS = ['position', 'top', 'left', 'right', 'bottom', 'width', 'height'] as const

const SAVED = new WeakMap<HTMLElement, Record<string, string>>()

export function isPinned(el: HTMLElement): boolean {
  return SAVED.has(el)
}

/**
 * Pin `el` to document offset `docY`, reproducing the viewport box it occupies
 * right now.
 *
 * The caller is expected to pass the CURRENT scroll offset, because that is the
 * only value that makes the switch invisible: at `docY === scrollY` the pinned
 * box lands exactly where the fixed box already was, so the frame that changes
 * the positioning scheme draws an identical picture.
 */
export function pinToPage(el: HTMLElement, docY: number): void {
  if (SAVED.has(el)) return
  const was: Record<string, string> = {}
  for (const p of PROPS) was[p] = el.style.getPropertyValue(p)
  SAVED.set(el, was)

  // Read the box BEFORE touching anything: while fixed this is its viewport
  // rectangle, and it is what the pinned box has to reproduce.
  const box = el.getBoundingClientRect()

  el.style.position = 'absolute'
  // `inset: 0` is how both of these overlays are written, and an absolute box
  // with all four offsets set plus an explicit width is over-constrained — the
  // resolution is defined but it is not obvious, and it is not worth relying on.
  el.style.right = 'auto'
  el.style.bottom = 'auto'
  el.style.top = '0px'
  el.style.left = '0px'
  // With the offsets zeroed the box's own position IS the containing block's
  // origin, so one extra read answers "positioned ancestor or not" for whatever
  // page this is, without the page having to promise anything.
  const origin = el.getBoundingClientRect()
  el.style.top = `${docY - (origin.top + window.scrollY)}px`
  el.style.left = `${box.left - origin.left}px`
  // Explicit, rather than left to `w-full`, for the same reason: a percentage
  // resolves against the containing block, and a fixed box resolves against the
  // viewport. Those agree here and are not guaranteed to agree elsewhere.
  // Rounded, so the canvas's ResizeObserver sees the size it already had and the
  // no-op guard in `DeckE.resize` recognises it as no change.
  // FLOOR THE WIDTH, round the height. A fractional viewport — browser zoom, or
  // a fractional device scale — rounds 1279.5 up to 1280, and half a pixel of
  // overflow past the root's edge is the classic "the page can suddenly be
  // scrolled sideways" artefact, for the whole life of the pin. Half a pixel of
  // missing height costs nothing against a margin measured in tens.
  el.style.width = `${Math.floor(box.width)}px`
  el.style.height = `${Math.round(box.height)}px`
}

/** Put `el` back on the viewport. Whatever is drawn inside it was solved for
 *  where the page was when it was pinned, so the caller has to re-solve in the
 *  same frame — see `DeckE.unpin`. */
export function unpinToViewport(el: HTMLElement): void {
  const was = SAVED.get(el)
  if (!was) return
  SAVED.delete(el)
  for (const p of PROPS) {
    if (was[p]) el.style.setProperty(p, was[p])
    else el.style.removeProperty(p)
  }
}


// --- where the canvas goes ---------------------------------------------------

/**
 * How much surface has to sit between the character and the canvas edge, given
 * his on-screen half-height.
 *
 * The fraction is not a guess. `halfPx` is his BODY — half of `BODY_H`,
 * projected — and what actually reaches the canvas is a good deal more. Measured
 * at the shipped framing by reading rendered pixels back and finding his real
 * top and bottom rows, against what the body half-height claims, at 112 px:
 *
 *     idle           21 px above,   25 px below
 *     happy          65 px above,   26 px below
 *     card_present   25 px above,   66 px below
 *     alert_star    136 px above,   46 px below
 *     card_stash    148 px above,   41 px below
 *
 * The stash cards and the alert reel ride a long way outboard of the body, so a
 * margin of 0.6 half-heights — 67 px, which looked generous — was under half of
 * what the worst state needs, and it cut his feet off. 1.6 covers the measured
 * worst with headroom. A fraction rather than a pixel count because he is sized
 * from the viewport, so no constant is right on both a phone and a desktop.
 */
export const PIN_MARGIN_PX = 32
export const PIN_MARGIN_FRAC = 1.6

export function pinMargin(halfPx: number): number {
  return Math.max(PIN_MARGIN_PX, halfPx * PIN_MARGIN_FRAC)
}

/**
 * Where the canvas's top edge goes, in viewport pixels, or null if there is
 * nowhere it can go.
 *
 * Zero — the canvas over the viewport, covering the whole screen — whenever zero
 * is one of the answers, and only as far off the edge as it has to be otherwise.
 * Sliding it off is what lets him be pinned while he is still half on screen,
 * which is the difference between a smooth entrance and a juddering one.
 *
 * `roomBelow` is the constraint that is easy to miss and ugly when missed. The
 * pinned canvas is an absolutely positioned box, so any part of it hanging below
 * the document's own end EXTENDS THE SCROLLABLE RANGE — measured on Chromium,
 * parking beside a footer grew the page by 219 px of blank space, which the
 * reader can scroll into and which snaps shut again the moment he unpins. So the
 * canvas is not allowed past the end of the document, and when that cannot be
 * reconciled with containing him this returns null and he keeps the hand-tracked
 * path. That costs nothing where it bites: it bites at the bottom of the page,
 * where there is no scrolling left to be chunky during.
 */
export function pinWindow(opts: {
  /** His centre, in viewport pixels. */
  screenY: number
  /** Half his body height, in pixels. */
  halfPx: number
  /** The height of the drawing surface. */
  canvasH: number
  /** How far the canvas top may sit below the viewport top before the canvas
   *  would hang past the end of the document. May be negative. */
  roomBelow: number
}): number | null {
  const m = pinMargin(opts.halfPx)
  const lowest = opts.screenY + opts.halfPx + m - opts.canvasH
  const highest = Math.min(opts.screenY - opts.halfPx - m, opts.roomBelow)
  // Covers both ways this fails: a character too tall for the surface, and a
  // surface that cannot be placed without growing the page.
  if (lowest > highest) return null
  return Math.max(lowest, Math.min(0, highest))
}
