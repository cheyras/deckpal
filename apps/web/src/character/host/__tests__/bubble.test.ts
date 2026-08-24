/**
 * The speech bubble must never cover the element he is pointing at.
 *
 * That is a product requirement, not a nicety: the point of him travelling to
 * something is that you can SEE the thing. A bubble landing on top of it makes
 * the feature worse than not having it.
 *
 * The solve is pure, so it is tested here rather than eyeballed — an overlap of
 * a few pixels is invisible in a screenshot and obvious in a number.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { place, type Rect } from '../DeckeBubble'

const VW = 1280
const VH = 900
const BUBBLE = { width: 260, height: 60 }

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

/** Area of intersection — 0 means the bubble is clear of the element. */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

const asRect = (p: { left: number; top: number }): Rect =>
  rect(p.left, p.top, BUBBLE.width, BUBBLE.height)

test('with nothing to avoid, it sits above him', () => {
  const him = rect(600, 400, 200, 240)
  const p = place(BUBBLE, him, null, VW, VH)
  assert.ok(p.top + BUBBLE.height <= him.top, 'bubble should be above his top edge')
})

test('it never covers the highlighted element', () => {
  // He is parked to the RIGHT of a card, which is what parkBeside does for an
  // element on the left half of the screen.
  const target = rect(300, 380, 260, 300)
  const him = rect(620, 400, 200, 240)
  const p = place(BUBBLE, him, target, VW, VH)
  assert.equal(overlapArea(asRect(p), target), 0)
})

test('it moves out of the way when the target is directly above him', () => {
  // Above is both the preferred slot AND where the target is, so the solve has
  // to reject its own first choice rather than take it.
  const target = rect(560, 120, 300, 260)
  const him = rect(600, 420, 200, 240)
  const p = place(BUBBLE, him, target, VW, VH)
  assert.equal(overlapArea(asRect(p), target), 0)
  assert.ok(p.top >= him.bottom - 1, 'should have fallen through to below him')
})

test('it stays inside the viewport when he is in a corner', () => {
  const him = rect(VW - 210, VH - 250, 200, 240)
  const p = place(BUBBLE, him, null, VW, VH)
  assert.ok(p.left >= 0 && p.top >= 0, 'not off the top-left')
  assert.ok(p.left + BUBBLE.width <= VW, 'not off the right edge')
  assert.ok(p.top + BUBBLE.height <= VH, 'not off the bottom edge')
})

test('he is at the top of the screen: above is clamped, not off-screen', () => {
  const him = rect(600, 4, 200, 240)
  const p = place(BUBBLE, him, null, VW, VH)
  assert.ok(p.top >= 0 && p.top + BUBBLE.height <= VH)
})

test('a target covering everything still yields a placed bubble', () => {
  // Degenerate, and the rule is "some of the words beats none of them": take the
  // least-bad candidate rather than refuse to render.
  const target = rect(0, 0, VW, VH)
  const him = rect(600, 400, 200, 240)
  const p = place(BUBBLE, him, target, VW, VH)
  assert.ok(Number.isFinite(p.left) && Number.isFinite(p.top))
  assert.ok(p.left >= 0 && p.top >= 0)
})

// ── T1: the bubble must never cover HIM, `avoid` or not ─────────────────────
//
// "this is like covering him up… we need to be a lot more smart about where
// this is going" — the owner, on a build that only ever scored candidates
// against the highlight. When there was nothing to avoid, the FIRST candidate
// won unconditionally, overlap with his own rect be damned. These two pin
// that fix rather than just the viewport clamp the pre-existing tests check.

test('with nothing to avoid, the chosen rect never overlaps him even when the preferred slot would put it there', () => {
  // The exact fixture that reproduced the bug: he is pinned near the top of
  // the screen, so the preferred "above him" candidate clamps down into his
  // own rect instead of going off-screen. The old solve, scoring only
  // against `avoid` (null here), returned that candidate anyway.
  const him = rect(600, 4, 200, 240)
  const p = place(BUBBLE, him, null, VW, VH)
  assert.equal(overlapArea(asRect(p), him), 0, 'bubble must not land on top of him')
  // Still viewport-safe — the pre-existing assertion, kept.
  assert.ok(p.top >= 0 && p.top + BUBBLE.height <= VH)
})

test('with both him and a highlight present, the choice clears both rectangles', () => {
  // Same top-of-screen pin as above, but now there is also something to
  // avoid tucked directly below him. A solve that only scores against
  // `avoid` (the pre-fix behaviour) is satisfied by the "above him" candidate
  // — it doesn't touch the highlight — and would return it anyway, still
  // landing on top of him. The fix must reject that candidate on the `him`
  // overlap alone and fall through to one that clears both.
  const him = rect(600, 4, 200, 240)
  const avoid = rect(500, 200, 400, 300)
  const p = place(BUBBLE, him, avoid, VW, VH)
  assert.equal(overlapArea(asRect(p), him), 0, 'bubble must not land on top of him')
  assert.equal(overlapArea(asRect(p), avoid), 0, 'bubble must not land on the highlight either')
})
