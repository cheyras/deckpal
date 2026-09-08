// Regressions for the two defects the 2026-09-04 e2e drive's THIRD round left
// open — the handover gate said NO on exactly these — each fenced against round
// 3's own harvested artifacts.
//
// Round 3 landed the saturation clutter gate (0 false captures and 0 false locks
// in 110 s of kitchen, mail and boxes), held the straddle gate at zero for a
// second round, kept 11/11 thumbnails upright, and cost nothing measurable. What
// it did not fix:
//
//   1. LOCK CONTINUITY. The presence regions were PERFECT — 32 of 41 locks
//      suppressed, `regionCount` never wrong in 41 events — and one physical
//      card still produced 9 captures, because the engine held NO LOCK for
//      4.7-11.4 s at a stretch and each re-acquisition after the 900 ms region
//      grace read as a fresh presentation.
//   2. THE TIE MARGIN. Three captures of an orange Fighting Energy were
//      committed to the batch as Grass Energy and Psychic Energy behind green
//      88-89% bars. The survivors cleared the shipped margin BY EXACTLY 2.
//
// Plus the telemetry the next round needs, which is the only way the two
// remaining device-shaped unknowns (§9.7-9.9) ever get numbers.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import { DEFAULT_CADENCE_MS } from '../index'
import { TRACKER_DEFAULTS } from '../tracker'
import { createCapturedRegions, REGION_DEPARTURE_MS, REGION_SAME_IOU, type RegionTrack } from '../../ui/regions'
import { judgeTie, gateScanResponse, TIE_MARGIN } from '../../ui/tieGate'
import type { ScanMatch, ScanResponse } from '../../../lib/api'

// ── WHY THE FIXTURES ARE IN THE REPO ────────────────────────────────────────
//
// This path used to be an absolute one on the author's laptop
// (`E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/...`), pointing
// into a directory that is not tracked. The `if (!existsSync) return []` guard
// below reads as graceful degradation and was not: the suite then asserts the
// artifacts ARE present, so on any other machine — GitHub Actions included —
// this file could only fail. It did, on every CI run since the scanner landed
// on main, and the regressions it pins have therefore never once been checked
// by CI.
//
// The recorded sessions are gigabytes of frames and crops and stay out of git.
// The JSON the assertions actually read is a few hundred KB, so it lives here,
// addressed relative to this file. The guard is kept: it is now the honest
// thing it always claimed to be.
const DRIVE = fileURLToPath(new URL('./fixtures/e2e-drive/', import.meta.url))

function load(rel: string): unknown | null {
  const p = DRIVE + rel
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}
function rows(v: unknown): Record<string, unknown>[] {
  if (!v) return []
  return (Array.isArray(v) ? v : Object.values(v as object)) as Record<string, unknown>[]
}

interface Ev {
  type: string
  epochMs: number
  quad: Quad
  id: number
  trackId: number
  regionCount?: number
  suppressedByRegion?: boolean
  wouldCapture?: boolean
}
const caps = (rs: Record<string, unknown>[]) =>
  (rs.filter((e) => e.type === 'capture-event') as unknown as Ev[]).sort((a, b) => a.epochMs - b.epochMs)
const locks = (rs: Record<string, unknown>[]) =>
  (rs.filter((e) => e.type === 'lock-event') as unknown as Ev[]).sort((a, b) => a.epochMs - b.epochMs)

const R3RUN = rows(load('harvest-r3run1/events.json'))
const R3CLUTTER = rows(load('harvest-r3clutter/events.json'))
const haveR3 = R3RUN.length > 0 && R3CLUTTER.length > 0

