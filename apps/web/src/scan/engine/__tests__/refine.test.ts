// The refiner, measured against a rectangle whose true edges are known to the
// half-pixel. A hard step edge between column 59 (background) and column 60
// (fill) has its Sobel ridge centred at x = 59.5, so that — not 60 — is the
// truth these tests are scored against.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import type { ImageDataLike } from '../geometry'
import { gradientField, refineQuad, refineQuadChecked } from '../refine'

const W = 200
const H = 200
const X0 = 60
const X1 = 140 // exclusive
const Y0 = 50
const Y1 = 150 // exclusive

/** Truth: the ridge sits half a pixel outside the first/last filled pixel. */
const TRUTH: Quad = [
  [X0 - 0.5, Y0 - 0.5],
  [X1 - 0.5, Y0 - 0.5],
  [X1 - 0.5, Y1 - 0.5],
  [X0 - 0.5, Y1 - 0.5],
]

function rectImage(bg = 30, fg = 220): ImageDataLike {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const v = x >= X0 && x < X1 && y >= Y0 && y < Y1 ? fg : bg
      data[o] = v
      data[o + 1] = v
      data[o + 2] = v
      data[o + 3] = 255
    }
  }
  return { width: W, height: H, data }
}

function perturb(q: Quad, deltas: readonly [number, number][]): Quad {
  return [
    [q[0][0] + deltas[0][0], q[0][1] + deltas[0][1]],
    [q[1][0] + deltas[1][0], q[1][1] + deltas[1][1]],
    [q[2][0] + deltas[2][0], q[2][1] + deltas[2][1]],
    [q[3][0] + deltas[3][0], q[3][1] + deltas[3][1]],
  ]
}

function cornerErrors(q: Quad): number[] {
  return q.map((p, i) => Math.hypot(p[0] - TRUTH[i][0], p[1] - TRUTH[i][1]))
}

describe('gradientField', () => {
  it('puts its ridge on the edge, oriented across it', () => {
    const F = gradientField(rectImage())
    const at = (x: number, y: number) => F.mag[y * W + x]
    // The step between 59 and 60 lights BOTH columns and nothing beyond.
    assert.ok(at(59, 100) > 500 && at(60, 100) > 500)
    assert.ok(at(58, 100) < 1e-6 && at(61, 100) < 1e-6)
    // ...and the direction is purely horizontal there.
    assert.ok(Math.abs(Math.abs(F.gxo[100 * W + 59]) - 1) < 1e-6)
    assert.ok(Math.abs(F.gyo[100 * W + 59]) < 1e-6)
  })

  it('leaves the 1px border untouched (why every sampler refuses to read it)', () => {
    const F = gradientField(rectImage())
    assert.equal(F.mag[0], 0)
    assert.equal(F.mag[W - 1], 0)
    assert.equal(F.mag[(H - 1) * W], 0)
  })
})

describe('refineQuadChecked', () => {
  const F = gradientField(rectImage())

  it('converges a perturbed quad to the true corners within 1px', () => {
    const start = perturb(TRUTH, [
      [2.4, -1.7],
      [-3.1, 2.2],
      [1.8, 1.4],
      [-2.6, -2.9],
    ])
    const before = cornerErrors(start)
    assert.ok(Math.max(...before) > 2, 'the test must actually start off the edge')

    const out = refineQuadChecked(start, F)
    assert.ok(out, 'refinement must produce a valid quad')
    const after = cornerErrors(out)
    for (let i = 0; i < 4; i++) {
      assert.ok(after[i] < 1, `corner ${i}: ${after[i].toFixed(3)}px (was ${before[i].toFixed(3)}px)`)
    }
  })

  it('converges from every direction, not just the one that was tried', () => {
    const offsets: Array<[number, number]> = [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
      [2, 2],
      [-2, -2],
    ]
    for (const [dx, dy] of offsets) {
      const start = perturb(TRUTH, [
        [dx, dy],
        [dx, dy],
        [dx, dy],
        [dx, dy],
      ])
      const out = refineQuadChecked(start, F)
      assert.ok(out, `offset ${dx},${dy} produced no quad`)
      const err = Math.max(...cornerErrors(out))
      assert.ok(err < 1, `offset ${dx},${dy}: worst corner ${err.toFixed(3)}px`)
    }
  })

  it('does not walk away when re-applied to its own output', () => {
    // A second pass moves corners by a fraction of a pixel — the residual is
    // the discrete peak search on a ridge that is two pixels wide on a hard
    // synthetic edge — but it must not drift AWAY from the truth.
    const once = refineQuadChecked(perturb(TRUTH, [[2, 2], [-2, 2], [2, -2], [-2, -2]]), F)
    assert.ok(once)
    const twice = refineQuadChecked(once, F)
    assert.ok(twice)
    for (let i = 0; i < 4; i++) {
      assert.ok(
        Math.hypot(twice[i][0] - once[i][0], twice[i][1] - once[i][1]) < 0.5,
        `corner ${i} moved on the second pass`,
      )
    }
    assert.ok(Math.max(...cornerErrors(twice)) < 1, 'still within 1px of truth after two applications')
  })

  it('refuses to invent: with no evidence nearby, the quad is returned unmoved', () => {
    // A quad out in the flat background. Every side samples nothing above
    // minPeak, so every side keeps its original line and every corner its
    // original position.
    const nowhere: Quad = [
      [10, 10],
      [50, 10],
      [50, 40],
      [10, 40],
    ]
    const out = refineQuadChecked(nowhere, F)
    assert.ok(out)
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(out[i][0] - nowhere[i][0]) < 1e-9)
      assert.ok(Math.abs(out[i][1] - nowhere[i][1]) < 1e-9)
    }
  })

  it('honours maxMove: a corner is never dragged further than its leash', () => {
    const start = perturb(TRUTH, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    const out = refineQuad(start, gradientField(rectImage()), { maxMove: 0.0001 })
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(out[i], start[i], 'a zero leash must return the input corner verbatim')
    }
  })

  it('a low-contrast edge is still found (colour gradient, not luminance)', () => {
    // Blue-on-black: invisible to a green-channel-only gradient, obvious here.
    const data = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        const inside = x >= X0 && x < X1 && y >= Y0 && y < Y1
        data[o + 2] = inside ? 200 : 0
        data[o + 3] = 255
      }
    }
    const Fb = gradientField({ width: W, height: H, data })
    const out = refineQuadChecked(perturb(TRUTH, [[2, 2], [-2, 2], [2, -2], [-2, -2]]), Fb)
    assert.ok(out)
    assert.ok(Math.max(...cornerErrors(out)) < 1, 'blue-on-black edge must refine like any other')
  })

  it('gates degenerate output: a collapsed quad refines to null', () => {
    const collapsed: Quad = [
      [100, 100],
      [100, 100],
      [100, 100],
      [100, 100],
    ]
    assert.equal(refineQuadChecked(collapsed, F), null)
  })
})
