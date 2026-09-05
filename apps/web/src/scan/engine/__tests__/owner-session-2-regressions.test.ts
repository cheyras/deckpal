// OWNER SESSION 2 (2026-09-05, build deckpal-9kmmb96sc, commit a4b4491) — six
// minutes of the owner scanning a sequential run of Destined Rivals on his own
// phone, with the identity-gated follow and the 1.5 s re-anchor bridge shipped.
// 81 lock-events, 36 captures, 25 report flags, and the manual Capture button
// pressed ZERO times (session 1: 21).
//
// This is the session that priced `REGION_DEPARTURE_MS`, and it is the first one
// in which the constant was the ONLY thing costing anything.
//
// ── WHAT IT MEASURED ────────────────────────────────────────────────────────
//
// Auto-capture is structurally fixed and structurally throttled. Every capture
// the region refractory did not touch fired at 0.67 s — five ticks at 7.5 Hz,
// the structural floor — in all 13 cases, with zero variance. All 16 captures
// slower than 2.5 s (up to 9.41 s) had a suppressed lock, and 100 % of the
// 103.4 s of avoidable wait sits in that group. Detector acquisition, the
// saturation gate, the aspect/straddle gates and the matcher round trip cost
// zero seconds between them. `regionCount` peaked at 3 (session 1: 11), so the
// adoption bug is genuinely gone; what remained was one number against another.
// The window was 12 s and the owner presented a new card every 7.6 s.
//
// ── WHY THE MODEL HERE IS ARITHMETIC AND NOT A SIMULATION ───────────────────
//
// Round 3's replay had to RECONSTRUCT presence from a throttled lock stream,
// because that build recorded nothing about when its regions retired. This one
// does: `regionsExpired` is cumulative and `sinceRegionExpiryMs` timestamps the
// most recent retirement, on every lock. So every region's retirement instant in
// this session is recoverable exactly, and `retirement - REGION_DEPARTURE_MS` is
// the instant production stopped seeing that card — the one quantity a replay
// cannot get from the lock stream, whose last lock of a presentation is up to
// 2 s before the card actually left.
//
// That turns the sweep into arithmetic on what happened rather than a model of
// what might have. Three facts make it exact for any window SHORTER than the
// 12 s that was shipped:
//
//   * WHICH regions overlap a presentation is pure geometry and does not depend
//     on the window at all;
//   * among the overlapping regions the binding one is the one whose card was
//     seen last, and shortening the window moves every retirement by the same
//     amount, so the binding region is the SAME at every value;
//   * a presentation the shipped build did NOT suppress cannot become suppressed
//     by a shorter window, so it stays at the 0.67 s floor.
//
// The geometric replay is still driven — against the real `createCapturedRegions`
// — as a check on the mechanism, and its one honest limit is recorded below.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import { DEFAULT_CADENCE_MS } from '../index'
import { createCapturedRegions, REGION_DEPARTURE_MS, REGION_SAME_IOU, REGION_BRIDGE_MS, type RegionTrack } from '../../ui/regions'

const SESSION = 'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/owner-session-2/'

interface Ev {
  type: string
  id: number
  epochMs: number
  quad: Quad
  trackId: number
  age?: number
  coasting?: boolean
  track?: { age: number; coasting: boolean }
  perf: { hz: number; detectMs: number; jitterPx: number }
  trigger?: 'auto' | 'manual'
  wouldCapture?: boolean
  suppressedByRegion?: boolean
  regionCount?: number
  regionsExpired?: number
  sinceRegionExpiryMs?: number | null
}

function read<T>(rel: string): T | null {
  const p = SESSION + rel
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : null
}

const ALL = (read<Ev[]>('harvest/events.json') ?? [])
  .filter((e) => e.type === 'lock-event' || e.type === 'capture-event')
  .sort((a, b) => a.epochMs - b.epochMs)