// ---------------------------------------------------------------------------
// The replay, and why it is built this way
// ---------------------------------------------------------------------------
//
// Round 2's replay ticked the region policy once per RECORDED EVENT. That is a
// bad model and it produced a wrong answer: the lock recorder throttles to one
// post every 2 s, so an event-driven replay has no ticks at all inside a 9 s
// dropout and the region therefore never gets the chance to retire that
// production gives it 75 times. Run against round 3 it says the shipped build
// would have taken 5 captures. The shipped build took 9.
//
// So the presence signal is RECONSTRUCTED at the engine's own tick cadence
// first, from what the lock stream can actually prove:
//
//   - two locks closer together than the throttle can explain => the engine held
//     a lock continuously between them, and the card was present;
//   - a longer gap => the engine held NO lock, and the region gets ticks with
//     nothing on screen, exactly as production would.
//
// The one free parameter is where "throttle silence" ends and "real dropout"
// begins, and the data hands it over: the gap distribution has an EMPTY BAND
// between 2.70 s and 4.67 s (asserted below). Any threshold in that band gives
// the same reconstruction, so the model has no tuning knob to hide behind.
//
// The check that makes it a model rather than a guess: at 900 ms it reproduces
// the shipped build's 9 captures on the card run and 2 on the clutter run,
// exactly.

const TICK_MS = DEFAULT_CADENCE_MS
const LOCK_THROTTLE_MS = 2_000
/** A gap this small is the recorder's throttle, not the card leaving. */
const CONTINUOUS_MS = 2_750

function presence(rs: Record<string, unknown>[], continuousMs = CONTINUOUS_MS): Array<{ t: number; tracks: RegionTrack[] }> {
  const L = locks(rs)
  const out: Array<{ t: number; tracks: RegionTrack[] }> = []
  let li = 0
  for (let t = L[0].epochMs; t <= L[L.length - 1].epochMs; t += TICK_MS) {
    while (li + 1 < L.length && L[li + 1].epochMs <= t) li++
    const cur = L[li]
    const nxt = L[li + 1]
    let present = t - cur.epochMs <= LOCK_THROTTLE_MS
    // The TRACK, not just the quad: a region follows the track it was captured
    // from now (regions.ts), so the reconstruction has to carry the tracker's
    // own id. Round 3's own churn is the reason that matters here — see the
    // "one card, fifteen track ids" assertion below.
    let e = cur
    if (nxt && nxt.epochMs - cur.epochMs <= continuousMs) {
      present = true
      e = t - cur.epochMs < nxt.epochMs - t ? cur : nxt
    }
    out.push({ t, tracks: present ? [{ id: e.trackId, quad: e.quad }] : [] })
  }
  return out
}

/** Replay a harvested run through the REAL region policy at the engine's tick
 *  cadence. Returns how many of its captures would still have been taken. */
function replay(rs: Record<string, unknown>[], departureMs: number, continuousMs = CONTINUOUS_MS) {
  const ticks = presence(rs, continuousMs)
  const c = caps(rs)
  const R = createCapturedRegions({ departureMs })
  const t0 = ticks[0].t
  let ci = 0
  const takenAt: number[] = []
  let blocked = 0
  const ask = (e: Ev) => {
    if (R.suppressed(e.quad)) blocked++
    else {
      takenAt.push((e.epochMs - t0) / 1000)
      R.note(e.quad, e.trackId, e.epochMs)
    }
  }
  for (const tk of ticks) {
    R.tick(tk.t, tk.tracks)
    while (ci < c.length && c[ci].epochMs <= tk.t + TICK_MS) ask(c[ci++])
  }
  while (ci < c.length) ask(c[ci++])
  return { taken: takenAt.length, blocked, takenAt, expired: R.expired }
}

