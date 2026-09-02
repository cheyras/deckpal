// Ported from p2-work/test-tracker.mjs, plus the cases the REBUILD added:
// the snap rule, the coasting flag as a contract, tick-counted age, and the
// frame-rate jitter instrumentation PHASE0-CLOSEOUT §2.8 says nothing in
// phase 0 could measure.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { centroid } from '../geometry'
import { createTracker } from '../tracker'

function square(cx: number, cy: number, half: number): Quad {
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ]
}

describe('tracker — ported behaviour', () => {
  it('flicker suppression: a quad present for one tick then gone never becomes stable', () => {
    const t = createTracker({ reticle: null, stableFrames: 3, graceFrames: 2 })
    let r = t.update([square(50, 50, 20)])
    assert.equal(r.pending.length, 1)
    assert.equal(r.stable.length, 0)

    for (let f = 1; f <= 10; f++) {
      r = t.update([])
      assert.equal(r.stable.length, 0, `stable must stay empty at tick ${f}`)
    }
    assert.equal(r.pending.length, 0, 'a pending track gets no grace: it dies on the first miss')
  })

  it('promotion happens at exactly stableFrames', () => {
    const t = createTracker({ reticle: null, stableFrames: 3 })
    const q = () => square(50, 50, 20)
    let r = t.update([q()])
    assert.equal(r.stable.length, 0, 'tick 1: pending')
    r = t.update([q()])
    assert.equal(r.stable.length, 0, 'tick 2: pending')
    r = t.update([q()])
    assert.equal(r.stable.length, 1, 'tick 3: promoted')
    assert.equal(r.pending.length, 0)
  })

  it('dropout grace, then death', () => {
    const t = createTracker({ reticle: null, stableFrames: 3, graceFrames: 2 })
    const q = () => square(50, 50, 20)
    t.update([q()])
    t.update([q()])
    let r = t.update([q()])
    const id = r.stable[0].id
    assert.equal(r.stable[0].coasting, false)

    r = t.update([])
    assert.equal(r.stable.length, 1, 'survives miss 1')
    assert.equal(r.stable[0].id, id)
    assert.equal(r.stable[0].coasting, true)

    r = t.update([])
    assert.equal(r.stable.length, 1, 'survives miss 2')
    assert.equal(r.stable[0].coasting, true)

    r = t.update([])
    assert.equal(r.stable.length, 0, 'dies once graceFrames is exceeded')
  })

  it('reticle exclusion: a quad entirely outside is never tracked', () => {
    const t = createTracker({ reticle: { x: 25, y: 25, w: 50, h: 50 }, stableFrames: 2 })
    const outside = square(87.5, 87.5, 7.5)
    for (let f = 0; f < 5; f++) {
      const r = t.update([outside])
      assert.equal(r.pending.length, 0, `tick ${f}`)
      assert.equal(r.stable.length, 0)
    }
  })

  it('reticle exclusion: below minInsideFrac out, well inside in', () => {
    const t = createTracker({ reticle: { x: 25, y: 25, w: 50, h: 50 }, minInsideFrac: 0.65, stableFrames: 2 })
    // Centroid inside, but only 25% of its own area overlaps.
    const straddling: Quad = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    for (let f = 0; f < 5; f++) {
      const r = t.update([straddling])
      assert.equal(r.pending.length, 0)
      assert.equal(r.stable.length, 0)
    }

    const t2 = createTracker({ reticle: { x: 25, y: 25, w: 50, h: 50 }, minInsideFrac: 0.65, stableFrames: 2 })
    let r2 = t2.update([square(50, 50, 20)])
    r2 = t2.update([square(50, 50, 20)])
    assert.equal(r2.stable.length, 1)
  })

  it('smoothing converges toward a new position without snapping instantly', () => {
    const t = createTracker({ reticle: null, stableFrames: 3, smooth: 0.45 })
    const a = square(50, 50, 20)
    t.update([a])
    t.update([a])
    let r = t.update([a])

    // 8px on each axis = 11.3px per corner: a real reposition, and small
    // enough that the snap cap (12px of DISPLAY error) does not fire.
    const b = square(58, 58, 20)
    const target = b[0]
    const initialGap = Math.hypot(r.stable[0].quad[0][0] - target[0], r.stable[0].quad[0][1] - target[1])

    let lastErr = initialGap
    for (let f = 0; f < 10; f++) {
      r = t.update([b])
      assert.equal(r.stable.length, 1)
      const q = r.stable[0].quad
      const err = Math.hypot(q[0][0] - target[0], q[0][1] - target[1])
      assert.ok(err <= lastErr + 1e-6, `error must not increase (tick ${f}: ${err} vs ${lastErr})`)
      if (f === 0) {
        assert.ok(err > 0.1, 'must not have snapped instantly')
        assert.ok(err < initialGap, 'must have moved partway')
      }
      lastErr = err
    }
    assert.ok(lastErr < 1, `expected convergence, got ${lastErr}`)
  })

  it('two simultaneous cards are tracked independently', () => {
    const t = createTracker({ reticle: null, stableFrames: 3 })
    const a = () => square(50, 50, 15)
    const b = () => square(200, 150, 15)
    let r = t.update([a(), b()])
    r = t.update([a(), b()])
    r = t.update([a(), b()])
    assert.equal(r.stable.length, 2)
    assert.notEqual(r.stable[0].id, r.stable[1].id)

    const trackB = r.stable.find((s) => Math.hypot(centroid(s.quad)[0] - 200, centroid(s.quad)[1] - 150) < 5)
    assert.ok(trackB)
    r = t.update([square(65, 60, 15), b()])
    const stillB = r.stable.find((s) => s.id === trackB.id)
    assert.ok(stillB, 'B keeps its identity when A moves')
    assert.ok(Math.hypot(centroid(stillB.quad)[0] - 200, centroid(stillB.quad)[1] - 150) < 5)
  })

  it('malformed self-intersecting quads are rejected before tracking', () => {
    const t = createTracker({ reticle: null, stableFrames: 2 })
    const bowtie: Quad = [
      [0, 0],
      [40, 40],
      [40, 0],
      [0, 40],
    ]
    for (let f = 0; f < 5; f++) {
      const r = t.update([bowtie])
      assert.equal(r.pending.length, 0)
      assert.equal(r.stable.length, 0)
    }
  })

  it('reset() clears tracks and restarts the id sequence', () => {
    const t = createTracker({ reticle: null, stableFrames: 2 })
    t.update([square(50, 50, 20)])
    let r = t.update([square(50, 50, 20)])
    const oldId = r.stable[0].id
    t.reset()
    r = t.update([])
    assert.equal(r.stable.length, 0)
    assert.equal(r.pending.length, 0)
    r = t.update([square(50, 50, 20)])
    assert.equal(r.pending[0].id, oldId)
  })
})