const LOCKS = ALL.filter((e) => e.type === 'lock-event')
const CAPS = ALL.filter((e) => e.type === 'capture-event')
const BUCKETS = read<Array<{ capId: number; truth: string | null }>>('analysis/buckets.json')
const UNFLAGGED = read<Array<{ id: number; match: { top: { cardId: string }; alternates: Array<{ cardId: string }> } }>>('analysis/unflagged.json')
const have = LOCKS.length === 81 && CAPS.length === 36 && !!BUCKETS && !!UNFLAGGED
const skip = have ? false : ('owner-session-2 artifacts unavailable' as const)

// ---------------------------------------------------------------------------
// GROUND TRUTH — which physical card each capture actually is
// ---------------------------------------------------------------------------
//
// The owner was working a sequential run of Destined Rivals, and the analysis
// read the collector number off 32 of the 36 crops (the other four are three
// card backs and one motion-blurred card). `buckets.json` carries the truth for
// the 25 he reported; the 11 he committed are recovered from the report's own
// breakdown of them — six where top-1 was correct and five where the right card
// sat at rank 2-5 — by finding which of those eleven ids appears in each
// capture's candidate list.
const COMMITTED_TRUTHS = new Set([
  'sv10-047', 'sv10-050', 'sv10-093', 'sv10-134', 'sv10-142', 'sv10-177',
  'sv10-043', 'sv10-070', 'sv10-109', 'sv10-121', 'sv10-160',
])
const truthById = new Map<number, string | null>()
if (have) {
  for (const b of BUCKETS!) truthById.set(b.capId, b.truth)
  // Two passes, because one capture's candidate list contains TWO of the eleven
  // (t+242 s offers sv10-142 at rank 2 and sv10-160 at rank 5). A card whose
  // top-1 is one of the eleven claims it first — those are the six the report
  // lists as correct top-1 — and the remaining captures then have exactly one
  // candidate left each.
  const claimed = new Set<string>()
  const remaining: typeof UNFLAGGED = []
  for (const u of UNFLAGGED!) {
    if (COMMITTED_TRUTHS.has(u.match.top.cardId)) {
      claimed.add(u.match.top.cardId)
      truthById.set(u.id, u.match.top.cardId)
    } else remaining!.push(u)
  }
  for (const u of remaining!) {
    const hits = [u.match.top.cardId, ...u.match.alternates.map((a) => a.cardId)].filter((c) => COMMITTED_TRUTHS.has(c) && !claimed.has(c))
    if (hits.length === 1) claimed.add(hits[0])
    truthById.set(u.id, hits.length === 1 ? hits[0] : null)
  }
}

// ---------------------------------------------------------------------------
// PRESENTATIONS — one physical card in front of the camera, once
// ---------------------------------------------------------------------------
interface Pres {
  trackId: number
  capId: number
  /** the instant the tracker first saw this card: `epochMs - age / hz` */
  birth: number
  /** the recorded latency, `age / hz` — seconds from first detection to capture */
  lat: number
  /** last PROVABLE sighting: the last lock of this track, or the capture moment */
  lastProvable: number
  /** ...corrected against the region telemetry; see `TAIL` below */
  lastSeen: number
  quad: Quad
  truth: string | null
  locks: Ev[]
  cap: Ev
}

const byTrack = new Map<number, Ev[]>()
for (const e of ALL) {
  const a = byTrack.get(e.trackId) ?? []
  a.push(e)
  byTrack.set(e.trackId, a)
}
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

const PRES: Pres[] = CAPS.map((c) => {
  const locks = (byTrack.get(c.trackId) ?? []).filter((e) => e.type === 'lock-event')
  const lat = c.track!.age / c.perf.hz
  // A capture-event's OWN `epochMs` is when the record was written, ~1 s after
  // the capture, behind a PNG encode — the same lag `regions.ts`'s header
  // records for round 1's flag ids. The lock clock is real time, so the track's
  // birth is taken from its first lock and the capture moment derived from it.
  const birth = locks.length
    ? locks[0].epochMs - (locks[0].age! / locks[0].perf.hz) * 1000
    : c.epochMs - 1_000 - lat * 1000
  return {
    trackId: c.trackId,
    capId: c.id,
    birth,
    lat,
    lastProvable: Math.max(birth + lat * 1000, ...locks.map((l) => l.epochMs)),
    lastSeen: 0,
    quad: c.quad,
    truth: truthById.get(c.id) ?? null,
    locks,
    cap: c,
  }
}).sort((a, b) => a.birth - b.birth)