/** Consecutive lock-to-lock gaps, in seconds. */
function lockGaps(rs: Record<string, unknown>[]): number[] {
  const L = locks(rs)
  return L.slice(1).map((l, i) => (l.epochMs - L[i].epochMs) / 1000)
}
/** The dropout immediately preceding each lock the region did NOT suppress. */
function dropoutsBeforeFreeLocks(rs: Record<string, unknown>[]): number[] {
  const L = locks(rs)
  const out: number[] = []
  for (let i = 1; i < L.length; i++) {
    if (L[i].suppressedByRegion) continue
    out.push((L[i].epochMs - L[i - 1].epochMs) / 1000)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Lock continuity — the duplicate residue
// ---------------------------------------------------------------------------

describe('e2e round 3 — one card, nine captures, and the region was not at fault', () => {
  it('the round-3 artifacts are present', () => {
    assert.ok(haveR3, 'round-3 harvest missing')
  })

  it('THE MECHANISM WAS PERFECT — this is what makes it a continuity bug and not a suppression bug', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    const L = locks(R3RUN)
    assert.equal(L.length, 41, 'round 3 recorded 41 lock-events on the card run')
    const suppressed = L.filter((l) => l.suppressedByRegion)
    assert.equal(suppressed.length, 32, '32 of 41 locks were suppressed by a region')
    // regionCount is 1 for every suppressed lock and 0 for every free one, with
    // no exceptions in 41 events. One card, one region, never miscounted.
    for (const l of L) {
      assert.equal(l.regionCount, l.suppressedByRegion ? 1 : 0, `lock ${l.id}: regionCount disagrees with suppression`)
    }
    assert.equal(L.length - suppressed.length, caps(R3RUN).length, 'the free locks are exactly the captures')
  })

  it('SHIPPED BEHAVIOUR: every free lock followed a dropout 5-12x longer than the 900 ms grace', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    const d = dropoutsBeforeFreeLocks(R3RUN)
    assert.equal(d.length, 8, 'eight of the nine captures had a preceding lock to measure from')
    const min = Math.min(...d)
    const max = Math.max(...d)
    assert.ok(min >= 4.6 && min <= 4.8, `shortest dropout ${min.toFixed(2)}s`)
    assert.ok(max >= 11.3 && max <= 11.5, `longest dropout ${max.toFixed(2)}s`)
    // THE FENCE. The old 900 ms could not survive the SHORTEST of them, let
    // alone the longest — which is precisely why every re-lock read as new.
    assert.ok(min * 1000 > 900, 'the retired-at-900ms window loses the card on every single dropout')
    // ── AND THIS IS WHERE THE FENCE USED TO SAY `REGION_DEPARTURE_MS > 11.37 s`
    //
    // It did, and that assertion sized a product constant on a desktop fake
    // camera playing a video file. Both of the owner's phone sessions have now
    // been measured for the same quantity — a stretch with the card still there
    // and its track gone — and the phone's is 2.38 s, with an empty band from
    // there to 4.12 s separating a tracker re-id from the reader taking the card
    // away (`owner-session-2-regressions.test.ts` carries that measurement, and
    // `regions.REGION_DEPARTURE_MS` carries the argument).
    //
    // So this fixture no longer sizes the constant. What it still does is name
    // the price: the window is now BELOW every dropout in this distribution, so
    // this run gets one more spurious capture than it did at 12 s (6 -> 7,
    // asserted below), and a device that ever reproduced this dropout pattern
    // would get duplicates. The fence is therefore the reverse of the old one —
    // it fires if somebody makes the constant large enough to cover the fake
    // camera again without new evidence for it.
    assert.ok(
      REGION_DEPARTURE_MS < max * 1000,
      `the departure window (${REGION_DEPARTURE_MS} ms) is deliberately shorter than this fake camera's longest dropout (${max.toFixed(2)} s) — if it is raised back over that, the phone evidence in regions.ts has to be answered first`,
    )
    // ...and not so short that even a phone-scale re-id would break it. 2.38 s
    // is the longest same-card gap either owner session measured.
    assert.ok(REGION_DEPARTURE_MS > 2_380, `the window must still outlast a real device's track re-id (${REGION_DEPARTURE_MS} ms)`)
  })

  it('the gap distribution has an empty band, so the replay has no tuning knob', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    const gaps = lockGaps(R3RUN)
    const shortest = gaps.filter((g) => g > 3).sort((a, b) => a - b)[0]
    const longestShort = Math.max(...gaps.filter((g) => g <= 3))
    assert.ok(longestShort <= 2.75, `throttle-explained gaps top out at ${longestShort.toFixed(2)}s`)
    assert.ok(shortest >= 4.6, `real dropouts start at ${shortest.toFixed(2)}s`)
    // Any split inside the empty band reconstructs the same presence signal.
    const outcomes = [2_800, 3_200, 3_800, 4_500].map((c) => replay(R3RUN, REGION_DEPARTURE_MS, c).taken)
    assert.equal(new Set(outcomes).size, 1, `the reconstruction threshold changed the answer: ${outcomes.join(', ')}`)
  })

  it('THE MODEL IS VALIDATED: at 900 ms the replay reproduces the shipped build exactly', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    // The claim the whole section rests on. A replay that cannot reproduce the
    // measured outcome cannot be trusted to predict a different one.
    assert.equal(replay(R3RUN, 900).taken, 9, 'the card run: the shipped build took 9')
    assert.equal(replay(R3CLUTTER, 900).taken, 2, 'the clutter run: the shipped build took 2')
  })

  it('THE TRACKER CHURNS ON THIS FIXTURE, which is what the identity gate has to survive', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    // The number that prices everything below. This is ONE physical card, in
    // frame for essentially the whole clip — and the tracker gives it fifteen
    // different identities across 41 locks, because it loses the card entirely
    // during each multi-second detection dropout and re-acquires it as a new
    // object. A refractory keyed on the track id ALONE would fire on every one
    // of those rebirths; that is the original refractory, and it is why
    // `regions.ts` uses the id to decide whether a region's clock is REFRESHED
    // and never to decide whether a lock is SUPPRESSED.
    const ids = new Set(locks(R3RUN).map((l) => l.trackId))
    assert.equal(locks(R3RUN).length, 41)
    assert.ok(ids.size >= 12, `expected heavy track churn on one card, got ${ids.size} ids`)
    // Every capture is on a different id, so no region here is ever refreshed:
    // this fixture exercises the departure clock alone.
    assert.equal(new Set(caps(R3RUN).map((c) => c.trackId)).size, caps(R3RUN).length)
  })

  it('THE FIX, AND ITS PRICE: at the shipped departure window, nine captures become seven', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    const before = replay(R3RUN, 900)
    const after = replay(R3RUN, REGION_DEPARTURE_MS)
    assert.equal(before.taken, 9)
    // FOUR, THEN SIX, AND SEVEN NOW. The widening from 900 ms to 12 s took this
    // run to four while a region could be refreshed by ANY overlapping track.
    // The owner's first real session showed that rule adopting 63% of genuine
    // card changes — a region kept alive by the next card in the stack never
    // expires, and 115 of his 134 locks were suppressed by regions that should
    // long since have retired (regions.ts's header). With the follow gated on
    // track identity, this fixture's churn (above) means no region is ever
    // refreshed and two of the four suppressions it used to get were
    // suppressions it had no evidence for: six.
    //
    // The seventh arrives with the 2026-09-05 shortening to 5 s, and it is the
    // whole cost of that change on this fixture. The dropout it loses is the
    // 4.67 s one at the short end — a fake-camera number. Both phone sessions
    // put the same quantity at 2.38 s or absent entirely.
    assert.equal(after.taken, 7, `expected 7 captures at ${REGION_DEPARTURE_MS} ms, got ${after.taken}`)
    assert.equal(after.blocked, 2)
    assert.ok(after.taken < before.taken - 1, 'still below the 900 ms shipped build')

    // WHAT THE SEVEN ARE. The fixture is a 58 s clip played ~2.15 times, so the
    // card genuinely leaves the frame and re-enters at the start of each pass.
    // Three of the seven sit on those re-entries — one clip length apart, twice
    // over — and the other four are the residual duplicates.
    const t = after.takenAt
    assert.ok(t[0] < 1, `first capture at t=${t[0].toFixed(1)}s`)
    const loopish = t.filter((x) => Math.abs((x % 58) - 0) < 3 || Math.abs((x % 58) - 58) < 3)
    assert.ok(loopish.length >= 3, `expected >=3 captures on a clip boundary, got ${loopish.length} of ${t.join(', ')}`)
    assert.equal(before.taken - loopish.length, 6, 'the shipped 900 ms build made six spurious captures')
    assert.equal(after.taken - loopish.length, 4, 'four spurious captures survive')
  })

  it('...and 5 s is not a knife edge: the answer is flat across a 2x sweep around it', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    // The property the old version of this test was really about, re-measured
    // around the new constant. It used to sweep 10-30 s and fence the constant
    // into [10 s, 30 s] — a range that existed only because this fake camera's
    // dropouts run to 11.37 s. That fence is gone; the phone measurement in
    // `regions.REGION_DEPARTURE_MS` replaced the evidence under it, and
    // `owner-session-2-regressions.test.ts` fences the new one on real-device
    // data. What is asserted here is only that the shipped value is not
    // balanced on a cliff of THIS fixture's own making.
    const sweep = [4_000, 5_000, 6_000, 8_000].map((d) => replay(R3RUN, d).taken)
    assert.deepEqual(sweep, [7, 7, 7, 7], `departure sweep: ${sweep.join(', ')}`)
    // The full picture either side, so the shape stays visible in the file:
    // 900 ms -> 9, 3 s -> 8, 4-8 s -> 7, 10-14 s -> 6, 20-30 s -> 5.
    assert.equal(replay(R3RUN, 3_000).taken, 8)
    assert.equal(replay(R3RUN, 12_000).taken, 6)
    assert.equal(replay(R3RUN, 30_000).taken, 5)
    assert.ok(
      REGION_DEPARTURE_MS >= 4_000 && REGION_DEPARTURE_MS <= 8_000,
      `the shipped constant must sit on this fixture's plateau, not at its edge (${REGION_DEPARTURE_MS})`,
    )
  })

  it('...and it costs the clutter run nothing: both real presentations are still taken', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    // The two clutter captures are one loop apart with the object genuinely gone
    // in between. Widening the window must not touch them at ANY value.
    for (const d of [900, 2_500, 5_000, REGION_DEPARTURE_MS, 20_000, 30_000]) {
      const r = replay(R3CLUTTER, d)
      assert.equal(r.taken, 2, `depart ${d}: both real presentations must capture`)
      assert.equal(r.blocked, 0, `depart ${d}: nothing may be suppressed here`)
    }
  })

  it('THE COST, TESTED: a different card on the same spot inside the window is suppressed', () => {
    // Documented in regions.REGION_DEPARTURE_MS, and asserted here so nobody
    // discovers it in the field. This is the trade the widening buys, and the
    // escape hatch is the manual Capture button, which the region never gates.
    const R = createCapturedRegions()
    const card = (dx: number): Quad => [
      [100 + dx, 100],
      [280 + dx, 100],
      [280 + dx, 351],
      [100 + dx, 351],
    ]
    R.tick(0, [{ id: 1, quad: card(0) }])
    R.note(card(0), 1, 0)
    // A different card, laid on the same spot well inside the window at high
    // overlap. Half a window is used deliberately: at exactly REGION_DEPARTURE_MS
    // the region is already gone, and a test that sat on that boundary would
    // stop testing the cost the moment the constant moved.
    const swapped = card(20)
    const swapAt = REGION_DEPARTURE_MS / 2
    assert.ok(polyIoU(card(0), swapped) >= REGION_SAME_IOU, 'the swap really is in the same place')
    R.tick(swapAt, [{ id: 2, quad: swapped }])
    assert.ok(R.suppressed(swapped), 'THE COST: the fast swap does not auto-capture')
    // ...and it is bounded. Once nothing overlaps for the window, the spot frees.
    R.tick(swapAt + REGION_DEPARTURE_MS + TICK_MS, [])
    assert.equal(R.count, 0, 'the region must retire once the card departs')
    assert.ok(!R.suppressed(swapped), 'and the spot is usable again')
  })

  it('a genuinely new card ELSEWHERE is never blocked, however long the window', () => {
    const R = createCapturedRegions()
    const at = (x: number): Quad => [
      [x, 100],
      [x + 180, 100],
      [x + 180, 351],
      [x, 351],
    ]
    R.tick(0, [{ id: 1, quad: at(100) }])
    R.note(at(100), 1, 0)
    const elsewhere = at(600)
    assert.ok(polyIoU(at(100), elsewhere) < REGION_SAME_IOU, 'the second card is genuinely somewhere else')
    R.tick(200, [{ id: 1, quad: at(100) }, { id: 2, quad: elsewhere }])
    assert.ok(!R.suppressed(elsewhere), 'a card in a fresh spot captures immediately')
  })
})

