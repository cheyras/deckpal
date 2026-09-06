// Run: node --import tsx --test src/scan/labeler/__tests__/*.test.ts
//
// THE SAVED ROW — what actually reaches the corpus, and what a harvest reads
// back out of it months from now.
//
// saveLabel.ts posts `{ type: 'quad-label', ...label }` through `api.scanFlag`,
// so a label is JSON on the wire and nothing more: no class survives the trip,
// no method comes back. Every guarantee this file makes is therefore made
// against a round-tripped PLAIN OBJECT rather than the in-memory value, because
// that is the only thing the training harvest will ever hold.
//
// The corpus already contains schema-1 rows. Nothing here is allowed to make
// them unreadable — the version field exists precisely so the harvest can MIX
// the two rather than choose.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import type { Quad } from '../../engine/contract'
import { orientedCorners, type TopLeftIndex } from '../orientation'
import {
  LABEL_SCHEMA_VERSION,
  labelSchemaOf,
  migrateLegacyReason,
  type LegacyInvalidReason,
  type NegativeQuadLabel,
  type PositiveQuadLabel,
  type QuadLabel,
} from '../types'

const CORNERS: Quad = [
  [0.2, 0.1],
  [0.8, 0.1],
  [0.8, 0.9],
  [0.2, 0.9],
]

const PIPELINE = { pipelineVersion: 3, canonicalSize: 416, model: 'lc050' }

function positive(over: Partial<PositiveQuadLabel> = {}): PositiveQuadLabel {
  return {
    labelSchema: LABEL_SCHEMA_VERSION,
    dims: { width: 416, height: 416 },
    source: 'upload',
    seededFrom: 'detector',
    pipeline: PIPELINE,
    savedAt: '2026-09-06T12:00:00.000Z',
    corners: CORNERS,
    topLeftIndex: 0,
    seededTopLeftIndex: 0,
    face: 'front',
    ...over,
  }
}

function negative(over: Partial<NegativeQuadLabel> = {}): NegativeQuadLabel {
  return {
    labelSchema: LABEL_SCHEMA_VERSION,
    dims: { width: 416, height: 416 },
    source: 'camera',
    seededFrom: 'default',
    pipeline: PIPELINE,
    savedAt: '2026-09-06T12:00:00.000Z',
    corners: null,
    invalidReason: 'not_a_card',
    ...over,
  }
}

/** What `saveLabel` actually hands `api.scanFlag`, then what comes back out of
 *  storage: JSON, and only JSON. */
function overTheWire(label: QuadLabel): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ type: 'quad-label', ...label })) as Record<string, unknown>
}

describe('the schema version is on every row', () => {
  it('stamps version 2 on a positive AND a negative', () => {
    assert.equal(overTheWire(positive()).labelSchema, 2)
    assert.equal(overTheWire(negative()).labelSchema, 2)
    assert.equal(LABEL_SCHEMA_VERSION, 2)
  })

  it('reads an ABSENT version as 1 — absence is what a v1 row looks like', () => {
    // The field did not exist on 2026-09-04, so a v1 row carries no key at all.
    // Defaulting to the current number instead would silently claim orientation
    // and face data that is not there.
    assert.equal(labelSchemaOf({}), 1)
    assert.equal(labelSchemaOf({ labelSchema: 2 }), 2)
  })

  it('keeps the row a quad-label, distinguishable in the shared flags bucket', () => {
    // /dev/scan-flags also holds live-camera flags and the product scanner's
    // own reports. `type` is what separates them.
    assert.equal(overTheWire(positive()).type, 'quad-label')
  })
})

