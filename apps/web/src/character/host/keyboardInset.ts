/**
 * The panel's floor, anchored to the VISUAL viewport.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE FORMULA. THIS FILE IS MOSTLY THE STORY OF GETTING IT WRONG.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   bottom = innerHeight - visualViewport.height - visualViewport.offsetTop
 *
 * That is the whole technique, it is what everyone else does, and it updates on
 * `visualViewport`'s `resize` AND `scroll`. Nothing here touches `window.scrollY`.
 *
 * Two cleaner answers exist and neither is available:
 *
 *   interactive-widget=resizes-content   the declarative fix. Safari has still
 *                                        not shipped it (WebKit #259770).
 *   navigator.virtualKeyboard +          the modern fix. Chromium only.
 *   env(keyboard-inset-height)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY `bottom: 0` IS ALREADY RIGHT WHILE YOU ARE TYPING
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Worth stating, because it is why this file does almost nothing most of the
 * time and why an earlier version doing a great deal made things worse.
 *
 * A `fixed` element is positioned against the LAYOUT viewport; Safari's
 * `getBoundingClientRect` reports against the VISUAL one. iOS reveals a focused
 * input by shifting the visual viewport DOWN inside the layout viewport, so
 * `offsetTop` grows and `height` shrinks by the same amount — and their sum
 * stays equal to `innerHeight`. Put that through the formula and it is 0: a
 * composer at `bottom: 0` is already sitting exactly on the keyboard. That path
 * never needed help and must not be given any.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE ANSWER IS NEGATIVE, AND THAT IS THE ENTIRE POINT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `visualViewport.offsetTop` DOES NOT RESET PROMPTLY WHEN THE KEYBOARD IS
 * DISMISSED. It is a documented iOS defect (Apple Developer Forums 800125;
 * MicrosoftDocs/edge-developer#3828 asks Edge for parity with Safari's fix).
 * The keyboard goes, the visible area is full height again, and `offsetTop` is
 * still carrying a stale offset — so every `fixed` layer is drawn that many
 * pixels TOO HIGH and then eases down as the number unwinds on iOS's own clock.
 *
 * That is the reported defect, in the owner's words: *"the chat bar goes down
 * most of the way with the keyboard, but then it slowly animates downward until
 * it hits its final resting place."*
 *
 * In that window `height` is already back to full while `offsetTop` is not, so
 * the formula returns a NEGATIVE number — "push the panel back down to where
 * the bottom of the screen actually is". Applying it lands the panel in one
 * step instead of letting it ride the unwind.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THE PREVIOUS ATTEMPT DID, SINCE IT SHIPPED AND WAS WORSE (#129, REVERTED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * It had this formula and then broke it three ways, and every one of them is a
 * line NOT to add back:
 *
 *   1. **It threw away the negative case.** A `KEYBOARD_MIN_PX` floor of 80
 *      suppressed everything under +80px — which is every value the unwind ever
 *      produces. The one correction that fixes the reported bug was the one
 *      case it refused to make.
 *   2. **It pinned `window.scrollY` at 0.** Nothing in the established solution
 *      goes near the scroll position. WebKit re-asserts, the effect resets,
 *      neither wins, and that tug-of-war was a NEW drift *while the keyboard was
 *      up* — a phase that had never had a problem.
 *   3. **It moved the panel without the canvas.** He is drawn on a separate
 *      `fixed inset-0 h-[100lvh]` layer, so lifting the panel alone put him
 *      behind the keyboard.
 *
 * (3) is why this file corrects the panel and nothing else. His park box is a
 * DOM element INSIDE the panel and `DeckE` re-measures its canvas origin on
 * `visualViewport` resize and scroll already — so a correct panel is a correct
 * character, with no second mechanism to keep in step. Said plainly by the
 * owner, and it is the right instinct: *"having deck e just stay fixed to that
 * spot on the page, it kind of would fall out from that."*
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A `.ts` SIBLING
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Same reason as `markWatch.ts`, `composerRuler.ts` and `parkFloor.ts`: a `.tsx`
 * throws under `node --import tsx` on `import.meta.env`. And a caveat this file
 * has earned the right to state loudly — NO HEADLESS BROWSER HAS A SOFTWARE
 * KEYBOARD. These tests pin arithmetic. They cannot pin the behaviour, the last
 * attempt was merged on a green probe that could not see the mechanism, and the
 * only verification that counts for this defect is a real iPhone.
 */

/** What the visual viewport tells us. */
export type ViewportSample = {
  /** The LAYOUT viewport's height — `window.innerHeight`. */
  innerHeight: number
  /** `visualViewport.height`, or `null` where there is no `visualViewport`. */
  visualHeight: number | null
  /** `visualViewport.offsetTop` — how far the visual viewport has been shifted. */
  visualOffsetTop: number
}

/**
 * A sanity bound, and NOT a threshold.
 *
 * The previous attempt's floor of +80 is what made it useless; there is
 * deliberately no minimum here, because a 3px correction is a real 3px of
 * misplacement and the unwind passes through every value on its way down.
 *
 * What this bounds is nonsense: a reading that would move the panel more than
 * half the screen is not a keyboard, it is a viewport caught mid-rotation or a
 * number that means something else. Outside the bound the answer is 0 — the
 * plain `bottom: 0` the panel has always had.
 */
export const SANE_FRACTION = 0.5

/**
 * Where the panel's floor belongs, in CSS pixels, as a `bottom` offset.
 *
 * SIGNED. Positive lifts the panel over a keyboard that overlays without
 * shifting the viewport (Android, and iOS with a hardware keyboard attached);
 * negative pushes it back down over a stale `offsetTop`, which is the case that
 * produces the reported drift. Zero is both "no keyboard" and "iOS has already
 * put the visual viewport where it belongs", which is most of the time.
 *
 * ZERO FOR ANYTHING UNREADABLE, and zero is the panel's own `bottom-0`. This
 * may decline to act; it may never act on a number it does not believe.
 */
export function keyboardInset(s: ViewportSample | null): number {
  if (!s) return 0
  const { innerHeight, visualHeight, visualOffsetTop } = s
  if (visualHeight === null) return 0
  if (!Number.isFinite(innerHeight) || !Number.isFinite(visualHeight)) return 0
  if (!Number.isFinite(visualOffsetTop)) return 0
  if (innerHeight <= 0 || visualHeight <= 0) return 0
  const bottom = Math.round(innerHeight - visualHeight - visualOffsetTop)
  return Math.abs(bottom) > innerHeight * SANE_FRACTION ? 0 : bottom
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