// ---------------------------------------------------------------------------
// 2. The tracker's coasting grace — the other candidate lever, measured
// ---------------------------------------------------------------------------

describe('e2e round 3 — a longer tracker grace is the wrong lever, and here is by how much', () => {
  it('the dropouts are 38-95 detect ticks long, so no defensible grace bridges any of them', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    // The proposal was graceFrames 2 -> 8-10 so tracks survive brief detection
    // gaps. At the engine's own cadence a grace of N frames buys N * 120 ms of
    // coasting, so 10 frames is 1.2 s. The dropouts that actually cost a capture
    // are 4.67-11.37 s. Quantified, on round 3's own lock stream:
    const drops = dropoutsBeforeFreeLocks(R3RUN)
    const ticksNeeded = drops.map((s) => Math.ceil((s * 1000) / TICK_MS))
    assert.ok(Math.min(...ticksNeeded) >= 38, `shortest dropout is ${Math.min(...ticksNeeded)} ticks`)
    assert.ok(Math.max(...ticksNeeded) <= 95, `longest dropout is ${Math.max(...ticksNeeded)} ticks`)

    for (const proposed of [8, 10]) {
      const bridged = ticksNeeded.filter((n) => n <= proposed).length
      assert.equal(bridged, 0, `graceFrames=${proposed} bridges ${bridged} of ${drops.length} dropouts — it bridges none`)
    }
    // To bridge even the shortest you would have to coast for ~4.7 s, drawing a
    // predicted quad over a card the detector has not seen since. tracker.ts
    // rule 3 ("coasting is bounded and always flagged") is a DISPLAY-SAFETY law
    // sized on a measured failure mode of 9 misses in 116 card frames; this
    // would be a 40x extension of it, bought with zero evidence of benefit.
    assert.equal(
      TRACKER_DEFAULTS.graceFrames,
      2,
      'graceFrames stays at 2: nothing in round 3 shows a longer grace recovering a single capture',
    )
  })

  it('the short track churn a longer grace WOULD bridge is already suppressed, so it buys no captures', {
    skip: haveR3 ? false : 'artifacts unavailable',
  }, () => {
    // The lock stream does contain track churn inside the recorder's throttle —
    // trk 2->3, 5->6, 17->18->19, 22->24, 34->35, all 2.0-2.7 s apart, i.e.
    // dropouts short enough that a longer grace might plausibly have held the
    // track through them. Every one of those locks is ALREADY region-suppressed,
    // so bridging them changes no capture count at all. The lever and the defect
    // do not touch.
    const L = locks(R3RUN)
    let churnWithinThrottle = 0
    for (let i = 1; i < L.length; i++) {
      const gap = (L[i].epochMs - L[i - 1].epochMs) / 1000
      if (L[i].trackId === L[i - 1].trackId || gap > 2.75) continue
      churnWithinThrottle++
      assert.equal(
        L[i].suppressedByRegion,
        true,
        `lock ${L[i].id} (trk ${L[i - 1].trackId}->${L[i].trackId}, ${gap.toFixed(2)}s) is already suppressed`,
      )
    }
    assert.ok(churnWithinThrottle >= 5, `expected the observed short churn, saw ${churnWithinThrottle}`)
  })
})