describe('tracker — the rebuild', () => {
  it('RULE 2: a jump the EMA could not follow snaps to the observation', () => {
    const t = createTracker({ reticle: null, stableFrames: 3, smooth: 0.45, snapPx: 12 })
    const a = square(150, 150, 60)
    t.update([a])
    t.update([a])
    t.update([a])

    // 25px on each axis = 35.4px per corner. EMA alone would leave 0.55 x that
    // = 19.4px of display error, well past the cap — but the quads still
    // overlap at IoU 0.46, so this is the SAME card moving, not a new track.
    const b = square(175, 175, 60)
    const r = t.update([b])
    assert.equal(r.stable.length, 1)
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(r.stable[0].quad[i][0] - b[i][0]) < 1e-9, `corner ${i} x snapped`)
      assert.ok(Math.abs(r.stable[0].quad[i][1] - b[i][1]) < 1e-9, `corner ${i} y snapped`)
    }
    assert.equal(r.jitter.snapped, true)
  })

  it('RULE 2: the displayed pose is never more than snapPx from the latest observation', () => {
    const snapPx = 12
    const t = createTracker({ reticle: null, stableFrames: 1, smooth: 0.45, snapPx })
    // A sustained sweep — the case where unbounded EMA lag settles at 1.22x
    // the per-tick step and the box visibly trails the card.
    let worst = 0
    for (let i = 0; i < 40; i++) {
      const raw = square(100 + i * 20, 150, 60)
      const r = t.update([raw])
      assert.equal(r.stable.length, 1)
      for (let c = 0; c < 4; c++) {
        worst = Math.max(worst, Math.hypot(r.stable[0].quad[c][0] - raw[c][0], r.stable[0].quad[c][1] - raw[c][1]))
      }
    }
    assert.ok(worst <= snapPx + 1e-9, `display lag reached ${worst}px against a ${snapPx}px cap`)
    assert.ok(worst > 0, 'and it is still smoothing, not passing raw straight through')
  })

  it('small per-tick noise is smoothed, not snapped', () => {
    const t = createTracker({ reticle: null, stableFrames: 3, smooth: 0.45, snapPx: 12 })
    const base = square(100, 100, 30)
    for (let i = 0; i < 3; i++) t.update([base])
    let snaps = 0
    let displayedTotal = 0
    let rawTotal = 0
    const jitterAmp = 2
    for (let i = 0; i < 30; i++) {
      const noisy = square(100 + (i % 2 ? jitterAmp : -jitterAmp), 100, 30)
      const r = t.update([noisy])
      if (r.jitter.snapped) snaps++
      displayedTotal += r.jitter.displayedPx
      rawTotal += r.jitter.rawPx
    }
    assert.equal(snaps, 0, 'sub-cap noise must never snap')
    // The whole reason smoothing exists: what is DISPLAYED shakes less than
    // what was OBSERVED.
    assert.ok(displayedTotal < rawTotal * 0.8, `displayed ${displayedTotal} vs raw ${rawTotal}`)
  })

  it('coasting is flagged on every coasted tick and never on an observed one', () => {
    const t = createTracker({ reticle: null, stableFrames: 2, graceFrames: 2 })
    const q = square(50, 50, 20)
    t.update([q])
    let r = t.update([q])
    assert.equal(r.stable[0].coasting, false)
    r = t.update([])
    assert.equal(r.stable[0].coasting, true)
    r = t.update([q])
    assert.equal(r.stable[0].coasting, false, 're-observation clears the flag')
    r = t.update([])
    assert.equal(r.stable[0].coasting, true)
    r = t.update([])
    assert.equal(r.stable[0].coasting, true, 'grace resets after a re-observation')
    r = t.update([])
    assert.equal(r.stable.length, 0)
  })

  it('a coasting track holds its last pose and does not extrapolate', () => {
    const t = createTracker({ reticle: null, stableFrames: 2, graceFrames: 2 })
    const q = square(50, 50, 20)
    t.update([q])
    const held = t.update([q]).stable[0].quad
    const coasted = t.update([]).stable[0].quad
    assert.deepEqual(coasted, held)
  })

  it('age counts consecutive observed ticks and freezes while coasting', () => {
    const t = createTracker({ reticle: null, stableFrames: 2, graceFrames: 2 })
    const q = square(50, 50, 20)
    assert.equal(t.update([q]).pending[0].age, 1)
    assert.equal(t.update([q]).stable[0].age, 2)
    assert.equal(t.update([q]).stable[0].age, 3)
    assert.equal(t.update([]).stable[0].age, 3, 'a coasted tick is not a sighting')
    assert.equal(t.update([q]).stable[0].age, 4)
  })

  it('jitter reports the top stable track, in displayed and raw px', () => {
    const t = createTracker({ reticle: null, stableFrames: 2, smooth: 0.45, snapPx: 12 })
    assert.equal(t.update([]).jitter.trackId, null)

    const a = square(50, 50, 20)
    t.update([a])
    const r0 = t.update([a])
    assert.equal(r0.jitter.trackId, r0.stable[0].id)
    assert.ok(r0.jitter.displayedPx < 1e-9, 'a motionless card has ~zero jitter')

    // Move by 4px/corner-axis: raw jitter should read ~5.66, displayed less.
    const r1 = t.update([square(54, 54, 20)])
    assert.ok(r1.jitter.rawPx > 5 && r1.jitter.rawPx < 6.5, `rawPx=${r1.jitter.rawPx}`)
    assert.ok(r1.jitter.displayedPx > 0 && r1.jitter.displayedPx < r1.jitter.rawPx)
  })

  it('the top stable track is the oldest one, not whichever was listed first', () => {
    const t = createTracker({ reticle: null, stableFrames: 2 })
    const a = () => square(50, 50, 20)
    const b = () => square(300, 300, 20)
    t.update([a()])
    t.update([a()])
    const older = t.update([a()]).stable[0].id
    const r = t.update([b(), a()])
    assert.equal(r.jitter.trackId, older)
  })

  it('setReticle() takes effect on the next tick', () => {
    const t = createTracker({ reticle: null, stableFrames: 1 })
    assert.equal(t.update([square(50, 50, 20)]).stable.length, 1)
    t.reset()
    t.setReticle({ x: 200, y: 200, w: 50, h: 50 })
    assert.equal(t.update([square(50, 50, 20)]).stable.length, 0)
    assert.deepEqual(t.getReticle(), { x: 200, y: 200, w: 50, h: 50 })
  })

  it('returned quads are copies — a caller mutating one cannot corrupt the track', () => {
    const t = createTracker({ reticle: null, stableFrames: 1 })
    const r = t.update([square(50, 50, 20)])
    r.stable[0].quad[0][0] = -9999
    const r2 = t.update([square(50, 50, 20)])
    assert.ok(r2.stable[0].quad[0][0] > 0)
  })
})