/**
 * WHERE PRESENCE REALLY ENDED, recovered from the build's own telemetry.
 *
 * `regionsExpired` increments as regions retire and `sinceRegionExpiryMs`
 * timestamps the most recent retirement, so each retirement instant is
 * recoverable, and `retirement - 12 000` is when production last saw that card.
 * Regions retire in the order their cards were last seen, so the n-th
 * retirement belongs to the n-th presentation in that order.
 */
const exactLastSeen = new Map<number, number>()
let TAIL = 0
if (have) {
  const order = PRES.map((_, i) => i).sort((a, b) => PRES[a].lastProvable - PRES[b].lastProvable)
  let prev = 0
  let k = 0
  for (const l of LOCKS) {
    const n = (l.regionsExpired ?? 0) - prev
    if (n <= 0) continue
    prev = l.regionsExpired!
    k += n
    if (k - 1 < order.length) exactLastSeen.set(order[k - 1], l.epochMs - (l.sinceRegionExpiryMs ?? 0) - 12_000)
  }
  TAIL = med([...exactLastSeen].map(([i, ls]) => ls - PRES[i].lastProvable))
  for (let i = 0; i < PRES.length; i++) PRES[i].lastSeen = exactLastSeen.get(i) ?? PRES[i].lastProvable + TAIL
}

const FLOOR = 5 / 7.5

// ---------------------------------------------------------------------------
// 1. THE FIXTURE, AND THE RECONSTRUCTION THAT MAKES IT USABLE
// ---------------------------------------------------------------------------

describe('owner session 2 — the fixture', () => {
  it('the session artifacts are present', () => {
    assert.ok(have, 'owner-session-2 harvest/events.json or analysis/*.json missing')
  })

  it('81 locks, 36 captures, one track each, and not one manual press', { skip }, () => {
    assert.equal(LOCKS.length, 81)
    assert.equal(CAPS.length, 36)
    assert.equal(CAPS.filter((c) => c.trigger === 'manual').length, 0, 'the owner never touched the Capture button')
    // One capture per track and one track per capture: on this device a card
    // gets a single identity for its whole presentation. That is the property
    // the fake-camera fixtures do NOT have (round 3: fifteen ids on one card).
    assert.equal(new Set(CAPS.map((c) => c.trackId)).size, 36)
    // ...and every lock belongs to a track that captured. Nothing locked and
    // then vanished without being taken.
    const capTracks = new Set(CAPS.map((c) => c.trackId))
    for (const l of LOCKS) assert.ok(capTracks.has(l.trackId), `lock on track ${l.trackId} has no capture`)
  })

  it('THE MODEL IS ANCHORED: every retirement in the session is recoverable, and lands ~1 s past the last lock', { skip }, () => {
    // 34 regions retired across 36 captures (the last two were still alive when
    // the session ended). 29 of the retirements are individually timestamped;
    // the rest share an inter-lock interval with another.
    assert.equal(Math.max(...LOCKS.map((l) => l.regionsExpired ?? 0)), 34)
    assert.ok(exactLastSeen.size >= 28, `${exactLastSeen.size} retirements individually timestamped`)
    // THE CHECK THAT MAKES IT A RECONSTRUCTION AND NOT A GUESS. Presence must
    // end AFTER the last recorded sighting, and by about half the recorder's
    // 2 s throttle — which is exactly where a uniformly-sampled last lock puts
    // it. Anything outside that band would mean the retirements are not lining
    // up with the presentations.
    const tails = [...exactLastSeen].map(([i, ls]) => (ls - PRES[i].lastProvable) / 1000)
    assert.ok(Math.min(...tails) > 0, `a region cannot retire before its card's last recorded sighting (min ${Math.min(...tails).toFixed(2)}s)`)
    assert.ok(Math.max(...tails) < 2.0, `nor more than one throttle interval after it (max ${Math.max(...tails).toFixed(2)}s)`)
    assert.ok(TAIL / 1000 > 0.8 && TAIL / 1000 < 1.5, `median tail ${(TAIL / 1000).toFixed(2)}s`)
  })

  it('the owner dealt a card every 7.6 s, which is what the window was longer than', { skip }, () => {
    const cadence: number[] = []
    for (let i = 1; i < PRES.length; i++) {
      const g = (PRES[i].birth - PRES[i - 1].birth) / 1000
      if (g < 40) cadence.push(g) // the one 70 s pause is not a card cadence
    }
    assert.equal(cadence.length, 34)
    const m = med(cadence)
    assert.ok(m > 7 && m < 8.5, `median card cadence ${m.toFixed(2)}s`)
    // THE MECHANISM, AS ONE COMPARISON. A window longer than the cadence means
    // every card waits out its predecessor; a window shorter than it means none
    // of them does. That is the whole finding of this session.
    assert.ok(REGION_DEPARTURE_MS < m * 1000, `the departure window (${REGION_DEPARTURE_MS} ms) must stay under the reader's own cadence (${m.toFixed(2)} s)`)
  })
})

