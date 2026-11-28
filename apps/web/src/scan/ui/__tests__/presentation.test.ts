// The presentation-episode machine (presentation.ts), driven tick by tick with
// real looks (lookScenes.ts, through the shipping cardLook): the design's four
// cases (DESIGN.md §2.4) and the edges its test plan names (§5.2).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../../engine/contract'
import { lookDistance, type CardLook } from '../../engine/look'
import {
  createPresentation,
  DRIFT_TICKS,
  HARD_MIN,
  MIN_FIRE_GAP_MS,
  QUIET_MAX,
  VACANT_TICKS,
  WINDOW_TICKS,
  type FireKind,
  type PresentationReport,
} from '../presentation'
import { CARD_QUAD, lookAt, lookOf } from './lookScenes'

const TICK_MS = 125
const A = lookOf(1)
const B = lookOf(2)
/** A hand over the spot, and the empty table under it: nothing like a card's look. */
const HAND = lookOf(50)
const TABLE = lookOf(60)
/** One card held: a passing shadow and tracker jitter, tick to tick. */
const A_JITTER = [A, lookOf(1, { exposure: 0.9 }), lookOf(1, { shift: 2 }), lookOf(1, { exposure: 1.05 })]

function rig() {
  const p = createPresentation()
  let now = 0
  let seq = 0
  const reports: PresentationReport[] = []
  /** One detect tick. `lock: false` is no lock (coasting, or nothing); a number is the track id. */
  const tick = (o: { lock?: number | false; look?: CardLook | null; spot?: CardLook | null; quad?: Quad } = {}) => {
    now += TICK_MS
    const lock = o.lock === false ? null : { id: o.lock ?? 1, quad: o.quad ?? CARD_QUAD }
    const r = p.observe({ now, lock, look: lock ? (o.look ?? null) : null, spotLook: p.watchQuad() ? (o.spot ?? null) : null })
    reports.push(r)
    return r
  }
  const fire = (kind: FireKind, look: CardLook | null = A, trackId = 1) =>
    p.fire({ kind, now, captureId: `cap-${++seq}`, trackId, quad: CARD_QUAD, look })
  /** Hold the episode's card still for n ticks. */
  const hold = (n: number, id = 1) => {
    const out: PresentationReport[] = []
    for (let i = 0; i < n; i++) out.push(tick({ lock: id, look: A_JITTER[i % A_JITTER.length], spot: A }))
    return out
  }
  return { p, tick, fire, hold, reports, get now() { return now } }
}

/** Tick until the machine offers a fire (at most `max` ticks); the number of ticks it took, or null. */
function ticksToCandidate(step: () => PresentationReport, max = 20): { n: number; kind: FireKind } | null {
  for (let i = 1; i <= max; i++) {
    const r = step()
    if (r.candidate) return { n: i, kind: r.candidate }
  }
  return null
}

describe('presentation — the design’s four cases (§2.4)', () => {
  it('the same card held still is never taken again, for a minute, through lone glitches', () => {
    const r = rig()
    assert.equal(r.tick({ look: A }).candidate, 'first', 'a fresh lock fires')
    r.fire('first')
    const glitchHard = lookAt(A, 1.2)
    const glitchSoft = lookAt(A, 0.75)
    for (let i = 1; i <= 480; i++) {
      // A lone hard tick every 30 (glare), a lone soft one in between: each
      // also makes the NEXT tick unsteady (sd), and still no break.
      const look = i % 30 === 0 ? glitchHard : i % 30 === 15 ? glitchSoft : A_JITTER[i % 4]
      const rep = r.tick({ look, spot: A })
      assert.equal(rep.state, 'watching', `tick ${i}`)
      assert.equal(rep.candidate, null, `tick ${i}`)
    }
  })

  it('swapped for a different card: the hand breaks the episode, the new card fires as it settles', () => {
    for (const newId of [2, 1]) {
      // newId 1: the tracker KEEPS the id across the swap (video 46OLXH5) — the
      // refractory this replaced refused exactly that.
      const r = rig()
      r.tick({ look: A })
      r.fire('first')
      r.hold(10)
      const hand = [r.tick({ lock: false, spot: HAND }), r.tick({ lock: false, spot: HAND })]
      assert.equal(hand[1]!.breakKind, 'disturbed', 'two hard ticks break it')
      r.tick({ lock: false, spot: TABLE })
      const settled = ticksToCandidate(() => r.tick({ lock: newId, look: B }))
      // A track the episode never saw is a new object: it fires on its lock, as
      // a fresh lock does (the focus gate still holds a blurred one). The
      // tracker keeping its id is the case the settle exists for: the second
      // steady tick.
      assert.deepEqual(settled, { n: newId === 2 ? 1 : 3, kind: 'disturbed' }, `track ${newId}`)
    }
  })

  it('swapped for an identical copy: the same disturbance, the same fire — identity decides afterwards', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(10)
    r.tick({ lock: false, spot: HAND })
    r.tick({ lock: false, spot: HAND })
    const copy = lookOf(1, { shift: 2 })
    assert.ok(lookDistance(copy, A) < QUIET_MAX, 'precondition: the copy looks exactly like the card')
    const settled = ticksToCandidate(() => r.tick({ lock: 2, look: copy }))
    assert.equal(settled?.kind, 'disturbed')
  })

  it('a hand that hovers for one tick does nothing; one that covers the card for 250 ms is a break', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(10)
    const hover = r.tick({ lock: false, spot: HAND })
    assert.equal(hover.cls, 'hard')
    for (const rep of r.hold(WINDOW_TICKS)) assert.equal(rep.state, 'watching')
    r.tick({ lock: false, spot: HAND })
    const second = r.tick({ lock: false, spot: HAND })
    assert.equal(second.breakKind, 'disturbed', 'covered for two ticks: the residual case, a flagged row later')
    assert.equal(ticksToCandidate(() => r.tick({ look: A }))?.kind, 'disturbed', 'the same card, uncovered, is taken again')
  })
})

