// THE WORKING-FRAME INVARIANT, enforced.
//
// Owner ruling, 2026-09-04: a display change — the photo window's height, the
// card list growing, the device rotating — must NEVER change what detection
// sees. Two failures had already traced back to that coupling, so the rule is
// not left to reviewer vigilance. This file is the enforcement, in three parts:
//
//   (a) a CONTRACT test: the canonical frame and reticle depend ONLY on the
//       camera stream's dimensions, and the reticle not even on those,
//   (b) an IMPORT FENCE: the frame-derivation modules may not import from the
//       UI/layout layer at all, so the dependency cannot be reintroduced,
//   (c) an exact ROUND-TRIP test of the canonical <-> stream mapping, since the
//       capture warp depends on it.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import {
  canonicalFrame,
  canonicalQuadToCrop,
  canonicalQuadToStream,
  CANONICAL_SIZE,
  DEFAULT_CARD_ASPECT,
  modelPointsToCanonicalQuad,
  PIPELINE_VERSION,
  reticleForAspect,
  RETICLE_MARGIN_FRAC,
  squareCrop,
  streamQuadToCanonical,
} from '../frame'
import { cardRectSize } from '../rectify'

const STREAMS: Array<[number, number]> = [
  [640, 750], // what the e2e drive's fake camera produced
  [1280, 960], // what getUserMedia is asked for
  [960, 1280], // the same device held portrait
  [1920, 1080],
  [480, 640], // the phase-0b corpus
  [720, 720], // already square
]

describe('working-frame invariant (a) — the frame is a pure function of the stream', () => {
  it('canonical dimensions never depend on anything but stream dimensions', () => {
    for (const [w, h] of STREAMS) {
      const f = canonicalFrame(w, h)
      assert.equal(f.width, CANONICAL_SIZE, `${w}x${h}`)
      assert.equal(f.height, CANONICAL_SIZE, `${w}x${h}`)
    }
  })

  it('the same stream always yields the same frame — it is a function, not a state', () => {
    for (const [w, h] of STREAMS) {
      assert.deepEqual(canonicalFrame(w, h), canonicalFrame(w, h))
      assert.deepEqual(squareCrop(w, h), squareCrop(w, h))
    }
  })

  it('the reticle is a CONSTANT of the square — no frame or layout input exists', () => {
    const r = reticleForAspect()
    // Height is the universal: the square minus both standardized margins.
    assert.ok(Math.abs(r.h - (1 - 2 * RETICLE_MARGIN_FRAC)) < 1e-12)
    assert.ok(Math.abs(r.y - RETICLE_MARGIN_FRAC) < 1e-12)
    // Width follows from the PER-GAME aspect, centred.
    assert.ok(Math.abs(r.w - r.h * DEFAULT_CARD_ASPECT) < 1e-12)
    assert.ok(Math.abs(r.x - (1 - r.w) / 2) < 1e-12)
    // `reticleForAspect` takes no frame, no box, no viewport — at most the one
    // per-game aspect. (`Function.length` stops at the first defaulted param, so
    // a fully-defaulted single argument reads as 0.)
    assert.ok(reticleForAspect.length <= 1, 'the reticle must depend only on the game aspect')
    // ...and it is genuinely constant for a given aspect.
    assert.deepEqual(reticleForAspect(), reticleForAspect())
  })

  it('a different game aspect changes only the WIDTH, never the margins', () => {
    const poke = reticleForAspect(DEFAULT_CARD_ASPECT)
    const wide = reticleForAspect(0.9) // a hypothetical squarer TCG
    assert.equal(poke.y, wide.y, 'the standardized margin is universal')
    assert.equal(poke.h, wide.h, 'reticle height is universal')
    assert.ok(wide.w > poke.w, 'a squarer card gets a wider reticle')
    // ...and the rectified output follows the same parameter.
    assert.ok(cardRectSize(0.9).height < cardRectSize(DEFAULT_CARD_ASPECT).height)
  })

  it('the centre-square crop is centred and maximal', () => {
    for (const [w, h] of STREAMS) {
      const c = squareCrop(w, h)
      assert.equal(c.size, Math.min(w, h), `${w}x${h}`)
      assert.ok(c.x >= 0 && c.y >= 0)
      assert.ok(c.x + c.size <= w && c.y + c.size <= h, `${w}x${h} crop escapes the stream`)
      // centred to within the rounding of an odd difference
      assert.ok(Math.abs((w - c.size) / 2 - c.x) <= 0.5)
      assert.ok(Math.abs((h - c.size) / 2 - c.y) <= 0.5)
    }
  })
})

