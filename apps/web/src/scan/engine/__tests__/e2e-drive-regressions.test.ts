// Regressions for the three defects the 2026-09-04 fake-camera e2e drive proved
// on the DEPLOYED build, fenced against the drive's own harvested artifacts
// rather than against synthetic stand-ins.
//
// Source of truth: p2-work/e2e-drive/E2E-REPORT.md and harvest-run1/events.json
// — 13 capture-events recorded by the product itself, each carrying the frame
// dimensions and the exact quad the engine used.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

import type { Quad, TrackedQuad } from '../contract'
import { oppositeSideRatio, polyIoU, quadAspectRatio } from '../geometry'
import { createLockPolicy, DEFAULT_LOCK_PARALLEL_MIN, isCardShaped, isSingleCardShaped } from '../index'
import { orderQuadForCard } from '../rectify'
import { createTracker } from '../tracker'
import { reticleForAspect, CANONICAL_SIZE } from '../frame'

const HARVEST =
  'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/e2e-drive/harvest-run1/events.json'

interface CaptureEvent {
  id: number
  type: string
  quad: Quad
  trackId: number
  epochMs: number
}

function driveCaptures(): CaptureEvent[] {
  if (!fs.existsSync(HARVEST)) return []
  const raw = JSON.parse(fs.readFileSync(HARVEST, 'utf8'))
  const all: CaptureEvent[] = Array.isArray(raw) ? raw : Object.values(raw)
  return all.filter((e) => e.type === 'capture-event')
}

/** The hand verdicts from E2E-REPORT.md §5, in capture order. */
const VERDICTS = ['BAD', 'GOOD', 'GOOD', 'PARTIAL', 'BAD', 'BAD', 'GOOD', 'GOOD', 'GOOD', 'PARTIAL', 'BAD', 'BAD', 'GOOD']

const CAPTURES = driveCaptures()
const haveDrive = CAPTURES.length === 13

describe('e2e drive — rectified crops were rotated 90 degrees (13/13)', () => {
  it('the drive artifacts are present and complete', () => {
    assert.ok(haveDrive, `expected 13 harvested capture-events, found ${CAPTURES.length} (${HARVEST})`)
  })

  it('THE FIX: side 0->1 of the ordered quad is the quad\'s TOP edge, on every real capture', {
    skip: haveDrive ? false : 'drive artifacts unavailable',
  }, () => {
    const wrong: string[] = []
    for (const c of CAPTURES) {
      const ordered = orderQuadForCard(c.quad)
      assert.ok(ordered, `${c.id}: quad should be orderable`)
      // The quad's true top edge = the two corners with the smallest y.
      const byY = [...c.quad].sort((a, b) => a[1] - b[1])
      const top = new Set([byY[0].join(','), byY[1].join(',')])
      if (!(top.has(ordered[0].join(',')) && top.has(ordered[1].join(',')))) wrong.push(String(c.id))
    }
    assert.deepEqual(wrong, [], `these captures still map a non-top edge onto the output's width: ${wrong.join(', ')}`)
  })

  it('the ordered corners run clockwise on screen, so 0,1,2,3 is TL,TR,BR,BL', {
    skip: haveDrive ? false : 'drive artifacts unavailable',
  }, () => {
    for (const c of CAPTURES) {
      const o = orderQuadForCard(c.quad)!
      let a2 = 0
      for (let i = 0; i < 4; i++) a2 += o[i][0] * o[(i + 1) % 4][1] - o[(i + 1) % 4][0] * o[i][1]
      assert.ok(a2 > 0, `${c.id}: ordered quad should wind clockwise in y-down coordinates`)
      // TL is left of TR, and BL is below TL — the definition of the labels.
      assert.ok(o[0][0] < o[1][0] || Math.abs(o[0][0] - o[1][0]) < 1e-9, `${c.id}: TL should not be right of TR`)
      assert.ok(o[3][1] > o[0][1] || Math.abs(o[3][1] - o[0][1]) < 1e-9, `${c.id}: BL should not be above TL`)
    }
  })

  it('SHIPPED BEHAVIOUR: a short-projected-side rule turns a foreshortened card', () => {
    // The old rule, reproduced: pick the rotation whose first side is SHORT.
    // A card tilted away from the camera projects LANDSCAPE, so its shorter
    // projected side is its 88 mm height — and the warp puts that on the
    // output's 63 mm width. This is the whole defect, in eight numbers.
    const foreshortened: Quad = [
      [10, 20],
      [200, 10],
      [210, 160],
      [5, 170],
    ]
    const side = (q: Quad, i: number) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1])
    const meanA = (side(foreshortened, 0) + side(foreshortened, 2)) / 2
    const meanB = (side(foreshortened, 1) + side(foreshortened, 3)) / 2
    assert.ok(meanA > meanB, 'the top/bottom edges are the LONGER pair on a foreshortened card')
    // The old rule would therefore have started at corner 1 or 3 — a side edge.
    // The new rule starts at the top-left and keeps the top edge first.
    const o = orderQuadForCard(foreshortened)!
    assert.deepEqual(o[0], [10, 20], 'TL is the top-left corner')
    assert.deepEqual(o[1], [200, 10], 'TR is the top-right corner')
  })
})