describe('presentation — the edges (§5.2)', () => {
  it('one coasting tick does not break, and its tick is judged by the spot look', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(5)
    const blink = r.tick({ lock: false, spot: A })
    assert.equal(blink.fromSpot, true)
    assert.equal(blink.cls, 'quiet')
    for (const rep of r.hold(5)) assert.equal(rep.state, 'watching')
  })

  it('a detector dropout with the card untouched does not break, however long', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(4)
    for (let i = 0; i < 80; i++) {
      const rep = r.tick({ lock: false, spot: A_JITTER[i % 4] })
      assert.equal(rep.state, 'watching', `dropout tick ${i}`)
    }
    assert.equal(r.hold(1)[0]!.candidate, null, 'the lock coming back is the same card')
  })

  it('the tracker keeps its id across a swap to a card 0.7 away: the slide breaks it, the card fires', () => {
    // 0.7 is inside the retired re-arm's 1.0, where 19 % of unrelated pairs on
    // the owner's crops sit (Drowzee vs Yamask measured 0.27).
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(6)
    const near = lookAt(A, 0.7)
    r.tick({ look: lookAt(A, 1.3) })
    const slid = r.tick({ look: lookAt(A, 1.1, lookOf(3)) })
    assert.equal(slid.breakKind, 'disturbed')
    assert.equal(ticksToCandidate(() => r.tick({ look: near }))?.kind, 'disturbed')
  })

  it('even with no slide seen, a card that swaps in at 0.7 and holds is taken, as a drift probe', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(6)
    const near = lookAt(A, 0.75)
    const reps: PresentationReport[] = []
    for (let i = 0; i < DRIFT_TICKS + 1; i++) reps.push(r.tick({ look: near }))
    assert.equal(reps.at(-1)!.breakKind, 'drift', `after ${DRIFT_TICKS} steady soft ticks`)
    assert.ok(reps.every((x) => x.cls === 'soft'))
    assert.equal(ticksToCandidate(() => r.tick({ look: near }))?.kind, 'drift')
  })

  it('mid-slide, unsteady ticks never fire; the card fires once it holds', () => {
    // The tracker FOLLOWING the sliding card (its id kept): the case the settle
    // is for. (A track the episode never saw fires on its lock — see above.)
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(4)
    r.tick({ lock: false, spot: HAND })
    r.tick({ lock: false, spot: HAND })
    for (let i = 0; i < 12; i++) {
      // Each tick's look a different blend: never within STEADY_MAX of the last.
      const rep = r.tick({ lock: 1, look: lookAt(B, i % 2 ? 0.9 : 0.35, lookOf(4 + i)) })
      assert.equal(rep.candidate, null, `slide tick ${i}`)
    }
    assert.equal(ticksToCandidate(() => r.tick({ lock: 1, look: B }))?.n, 3)
  })

  it('without the fresh-track rule (the design as written), a new track settles too', () => {
    const p = createPresentation({ freshTrackFires: false })
    let now = 0
    const tick = (lock: number | null, look: CardLook | null, spot: CardLook | null = null) => {
      now += TICK_MS
      return p.observe({ now, lock: lock === null ? null : { id: lock, quad: CARD_QUAD }, look, spotLook: p.watchQuad() ? spot : null })
    }
    tick(1, A)
    p.fire({ kind: 'first', now, captureId: 'a', trackId: 1, quad: CARD_QUAD, look: A })
    for (let i = 0; i < 4; i++) tick(1, A_JITTER[i]!, A)
    tick(null, null, HAND)
    tick(null, null, HAND)
    assert.equal(ticksToCandidate(() => tick(2, B))?.n, 3)
  })

  it('a phantom lock on the empty spot is never "Scanned" as the card that left', () => {
    // The 2026-11-27 pin-4 frame: "Already scanned" over a quad with no card
    // under it. The card leaves (the spot reads as the table), and a lock
    // appears where it was. The episode never comes back to WATCHING on its
    // own: that lock is a new lock, judged like any other by the gates
    // upstream (a fresh one would be offered; this one is the old track id,
    // unsteady, so it is not).
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(4)
    for (let i = 0; i < 3; i++) r.tick({ lock: false, spot: TABLE })
    for (let i = 0; i < 10; i++) {
      const rep = r.tick({ lock: 1, look: i % 2 ? TABLE : lookAt(TABLE, 0.8) })
      assert.notEqual(rep.state, 'watching')
      assert.equal(rep.candidate, null)
    }
    assert.equal(r.tick({ lock: 9, look: TABLE }).state, 'broken', 'still not watching without a capture')
  })

  it('the tracker re-identifying the lock on the spot is supporting evidence, never a break by itself', () => {
    // Two White Flare cards of one type can sit 0.44-0.99 apart by look (PR
    // #416): a swap can read as quiet. A re-id on the spot counts as one hard
    // tick; with the hand's own hard tick, that is a break.
    const near = lookAt(A, 0.5)
    const lone = rig()
    lone.tick({ look: A })
    lone.fire('first')
    lone.hold(4)
    for (let i = 0; i < 20; i++) assert.equal(lone.tick({ lock: 4, look: A_JITTER[i % 4], spot: A }).state, 'watching', 're-id alone')
    const swap = rig()
    swap.tick({ look: A })
    swap.fire('first')
    swap.hold(4)
    swap.tick({ lock: false, spot: HAND })
    const reid = swap.tick({ lock: 5, look: near, spot: near })
    assert.equal(reid.breakKind, 'disturbed', 'a hand tick and a re-id onto a near look')
  })

  it('the card leaving for good goes IDLE, and the next card is still compared with it', () => {
    const r = rig()
    r.tick({ look: A })
    const first = r.fire('first')
    assert.equal(first.prevCaptureId, null)
    r.hold(4)
    let rep = r.tick({ lock: false, spot: TABLE })
    for (let i = 0; i < VACANT_TICKS + 2; i++) rep = r.tick({ lock: false })
    assert.equal(rep.state, 'idle')
    assert.equal(r.p.watchQuad(), null)
    const back = r.tick({ look: A })
    assert.equal(back.candidate, 'disturbed', 'a break followed by a card (the phone left and came back)')
    const rec = r.fire('disturbed')
    assert.equal(rec.prevCaptureId, first.captureId, 'identity compares it with the last capture')
    assert.ok(rec.vacantTicks >= VACANT_TICKS)
    assert.ok(rec.brokenMs !== null && rec.brokenMs > 0)
  })

  it('two automatic captures are never closer than MIN_FIRE_GAP_MS (the flash stays under 3 a second)', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.p.reset()
    let t = 0
    let rep: PresentationReport
    do {
      rep = r.tick({ look: B })
      t += TICK_MS
    } while (!rep.candidate && t < 2_000)
    assert.ok(t >= MIN_FIRE_GAP_MS, `a candidate ${t} ms after the last fire`)
    // And across any long run of swaps, every fire is at least the gap apart.
    const s = rig()
    const fires: number[] = []
    for (let i = 0; i < 400; i++) {
      const look = Math.floor(i / 3) % 2 ? A : B
      const rep2 = s.tick({ lock: 1 + (Math.floor(i / 3) % 2), look })
      if (rep2.candidate) {
        s.fire(rep2.candidate, look)
        fires.push(s.now)
      }
    }
    assert.ok(fires.length > 10, `${fires.length} fires`)
    for (let i = 1; i < fires.length; i++) assert.ok(fires[i]! - fires[i - 1]! >= MIN_FIRE_GAP_MS, `fires ${fires[i - 1]} and ${fires[i]}`)
  })

  it('a failed capture puts the machine back, so the same card retries', () => {
    const r = rig()
    r.tick({ look: A })
    const first = r.fire('first')
    r.p.failed(first.captureId)
    assert.equal(r.p.current(), null)
    assert.equal(r.tick({ look: A }).candidate, 'first', 'idle again, and no photosensitivity wait after a failure')
    r.fire('first')
    r.hold(4)
    r.tick({ lock: false, spot: HAND })
    r.tick({ lock: false, spot: HAND })
    const settled = ticksToCandidate(() => r.tick({ lock: 2, look: B }))
    assert.equal(settled?.kind, 'disturbed')
    const second = r.fire('disturbed', B, 2)
    r.p.failed(second.captureId)
    assert.equal(r.p.current()?.state, 'broken')
    assert.equal(ticksToCandidate(() => r.tick({ lock: 2, look: B }))?.kind, 'disturbed')
  })

  it('a discarded drift probe leaves the episode as the capture it probed against', () => {
    const r = rig()
    r.tick({ look: A })
    const first = r.fire('first')
    r.hold(4)
    const drifted = lookAt(A, 0.75)
    let rep: PresentationReport | null = null
    for (let i = 0; i < 20 && !rep?.candidate; i++) rep = r.tick({ look: drifted })
    assert.equal(rep?.candidate, 'drift')
    const probe = r.fire('drift', drifted)
    assert.equal(probe.prevCaptureId, first.captureId)
    r.p.discardProbe(probe.captureId)
    assert.equal(r.p.current()?.captureId, first.captureId)
    assert.equal(r.p.current()?.state, 'watching')
    for (const x of r.hold(10).map(() => r.tick({ look: drifted, spot: drifted }))) assert.equal(x.candidate, null, 're-referenced on the drifted look')
    r.tick({ lock: false, spot: HAND })
    r.tick({ lock: false, spot: HAND })
    ticksToCandidate(() => r.tick({ lock: 2, look: B }))
    assert.equal(r.fire('disturbed', B, 2).prevCaptureId, first.captureId, 'the next card is compared with the capture that stayed')
  })

  it('the spot follows the episode’s card, and a reset forgets the comparison only when asked', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    const moved = CARD_QUAD.map(([x, y]) => [x + 6, y]) as Quad
    for (let i = 0; i < 10; i++) r.tick({ look: A, quad: moved })
    assert.ok(Math.abs(r.p.watchQuad()![0][0] - moved[0][0]) < 0.2, 'the reference quad followed the lock')
    r.p.reset()
    assert.equal(r.tick({ look: A }).candidate, 'disturbed', 'a suspend keeps the last capture to compare with')
    r.p.reset({ forget: true })
    assert.equal(r.tick({ look: A }).candidate, 'first', 'leaving Step 1 forgets it')
  })

  it('a second card locked elsewhere while the first still lies on its spot is taken once it holds', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(4)
    const there = CARD_QUAD.map(([x, y]) => [x + 260, y]) as Quad
    const reps = [0, 1, 2].map(() => r.tick({ lock: 7, look: B, quad: there, spot: A }))
    assert.equal(reps[0]!.candidate, null, 'not on its first tick')
    assert.equal(reps.find((x) => x.candidate)?.candidate, 'disturbed', 'nothing is refused for being somewhere else')
  })

  it('the tick classes sit where the design puts them', () => {
    const r = rig()
    r.tick({ look: A })
    r.fire('first')
    r.hold(3)
    assert.equal(r.tick({ look: lookAt(A, QUIET_MAX - 0.05) }).cls, 'soft', 'unsteady against the tick before')
    r.hold(3)
    assert.equal(r.tick({ look: lookAt(A, HARD_MIN + 0.1) }).cls, 'hard')
    const s = rig()
    s.tick({ look: A })
    s.fire('first')
    s.hold(3)
    assert.equal(s.tick({ look: null }).cls, 'hard', 'a null look is "cannot tell"')
    assert.equal(s.tick({ lock: false, spot: null }).cls, 'hard', 'no lock and no spot look')
  })
})
