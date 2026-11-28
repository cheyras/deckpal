// The size gate (sizeGate.ts): an auto-capture waits until the card is big
// enough in the frame to read; nothing else about the lock changes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Quad } from '../../engine/contract'
import { decideAutoCapture } from '../autoCapture'
import { FOCUS_FLOOR, createFocusGate } from '../focusGate'
import { createPresentation } from '../presentation'
import { MIN_CARD_SIDE, cardSideFraction, isTooFar } from '../sizeGate'

const FRAME = 416

/** An upright card whose long side is `side` of the frame, centred. */
function card(side: number): Quad {
  const h = side * FRAME
  const w = (h * 63) / 88
  const x = (FRAME - w) / 2
  const y = (FRAME - h) / 2
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
}

test('cardSideFraction is the long side over the frame, either way round', () => {
  assert.ok(Math.abs(cardSideFraction(card(0.7), FRAME) - 0.7) < 1e-9)
  const [a, b, c, d] = card(0.6)
  assert.ok(Math.abs(cardSideFraction([b, c, d, a], FRAME) - 0.6) < 1e-9, 'winding does not matter')
  assert.equal(cardSideFraction(card(0.6), 0), 0)
})

test('a card tilted away is judged by its middle, not its near edge', () => {
  // Near (bottom) edge long, far (top) edge short: a trapezoid.
  const q: Quad = [[150, 100], [266, 100], [290, 340], [126, 340]]
  const side = cardSideFraction(q, FRAME)
  const near = Math.hypot(290 - 266, 340 - 100) / FRAME
  assert.ok(side <= near + 1e-9)
})

test('the floor: just under it is too far, at it is not', () => {
  assert.equal(isTooFar(card(MIN_CARD_SIDE - 0.01), FRAME), true)
  assert.equal(isTooFar(card(MIN_CARD_SIDE), FRAME), false)
  assert.equal(isTooFar(card(0.7), FRAME), false, 'the median distance people hold a card at')
})

const memory = (extra: Record<string, unknown> = {}) => ({
  presentation: createPresentation(),
  now: 0,
  busy: false,
  size: { frameSide: FRAME },
  ...extra,
})

test('decideAutoCapture holds a far card, then fires the same track once it is close', () => {
  const far = decideAutoCapture({ id: 3, quad: card(MIN_CARD_SIDE - 0.05) }, null, memory())
  assert.equal(far.fire, false)
  assert.equal(far.tooFar, true)
  const near = decideAutoCapture({ id: 3, quad: card(0.65) }, null, memory())
  assert.equal(near.fire, true)
  assert.equal(near.tooFar, false)
})

test('without the size memory nothing changes (callers that do not opt in)', () => {
  const v = decideAutoCapture({ id: 1, quad: card(0.2) }, null, { ...memory(), size: undefined })
  assert.equal(v.fire, true)
  assert.equal(v.tooFar, false)
})

test('a card already taken, still lying there, is never told to come closer', () => {
  const presentation = createPresentation()
  const quad = card(0.3)
  presentation.fire({ kind: 'manual', now: 0, captureId: 'cap-1', trackId: 4, quad, look: null })
  const v = decideAutoCapture({ id: 4, quad }, null, memory({ presentation, now: 125 }))
  assert.equal(v.presentation.state, 'watching')
  assert.equal(v.fire, false)
  assert.equal(v.tooFar, false)
})

test('too far outranks focus, and the focus wait starts when the card arrives', () => {
  const focus = createFocusGate()
  const blurred = FOCUS_FLOOR / 2
  // 5 s spent too far: the focus gate is never consulted, so it never settles.
  for (let t = 0; t < 5000; t += 150) {
    const v = decideAutoCapture({ id: 9, quad: card(0.3) }, null, memory({ focus: { gate: focus, sharpness: blurred, now: t } }))
    assert.equal(v.tooFar, true)
    assert.equal(v.focusWait, false)
  }
  // Arrives close but still blurred: waits for focus instead of firing on a
  // focus wait it spent far away.
  const arrived = decideAutoCapture({ id: 9, quad: card(0.65) }, null, memory({ focus: { gate: focus, sharpness: blurred, now: 5100 } }))
  assert.equal(arrived.fire, false)
  assert.equal(arrived.focusWait, true)
  const sharp = decideAutoCapture({ id: 9, quad: card(0.65) }, null, memory({ focus: { gate: focus, sharpness: FOCUS_FLOOR * 2, now: 5300 } }))
  assert.equal(sharp.fire, true)
})
