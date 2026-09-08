// The stage attribution, exercised against every branch — because the whole
// value of the sweep readout is that the stage it NAMES is the stage that
// actually stopped the frame. A readout that says "reticle" when the presence
// gate refused would send the reader off labelling the wrong population, and
// nothing about the picture on screen would give that away.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EngineState, Quad, TrackedQuad } from '../../engine/contract'
import { isNoteworthy, sweepVerdict } from '../sweep'

const QUAD: Quad = [
  [10, 10],
  [90, 12],
  [88, 130],
  [12, 128],
]

function track(id: number): TrackedQuad {
  return { id, quad: QUAD, age: 5, coasting: false, raw: QUAD }
}

/** A tick with nothing found. Every test overrides only what it is about, so a
 *  field a test does not mention is provably not what drove its assertion. */
function state(over: Partial<EngineState> = {}): EngineState {
  return {
    frame: { width: 416, height: 416 },
    stream: { width: 1280, height: 720 },
    reticle: { x: 0.15, y: 0.1, w: 0.7, h: 0.8 },
    hasObj: 0.02,
    observed: [],
    ungated: null,
    thresholds: {
      acquire: 0.8,
      hold: 0.3,
      minSaturation: 0.06,
      lockAspectTol: 0.28,
      lockParallelMin: 0.72,
      cardAspect: 0.71591,
    },
    stable: [],
    pending: [],
    locked: null,
    saturation: null,
    perf: { detectMs: 21, hz: 8, jitterPx: 0.4 },
    ...over,
  }
}

test('an empty tick is `none` — the detector being right is not training data', () => {
  const v = sweepVerdict(state())
  assert.equal(v.stage, 'none')
  assert.equal(v.rejectedBy, 'no-quad')
  assert.equal(isNoteworthy(v), false)
})

test('corners the presence gate refused are a NEAR MISS, not nothing', () => {
  // The room-sweep row the whole mode exists for: the model does think
  // something card-like is there and was not confident enough to say so.
  const v = sweepVerdict(state({ ungated: QUAD, hasObj: 0.42 }))
  assert.equal(v.stage, 'proposed')
  assert.equal(v.rejectedBy, 'presence-gate')
  assert.equal(v.hasObj, 0.42)
  assert.equal(v.acquire, 0.8, 'the threshold travels with the value it judged')
  assert.equal(isNoteworthy(v), true)
})

test('through the gate but tracked by nothing is the RETICLE, not the detector', () => {
  const v = sweepVerdict(state({ ungated: QUAD, observed: [QUAD], hasObj: 0.93 }))
  assert.equal(v.stage, 'gated')
  assert.equal(v.rejectedBy, 'reticle')
  assert.equal(v.observed, 1)
  assert.equal(v.tracked, 0)
})

test('a live track that has not locked is attributed to the LOCK policy', () => {
  const v = sweepVerdict(
    state({ ungated: QUAD, observed: [QUAD], hasObj: 0.97, stable: [track(1)], saturation: 0.03 }),
  )
  assert.equal(v.stage, 'tracked')
  assert.equal(v.rejectedBy, 'lock')
  assert.equal(v.tracked, 1)
  assert.equal(v.saturation, 0.03)
  assert.equal(v.minSaturation, 0.06, 'so the reader can see it is the saturation floor')
})

test('a pending-only tick still counts as tracked — the product is drawing it', () => {
  const v = sweepVerdict(state({ ungated: QUAD, observed: [QUAD], pending: [track(2)] }))
  assert.equal(v.stage, 'tracked')
  assert.equal(v.tracked, 1)
})

test('a lock is the end of the line — nothing rejected it', () => {
  const t = track(3)
  const v = sweepVerdict(state({ ungated: QUAD, observed: [QUAD], stable: [t], locked: t, saturation: 0.31 }))
  assert.equal(v.stage, 'locked')
  assert.equal(v.rejectedBy, null)
  assert.equal(isNoteworthy(v), true)
})

test('the stages are attributed to the FIRST thing that could have stopped it', () => {
  // A tick that satisfies several branches at once must not be reported by the
  // weakest of them. Tracked + observed + ungated is `tracked`, never `gated`.
  const t = track(4)
  assert.equal(sweepVerdict(state({ ungated: QUAD, observed: [QUAD], stable: [t] })).stage, 'tracked')
  // ...and observed + ungated is `gated`, never `proposed`.
  assert.equal(sweepVerdict(state({ ungated: QUAD, observed: [QUAD] })).stage, 'gated')
})

test('thresholds are read from the engine, never re-imported', () => {
  // The guarantee that makes a recorded row survive a re-tune: change the
  // engine's numbers and the verdict follows, with no edit here.
  const v = sweepVerdict(
    state({
      ungated: QUAD,
      hasObj: 0.55,
      thresholds: {
        acquire: 0.5,
        hold: 0.2,
        minSaturation: 0.2,
        lockAspectTol: 0.3,
        lockParallelMin: 0.6,
        cardAspect: 0.7,
      },
    }),
  )
  assert.equal(v.acquire, 0.5)
  assert.equal(v.hold, 0.2)
  assert.equal(v.minSaturation, 0.2)
})