// ---------------------------------------------------------------------------
// 2. WHAT THE SHIPPED 12 s COST, AS RECORDED
// ---------------------------------------------------------------------------

describe('owner session 2 — the 12 s window, and the 103.4 s it cost', () => {
  it('the latency distribution is bimodal and the split is the refractory', { skip }, () => {
    const suppressed = PRES.filter((p) => p.locks.some((l) => l.suppressedByRegion))
    const free = PRES.filter((p) => !p.locks.some((l) => l.suppressedByRegion))
    assert.equal(free.length, 13, 'thirteen presentations no region ever touched')
    assert.equal(suppressed.length, 23)
    // Thirteen of thirteen at the structural floor, to the hundredth: two ticks
    // for the tracker to call a track stable plus DEFAULT_LOCK_TICKS = 3.
    for (const p of free) assert.ok(Math.abs(p.lat - FLOOR) < 0.02, `free capture at ${p.lat.toFixed(2)}s, floor is ${FLOOR.toFixed(2)}s`)
    // And every slow capture is in the other group. No exceptions in 36.
    const slow = PRES.filter((p) => p.lat > 2.5)
    assert.equal(slow.length, 16)
    for (const p of slow) assert.ok(p.locks.some((l) => l.suppressedByRegion), `slow capture at t+${((p.birth - PRES[0].birth) / 1000).toFixed(0)}s had no suppressed lock`)
    assert.ok(Math.max(...PRES.map((p) => p.lat)) > 9.3, 'the worst wait was 9.41 s')
  })

  it('103.4 s of avoidable wait, all of it region suppression', { skip }, () => {
    const avoidable = PRES.reduce((a, p) => a + Math.max(0, p.lat - FLOOR), 0)
    assert.ok(avoidable > 102 && avoidable < 105, `avoidable wait ${avoidable.toFixed(1)}s`)
    const fromFree = PRES.filter((p) => !p.locks.some((l) => l.suppressedByRegion)).reduce((a, p) => a + Math.max(0, p.lat - FLOOR), 0)
    assert.ok(fromFree < 0.2, `the unsuppressed group contributes ${fromFree.toFixed(2)}s`)
  })

  it('the ground truth reconstructs to 36 captures of 31 distinct cards, 3 backs and 1 unreadable', { skip }, () => {
    // The check that makes the duplicate count below mean anything. The report
    // read a sequential Destined Rivals run off the crops — 32 collector
    // numbers with 127 appearing twice — and the reconstruction here has to
    // land on exactly that, with every one of the eleven committed truths
    // claimed by exactly one capture.
    const truths = PRES.map((p) => p.truth)
    assert.equal(truths.length, 36)
    assert.equal(truths.filter((t) => t === 'CARD-BACK').length, 3, 'three captures are the blue Pokeball card back')
    assert.equal(truths.filter((t) => !t).length, 1, 'one crop is too motion-blurred to read')
    const real = truths.filter((t): t is string => !!t && t !== 'CARD-BACK')
    assert.equal(real.length, 32)
    assert.equal(new Set(real).size, 31, 'exactly one card was presented twice')
    for (const c of COMMITTED_TRUTHS) assert.ok(real.includes(c), `committed truth ${c} was never assigned`)
  })

  it('THE PART THAT SETTLES IT: the 12 s window prevented no duplicate in this session', { skip }, () => {
    // All 36 presentations captured, and exactly ONE physical card was captured
    // twice — sv10-127, which the owner presented, took away, and put back. The
    // 12 s window did not prevent that duplicate. It suppressed the second
    // presentation for 6.54 s and then let it through anyway, because the card
    // had been gone for 5.35 s and the window only delays what it cannot refuse.
    //
    // So on this session the 12 s constant bought ZERO duplicate suppression for
    // its 103.4 s. A shorter window cannot make the count worse either: the set
    // of presentations is fixed, and `Scan.tsx` holds a per-track-id refractory
    // so each presentation fires at most once however early its region retires.
    const counts = new Map<string, Pres[]>()
    for (const p of PRES) {
      if (!p.truth || p.truth === 'CARD-BACK') continue
      counts.set(p.truth, [...(counts.get(p.truth) ?? []), p])
    }
    const repeats = [...counts].filter(([, ps]) => ps.length > 1)
    assert.equal(repeats.length, 1, `expected exactly one same-card double capture, got ${repeats.map(([c]) => c).join(', ') || 'none'}`)
    const [card, ps] = repeats[0]
    assert.equal(card, 'sv10-127')
    const gap = (ps[1].birth - ps[0].lastSeen) / 1000
    assert.ok(gap > 5 && gap < 6, `${card} came back ${gap.toFixed(2)}s after its region froze`)
    // The second presentation waited out the old window and captured regardless.
    assert.ok(ps[1].lat > 6, `the second sv10-127 waited ${ps[1].lat.toFixed(2)}s and was taken anyway`)
    // At the shipped window it is taken immediately instead — the same
    // duplicate, six seconds sooner.
    assert.ok(gap * 1000 > REGION_DEPARTURE_MS, 'the shipped window does not reach this re-presentation either')
  })
})