describe('e2e drive — the straddle gate', () => {
  it('separates the drive\'s good captures from its straddles with no overlap', {
    skip: haveDrive ? false : 'drive artifacts unavailable',
  }, () => {
    const byClass: Record<string, number[]> = { GOOD: [], PARTIAL: [], BAD: [] }
    CAPTURES.forEach((c, i) => byClass[VERDICTS[i]].push(oppositeSideRatio(c.quad)))
    const worstOk = Math.min(...byClass.GOOD, ...byClass.PARTIAL)
    const bestBad = Math.max(...byClass.BAD)
    assert.ok(
      bestBad < worstOk,
      `classes must not overlap: worst usable ${worstOk.toFixed(3)}, best straddle ${bestBad.toFixed(3)}`,
    )
    // The shipped threshold sits inside that empty band, not on either edge.
    assert.ok(DEFAULT_LOCK_PARALLEL_MIN > bestBad, `threshold must reject every straddle (best bad ${bestBad.toFixed(3)})`)
    assert.ok(DEFAULT_LOCK_PARALLEL_MIN < worstOk, `threshold must keep every usable capture (worst ok ${worstOk.toFixed(3)})`)
  })

  it('rejects 5/5 straddles and keeps 8/8 usable captures', {
    skip: haveDrive ? false : 'drive artifacts unavailable',
  }, () => {
    let badRejected = 0
    let okKept = 0
    CAPTURES.forEach((c, i) => {
      const pass = isSingleCardShaped(c.quad)
      if (VERDICTS[i] === 'BAD' && !pass) badRejected++
      if (VERDICTS[i] !== 'BAD' && pass) okKept++
    })
    assert.equal(badRejected, 5, 'every straddle must be refused')
    assert.equal(okKept, 8, 'every usable capture must survive')
  })

  it('the ASPECT prior keeps every usable capture the real product made', {
    skip: haveDrive ? false : 'drive artifacts unavailable',
  }, () => {
    // The fence against re-tuning this on the corpus. The corpus is a version-2
    // dataset whose frames get clipped by the canonical centre square, which
    // makes cards measure squarer than they are and makes a tight prior look
    // free. These are real captures through the shipped product.
    const refused: string[] = []
    CAPTURES.forEach((c, i) => {
      if (VERDICTS[i] === 'BAD') return
      if (!isCardShaped(c.quad)) refused.push(`${c.id} (${quadAspectRatio(c.quad).toFixed(3)})`)
    })
    assert.deepEqual(refused, [], `the aspect prior must not refuse a usable hand-held capture: ${refused.join(', ')}`)
  })

  it('the two lock priors together reject every bad capture and keep every good one', {
    skip: haveDrive ? false : 'drive artifacts unavailable',
  }, () => {
    let keptGood = 0
    let keptBad = 0
    CAPTURES.forEach((c, i) => {
      const passes = isCardShaped(c.quad) && isSingleCardShaped(c.quad)
      if (passes && VERDICTS[i] !== 'BAD') keptGood++
      if (passes && VERDICTS[i] === 'BAD') keptBad++
    })
    assert.equal(keptGood, 8, 'all 8 usable captures must survive both priors')
    assert.equal(keptBad, 0, 'no bad capture may survive both priors')
  })

  it('a straddle is CONVEX, so convexity could never have caught it', () => {
    // Two stacked cards spanned by one quad: perfectly convex, grossly
    // non-parallelogram. This is why the gate is a ratio and not a shape check.
    const straddle: Quad = [
      [100, 100],
      [300, 130],
      [260, 400],
      [90, 250],
    ]
    assert.ok(oppositeSideRatio(straddle) < DEFAULT_LOCK_PARALLEL_MIN)
    assert.ok(!isSingleCardShaped(straddle))
  })

  it('gates the LOCK only — a straddling quad is still tracked and drawn', () => {
    const straddle: Quad = [
      [100, 100],
      [300, 130],
      [260, 400],
      [90, 250],
    ]
    const tracker = createTracker()
    tracker.setReticle(null)
    let everStable = false
    const policy = createLockPolicy({})
    const reticle = reticleForAspect()
    for (let t = 0; t < 12; t++) {
      const { stable } = tracker.update([straddle])
      if (stable.length) everStable = true
      assert.equal(
        policy.update(stable as TrackedQuad[], reticle, CANONICAL_SIZE, CANONICAL_SIZE),
        null,
        'a straddle must never auto-capture',
      )
    }
    assert.ok(everStable, 'but it must still be tracked, so the user sees what the engine sees')
  })
})

