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
// The harvest-time inverse map is the SHIPPING one, not a copy of it — a row's
// `stream`/`crop` are only useful if they feed the engine's own function.
import { CANONICAL_SIZE, canonicalToStream, squareCrop } from '../../engine/frame'
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
  // detectSeed.ts cannot be imported here — it pulls the ONNX session and a
  // canvas, which need a browser. So the invariant is fenced at the source:
  // there are several ways out of `seedQuad` (a detector hit, a detector miss,
  // a model that would not load, an expired budget, an exception), and every
  // one of them must go through the single helper that assigns the anchor. A
  // hand-built SeedResult on any path would ship the editor an anchor of
  // `undefined`.
  const RAW = readFileSync(fileURLToPath(new URL('../detectSeed.ts', import.meta.url)), 'utf8')

  /**
   * CODE ONLY — comments stripped before any scan below runs.
   *
   * The file's header quotes rounds 9/9b/9c verbatim, and those rounds are a
   * story about rows that came back `seededFrom: 'default'`, so the phrase this
   * suite hunts for appears legitimately in prose several times. Scanning the
   * raw text made the suite fail on a documentation change, which is the exact
   * opposite of what it is for: it exists to notice a RETURN PATH that skipped
   * the helper.
   */
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('declares topLeftIndex on SeedResult', () => {
    assert.match(SRC, /topLeftIndex: TopLeftIndex/)
  })

  it('assigns it from the production geometric rule, in exactly one place', () => {
    const assignments = SRC.match(/topLeftIndex: seedTopLeftIndex\(/g) ?? []
    assert.equal(assignments.length, 1)
    assert.match(RAW, /import \{ seedTopLeftIndex/)
  })

  it('builds NO SeedResult by hand — every return goes through the helper', () => {
    // A literal `seededFrom:` anywhere in the CODE outside the helper means
    // some path is constructing the result itself, and has therefore skipped
    // the anchor.
    const handBuilt = SRC.match(/seededFrom: '(detector|default)'/g) ?? []
    assert.deepEqual(handBuilt, [], `hand-built SeedResult(s) found: ${handBuilt.join(', ')}`)
  })

  it('funnels every fallback through ONE place, which itself calls the helper', () => {
    // The fallback paths are consolidated behind `fell(...)`, so there are
    // exactly three occurrences of `seeded(`: its own definition, the fallback
    // helper, and the one success return. A fourth is a fourth way out.
    assert.equal((SRC.match(/\bseeded\(/g) ?? []).length, 3)
    assert.match(SRC, /const fell = \(why: SeedFallback[\s\S]*?seeded\(normalize\(fallbackQuad\(\)\)/)
  })

  it('bounds every await — no path can hang the editor open', () => {
    // Round 9b's defect was one unbounded `await video.play()` with every
    // ceiling downstream of it, in a file whose sibling `scan/ui/deadline.ts`
    // opens with the rule it broke: NOTHING on the capture path may await
    // something that has no worst case. Both awaits that can block are now
    // raced against the seed budget...
    assert.match(SRC, /within\(loadModel\(\), SEED_BUDGET_MS\)/)
    assert.match(SRC, /within\(session\.run\(input\)/)
    // ...and the transport that could not be bounded is gone entirely.
    assert.equal(
      /captureStream|\.play\(\)|createElement\('video'\)/.test(SRC),
      false,
      'the canvas-captureStream video bridge must not come back',
    )
  })
})

describe('a row says WHY it fell back, and where its pixels came from', () => {
  // The 2026-09-07 additions. Both exist because round 9's corpus could not
  // answer a question a training run has to ask.
  const PIPELINE_V2 = { ...PIPELINE, seedAcquireThreshold: 0.8 }

  it('tells a detector MISS from a detector that never ran', () => {
    // Both are `seededFrom: 'default'` and they mean opposite things. A miss is
    // signal about a real frame — paired with a human positive it is the most
    // valuable row in the set. "Never ran" is a note about the rig, and must
    // never be mined as a miss.
    const miss = overTheWire(
      positive({ seededFrom: 'default', pipeline: { ...PIPELINE_V2, hasObj: 0.17, seedFallback: 'no_object' } }),
    )
    const broken = overTheWire(
      positive({ seededFrom: 'default', pipeline: { ...PIPELINE_V2, seedFallback: 'unavailable' } }),
    )
    assert.equal(miss.seededFrom, broken.seededFrom)
    assert.notEqual(
      (miss.pipeline as Record<string, unknown>).seedFallback,
      (broken.pipeline as Record<string, unknown>).seedFallback,
    )
    assert.equal(Object.hasOwn(broken.pipeline as object, 'hasObj'), false, 'a model that never ran has no reading')
  })

  it('leaves a pre-2026-09-07 `default` row readable as NEITHER — deliberately', () => {
    // Every `default` row from rounds 9-9c is `unavailable` in fact (the
    // captureStream transport never delivered a frame to the engine) and
    // carries no field saying so. Absence must therefore read as UNKNOWN,
    // exactly like a missing `face`.
    const old = overTheWire(negative({ seededFrom: 'default', pipeline: PIPELINE }))
    assert.equal(Object.hasOwn(old.pipeline as object, 'seedFallback'), false)
  })

  it('records the threshold the reading was judged against, not just the reading', () => {
    // gate.ts's DEFAULT_ACQUIRE is tunable. Storing the value in force at
    // labelling time means a later re-tune cannot retroactively change what a
    // recorded row claimed.
    const row = overTheWire(positive({ pipeline: { ...PIPELINE_V2, hasObj: 0.99 } }))
    const p = row.pipeline as Record<string, number>
    assert.equal(p.seedAcquireThreshold, 0.8)
    assert.ok(p.hasObj >= p.seedAcquireThreshold, 'a detector seed cleared its own gate')
  })

  it('maps a corner back to a pixel in the ORIGINAL photo', () => {
    // The single most important thing a training run does with one of these
    // rows, and it was impossible before `stream`/`crop`: `dims` is always the
    // canonical square, so every row looked like a 416x416 photo.
    //
    // The mapping is not re-implemented here — it is `engine/frame.ts`'s own
    // `canonicalToStream`, the function the shipping pipeline uses, fed
    // straight from the recorded fields.
    const row = overTheWire(
      positive({ stream: { width: 4032, height: 3024 }, crop: { x: 504, y: 0, size: 3024 } }),
    )
    const stream = row.stream as { width: number; height: number }
    const crop = row.crop as { x: number; y: number; size: number }
    assert.deepEqual(crop, squareCrop(stream.width, stream.height), 'the recorded crop IS the engine’s own')

    const corners = row.corners as Quad
    const [px, py] = canonicalToStream([corners[0][0] * CANONICAL_SIZE, corners[0][1] * CANONICAL_SIZE], crop)
    // CORNERS[0] is (0.2, 0.1) of the square: 504 + 0.2*3024, and 0 + 0.1*3024.
    assert.equal(Math.round(px), 1109)
    assert.equal(Math.round(py), 302)
    assert.ok(px >= 0 && px <= stream.width && py >= 0 && py <= stream.height, 'inside the source photo')
  })

  it('is ABSENT on the schema-2 rows recorded before it existed', () => {
    // Six rows exist at schema 2 from 2026-09-06 with no provenance at all.
    // They stay perfectly good quad-regression examples; they simply cannot be
    // weighted by source resolution, and the schema number does not move for
    // an addition that changes provenance rather than meaning.
    const older = overTheWire({ ...positive(), stream: undefined, crop: undefined })
    assert.equal(older.stream, undefined)
    assert.equal(older.crop, undefined)
    assert.equal(older.labelSchema, 2)
  })
})
