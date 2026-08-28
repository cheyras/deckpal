/**
 * The keyboard, measured — and the panel that stopped riding a scroll.
 *
 * ── THE COMPLAINT, REPORTED TWICE ────────────────────────────────────────────
 *
 * *"I'm still seeing that downward drift happening after the keyboard is
 * dismissed. The chat bar goes down most of the way with the keyboard, but then
 * it slowly animates downward until it hits its final resting place."*
 *
 * The first pass made DECK-E settle in one hop instead of six, which was a real
 * defect and a real fix and could not have touched this: he was tracking a
 * composer that is itself sliding. The panel is `fixed bottom-0`, iOS does not
 * shrink the layout viewport for a keyboard, WebKit scrolls the held document to
 * reveal the composer, and every fixed layer rides that scroll — then rides the
 * animated unwind back down when the keyboard leaves.
 *
 * ── THE NUMBERS ARE FROM REAL HARDWARE ───────────────────────────────────────
 *
 * `character/viewport.ts` records them, measured on an iPhone rather than
 * reasoned about:
 *
 *   keyboard down   canvas client rect     0 .. 760
 *   keyboard up     canvas client rect  -268 .. 492
 *
 * The canvas is `fixed` and `100lvh`, so 760 is the layout viewport and the -268
 * is the reveal-scroll. What remains visible is 0..492, so the keyboard is
 * 760 - 492 = 268 px. Every case below is built from that reading, because a
 * headless browser has no software keyboard and these are the only real numbers
 * available.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KEYBOARD_MIN_PX,
  keyboardInset,
  shouldPinScroll,
  type ViewportSample,
} from '../keyboardInset'

/** The iPhone in `viewport.ts`, keyboard down. */
const DOWN: ViewportSample = { innerHeight: 760, visualHeight: 760, visualOffsetTop: 0 }
/** The same phone with the keyboard up: 268 px of it. */
const UP: ViewportSample = { innerHeight: 760, visualHeight: 492, visualOffsetTop: 0 }

test('the measured keyboard is measured', () => {
  assert.equal(keyboardInset(UP), 268)
})

test('no keyboard is no inset, which is exactly today’s layout', () => {
  // `bottom: 0` — the class's own value. The ordinary case has to be
  // byte-identical to what shipped, or this is a rewrite of the panel rather
  // than a fix for a keyboard.
  assert.equal(keyboardInset(DOWN), 0)
})

test('a visual viewport scrolled inside the layout one is accounted for', () => {
  // The keyboard occupies what the layout viewport has and the visual viewport
  // does not, BELOW the visual viewport — so `offsetTop` belongs in the
  // subtraction. Ignoring it over-reports the gap and lifts the panel too far.
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 400, visualOffsetTop: 92 }), 268)
})

test('a toolbar sliding is not a keyboard', () => {
  // Safari's own chrome moves the visual viewport by tens of pixels. Lifting the
  // panel for that would be a new small drift of exactly the kind this removes.
  for (const gap of [1, 12, 44, KEYBOARD_MIN_PX - 1]) {
    assert.equal(
      keyboardInset({ innerHeight: 760, visualHeight: 760 - gap, visualOffsetTop: 0 }),
      0,
      `${gap}px was treated as a keyboard`,
    )
  }
  // And the smallest thing that IS one still is.
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 760 - KEYBOARD_MIN_PX, visualOffsetTop: 0 }), KEYBOARD_MIN_PX)
})

test('the shortest real iPhone keyboard is comfortably over the threshold', () => {
  // ~216 px. The threshold has to sit under every real keyboard and over every
  // toolbar, and stating both bounds is what stops a future tweak closing the
  // gap from either side.
  assert.ok(KEYBOARD_MIN_PX < 216, 'the threshold would ignore a real keyboard')
  assert.ok(KEYBOARD_MIN_PX > 60, 'the threshold would fire on browser chrome')
})

test('every uncertain reading is zero, never a guess', () => {
  // ZERO IS TODAY'S BEHAVIOUR. This is allowed to decline to act; it is never
  // allowed to act on a number it does not believe, because the failure is a
  // panel floating in the middle of the screen with full confidence.
  assert.equal(keyboardInset(null), 0, 'no visualViewport at all')
  assert.equal(keyboardInset({ ...UP, visualHeight: null }), 0, 'no visual height')
  assert.equal(keyboardInset({ ...UP, innerHeight: 0 }), 0)
  assert.equal(keyboardInset({ ...UP, visualHeight: 0 }), 0)
  assert.equal(keyboardInset({ ...UP, innerHeight: Number.NaN }), 0)
  assert.equal(keyboardInset({ ...UP, visualHeight: Number.NaN }), 0)
  assert.equal(keyboardInset({ ...UP, visualOffsetTop: Number.NaN }), 0)
  // A visual viewport TALLER than the layout one happens transiently on some
  // Android browsers. A negative gap is not a keyboard.
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 900, visualOffsetTop: 0 }), 0)
  // And a keyboard cannot be taller than the screen it is on. Clamping this
  // rather than refusing it would put the panel's floor at the top of the
  // screen — the same defect, larger.
  assert.equal(keyboardInset({ innerHeight: 760, visualHeight: 1, visualOffsetTop: 900 }), 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// THE PIN, WHICH IS ONLY SAFE BECAUSE OF THE INSET
// ─────────────────────────────────────────────────────────────────────────────

test('with no keyboard the page is held still — that IS the unwind being cancelled', () => {
  // The drift the reader sees happens with the keyboard already gone: it is
  // WebKit returning the document to 0 on its own clock. This is the case that
  // stops it.
  assert.equal(shouldPinScroll(DOWN, 0), true)
})

test('with a keyboard up, the pin waits for the inset to actually be applied', () => {
  // THE LOAD-BEARING ASSERTION. The reveal-scroll is the only thing lifting the
  // composer clear of the keyboard when we have not lifted it ourselves.
  // Pinning first would leave the reader typing into a box behind the keyboard —
  // worse than the drift, and silent.
  assert.equal(shouldPinScroll(UP, 0), false, 'pinned before the panel had moved')
  assert.equal(shouldPinScroll(UP, 100), false, 'pinned while only part of the way up')
  assert.equal(shouldPinScroll(UP, 268), true)
  assert.equal(shouldPinScroll(UP, 300), true, 'more than enough is still enough')
})

test('a browser with no visualViewport is left entirely alone', () => {
  // No inset, and therefore no pin. Everything about that browser behaves the
  // way it did before this file existed.
  assert.equal(keyboardInset(null), 0)
  assert.equal(shouldPinScroll(null, 0), false)
  assert.equal(shouldPinScroll({ ...UP, visualHeight: null }, 0), false)
})

test('the two halves cannot be separated', () => {
  // Stated as a property rather than a case: there is no sample for which the
  // pin is allowed while a keyboard is up and the panel has not been lifted
  // over it. A future edit that makes `shouldPinScroll` ignore `appliedInset`
  // fails here.
  for (let gap = KEYBOARD_MIN_PX; gap < 700; gap += 37) {
    const s = { innerHeight: 760, visualHeight: 760 - gap, visualOffsetTop: 0 }
    assert.equal(shouldPinScroll(s, 0), false, `gap ${gap} pinned with no inset applied`)
    assert.equal(shouldPinScroll(s, keyboardInset(s)), true, `gap ${gap} refused a correct inset`)
  }
})