describe('e2e drive — duplicate captures survived track churn', () => {
  // The drive got 13 captures from 3 cards, every one on a NEW track id, with
  // two pairs 0.2 s and 0.3 s apart. A refractory keyed on track id cannot help
  // when identity is what churns, so the suppression is spatial + temporal.
  // This reproduces Scan.tsx's `recentlyCapturedHere` policy exactly.
  const REFRACTORY_MS = 2_500
  const REFRACTORY_IOU = 0.5

  function makeSuppressor() {
    let recent: Array<{ quad: Quad; at: number }> = []
    return {
      allows(quad: Quad, now: number): boolean {
        recent = recent.filter((r) => now - r.at < REFRACTORY_MS)
        return !recent.some((r) => polyIoU(r.quad, quad) >= REFRACTORY_IOU)
      },
      note(quad: Quad, now: number) {
        recent.push({ quad, at: now })
      },
    }
  }

  const card = (dx = 0, dy = 0): Quad => [
    [100 + dx, 100 + dy],
    [280 + dx, 100 + dy],
    [280 + dx, 351 + dy],
    [100 + dx, 351 + dy],
  ]

  it('SHIPPED BEHAVIOUR: a track-id refractory captures once per new id', () => {
    const seen = new Set<number>()
    let captures = 0
    // The drive's own churn: one stationary card, a fresh track id each time.
    for (const id of [1, 2, 8, 11, 13]) {
      if (!seen.has(id)) {
        seen.add(id)
        captures++
      }
    }
    assert.equal(captures, 5, 'five ids, five captures — one card, five rows in the feed')
  })

  it('THE FIX: the same card in the same place captures once, whatever the track id', () => {
    const s = makeSuppressor()
    let captures = 0
    let now = 0
    for (const id of [1, 2, 8, 11, 13]) {
      void id
      now += 250 // the drive's observed 0.2-0.3 s spacing
      const q = card(2, -1) // hand jitter, not a new card
      if (s.allows(q, now)) {
        s.note(q, now)
        captures++
      }
    }
    assert.equal(captures, 1, 'one physical card must produce one capture')
  })

  it('a genuinely different card elsewhere in the frame is NOT suppressed', () => {
    const s = makeSuppressor()
    const first = card()
    assert.ok(s.allows(first, 0))
    s.note(first, 0)
    // A second card set down beside it: low overlap, so it captures.
    const second = card(220, 0)
    assert.ok(polyIoU(first, second) < REFRACTORY_IOU, 'the two cards must not overlap much')
    assert.ok(s.allows(second, 300), 'a different card must still capture')
  })

  it('the same place becomes capturable again once the window passes', () => {
    const s = makeSuppressor()
    const q = card()
    s.note(q, 0)
    assert.ok(!s.allows(q, REFRACTORY_MS - 100), 'still suppressed inside the window')
    assert.ok(s.allows(q, REFRACTORY_MS + 100), 'deliberately re-presenting the card must work')
  })
})
