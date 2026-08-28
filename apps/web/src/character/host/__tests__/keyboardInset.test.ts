/**
 * The panel's floor, and the three ways the last attempt broke one formula.
 *
 * ── WHAT THESE CAN AND CANNOT PROVE ──────────────────────────────────────────
 *
 * NO HEADLESS BROWSER HAS A SOFTWARE KEYBOARD. These pin arithmetic and nothing
 * else. #129 was merged and deployed on a green probe that faked
 * `visualViewport` and could not see the mechanism, and it made the product
 * worse on the device — so the honest statement of this file's worth is: it
 * stops the arithmetic regressing. Only a real iPhone can say whether the
 * arithmetic is the right arithmetic.
 *
 * ── THE NUMBERS ──────────────────────────────────────────────────────────────
 *
 * `character/viewport.ts` measured, on a real iPhone: the canvas's client rect
 * is `0..760` with the keyboard down and `-268..492` with it up. The canvas is
 * `fixed` and `100lvh`, so 760 is the layout viewport and 268 is how far iOS
 * shifted the visual viewport to reveal the composer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SANE_FRACTION, keyboardInset, type ViewportSample } from '../keyboardInset'

/** That iPhone, keyboard down. */
const DOWN: ViewportSample = { innerHeight: 760, visualHeight: 760, visualOffsetTop: 0 }

/**
 * The same phone with the keyboard up, as iOS actually reports it: the visual
 * viewport is SHIFTED, so `height` falls by 268 and `offsetTop` rises by 268,
 * and their sum is still 760.
 */
const UP_IOS: ViewportSample = { innerHeight: 760, visualHeight: 492, visualOffsetTop: 268 }

/**
 * The stale window, which is the whole reason this file exists. The keyboard
 * has gone and `height` is back to full, but `offsetTop` has not reset — the
 * documented iOS defect. Every `fixed` layer is drawn 268px too high.
 */
const STALE: ViewportSample = { innerHeight: 760, visualHeight: 760, visualOffsetTop: 268 }

test('typing changes nothing, because bottom:0 is already correct there', () => {
  // iOS shifts the visual viewport rather than overlaying it, so the two terms
  // cancel and the composer at `bottom: 0` is already sitting on the keyboard.
  // THE PATH THAT ALWAYS WORKED MUST KEEP WORKING, and #129's worst symptom —
  // drift while the keyboard was up — was this case being given "help".
  assert.equal(keyboardInset(UP_IOS), 0)
})

test('no keyboard is no change', () => {
  assert.equal(keyboardInset(DOWN), 0)
})

test('the stale offsetTop is corrected, and the answer is NEGATIVE', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. #129 had this same formula and put a
  // +80 floor in front of it, which suppressed every value the unwind produces —
  // so the one correction that fixes the reported drift was the one case it
  // refused to make.
  assert.equal(keyboardInset(STALE), -268)
})

test('every step of the unwind is corrected, not just the big ones', () => {
  // iOS eases `offsetTop` back to 0, so the correction passes through every
  // value on the way down. A minimum of any size re-creates the defect in
  // miniature: the panel would ride the tail of the animation instead of the
  // whole of it.
  for (const stale of [268, 180, 96, 40, 12, 3, 1]) {
    assert.equal(
      keyboardInset({ innerHeight: 760, visualHeight: 760, visualOffsetTop: stale }),
      -stale,
      `${stale}px of stale offset was ignored`,
    )
  }
})

test('a keyboard that overlays without shifting is lifted over', () => {
  // Android, and iOS with a hardware keyboard attached: `height` shrinks and
  // `offsetTop` stays 0, so the panel genuinely has to rise. The formula is
  // signed; it covers both directions with no branch.
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 492, visualOffsetTop: 0 }), 268)
})

test('anything unreadable is zero, which is the panel’s own bottom-0', () => {
  // This may decline to act. It may never act on a number it does not believe,
  // because the failure is a panel placed confidently in the wrong place.
  assert.equal(keyboardInset(null), 0, 'no visualViewport at all')
  assert.equal(keyboardInset({ ...UP_IOS, visualHeight: null }), 0)
  assert.equal(keyboardInset({ ...UP_IOS, innerHeight: 0 }), 0)
  assert.equal(keyboardInset({ ...UP_IOS, visualHeight: 0 }), 0)
  assert.equal(keyboardInset({ ...UP_IOS, innerHeight: Number.NaN }), 0)
  assert.equal(keyboardInset({ ...UP_IOS, visualHeight: Number.NaN }), 0)
  assert.equal(keyboardInset({ ...UP_IOS, visualOffsetTop: Number.NaN }), 0)
})

test('a nonsense reading is refused rather than clamped', () => {
  // Mid-rotation, or a number that means something else. Clamping it to the
  // bound would move the panel half a screen with full confidence; refusing it
  // leaves the panel where it has always been.
  const half = 760 * SANE_FRACTION
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 760, visualOffsetTop: half + 1 }), 0)
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 10, visualOffsetTop: 0 }), 0)
  // And the bound is generous enough that a real keyboard is never refused: the
  // tallest iPhone keyboard with a prediction bar is around 400px on a 900px
  // screen, and both of those are inside it.
  assert.equal(keyboardInset({ innerHeight: 900, visualHeight: 900, visualOffsetTop: 400 }), -400)
})

test('there is no minimum, and that is deliberate', () => {
  // Stated as a property so a future "let us ignore the small ones" edit fails
  // here rather than shipping. #129's floor was exactly that edit.
  for (let stale = 1; stale <= 300; stale++) {
    const got = keyboardInset({ innerHeight: 760, visualHeight: 760, visualOffsetTop: stale })
    assert.equal(got, -stale, `${stale}px was suppressed`)
  }
})
