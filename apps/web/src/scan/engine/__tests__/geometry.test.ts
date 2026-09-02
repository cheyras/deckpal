import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import {
  alignToReference,
  CARD_ASPECT_W_OVER_H,
  defaultReticle,
  insideFraction,
  isConvexQuad,
  isStrictlyConvexQuad,
  maxCornerDelta,
  meanCornerDelta,
  orderQuad,
  polyArea,
  polyIoU,
} from '../geometry'

describe('defaultReticle', () => {
  it('is a card-aspect box at 72% width on a portrait phone frame', () => {
    const r = defaultReticle(480, 640)
    assert.ok(Math.abs(r.w - 0.72) < 1e-9, `w=${r.w}`)
    const boxW = r.w * 480
    const boxH = r.h * 640
    assert.ok(Math.abs(boxW / boxH - CARD_ASPECT_W_OVER_H) < 1e-9)
    // centred
    assert.ok(Math.abs(r.x - (1 - r.w) / 2) < 1e-12)
    assert.ok(Math.abs(r.y - (1 - r.h) / 2) < 1e-12)
  })

  it('lets the height cap win on a landscape frame, so the box still fits', () => {
    const r = defaultReticle(640, 480)
    assert.ok(r.h <= 0.92 + 1e-9, `h=${r.h}`)
    assert.ok(r.w < 0.72, 'the literal 72%-of-width box would be taller than the frame')
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1)
  })

  it('never runs off the frame at any aspect', () => {
    for (const [w, h] of [
      [480, 640],
      [640, 480],
      [1280, 960],
      [960, 1280],
      [1000, 1000],
      [276, 276],
    ]) {
      const r = defaultReticle(w, h)
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-12 && r.y + r.h <= 1 + 1e-12, `${w}x${h}`)
    }
  })
})

describe('convexity gates', () => {
  const good: Quad = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]
  const bowtie: Quad = [
    [0, 0],
    [10, 10],
    [10, 0],
    [0, 10],
  ]
  const sliver: Quad = [
    [0, 0],
    [10, 0],
    [20, 0.0001],
    [5, 5],
  ]

  it('accepts a plain square and rejects a bowtie', () => {
    assert.equal(isConvexQuad(good), true)
    assert.equal(isConvexQuad(bowtie), false)
    assert.equal(isStrictlyConvexQuad(good), true)
    assert.equal(isStrictlyConvexQuad(bowtie), false)
  })

  it('only the STRICT gate rejects a collinear sliver', () => {
    assert.equal(isConvexQuad(sliver), true, 'the screening gate tolerates it, which is why it is not the output gate')
    assert.equal(isStrictlyConvexQuad(sliver), false)
  })

  it('orderQuad repairs a permuted bowtie but not a genuinely broken quad', () => {
    const repaired = orderQuad(bowtie)
    assert.ok(repaired, 'a swapped-corner bowtie is repairable by re-ordering')
    assert.equal(isStrictlyConvexQuad(repaired), true)
    assert.equal(polyArea(repaired), 100)

    // A corner inside the triangle of the other three cannot be re-ordered
    // into a convex quad, at any rotation.
    const concave: Quad = [
      [0, 0],
      [10, 0],
      [5, 2],
      [10, 10],
    ]
    assert.equal(orderQuad(concave), null)
  })

  it('orderQuad rejects non-finite input rather than propagating NaN', () => {
    assert.equal(orderQuad([[0, 0], [Number.NaN, 0], [10, 10], [0, 10]] as Quad), null)
    assert.equal(orderQuad(null), null)
  })

  it('orderQuad is a no-op on an already-correct quad', () => {
    assert.deepEqual(orderQuad(good), good)
  })
})

describe('overlap measures', () => {
  it('polyIoU is 1 for identical quads and 0 for disjoint ones', () => {
    const a: Quad = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const b: Quad = [
      [100, 100],
      [110, 100],
      [110, 110],
      [100, 110],
    ]
    assert.ok(Math.abs(polyIoU(a, a) - 1) < 1e-9)
    assert.equal(polyIoU(a, b), 0)
    const half: Quad = [
      [5, 0],
      [15, 0],
      [15, 10],
      [5, 10],
    ]
    assert.ok(Math.abs(polyIoU(a, half) - 50 / 150) < 1e-9)
  })

  it('insideFraction measures the quad against the rect, not the other way round', () => {
    const big: Quad = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    assert.ok(Math.abs(insideFraction(big, { x: 25, y: 25, w: 50, h: 50 }) - 0.25) < 1e-9)
    const small: Quad = [
      [30, 30],
      [70, 30],
      [70, 70],
      [30, 70],
    ]
    assert.ok(Math.abs(insideFraction(small, { x: 25, y: 25, w: 50, h: 50 }) - 1) < 1e-9)
  })
})

describe('corner correspondence', () => {
  it('alignToReference rotates a quad onto the reference corner order', () => {
    const ref: Quad = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    // The same square, wound from a different starting corner.
    const rotated: Quad = [
      [10, 10],
      [0, 10],
      [0, 0],
      [10, 0],
    ]
    const aligned = alignToReference(ref, rotated)
    assert.deepEqual(aligned, [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    // Without alignment, blending would average opposite corners together.
    assert.equal(meanCornerDelta(ref, aligned), 0)
    assert.ok(meanCornerDelta(ref, rotated) > 10)
  })

  it('mean and max corner delta measure what they say', () => {
    const a: Quad = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const b: Quad = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 18],
    ]
    assert.equal(maxCornerDelta(a, b), 8)
    assert.equal(meanCornerDelta(a, b), 2)
  })
})
