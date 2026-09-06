// Run: node --import tsx --test src/scan/labeler/__tests__/*.test.ts
//
// THE ORIENTATION ANCHOR — the assignment a quad cannot carry on its own.
//
// scan/engine/rectify.ts states its own limit in its header: the corner order
// it produces "assumes roughly upright and breaks past 45 degrees, by
// construction", and three of the owner's 42 session-1 captures came back a
// quarter turn wrong for exactly that reason. Geometry cannot fix it; a human
// can, in one tap. This file pins the tap.
//
// What is being defended here is mostly ARITHMETIC ABOUT WINDING, which is
// where an anchor-index design goes wrong quietly: get it backwards and the
// rotate button walks the marker anticlockwise on half the frames, and — far
// worse — `orientedCorners` silently hands the trainer a top-RIGHT corner
// labelled top-left. Both windings are therefore asserted for every operation.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../../engine/contract'
import {
  assignTopLeft,
  isTopLeftIndex,
  orientedCorners,
  quadWinding,
  rotateTopLeft,
  seedAgreed,
  seedTopLeftIndex,
  TOP_LEFT_INDICES,
  type TopLeftIndex,
} from '../orientation'

/** An upright card, corners clockwise on screen from the top-left. Normalized
 *  canonical-square space, which is what a real seed is in. */
const UPRIGHT_CW: Quad = [
  [0.2, 0.1],
  [0.8, 0.1],
  [0.8, 0.9],
  [0.2, 0.9],
]

/** The same four points, listed the other way round. */
const UPRIGHT_CCW: Quad = [
  [0.2, 0.1],
  [0.2, 0.9],
  [0.8, 0.9],
  [0.8, 0.1],
]

/** A card lying on its side — rotated ~90 degrees clockwise in frame, so the
 *  CARD's top-left is at the frame's BOTTOM-left. This is the shape of all
 *  three captures rectify.ts measured as broken (true top edges at 92, 108,
 *  125 degrees). */
const SIDEWAYS_CW: Quad = [
  [0.1, 0.8], // card top-left
  [0.1, 0.2], // card top-right
  [0.9, 0.2], // card bottom-right
  [0.9, 0.8], // card bottom-left
]

describe('winding, in image coordinates (y grows down)', () => {
  it('reads a clockwise-on-screen array as clockwise', () => {
    assert.equal(quadWinding(UPRIGHT_CW), 'cw')
    assert.equal(quadWinding(SIDEWAYS_CW), 'cw')
  })

  it('reads the reversed array as counter-clockwise', () => {
    assert.equal(quadWinding(UPRIGHT_CCW), 'ccw')
  })

  it('does not throw on a degenerate quad mid-drag', () => {
    // A reader can collapse three corners onto each other while dragging. The
    // marker still has to go somewhere; refusing to answer would blow up the
    // editor's own render path.
    const collapsed: Quad = [
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
    ]
    assert.equal(quadWinding(collapsed), 'cw')
  })
})

describe('the seed pre-assignment', () => {
  it('picks the corner nearest the FRAME top-left — production rule 3, verbatim', () => {
    // orderQuadForCard's rule 3 is "start at the corner nearest the frame's
    // top-left". Reproducing it means the reader is confirming or
    // contradicting PRODUCTION, not answering an unrelated question.
    assert.equal(seedTopLeftIndex(UPRIGHT_CW), 0)
    assert.equal(seedTopLeftIndex(UPRIGHT_CCW), 0)
  })

  it('is unaffected by which corner the array happens to start at', () => {
    const rotatedArray: Quad = [UPRIGHT_CW[2], UPRIGHT_CW[3], UPRIGHT_CW[0], UPRIGHT_CW[1]]
    assert.equal(seedTopLeftIndex(rotatedArray), 2)
  })

  it('GETS THE SIDEWAYS CARD WRONG — and that is the point', () => {
    // The seed guesses index 1 (nearest the frame origin), but the card's own
    // top-left is index 0. This is precisely the 7.1 % rectify.ts documents and
    // cannot repair from geometry; the label exists to capture the correction.
    assert.equal(seedTopLeftIndex(SIDEWAYS_CW), 1)
    assert.notEqual(seedTopLeftIndex(SIDEWAYS_CW), 0)
  })

  it('always answers with a legal index', () => {
    for (const q of [UPRIGHT_CW, UPRIGHT_CCW, SIDEWAYS_CW]) {
      assert.ok(isTopLeftIndex(seedTopLeftIndex(q)))
    }
  })
})