describe('a positive round-trips with its orientation intact', () => {
  it('carries corners, the anchor, and the seed the anchor was judged against', () => {
    const row = overTheWire(positive({ topLeftIndex: 2, seededTopLeftIndex: 1 }))
    assert.deepEqual(row.corners, CORNERS)
    assert.equal(row.topLeftIndex, 2)
    assert.equal(row.seededTopLeftIndex, 1)
    assert.equal(row.face, 'front')
  })

  it('lets the harvest recover the CARD order from the wire form alone', () => {
    // The whole point of storing an index rather than reordering: the detector's
    // own corner order survives verbatim for anyone diffing against it, and the
    // card order is one function call away.
    const row = overTheWire(positive({ topLeftIndex: 1 }))
    const ordered = orientedCorners(row.corners as Quad, row.topLeftIndex as TopLeftIndex)
    assert.deepEqual(ordered[0], CORNERS[1])
    assert.deepEqual(ordered, orientedCorners(CORNERS, 1))
  })

  it('records disagreement with production as two separate numbers', () => {
    // `topLeftIndex !== seededTopLeftIndex` is the live re-measurement of
    // rectify.ts's ~7 % orientation residual, on real frames, for free.
    const agreed = overTheWire(positive({ topLeftIndex: 0, seededTopLeftIndex: 0 }))
    const corrected = overTheWire(positive({ topLeftIndex: 3, seededTopLeftIndex: 0 }))
    assert.equal(agreed.topLeftIndex === agreed.seededTopLeftIndex, true)
    assert.equal(corrected.topLeftIndex === corrected.seededTopLeftIndex, false)
  })

  it('survives an anchor of 0 without being mistaken for missing', () => {
    // Index 0 is falsy. Any harvest written as `row.topLeftIndex || ...` would
    // silently rewrite the most common answer; this pins that the key is
    // present and the value is the number zero.
    const row = overTheWire(positive({ topLeftIndex: 0 }))
    assert.equal(Object.hasOwn(row, 'topLeftIndex'), true)
    assert.equal(row.topLeftIndex, 0)
  })
})

describe('a card back is a positive, not a rejection', () => {
  it('keeps its quad and its anchor, and adds only the face', () => {
    // One label, two trainings: the detector learns backs are quaddable cards,
    // the classifier learns to say "flip the card" instead of spending an
    // identify round-trip on one. The owner's sessions caught three.
    const row = overTheWire(positive({ face: 'back' }))
    assert.equal(row.face, 'back')
    assert.deepEqual(row.corners, CORNERS)
    assert.equal(row.topLeftIndex, 0)
    assert.equal(Object.hasOwn(row, 'invalidReason'), false, 'a back is not invalid')
  })

  it('is the ONLY thing that distinguishes it from a front', () => {
    const front = overTheWire(positive({ face: 'front' }))
    const back = overTheWire(positive({ face: 'back' }))
    const differing = Object.keys(back).filter((k) => JSON.stringify(back[k]) !== JSON.stringify(front[k]))
    assert.deepEqual(differing, ['face'])
  })
})

describe('a negative round-trips with its reason and no quad', () => {
  it('carries a null quad and the reason, never an inferred degenerate quad', () => {
    const row = overTheWire(negative({ invalidReason: 'too_far' }))
    assert.equal(row.corners, null)
    assert.equal(row.invalidReason, 'too_far')
  })

  it('carries NO orientation — a frame with no quad has no top-left to name', () => {
    const row = overTheWire(negative())
    assert.equal(Object.hasOwn(row, 'topLeftIndex'), false)
    assert.equal(Object.hasOwn(row, 'face'), false)
  })
})

