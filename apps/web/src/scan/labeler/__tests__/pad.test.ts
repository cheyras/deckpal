// The overhanging crop's geometry.
//
// The mirror fill itself needs a canvas and is verified in a browser; these pin
// the arithmetic that decides WHERE it happens and how far the square is
// allowed to go — the parts that can be wrong silently, because a wrong pad
// still produces a plausible-looking square.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_REAL_FRACTION, clampCropAllowingPad, cropPad, isPadded } from '../workingFrame'

test('a crop inside the photo pads nothing', () => {
  const pad = cropPad({ x: 100, y: 100, size: 400 }, 1200, 900)
  assert.deepEqual(pad, { left: 0, top: 0, right: 0, bottom: 0 })
  assert.equal(isPadded(pad), false)
})

test('overhang is measured per side, in source pixels', () => {
  // Off the left by 50 and the top by 30; the right and bottom are still inside.
  assert.deepEqual(cropPad({ x: -50, y: -30, size: 400 }, 1200, 900), {
    left: 50,
    top: 30,
    right: 0,
    bottom: 0,
  })
  // Off the right by 200 (700 + 700 = 1400, photo is 1200) and the bottom by 500.
  assert.deepEqual(cropPad({ x: 700, y: 700, size: 700 }, 1200, 900), {
    left: 0,
    top: 0,
    right: 200,
    bottom: 500,
  })
})

test('the square may now leave the photo — the old clamp would not allow this', () => {
  const c = clampCropAllowingPad({ x: -100, y: 0, size: 400 }, 1200, 900)
  assert.ok(c.x < 0, 'a negative x must survive, or the feature does not exist')
  assert.equal(isPadded(cropPad(c, 1200, 900)), true)
})

test('at least half of each axis stays over real photograph', () => {
  // The mirror reflects the real content outward; a gap wider than the content
  // has nothing left to copy. Pushed as far left as it will go, exactly half
  // the square should still be on the photo.
  const size = 400
  const c = clampCropAllowingPad({ x: -100_000, y: 0, size }, 1200, 900)
  const pad = cropPad(c, 1200, 900)
  assert.equal(pad.left, size * MIN_REAL_FRACTION)
  assert.ok(pad.left <= size - pad.left, 'the pad may never exceed the real content it mirrors')
})

test('the same limit applies on the far side', () => {
  const size = 400
  const c = clampCropAllowingPad({ x: 100_000, y: 100_000, size }, 1200, 900)
  const pad = cropPad(c, 1200, 900)
  assert.equal(pad.right, size * MIN_REAL_FRACTION)
  assert.equal(pad.bottom, size * MIN_REAL_FRACTION)
})

test('the square is capped at the LONGER edge, not the shorter one', () => {
  // `clampCrop` capped at the shorter edge because the square had to fit
  // inside. This one may overhang, so the cap moves out — but not without
  // limit: past the long edge both axes are mostly padding.
  const c = clampCropAllowingPad({ x: 0, y: 0, size: 99_999 }, 1200, 900)
  assert.equal(c.size, 1200)
})

test('a square larger than the photo still keeps half of each axis real', () => {
  const c = clampCropAllowingPad({ x: -5000, y: -5000, size: 1000 }, 1200, 900)
  const pad = cropPad(c, 1200, 900)
  assert.ok(pad.left <= 1000 * MIN_REAL_FRACTION)
  assert.ok(pad.top <= 1000 * MIN_REAL_FRACTION)
})

test('the crop always overlaps the photo, so the mirror always has a source', () => {
  // The one thing `drawSquarePadded` throws on. Every reachable position must
  // leave a non-empty intersection.
  for (const [x, y, size] of [
    [-100_000, -100_000, 400],
    [100_000, 100_000, 400],
    [-100_000, 100_000, 1200],
    [0, -100_000, 900],
  ] as const) {
    const c = clampCropAllowingPad({ x, y, size }, 1200, 900)
    const ix = Math.min(c.x + c.size, 1200) - Math.max(c.x, 0)
    const iy = Math.min(c.y + c.size, 900) - Math.max(c.y, 0)
    assert.ok(ix > 0 && iy > 0, `no overlap at ${x},${y},${size} -> ${JSON.stringify(c)}`)
  }
})

test('an unpadded crop is byte-identical in shape to what it always was', () => {
  // The regression that would matter most: uploads that never touch an edge
  // must keep behaving exactly as before this feature existed.
  const c = clampCropAllowingPad({ x: 300, y: 200, size: 400 }, 1200, 900)
  assert.deepEqual(c, { x: 300, y: 200, size: 400 })
  assert.equal(isPadded(cropPad(c, 1200, 900)), false)
})