describe('rotate cycling — the one-tap correction', () => {
  it('walks the anchor CLOCKWISE ON SCREEN whichever way the array winds', () => {
    // The reader's promise is about the screen, not the array. A cw array
    // advances the index; a ccw array must retreat it to move the same way.
    assert.equal(rotateTopLeft(UPRIGHT_CW, 0), 1)
    assert.equal(rotateTopLeft(UPRIGHT_CCW, 0), 3)
  })

  it('returns to where it started after four taps, both windings', () => {
    for (const quad of [UPRIGHT_CW, UPRIGHT_CCW]) {
      for (const start of TOP_LEFT_INDICES) {
        let tl: TopLeftIndex = start
        const seen = new Set<TopLeftIndex>()
        for (let i = 0; i < 4; i += 1) {
          seen.add(tl)
          tl = rotateTopLeft(quad, tl)
        }
        assert.equal(tl, start, 'four quarter turns is identity')
        assert.equal(seen.size, 4, 'and it visits every corner exactly once on the way')
      }
    }
  })

  it('never leaves the legal range, for any step count', () => {
    for (const steps of [-9, -4, -1, 0, 1, 2, 3, 4, 7, 13]) {
      assert.ok(isTopLeftIndex(rotateTopLeft(UPRIGHT_CW, 2, steps)), `steps=${steps}`)
      assert.ok(isTopLeftIndex(rotateTopLeft(UPRIGHT_CCW, 2, steps)), `steps=${steps}`)
    }
  })

  it('reverses cleanly, so a reader who overshoots can step back', () => {
    assert.equal(rotateTopLeft(UPRIGHT_CW, rotateTopLeft(UPRIGHT_CW, 3), -1), 3)
  })

  it('FIXES THE SIDEWAYS CARD IN ONE TAP from the seed', () => {
    // Seed says 1, truth is 0, and the array winds clockwise — so one
    // anticlockwise step. The common failure is a quarter turn either way,
    // which is why rotate is the primary control: at most one tap, usually
    // zero.
    assert.equal(rotateTopLeft(SIDEWAYS_CW, seedTopLeftIndex(SIDEWAYS_CW), -1), 0)
  })
})

describe('direct assignment — the tap on a corner marker', () => {
  it('takes the corner the reader named', () => {
    for (const i of TOP_LEFT_INDICES) assert.equal(assignTopLeft(i), i)
  })

  it('REFUSES an out-of-range index rather than poisoning a training row', () => {
    // There are exactly four legal answers. A fifth would ride into the corpus
    // as a silently wrong orientation, which is worse than no orientation.
    for (const bad of [-1, 4, 1.5, NaN]) {
      assert.throws(() => assignTopLeft(bad), RangeError, `assignTopLeft(${bad})`)
    }
  })

  it('reaches a two-turn corner in one tap, where rotate would take two', () => {
    // This is the whole reason "Set top-left" survives beside the rotate
    // button: an upside-down card is the opposite corner, and naming it beats
    // tapping rotate twice.
    assert.equal(assignTopLeft(2), 2)
    assert.equal(rotateTopLeft(UPRIGHT_CW, rotateTopLeft(UPRIGHT_CW, 0), 1), 2)
  })
})

describe('orientedCorners — how the trainer reads the label back', () => {
  it('returns the CARD as [TL, TR, BR, BL] from a clockwise array', () => {
    assert.deepEqual(orientedCorners(UPRIGHT_CW, 0), UPRIGHT_CW)
  })

  it('walks a counter-clockwise array BACKWARDS to get the same card order', () => {
    // Both arrays describe the same rectangle. Read correctly, both must yield
    // the same [TL, TR, BR, BL] — if this ever walked ccw forwards, the trainer
    // would be handed the top-right corner labelled top-left on half the corpus.
    assert.deepEqual(orientedCorners(UPRIGHT_CCW, 0), UPRIGHT_CW)
  })

  it('recovers an upright card from the sideways frame once the human has spoken', () => {
    const ordered = orientedCorners(SIDEWAYS_CW, 0)
    const [tl, tr, br, bl] = ordered
    // The card's top edge is its 63mm width and its side is its 88mm height —
    // so in this frame the top edge is the SHORTER projected side. Geometry
    // alone could not tell; the anchor did.
    const topLen = Math.hypot(tr[0] - tl[0], tr[1] - tl[1])
    const sideLen = Math.hypot(bl[0] - tl[0], bl[1] - tl[1])
    assert.ok(topLen < sideLen, `top ${topLen} should be shorter than side ${sideLen}`)
    assert.deepEqual(br, SIDEWAYS_CW[2])
  })

  it('is a permutation of the input — it never invents or drops a point', () => {
    for (const quad of [UPRIGHT_CW, UPRIGHT_CCW, SIDEWAYS_CW]) {
      for (const tl of TOP_LEFT_INDICES) {
        const out = orientedCorners(quad, tl)
        assert.equal(out.length, 4)
        assert.deepEqual(out[0], quad[tl], 'element 0 is always the anchor itself')
        assert.deepEqual([...out].sort(), [...quad].sort())
      }
    }
  })

  it('four rotations of the anchor give four distinct readings', () => {
    const readings = TOP_LEFT_INDICES.map((tl) => JSON.stringify(orientedCorners(UPRIGHT_CW, tl)))
    assert.equal(new Set(readings).size, 4)
  })
})

describe('seedAgreed — the residual, re-measured continuously', () => {
  it('is true when the reader left production alone', () => {
    assert.equal(seedAgreed(0, 0), true)
  })

  it('is false on exactly the frames production would have rectified wrong', () => {
    assert.equal(seedAgreed(seedTopLeftIndex(SIDEWAYS_CW), 0), false)
  })
})