// ---------------------------------------------------------------------------
// 3. The tie margin
// ---------------------------------------------------------------------------

/** Build ScanMatch-shaped records from the drive's probe output. Its rows carry
 *  name/set/num/d rather than cardId, and the API's cardId IS the tcgdex id
 *  (`apps/api/src/scan/router.ts`: `cardId: m.tcgdex_id`), so `set-num` is the
 *  same identity the gate would see. */
function matchesFrom(top: Array<{ name: string; set: string; num: string; d: number }>): ScanMatch[] {
  return top.map((t) => ({
    cardId: `${t.set}-${t.num}`,
    name: t.name,
    setName: t.set,
    number: t.num,
    rarity: null,
    images: null,
    confidence: 1 - t.d / 64,
    distance: t.d,
  })) as unknown as ScanMatch[]
}

interface ProbeRow {
  id: string
  app?: { matched?: boolean; threshold?: number; top?: Array<{ name: string; set: string; num: string; d: number }> }
}
const PROBE = [
  ...(rows(load('harvest-r3run1/analysis/scan-results.json')) as unknown as ProbeRow[]),
  ...(rows(load('harvest-r3clutter/analysis/scan-results.json')) as unknown as ProbeRow[]),
]
const haveProbe = PROBE.length > 0

/** Round 3's server-confident results, as the client gate sees them. */
function serverConfident(): Array<{ id: string; matches: ScanMatch[] }> {
  const out: Array<{ id: string; matches: ScanMatch[] }> = []
  for (const r of PROBE) {
    if (!r.app?.matched || !r.app.top?.length) continue
    const m = matchesFrom(r.app.top)
    if (m[0].distance > (r.app.threshold ?? 9)) continue
    out.push({ id: r.id, matches: m })
  }
  return out
}