// ---------------------------------------------------------------------------
// 3. THE DROPOUT A REGION MUST SURVIVE ON THIS DEVICE — there isn't one
// ---------------------------------------------------------------------------

describe('owner session 2 — the phone never loses a card it can see', () => {
  it('THE MEASUREMENT THAT SIZES THE CONSTANT: zero same-card track losses in 81 locks', { skip }, () => {
    // Round 3's fake camera produced eight stretches of 4.67-11.37 s in which a
    // continuously-present card had NO track, and fifteen track ids for that one
    // card. That distribution is what REGION_DEPARTURE_MS used to be sized on.
    // This device has none of it.
    const sameTrackGaps: number[] = []
    for (const p of PRES) for (let i = 1; i < p.locks.length; i++) sameTrackGaps.push((p.locks[i].epochMs - p.locks[i - 1].epochMs) / 1000)
    assert.ok(sameTrackGaps.length >= 40, `${sameTrackGaps.length} within-presentation lock gaps`)
    // Every one of them IS the recorder's own 2 s throttle — the engine held the
    // lock continuously between them.
    assert.ok(Math.min(...sameTrackGaps) >= 2.0, `min ${Math.min(...sameTrackGaps).toFixed(2)}s`)
    assert.ok(Math.max(...sameTrackGaps) <= 2.75, `a lock was lost mid-presentation: ${Math.max(...sameTrackGaps).toFixed(2)}s`)
    // Nothing coasted, and one card held one id for nine unbroken seconds.
    assert.equal(LOCKS.filter((l) => l.coasting).length, 0)
    const maxAge = Math.max(...LOCKS.map((l) => l.age ?? 0))
    assert.ok(maxAge >= 60, `longest unbroken run on one track: ${maxAge} ticks = ${(maxAge / 7.5).toFixed(1)}s`)
  })

  it('and it acquires a card the instant one is there, which is why "no track" means "no card"', { skip }, () => {
    // Every presentation's first lock is at age 5 — the structural minimum. A
    // detector that acquires in 0.67 s every single time is not a detector that
    // loses a static card for seconds, so a gap with no track is the reader
    // having taken the card away.
    for (const p of PRES) {
      if (!p.locks.length) continue
      assert.equal(p.locks[0].age, 5, `first lock of track ${p.trackId} at age ${p.locks[0].age}`)
    }
    assert.ok(PRES.filter((p) => p.locks.length).length >= 35)
  })

  it('the swap gaps clear the re-anchor bridge, so a swap is not adopted', { skip }, () => {
    // The bridge (REGION_BRIDGE_MS) re-anchors a region onto a track standing on
    // it within 1.5 s of the card's last sighting. That is safe only if real
    // swaps take longer than that, which this session measures directly.
    const gaps: number[] = []
    for (let i = 1; i < PRES.length; i++) {
      const g = (PRES[i].birth - PRES[i - 1].lastSeen) / 1000
      if (g < 40) gaps.push(g)
    }
    assert.ok(med(gaps) > 3, `median swap gap ${med(gaps).toFixed(2)}s`)
    assert.ok(gaps.filter((g) => g * 1000 <= REGION_BRIDGE_MS).length <= 4, `${gaps.filter((g) => g * 1000 <= REGION_BRIDGE_MS).length} of ${gaps.length} swaps land inside the bridge`)
  })
})

