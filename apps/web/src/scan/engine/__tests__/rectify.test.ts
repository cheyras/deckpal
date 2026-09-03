import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { CARD_ASPECT_W_OVER_H, centroid, polyArea, polyIoU, type ImageDataLike } from '../geometry'
import {
  applyHomography,
  CAPTURE_MARGIN,
  CARD_RECT_HEIGHT,
  CARD_RECT_WIDTH,
  expandQuad,
  orderQuadForCard,
  rectifyImageData,
  solveHomography,
  type Mat3,
} from '../rectify'

const UNIT: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps
}

describe('homography', () => {
  it('src === dst gives the identity', () => {
    const H = solveHomography(UNIT, UNIT)
    assert.ok(H)
    const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    for (let i = 0; i < 9; i++) assert.ok(near(H[i], I[i]), `h${i} = ${H[i]}`)
  })

  it('maps all four correspondences exactly', () => {
    const src: Quad = [
      [37, 21],
      [190, 55],
      [204, 233],
      [12, 198],
    ]
    const dst: Quad = [
      [0, 0],
      [480, 0],
      [480, 670],
      [0, 670],
    ]
    const H = solveHomography(src, dst)
    assert.ok(H)
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyHomography(H, src[i][0], src[i][1])
      assert.ok(near(x, dst[i][0], 1e-6), `corner ${i} x: ${x}`)
      assert.ok(near(y, dst[i][1], 1e-6), `corner ${i} y: ${y}`)
    }
  })

  it('is genuinely projective, not affine — the centre does not stay the centre', () => {
    // A trapezoid (the shape a tilted card makes) has no affine map to a
    // rectangle; if this came out affine the whole rectification would be a
    // stretch, and the phash downstream would be hashing a distortion.
    const trapezoid: Quad = [
      [40, 0],
      [160, 0],
      [200, 100],
      [0, 100],
    ]
    const H = solveHomography(trapezoid, UNIT)
    assert.ok(H)
    assert.ok(Math.abs(H[6]) + Math.abs(H[7]) > 1e-6, 'perspective row must be non-zero')
    const [cx, cy] = applyHomography(H, 100, 50)
    assert.ok(near(cx, 0.5, 1e-9), `x centre stays centred by symmetry: ${cx}`)
    assert.ok(!near(cy, 0.5, 1e-3), `y centre must NOT map to 0.5 under perspective: ${cy}`)
  })

  it('the inverse undoes it', () => {
    const src: Quad = [
      [37, 21],
      [190, 55],
      [204, 233],
      [12, 198],
    ]
    const fwd = solveHomography(src, UNIT)
    const inv = solveHomography(UNIT, src)
    assert.ok(fwd && inv)
    for (const [x, y] of [
      [50, 50],
      [120, 90],
      [180, 200],
    ]) {
      const [u, v] = applyHomography(fwd, x, y)
      const [bx, by] = applyHomography(inv, u, v)
      assert.ok(near(bx, x, 1e-6), `${x} -> ${bx}`)
      assert.ok(near(by, y, 1e-6), `${y} -> ${by}`)
    }
  })

  it('refuses a degenerate correspondence instead of returning a singular matrix', () => {
    const collinear: Quad = [
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
    ]
    assert.equal(solveHomography(collinear, UNIT), null)
  })
})