describe('working-frame invariant (b) — the import fence', () => {
  // The dependency must be impossible, not merely absent today. Frame-derivation
  // modules may not reach into the UI layer, the router, or anything that knows
  // about layout; if one ever does, this fails by name.
  const ENGINE_DIR = path.join(import.meta.dirname, '..')
  const SCAN_DIR = path.join(ENGINE_DIR, '..')
  const FENCED = [
    'engine/frame.ts',
    'engine/preprocess.ts',
    'engine/geometry.ts',
    'engine/rectify.ts',
    'engine/tracker.ts',
    'engine/gate.ts',
    'engine/refine.ts',
    'engine/index.ts',
    // The labeler builds a working frame too, and it must obey the same rule —
    // a label whose frame depended on the editor's layout would be unusable as
    // training data for a detector that sees the canonical square.
    'labeler/workingFrame.ts',
    'labeler/detectSeed.ts',
  ].filter((f) => fs.existsSync(path.join(SCAN_DIR, f)))
  const FORBIDDEN = /from\s+['"]([^'"]*(?:\/ui\/|\.\.\/ui|routes\/|components\/|coords|CameraStage|QuadOverlay|react)[^'"]*)['"]/

  /**
   * The one allowed crossing, named rather than pattern-excused.
   *
   * `ui/engineLoader` is a DYNAMIC-IMPORT shim — it code-splits the detector
   * bundle and nothing else. It carries no size, no rect, no layout, and it is
   * what lets the labeler seed a quad from the real detector instead of
   * reimplementing one. The fence exists to keep DISPLAY GEOMETRY out of frame
   * derivation, and this module has none to leak; excluding it by exact name
   * keeps the rule sharp instead of loosening the pattern for everything under
   * `ui/`.
   */
  const ALLOWED = new Set(['../ui/engineLoader'])

  it('no frame-derivation module imports from the UI/layout layer', () => {
    assert.ok(FENCED.length >= 8, `expected the fenced module list to resolve, got ${FENCED.length}`)
    const offenders: string[] = []
    for (const file of FENCED) {
      const src = fs.readFileSync(path.join(SCAN_DIR, file), 'utf8')
      for (const line of src.split(/\r?\n/)) {
        // only real import/export-from statements, not prose in comments
        if (!/^\s*(?:import|export)\b[^\n]*\bfrom\s+['"]/.test(line)) continue
        const m = line.match(FORBIDDEN)
        if (m && !ALLOWED.has(m[1])) offenders.push(`${file}: ${m[1]}`)
      }
    }
    assert.deepEqual(offenders, [], `frame derivation must not depend on the display:\n${offenders.join('\n')}`)
  })

  it('the engine exposes no way to tell it about the display', () => {
    const src = fs.readFileSync(path.join(ENGINE_DIR, 'contract.ts'), 'utf8')
    // A DECLARATION, not a mention — the contract explains in prose why this
    // method no longer exists, and that explanation must not trip the fence.
    assert.ok(
      !/^\s*setViewport\s*\(/m.test(src),
      'ScanEngine must expose no setViewport: the display cannot inform frame derivation',
    )
    // and the invariant is written down where the next reader will find it
    assert.match(src, /working-frame invariant/i)
    assert.match(src, /2026-09-04/)
  })
})

describe('working-frame invariant (c) — canonical <-> stream round trip', () => {
  const q: Quad = [
    [12.5, 30.25],
    [380.75, 44],
    [366, 400.5],
    [30, 388.125],
  ]

  it('round-trips exactly for every stream shape', () => {
    for (const [w, h] of STREAMS) {
      const c = squareCrop(w, h)
      const back = streamQuadToCanonical(canonicalQuadToStream(q, c), c)
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(back[i][0] - q[i][0]) < 1e-9, `${w}x${h} x[${i}]`)
        assert.ok(Math.abs(back[i][1] - q[i][1]) < 1e-9, `${w}x${h} y[${i}]`)
      }
    }
  })

  it('the crop mapping is the stream mapping minus the crop offset', () => {
    for (const [w, h] of STREAMS) {
      const c = squareCrop(w, h)
      const inCrop = canonicalQuadToCrop(q, c)
      const inStream = canonicalQuadToStream(q, c)
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(inStream[i][0] - (inCrop[i][0] + c.x)) < 1e-9)
        assert.ok(Math.abs(inStream[i][1] - (inCrop[i][1] + c.y)) < 1e-9)
      }
    }
  })

  it('a full-resolution capture warps at SENSOR scale, not detection scale', () => {
    // 1280x960 -> a 960 crop, so one canonical pixel is 2.3 sensor pixels: the
    // whole reason capture() keeps the full-res buffer instead of the 416 one.
    const c = squareCrop(1280, 960)
    assert.equal(c.size, 960)
    const scaled = canonicalQuadToCrop(
      [
        [0, 0],
        [CANONICAL_SIZE, 0],
        [CANONICAL_SIZE, CANONICAL_SIZE],
        [0, CANONICAL_SIZE],
      ],
      c,
    )
    assert.ok(Math.abs(scaled[2][0] - 960) < 1e-9, 'the canonical square must map onto the whole crop')
    assert.ok(Math.abs(scaled[2][1] - 960) < 1e-9)
  })

  it('model output maps to canonical pixels with no letterbox to undo', () => {
    // A plain resize means a model fraction IS a canonical fraction.
    const pts = [0, 0, 1, 0, 1, 1, 0, 1]
    const quad = modelPointsToCanonicalQuad(pts)
    assert.ok(quad)
    assert.deepEqual(quad, [
      [0, 0],
      [CANONICAL_SIZE, 0],
      [CANONICAL_SIZE, CANONICAL_SIZE],
      [0, CANONICAL_SIZE],
    ])
    assert.equal(modelPointsToCanonicalQuad([0, 0, 1, 0]), null, 'a short point list must be refused')
    assert.equal(modelPointsToCanonicalQuad([0, 0, 1, 0, 1, 1, 0, NaN]), null, 'a non-finite point must be refused')
  })

  it('the pipeline version is stamped and ahead of the corpus era', () => {
    assert.equal(PIPELINE_VERSION, 3)
  })
})
