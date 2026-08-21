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