// ---------------------------------------------------------------------------
// 4. THE SWEEP — exact, and the one that moved the constant
// ---------------------------------------------------------------------------

/**
 * The latency every presentation would have had at `departureMs`.
 *
 * Exact for any value at or below the 12 s that produced this recording: the
 * binding region is the same at every value and only its retirement moves, so a
 * suppressed presentation's wait falls by `12 s - departureMs` and re-floors,
 * and a free presentation stays free. See the file header for why each of those
 * three steps holds.
 */
function latenciesAt(departureMs: number): number[] {
  const shift = (12_000 - departureMs) / 1000
  return PRES.map((p) => (p.lat <= FLOOR + 0.02 ? p.lat : Math.max(FLOOR, p.lat - shift)))
}

describe('owner session 2 — THE SWEEP that moved REGION_DEPARTURE_MS', () => {
  it('the table, as it appears in regions.REGION_DEPARTURE_MS', { skip }, () => {
    const expected: Array<[number, number, number, number]> = [
      // departure, total wait (s), max latency (s), captures over 2.5 s
      [12_000, 127.5, 9.41, 16],
      [8_000, 59.8, 5.41, 9],
      [6_000, 36.2, 3.41, 3],
      [5_000, 29.2, 2.41, 0],
      [4_000, 25.0, 1.41, 0],
      [3_000, 24.0, 0.68, 0],
    ]
    for (const [d, total, max, slow] of expected) {
      const lats = latenciesAt(d)
      const t = lats.reduce((a, b) => a + b, 0)
      assert.ok(Math.abs(t - total) < 0.2, `departure ${d}: total wait ${t.toFixed(1)}s, expected ${total}s`)
      assert.ok(Math.abs(Math.max(...lats) - max) < 0.05, `departure ${d}: max ${Math.max(...lats).toFixed(2)}s, expected ${max}s`)
      assert.equal(lats.filter((x) => x > 2.5).length, slow, `departure ${d}: ${lats.filter((x) => x > 2.5).length} slow captures`)
    }
  })

  it('THE DECISION: 5 s removes every slow capture and 98.2 s of the 103.4 s', { skip }, () => {
    const shipped = latenciesAt(REGION_DEPARTURE_MS)
    const before = PRES.map((p) => p.lat)
    const saved = before.reduce((a, b) => a + b, 0) - shipped.reduce((a, b) => a + b, 0)
    assert.ok(saved > 98 && saved < 99, `${saved.toFixed(1)}s of wait removed`)
    assert.equal(shipped.filter((x) => x > 2.5).length, 0, 'no capture in this session may still be slow')
    assert.ok(Math.abs(med(shipped) - FLOOR) < 0.02, `median latency ${med(shipped).toFixed(2)}s must be the floor`)
    assert.ok(quantile(shipped, 0.9) < 1.5, `p90 latency ${quantile(shipped, 0.9).toFixed(2)}s`)
    // ...and below 3 s there is nothing left to win, which is the other half of
    // "5 s and not less": the remaining wait is the floor itself.
    const floorOnly = PRES.length * FLOOR
    assert.ok(latenciesAt(3_000).reduce((a, b) => a + b, 0) - floorOnly < 0.5, 'at 3 s the session is already at the floor')
  })

  it('...at a cost of nothing measurable in this session', { skip }, () => {
    // Every presentation still captures, because a shorter window cannot
    // suppress more than a longer one, and each track fires at most once.
    for (const d of [3_000, 4_000, 5_000, 6_000, 8_000, 12_000]) {
      assert.equal(latenciesAt(d).length, 36, `departure ${d}: all 36 presentations still capture`)
    }
    // The duplicate count is fixed by the presentations, not by the window: the
    // one same-card double at every value, and the 12 s build took it too.
    const truths = PRES.map((p) => p.truth).filter((t): t is string => !!t && t !== 'CARD-BACK')
    const doubles = [...new Set(truths)].filter((t) => truths.filter((x) => x === t).length > 1)
    assert.equal(doubles.length, 1)
  })
})