describe('e2e round 3 — the wrong-card commits cleared the margin by exactly 2', () => {
  it('the round-3 probe is present', () => {
    assert.ok(haveProbe, 'round-3 scan-results missing')
  })

  it('SHIPPED BEHAVIOUR: a margin of 2 lets exactly two results through, and they are the wrong card', {
    skip: haveProbe ? false : 'probe unavailable',
  }, () => {
    // Every capture in the card run is Basic Fighting Energy `sve` #014, checked
    // by eye on all nine thumbnails (E2E-REPORT round 3 §5).
    const TRUTH = 'sve-014'
    const survivors = serverConfident().filter((r) => judgeTie(r.matches, 2).confident)
    assert.equal(survivors.length, 2, `expected 2 survivors at margin 2, got ${survivors.length}`)
    for (const s of survivors) {
      assert.equal(judgeTie(s.matches, 2).margin, 2, `${s.id}: cleared the bar by exactly 2, not more`)
      assert.notEqual(s.matches[0].cardId, TRUTH, `${s.id}: committed as ${s.matches[0].cardId} — a wrong card`)
    }
  })

  it('the margin distribution has an empty band between 2 and 3 — the fence goes in it', {
    skip: haveProbe ? false : 'probe unavailable',
  }, () => {
    const hist = new Map<number, number>()
    for (const r of serverConfident()) {
      const m = judgeTie(r.matches, 2).margin
      hist.set(m, (hist.get(m) ?? 0) + 1)
    }
    const margins = [...hist.keys()].sort((a, b) => a - b)
    assert.deepEqual(margins, [0, 1, 2], `expected margins of only 0, 1 and 2, saw ${margins.join(', ')}`)
    assert.equal(hist.get(0), 2, 'the two clutter results were outright ties')
    assert.equal(hist.get(1), 6, 'six card results were one distance ahead')
    assert.equal(hist.get(2), 2, 'two were exactly two ahead — the wrong commits')
    // Nothing in the run has a margin of 3 or more, so raising the bar to 3
    // demotes the two wrong commits and costs this footage NOTHING else.
    assert.equal(
      [...hist.entries()].filter(([m]) => m >= 3).length,
      0,
      'no result in either run had a margin of 3 or more',
    )
  })

  it('THE FIX: at the shipped margin no wrong-card commit survives', {
    skip: haveProbe ? false : 'probe unavailable',
  }, () => {
    assert.ok(TIE_MARGIN >= 3, `the margin must be at least 3 to take round 3's commits, got ${TIE_MARGIN}`)
    let stillConfident = 0
    for (const r of serverConfident()) {
      const res = { matched: true, matches: r.matches } as unknown as ScanResponse
      if (gateScanResponse(res)?.matched) stillConfident++
    }
    assert.equal(stillConfident, 0, 'no round-3 result may survive as a confident match')
  })

  it('...and the ranked list still reaches the reader — the claim is withheld, not the evidence', {
    skip: haveProbe ? false : 'probe unavailable',
  }, () => {
    for (const r of serverConfident()) {
      const res = { matched: true, matches: r.matches } as unknown as ScanResponse
      const out = gateScanResponse(res)
      assert.equal(out?.matched, false)
      assert.equal(out?.matches.length, r.matches.length, `${r.id}: the top-5 must survive intact for pick-a-match`)
    }
  })

  it('a genuinely separated hit is still confident at the higher bar', () => {
    // The gate must not become "never confident". A visually distinct card sits
    // many units from its nearest rival and is unaffected.
    const v = judgeTie(
      matchesFrom([
        { name: 'Charizard', set: 'base', num: '004', d: 2 },
        { name: 'Something Else', set: 'base', num: '099', d: 18 },
      ]),
    )
    assert.equal(v.confident, true)
    assert.equal(v.margin, 16)
  })

  it('two printings of ONE card still do not block each other', () => {
    // Same cardId is not a disagreement about what the card is, at any margin.
    const m = matchesFrom([
      { name: 'Fighting Energy', set: 'sve', num: '014', d: 7 },
      { name: 'Fighting Energy', set: 'sve', num: '014', d: 7 },
    ])
    assert.equal(judgeTie(m).confident, true)
    assert.equal(judgeTie(m).rival, null)
  })
})