describe('orderQuadForCard', () => {
  it('ships a 63:88 canvas', () => {
    assert.equal(CARD_RECT_WIDTH, 480)
    assert.equal(CARD_RECT_HEIGHT, 670)
    assert.ok(Math.abs(CARD_RECT_WIDTH / CARD_RECT_HEIGHT - CARD_ASPECT_W_OVER_H) < 0.001)
  })

  it('puts a short side first, so a card held sideways rectifies portrait', () => {
    // A landscape-presented card: 200 wide, 140 tall.
    const landscape: Quad = [
      [10, 10],
      [210, 10],
      [210, 150],
      [10, 150],
    ]
    const o = orderQuadForCard(landscape)
    assert.ok(o)
    const s01 = Math.hypot(o[1][0] - o[0][0], o[1][1] - o[0][1])
    const s12 = Math.hypot(o[2][0] - o[1][0], o[2][1] - o[1][1])
    assert.ok(s01 < s12, `first side ${s01} must be the short one (${s12})`)
  })

  it('is winding-agnostic: a counter-clockwise quad comes back the same as clockwise', () => {
    const cw: Quad = [
      [10, 10],
      [90, 10],
      [90, 120],
      [10, 120],
    ]
    const ccw: Quad = [cw[0], cw[3], cw[2], cw[1]]
    assert.deepEqual(orderQuadForCard(ccw), orderQuadForCard(cw))
  })

  it('is rotation-of-input-agnostic: the same four points in any cyclic order', () => {
    const q: Quad = [
      [10, 10],
      [90, 10],
      [90, 120],
      [10, 120],
    ]
    const rotated: Quad = [q[2], q[3], q[0], q[1]]
    assert.deepEqual(orderQuadForCard(rotated), orderQuadForCard(q))
  })

  it('rejects a degenerate quad', () => {
    assert.equal(
      orderQuadForCard([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
      null,
    )
  })
})

describe('expandQuad — the capture margin', () => {
  const CARD: Quad = [
    [100, 200],
    [200, 200],
    [200, 340],
    [100, 340],
  ]

  it('is a real margin, not a decoration', () => {
    // The whole point of the constant is that captures are LOOSE. A zero or
    // negative default would silently restore the exact-crop behaviour that
    // measured 81% top-1 against the margin's 98%.
    assert.ok(CAPTURE_MARGIN > 0.02, `CAPTURE_MARGIN ${CAPTURE_MARGIN} is too small to matter`)
    assert.ok(CAPTURE_MARGIN < 0.15, `CAPTURE_MARGIN ${CAPTURE_MARGIN} would drown the card in background`)
  })

  it('adds exactly `margin` of each dimension on each side', () => {
    const out = expandQuad(CARD, 0.05)
    const xs = out.map((p) => p[0])
    const ys = out.map((p) => p[1])
    // 100 wide, 140 tall -> 5 px and 7 px beyond each edge.
    assert.ok(near(Math.min(...xs), 95, 1e-9), `left ${Math.min(...xs)}`)
    assert.ok(near(Math.max(...xs), 205, 1e-9), `right ${Math.max(...xs)}`)
    assert.ok(near(Math.min(...ys), 193, 1e-9), `top ${Math.min(...ys)}`)
    assert.ok(near(Math.max(...ys), 347, 1e-9), `bottom ${Math.max(...ys)}`)
  })

  it('keeps the centroid, so the capture is still centred on the card', () => {
    const before = centroid(CARD)
    const after = centroid(expandQuad(CARD, 0.07))
    assert.ok(near(after[0], before[0], 1e-9))
    assert.ok(near(after[1], before[1], 1e-9))
  })

  it('contains the original quad — the guarantee the margin exists to make', () => {
    const tilted: Quad = [
      [120, 190],
      [230, 215],
      [212, 350],
      [98, 331],
    ]
    for (const q of [CARD, tilted]) {
      const out = expandQuad(q, CAPTURE_MARGIN)
      assert.ok(polyIoU(q, out) > 0.7, 'the expansion must still be mostly the card')
      // Every original corner strictly inside the expanded quad === no card lost.
      assert.ok(
        Math.abs(polyIoU(q, out) - polyArea(q) / polyArea(out)) < 1e-9,
        'the original quad is not fully contained in the expanded one',
      )
    }
  })

  it('preserves shape: the expansion is a scale, not a per-side push', () => {
    // A keystone must stay a keystone, or the rectified capture is a distortion
    // of a distortion. Side-length RATIOS are the invariant of a similarity.
    const keystone: Quad = [
      [140, 200],
      [220, 200],
      [250, 330],
      [110, 330],
    ]
    const out = expandQuad(keystone, 0.06)
    const side = (q: Quad, i: number) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1])
    for (let i = 0; i < 4; i++) {
      assert.ok(near(side(out, i) / side(keystone, i), 1.12, 1e-9), `side ${i} scaled by ${side(out, i) / side(keystone, i)}`)
    }
  })

  it('is the identity at margin 0, and returns a copy rather than the input', () => {
    const out = expandQuad(CARD, 0)
    assert.deepEqual(out, CARD)
    assert.notEqual(out, CARD)
    out[0][0] = -1
    assert.equal(CARD[0][0], 100, 'expandQuad handed back the caller its own array')
  })
})