// ---------------------------------------------------------------------------
// 5. THE GEOMETRIC REPLAY — the real policy, driven, as a mechanism check
// ---------------------------------------------------------------------------
//
// Everything above is arithmetic on recorded instants. This drives the SHIPPING
// `createCapturedRegions` over a reconstructed presence signal, so the mechanism
// itself is exercised rather than described.
//
// ITS ONE HONEST LIMIT, and it is not in the conservative direction, which is
// why the sweep above is not built on it. A region FOLLOWS its track, so while
// the hand lifts a card away the region goes with it — and the last position
// that motion reaches is not recorded anywhere. This replay can only freeze a
// region at its last RECORDED quad, which is still square in the reticle, so it
// suppresses swaps that production let through. Measured: 28 of the 35
// subsequent presentations overlap the previous CAPTURE at >= REGION_SAME_IOU
// and the shipped build suppressed 21 of them. The replay therefore
// over-suppresses at long windows, which FLATTERS a shortening.

const TICK_MS = DEFAULT_CADENCE_MS

function quadAt(p: Pres, t: number): Quad {
  let best: Ev = p.cap
  let bd = Math.abs(p.birth + p.lat * 1000 - t)
  for (const l of p.locks) {
    const d = Math.abs(l.epochMs - t)
    if (d < bd) {
      bd = d
      best = l
    }
  }
  return best.quad
}

