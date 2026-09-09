// `clampCrop` — the one rule the hand-chosen upload crop must obey.
//
// A square that hangs off the edge of the photo draws TRANSPARENT BLACK into
// the canonical frame: a region the detector has never seen in training, that
// the reader cannot meaningfully label, and that would be indistinguishable in
// the corpus from a genuinely dark card edge. Every path into
// `buildWorkingFrame` goes through this, so the invariant is pinned here rather
// than trusted to the UI that usually gets it right.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampCrop } from '../workingFrame'

test('a crop already inside the image is returned unchanged', () => {
  assert.deepEqual(clampCrop({ x: 100, y: 50, size: 400 }, 1200, 900), { x: 100, y: 50, size: 400 })
})

test('a crop pushed off the left/top edge is pulled back in, not shrunk', () => {
  assert.deepEqual(clampCrop({ x: -300, y: -80, size: 400 }, 1200, 900), { x: 0, y: 0, size: 400 })
})

test('a crop pushed off the right/bottom edge is pulled back in', () => {
  assert.deepEqual(clampCrop({ x: 5000, y: 5000, size: 400 }, 1200, 900), { x: 800, y: 500, size: 400 })
})

test('a square larger than the photo is capped at the SHORTER edge', () => {
  // Not the longer one: a square that fits the width of a landscape photo would
  // still hang off the top and bottom, which is the case this exists to refuse.
  assert.deepEqual(clampCrop({ x: 0, y: 0, size: 99999 }, 1200, 900), { x: 0, y: 0, size: 900 })
})

test('the offset is clamped AFTER the size is capped', () => {
  // Order matters: clamping x against the requested 99999 first would allow a
  // negative bound and let the square escape on the next line.
  const c = clampCrop({ x: 700, y: 700, size: 99999 }, 1200, 900)
  assert.equal(c.size, 900)
  assert.ok(c.x + c.size <= 1200, 'right edge inside the photo')
  assert.ok(c.y + c.size <= 900, 'bottom edge inside the photo')
  assert.deepEqual(c, { x: 300, y: 0, size: 900 })
})

test('a degenerate request still yields a drawable square', () => {
  const c = clampCrop({ x: 0, y: 0, size: 0 }, 1200, 900)
  assert.equal(c.size, 1)
})

test('fractional input is rounded — canvas source rects are pixel counts', () => {
  assert.deepEqual(clampCrop({ x: 10.6, y: 20.2, size: 300.7 }, 1200, 900), { x: 11, y: 20, size: 301 })
})