describe('rectifyImageData', () => {
  const W = 200
  const H = 200
  const QUAD: Quad = [
    [60, 50],
    [140, 50],
    [140, 150],
    [60, 150],
  ]
  const RED = [255, 0, 0]
  const GREEN = [0, 255, 0]
  const BLUE = [0, 0, 255]
  const WHITE = [255, 255, 255]

  /** Four coloured quadrants inside the quad, black everywhere else. */
  function quadrantImage(): ImageDataLike {
    const data = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        data[o + 3] = 255
        if (x < 60 || x >= 140 || y < 50 || y >= 150) continue
        const c = y < 100 ? (x < 100 ? RED : GREEN) : x < 100 ? WHITE : BLUE
        data[o] = c[0]
        data[o + 1] = c[1]
        data[o + 2] = c[2]
      }
    }
    return { width: W, height: H, data }
  }

  function at(img: ImageDataLike, x: number, y: number): number[] {
    const o = (y * img.width + x) * 4
    return [img.data[o], img.data[o + 1], img.data[o + 2]]
  }

  it('warps the quad onto the canvas, corner for corner', () => {
    const out = rectifyImageData(quadrantImage(), QUAD, 40, 56)
    assert.ok(out)
    assert.equal(out.width, 40)
    assert.equal(out.height, 56)
    assert.deepEqual(at(out, 10, 14), RED, 'top-left quadrant')
    assert.deepEqual(at(out, 30, 14), GREEN, 'top-right quadrant')
    assert.deepEqual(at(out, 30, 42), BLUE, 'bottom-right quadrant')
    assert.deepEqual(at(out, 10, 42), WHITE, 'bottom-left quadrant')
  })

  it('fills the canvas — no black border from an off-by-one in the mapping', () => {
    const out = rectifyImageData(quadrantImage(), QUAD, 40, 56)
    assert.ok(out)
    for (const [x, y] of [
      [0, 0],
      [39, 0],
      [39, 55],
      [0, 55],
    ]) {
      const p = at(out, x, y)
      assert.ok(p[0] + p[1] + p[2] > 0, `corner pixel ${x},${y} is black — the warp missed the quad`)
    }
    assert.equal(out.data[3], 255, 'output is opaque')
  })

  it('un-skews a perspective view: a trapezoid of the card comes back rectangular', () => {
    // Same four quadrants, but painted into a trapezoid — what a tilted card
    // actually looks like. Rectifying it must put the quadrant boundary back
    // in the middle of the output.
    const data = new Uint8ClampedArray(W * H * 4)
    const trap: Quad = [
      [70, 40],
      [130, 40],
      [170, 160],
      [30, 160],
    ]
    const toSrc = solveHomography(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      trap,
    )
    assert.ok(toSrc)
    // Paint by forward-mapping a dense grid of the unit square (crude, but it
    // is a fixture, not the algorithm under test).
    for (let i = 0; i <= 1200; i++) {
      for (let j = 0; j <= 1200; j++) {
        const u = i / 1200
        const v = j / 1200
        const [sx, sy] = applyHomography(toSrc, u, v)
        const x = Math.round(sx)
        const y = Math.round(sy)
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        const c = v < 0.5 ? (u < 0.5 ? RED : GREEN) : u < 0.5 ? WHITE : BLUE
        const o = (y * W + x) * 4
        data[o] = c[0]
        data[o + 1] = c[1]
        data[o + 2] = c[2]
        data[o + 3] = 255
      }
    }
    const out = rectifyImageData({ width: W, height: H, data }, trap, 40, 56)
    assert.ok(out)
    assert.deepEqual(at(out, 10, 14), RED)
    assert.deepEqual(at(out, 30, 14), GREEN)
    assert.deepEqual(at(out, 30, 42), BLUE)
    assert.deepEqual(at(out, 10, 42), WHITE)
  })

  it('returns null rather than warping through a degenerate quad', () => {
    const degenerate: Quad = [
      [10, 10],
      [10, 10],
      [10, 10],
      [10, 10],
    ]
    assert.equal(rectifyImageData(quadrantImage(), degenerate, 8, 8), null)
  })
})
