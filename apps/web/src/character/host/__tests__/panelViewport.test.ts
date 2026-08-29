/**
 * The panel's placement, pinned to numbers copied off a real screen.
 *
 * ── WHY THESE SAMPLES AND NOT INVENTED ONES ──────────────────────────────────
 *
 * Two previous attempts at this bug shipped green. Both were tested against a
 * faked `visualViewport` built from a model of iOS that was wrong — in
 * particular that `window.innerHeight` is the LAYOUT viewport, which on iOS it
 * is not. The arithmetic agreed with itself and disagreed with the phone.
 *
 * Every sample below was read off the instrument in `KbDiag.tsx` running on a
 * simulator, and the source of each is named. What they still cannot prove is
 * behaviour — no headless browser has a software keyboard — so they pin the
 * placement and the device verification lives in the PR.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { panelBox } from '../panelViewport'

/** The app header, measured: 64px plus a 1px border on the 17 Pro. */
const HEADER = 65

/** iPhone 17 Pro, iOS 26.5, nothing focused. `hT` is 0 — nothing is riding. */
const REST_26 = { fixedOrigin: 0, visualHeight: 714, headerOffset: HEADER }

/**
 * The same phone with the composer focused. iOS has scrolled the document 338
 * to reveal it and is carrying every `fixed` layer along, so a `fixed; top: 0`
 * box now lands at client -337.
 */
const FOCUSED_26 = { fixedOrigin: -337, visualHeight: 377, headerOffset: HEADER }

/** iPhone 16 Pro, iOS 18.6, at rest and focused. A different phone, same shape. */
const REST_18 = { fixedOrigin: 0, visualHeight: 678, headerOffset: HEADER }
const FOCUSED_18 = { fixedOrigin: -268, visualHeight: 410, headerOffset: HEADER }

test('at rest the panel is exactly what it was authored to be', () => {
  // THE RESTING LAYOUT MUST NOT MOVE. This is the case that is not broken, on
  // every device and both platforms, and the one a fix for a keyboard is most
  // likely to damage on its way past.
  assert.deepEqual(panelBox(REST_26), { top: HEADER, height: 714 - HEADER })
  assert.deepEqual(panelBox(REST_18), { top: HEADER, height: 678 - HEADER })
})

test('focused, the panel covers the whole visible area', () => {
  // The header has been carried off the top of the screen, so there is nothing
  // left to clear and the panel starts at the top of what can be seen. `top` is
  // the offset that puts it there THROUGH the drift: 0 - (-337).
  assert.deepEqual(panelBox(FOCUSED_26), { top: 337, height: 377 })
  assert.deepEqual(panelBox(FOCUSED_18), { top: 268, height: 410 })
})

test('the floor lands on the keyboard, which is the whole point', () => {
  // `top + height` is the panel's bottom edge in the drifted coordinates the
  // browser reports rects in. Measured on both phones, a panel whose bottom sat
  // here had its composer exactly on the keyboard.
  const a = panelBox(FOCUSED_26)!
  assert.equal(a.top + a.height - 337, 377, '17 Pro: panel bottom at client 377')
  const b = panelBox(FOCUSED_18)!
  assert.equal(b.top + b.height - 268, 410, '16 Pro: panel bottom at client 410')
})

test('the header is cleared only while the header is on screen', () => {
  // Halfway through iOS's reveal the header is partly gone. It is cleared by
  // exactly as much of it as is left, and never by a negative amount — the
  // `Math.max` is what stops a band of nothing appearing above the conversation.
  assert.deepEqual(panelBox({ fixedOrigin: -30, visualHeight: 500, headerOffset: HEADER }), {
    top: 65,
    height: 465,
  })
  assert.deepEqual(panelBox({ fixedOrigin: -65, visualHeight: 500, headerOffset: HEADER }), {
    top: 65,
    height: 500,
  })
  assert.deepEqual(panelBox({ fixedOrigin: -200, visualHeight: 500, headerOffset: HEADER }), {
    top: 200,
    height: 500,
  })
})

test('an overlay keyboard that shifts nothing still lifts the floor', () => {
  // Android, and iOS with a hardware keyboard attached: the visible area
  // shrinks with no scroll and no drift. Nothing here is iOS-specific, so that
  // case needs no branch — the panel is still placed against what can be seen.
  assert.deepEqual(panelBox({ fixedOrigin: 0, visualHeight: 400, headerOffset: HEADER }), {
    top: HEADER,
    height: 335,
  })
})

test('nothing believable, nothing written', () => {
  // `null` means "keep the CSS the panel was authored with". Every one of these
  // is a real state: no `visualViewport`, a route with no header, a viewport
  // caught mid-rotation, or a visible area shorter than the header itself.
  assert.equal(panelBox(null), null)
  assert.equal(panelBox({ fixedOrigin: 0, visualHeight: 0, headerOffset: HEADER }), null)
  assert.equal(panelBox({ fixedOrigin: 0, visualHeight: -5, headerOffset: HEADER }), null)
  assert.equal(panelBox({ fixedOrigin: NaN, visualHeight: 714, headerOffset: HEADER }), null)
  assert.equal(panelBox({ fixedOrigin: 0, visualHeight: NaN, headerOffset: HEADER }), null)
  assert.equal(panelBox({ fixedOrigin: 0, visualHeight: 714, headerOffset: NaN }), null)
  assert.equal(panelBox({ fixedOrigin: 0, visualHeight: 40, headerOffset: HEADER }), null)
})

test('a height is never negative and a top is always an integer', () => {
  // Sub-pixel viewport heights are ordinary on a scaled page, and a fractional
  // `top` written every frame is a panel that shimmers.
  const box = panelBox({ fixedOrigin: -337.4, visualHeight: 377.6, headerOffset: HEADER })!
  assert.equal(Number.isInteger(box.top), true)
  assert.equal(Number.isInteger(box.height), true)
  assert.equal(box.height >= 0, true)
})