describe('mixing schema 1 and schema 2 in one harvest', () => {
  /**
   * A row AS THE HARVEST SEES IT — every field the two schema versions can
   * carry, and the version-2 additions optional, because on a version-1 row
   * they are simply not there. Writing the fixture at this type is the point:
   * it is the shape any real harvest reader has to be written against.
   */
  interface HarvestedRow {
    type: string
    dims: { width: number; height: number }
    source: string
    seededFrom: string
    pipeline: typeof PIPELINE
    savedAt: string
    corners: Quad | null
    invalidReason?: string
    labelSchema?: number
    topLeftIndex?: number
    seededTopLeftIndex?: number
    face?: string
  }

  /** A row exactly as the 2026-09-04 build wrote it: no version, no anchor, no
   *  face, and one of the three old reasons. */
  const V1_REASON: LegacyInvalidReason = 'multiple_cards'

  const V1_NEGATIVE: HarvestedRow = {
    type: 'quad-label',
    dims: { width: 416, height: 416 },
    source: 'camera',
    seededFrom: 'detector',
    pipeline: PIPELINE,
    savedAt: '2026-09-04T09:00:00.000Z',
    corners: null,
    invalidReason: V1_REASON,
  }

  const V1_POSITIVE: HarvestedRow = {
    type: 'quad-label',
    dims: { width: 416, height: 416 },
    source: 'upload',
    seededFrom: 'detector',
    pipeline: PIPELINE,
    savedAt: '2026-09-04T09:00:00.000Z',
    corners: CORNERS,
  }

  it('recognises a v1 row and maps its reason forward', () => {
    assert.equal(labelSchemaOf(V1_NEGATIVE), 1)
    assert.equal(migrateLegacyReason(V1_REASON), 'multiple_no_clear_foreground')
  })

  it('keeps a v1 POSITIVE usable for the quad head — it just says nothing about orientation', () => {
    assert.equal(labelSchemaOf(V1_POSITIVE), 1)
    assert.deepEqual(V1_POSITIVE.corners, CORNERS)
    assert.equal(Object.hasOwn(V1_POSITIVE, 'topLeftIndex'), false)
  })

  it('treats a missing anchor as UNKNOWN, never as index 0', () => {
    // The difference matters: index 0 is a claim, and it would be right roughly
    // as often as production's own guess — i.e. wrong on exactly the frames the
    // orientation head exists to learn.
    const anchorOf = (row: { topLeftIndex?: number }) => (Object.hasOwn(row, 'topLeftIndex') ? row.topLeftIndex : null)
    assert.equal(anchorOf(V1_POSITIVE), null)
    assert.equal(anchorOf(overTheWire(positive()) as unknown as HarvestedRow), 0)
  })

  it('treats a missing face as UNKNOWN, never as front', () => {
    // v1 had no way to say "back", and the owner's sessions contain three that
    // were saved as plain positives. Defaulting to 'front' would feed the face
    // head a handful of confidently wrong labels.
    assert.equal(Object.hasOwn(V1_POSITIVE, 'face'), false)
  })
})

describe('the seed pre-assigns the anchor on EVERY path', () => {
  // detectSeed.ts cannot be imported here — it pulls the engine loader and the
  // ONNX session, which need a browser. So the invariant is fenced at the
  // source: there are three ways out of `seedQuad` (detector hit, detector
  // miss, and the captureStream/exception fallbacks), and every one of them
  // must go through the single helper that assigns the anchor. A hand-built
  // SeedResult on any path would ship the editor an anchor of `undefined`.
  const SRC = readFileSync(fileURLToPath(new URL('../detectSeed.ts', import.meta.url)), 'utf8')

  it('declares topLeftIndex on SeedResult', () => {
    assert.match(SRC, /topLeftIndex: TopLeftIndex/)
  })

  it('assigns it from the production geometric rule, in exactly one place', () => {
    const assignments = SRC.match(/topLeftIndex: seedTopLeftIndex\(/g) ?? []
    assert.equal(assignments.length, 1)
    assert.match(SRC, /import \{ seedTopLeftIndex/)
  })

  it('builds NO SeedResult by hand — every return goes through the helper', () => {
    // A literal `seededFrom: 'detector'` anywhere outside the helper means some
    // path is constructing the result itself, and has therefore skipped the
    // anchor.
    const handBuilt = SRC.match(/seededFrom: '(detector|default)'/g) ?? []
    assert.deepEqual(handBuilt, [], `hand-built SeedResult(s) found: ${handBuilt.join(', ')}`)
    assert.ok((SRC.match(/\bseeded\(/g) ?? []).length >= 4, 'helper definition plus every return path')
  })
})