// ---------------------------------------------------------------------------
// 4. Telemetry — the shape the next round reads
// ---------------------------------------------------------------------------

describe('e2e round 3 — the telemetry the device unknowns need', () => {
  it('regions count their own expiries, so a free lock can say WHY it was free', () => {
    // Round 3 could see THAT a lock was free and had to reconstruct why from
    // gaps between throttled event timestamps. These make it one field.
    const R = createCapturedRegions({ departureMs: 1_000 })
    const q: Quad = [
      [100, 100],
      [280, 100],
      [280, 351],
      [100, 351],
    ]
    assert.equal(R.expired, 0)
    assert.equal(R.msSinceExpiry(0), null, 'null until something has actually expired')
    R.tick(0, [{ id: 1, quad: q }])
    R.note(q, 1, 0)
    R.tick(500, [{ id: 1, quad: q }])
    assert.equal(R.expired, 0, 'a refreshed region has not expired')
    R.tick(2_000, [])
    assert.equal(R.expired, 1, 'the retirement is counted')
    assert.equal(R.count, 0)
    assert.equal(R.msSinceExpiry(2_400), 400, 'and timestamped, so "this lock is 400 ms past an expiry" is one read')
    R.reset()
    assert.equal(R.expired, 0, 'reset clears the counter with the regions')
  })

  it('the saturation signature is a first-class part of the engine state', async () => {
    // The 0.13 clutter gate has been shown ONE clutter scene and no
    // low-saturation card (E2E-REPORT round 3 §9.7). It fails closed: a real
    // card below it never locks and cannot be auto-scanned. Nothing can size it
    // until a real device reports where real cards, sleeves and mattes sit, and
    // nothing reports that unless the value rides on the events.
    const mod = await import('../contract')
    const src = fs.readFileSync(new URL('../contract.ts', import.meta.url), 'utf8')
    assert.ok(/saturation: number \| null/.test(src), 'EngineState must carry the signature')
    assert.ok(mod, 'contract module loads')
  })

  it('the engine reports the signature for the track it is REPORTING ON, not only for locks', () => {
    // The distinction is the whole point: a card that fails the gate never
    // locks, so a lock-only signal is blind to exactly the failure it exists to
    // detect. The manual Capture button still works on that card, and the
    // capture-event carries its signature — the one measurement path to "a real
    // card sitting below 0.13".
    const src = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    assert.ok(/function focusTrack\(\)/.test(src), 'the engine must pick a focus track')
    assert.ok(/if \(locked\) return locked/.test(src), 'the lock wins when there is one')
    assert.ok(/saturation: focus \? \(saturations\.get\(focus\.id\) \?\? null\) : null/.test(src))
  })
})