function replay(departureMs: number) {
  const R = createCapturedRegions({ departureMs })
  const refractory = new Set<number>()
  const verdict = new Map<number, boolean>()
  const fired: Array<{ t: number; pres: Pres }> = []
  const end = Math.max(...PRES.map((p) => p.lastSeen))
  let li = 0
  for (let t = PRES[0].birth; t <= end; t += TICK_MS) {
    const live = PRES.filter((p) => t >= p.birth && t <= p.lastSeen)
    R.tick(t, live.map((p) => ({ id: p.trackId, quad: quadAt(p, t) }) as RegionTrack))
    for (const id of [...refractory]) if (!live.some((p) => p.trackId === id)) refractory.delete(id)
    while (li < LOCKS.length && LOCKS[li].epochMs <= t + TICK_MS) {
      verdict.set(LOCKS[li].id, R.suppressed(LOCKS[li].quad))
      li++
    }
    for (const p of live) {
      // "locked" starts five ticks after birth — every first lock in this
      // session is at age 5, so that is not an assumption, it is the data.
      if (t < p.birth + (5 / p.cap.perf.hz) * 1000) continue
      if (refractory.has(p.trackId)) continue
      const quad = quadAt(p, t)
      if (R.suppressed(quad)) continue
      refractory.add(p.trackId)
      fired.push({ t, pres: p })
      R.note(quad, p.trackId, t)
    }
  }
  return { fired, verdict, expired: R.expired }
}

describe('owner session 2 — the shipping policy, driven', () => {
  it('THE LIMIT, MEASURED: a region follows its card off the spot and this replay cannot', { skip }, () => {
    let overlapping = 0
    let overlappingAndFree = 0
    for (let i = 1; i < PRES.length; i++) {
      const p = PRES[i]
      if (!p.locks.length) continue
      if (polyIoU(PRES[i - 1].quad, p.locks[0].quad) < REGION_SAME_IOU) continue
      overlapping++
      if (!p.locks[0].suppressedByRegion) overlappingAndFree++
    }
    assert.equal(overlapping, 28, `${overlapping} of 35 presentations land on the previous capture's quad`)
    assert.ok(overlappingAndFree >= 5, `only ${overlappingAndFree} of them were free — the lift has to move the region for that`)
    // The consequence, stated as a number so it cannot rot: the replay agrees
    // with the recorded suppression flags on most locks but not all, and the
    // disagreement is one-directional.
    const { verdict } = replay(12_000)
    const agree = LOCKS.filter((l) => verdict.get(l.id) === !!l.suppressedByRegion).length
    assert.ok(agree / LOCKS.length > 0.8, `replay reproduced ${agree}/${LOCKS.length} recorded suppression flags`)
    const over = LOCKS.filter((l) => verdict.get(l.id) && !l.suppressedByRegion).length
    const under = LOCKS.filter((l) => !verdict.get(l.id) && l.suppressedByRegion).length
    assert.ok(over >= under, `over-suppressed ${over}, under-suppressed ${under} — the bias must be the one the header describes`)
  })

  it('THE MECHANISM: driven on this session, the real policy reproduces the sweep it was measured with', { skip }, () => {
    // Not the same numbers as the exact model — the limit above guarantees that
    // — but the same shape, and the same answer at the point that matters: at
    // the shipped window every presentation fires and nothing is slow, while at
    // 12 s a third of them are still waiting.
    const at5 = replay(REGION_DEPARTURE_MS)
    const at12 = replay(12_000)
    assert.ok(at5.fired.length > at12.fired.length, `${at12.fired.length} -> ${at5.fired.length} auto-captures`)
    const lat = (r: ReturnType<typeof replay>) => {
      const first = new Map<number, number>()
      for (const f of r.fired) if (!first.has(f.pres.capId)) first.set(f.pres.capId, (f.t - f.pres.birth) / 1000)
      return [...first.values()]
    }
    const l5 = lat(at5)
    const l12 = lat(at12)
    assert.equal(l5.filter((x) => x > 2.5).length, 0, 'no slow capture survives at the shipped window')
    assert.ok(l12.filter((x) => x > 2.5).length >= 8, `the 12 s window left ${l12.filter((x) => x > 2.5).length} slow captures even on this over-suppressing replay`)
    assert.ok(l5.reduce((a, b) => a + b, 0) < l12.reduce((a, b) => a + b, 0) / 2, 'total wait must at least halve')
    // Monotone, and it has to be: a shorter window can never suppress more.
    const counts = [3_000, 4_000, 5_000, 6_000, 8_000, 12_000].map((d) => replay(d).fired.length)
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1], `auto-captures must not rise with the window: ${counts.join(', ')}`)
  })
})
