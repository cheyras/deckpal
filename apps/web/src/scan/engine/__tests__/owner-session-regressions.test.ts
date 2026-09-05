// OWNER SESSION 1 (2026-09-04, build deckpal-o81iruuou) — the first 39 minutes
// of this scanner used by its owner on his own phone, on his own cards, with the
// recorder on. 134 lock-events, 42 captures, 176 quads, and the only dataset
// this project has in which somebody was actually trying to get work done.
//
// Two findings are fenced here. The display bug it also found has its own file
// (`overlay-alignment.test.ts`).
//
// ── 1. OVERLAP IS NOT IDENTITY ──────────────────────────────────────────────
//
// `regions.ts` let a captured region FOLLOW and REFRESH against any track
// overlapping it at >= REGION_SAME_IOU, on the reasoning that "a region must
// only ever follow something it would also recognise as itself". This session
// says overlap cannot recognise anything: a reader working a stack puts the next
// card almost exactly where the last one was, so the previous card's region
// adopts its replacement, refreshes, and never expires. 115 of 134 locks were
// suppressed, regions ran eleven deep, and the module's stated "at most one
// departure window" cost was in fact unbounded.
//
// ── 2. WHAT THAT ACTUALLY COST, WHICH IS NOT 76.9 % ─────────────────────────
//
// The session report's headline is that 103 of 134 locks were `wouldCapture`
// and suppressed. That is a count of the SUPPRESSION and not of the harm: this
// owner held one card in front of the camera for twenty or thirty consecutive
// locks at a time, and every one of those re-locks SHOULD be suppressed. Sizing
// the harm needs to know which locks were a NEW card, which the telemetry does
// not record — so it is recovered from the pixels (`analysis/card-identity.mjs`:
// each event's quad re-rectified through the shipping warp and correlated with
// its neighbour). Read against that, the ceiling on any region policy is 12 of
// his 21 manual button presses; the other 9 never locked at all, because they
// failed the saturation or shape/straddle gates — which is exactly what the
// session report attributes independently (4 below the saturation gate, 5
// failing shape/straddle). This file used to say 13 and 8; that came from a
// press metric with an 8 s look-back, and `manualPressesSaved` documents why
// the look-back had to go.
//
// ── 3. THE DROPOUT A PHONE ACTUALLY HAS (added 2026-09-05) ──────────────────
//
// REGION_DEPARTURE_MS had been sized on a desktop fake camera that loses a
// static card for up to 11.37 s. This session measures the same quantity on
// hardware: four same-card track re-ids at 1.07-2.38 s, and an empty band from
// there to the next event of any kind. See section 3b.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import { DEFAULT_CADENCE_MS } from '../index'
import { DEFAULT_LOCK_MIN_SATURATION } from '../index'
import { orderQuadForCard } from '../rectify'
import { createCapturedRegions, REGION_DEPARTURE_MS, REGION_SAME_IOU, type RegionTrack } from '../../ui/regions'

const SESSION = 'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/owner-session-1/'

interface Ev {
  file: string
  type: string
  epochMs: number
  quad: Quad
  trackId: number
  trigger?: 'auto' | 'manual'
  wouldCapture?: boolean
  suppressedByRegion?: boolean
  regionCount?: number
  saturation?: number
  cameraBox?: { width: number; height: number }
  /** ticks this track has been observed for — on a lock-event */
  age?: number
  /** ...and on a capture-event, where it is nested */
  track?: { age: number; coasting: boolean }
  coasting?: boolean
  perf?: { hz: number; detectMs: number; jitterPx: number }
}
interface Identity {
  method: string
  events: Array<{ file: string; simToPrev: number | null }>
  toCaptures: Array<Record<string, number>>
}

function read<T>(rel: string): T | null {
  const p = SESSION + rel
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : null
}
const ALL = (read<Ev[]>('events.json') ?? [])
  .filter((e) => e.type === 'lock-event' || e.type === 'capture-event')
  .sort((a, b) => a.epochMs - b.epochMs)
const ID = read<Identity>('card-identity.json')
const have = ALL.length > 0 && !!ID && ID.events.length === ALL.length
const skip = have ? false : ('owner-session artifacts unavailable' as const)

const LOCKS = ALL.filter((e) => e.type === 'lock-event')
const CAPS = ALL.filter((e) => e.type === 'capture-event')
const MANUALS = CAPS.filter((e) => e.trigger === 'manual')

/** The three identity bands. The middle one is never counted either way — see
 *  `card-identity.mjs` for the validation that makes the outer two safe. */
const SAME = 0.75
const DIFFERENT = 0.5
const simToPrev = (i: number) => ID!.events[i].simToPrev
const simToCapture = (i: number, cap: Ev) => ID!.toCaptures[i][cap.file]

// ---------------------------------------------------------------------------
// 1. THE FINDING: no overlap threshold separates a card from its replacement
// ---------------------------------------------------------------------------

describe('owner session 1 — overlap cannot tell a card from the one that replaced it', () => {
  it('the session artifacts are present', () => {
    assert.ok(have, 'owner-session-1 events.json / card-identity.json missing')
  })

  it('THE MEASUREMENT that rules out repairing the follow rule with a bigger number', { skip }, () => {
    // Every consecutive pair of the 176 recorded quads, labelled by picture and
    // scored by geometry. If some IoU threshold separated "same card" from "next
    // card", the follow rule could simply be tightened; there is none.
    const same: number[] = []
    const different: number[] = []
    for (let i = 1; i < ALL.length; i++) {
      const s = simToPrev(i)
      if (s === null) continue
      const iou = polyIoU(ALL[i - 1].quad, ALL[i].quad)
      if (s >= SAME) same.push(iou)
      else if (s < DIFFERENT) different.push(iou)
    }
    assert.ok(same.length >= 80, `expected a large same-card population, got ${same.length}`)
    assert.ok(different.length >= 30, `expected a real card-change population, got ${different.length}`)

    const share = (xs: number[], t: number) => xs.filter((v) => v >= t).length / xs.length
    // At the shipped follow threshold, nearly two thirds of REAL card changes
    // look like the same card. That is the bug, as one number.
    const adoptedAtShipped = share(different, REGION_SAME_IOU)
    assert.ok(
      adoptedAtShipped > 0.55,
      `overlap at ${REGION_SAME_IOU} adopts ${(adoptedAtShipped * 100).toFixed(0)}% of real card changes`,
    )
    // And no threshold rescues it: anywhere the card-change adoption rate drops
    // below 20%, more than a quarter of genuine same-card follows are lost too,
    // which is the failure the follow rule exists to prevent.
    for (const t of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const adopts = share(different, t)
      const keeps = share(same, t)
      assert.ok(
        adopts > 0.2 || keeps < 0.75,
        `IoU >= ${t} would separate them (adopts ${(adopts * 100).toFixed(0)}% of changes, keeps ${(keeps * 100).toFixed(0)}% of follows) — if this ever fires, the follow rule can go back to geometry`,
      )
    }
  })

  it('the tracker DOES tell them apart, which is why the follow is gated on the track id', { skip }, () => {
    let changeWithNewId = 0
    let changeWithSameId = 0
    let sameCardKeptId = 0
    let sameCardLostId = 0
    for (let i = 1; i < ALL.length; i++) {
      const s = simToPrev(i)
      if (s === null) continue
      const keptId = ALL[i].trackId === ALL[i - 1].trackId
      if (s >= SAME) keptId ? sameCardKeptId++ : sameCardLostId++
      else if (s < DIFFERENT) keptId ? changeWithSameId++ : changeWithNewId++
    }
    const detects = changeWithNewId / (changeWithNewId + changeWithSameId)
    const survives = sameCardKeptId / (sameCardKeptId + sameCardLostId)
    assert.ok(detects >= 0.7, `a real card change brings a new track id ${(detects * 100).toFixed(0)}% of the time`)
    assert.ok(survives >= 0.85, `a card keeps its track id across ${(survives * 100).toFixed(0)}% of consecutive sightings`)
    // Strictly better than the geometry it replaces, on the same pairs.
    const overlapAdopts =
      ALL.slice(1).filter((_, k) => {
        const i = k + 1
        const s = simToPrev(i)
        return s !== null && s < DIFFERENT && polyIoU(ALL[i - 1].quad, ALL[i].quad) >= REGION_SAME_IOU
      }).length / (changeWithNewId + changeWithSameId)
    assert.ok(1 - detects < overlapAdopts, 'the track id must confuse fewer card changes than overlap does')
  })
})

// ---------------------------------------------------------------------------
// 2. WHAT THE SHIPPED BUILD DID
// ---------------------------------------------------------------------------

describe('owner session 1 — the shipped region policy, as recorded', () => {
  it('115 of 134 locks were suppressed and regions ran eleven deep', { skip }, () => {
    assert.equal(LOCKS.length, 134)
    assert.equal(CAPS.length, 42)
    assert.equal(MANUALS.length, 21, 'half the session was driven by hand')
    assert.equal(LOCKS.filter((l) => l.suppressedByRegion).length, 115)
    assert.equal(LOCKS.filter((l) => l.wouldCapture && l.suppressedByRegion).length, 103)
    assert.equal(Math.max(...LOCKS.map((l) => l.regionCount ?? 0)), 11)
    // The telemetry is internally coherent — no lock claims suppression with no
    // live region — which is what makes it usable as a fixture at all.
    for (const l of LOCKS) if (l.suppressedByRegion) assert.ok((l.regionCount ?? 0) > 0, 'suppressed with no region')
  })

  it('but most of that suppression was correct: the owner held one card for 20+ locks at a time', { skip }, () => {
    // The corrective to reading 76.9 % as the size of the bug. Consecutive
    // events that are provably the SAME card outnumber provable changes almost
    // three to one, and the longest unbroken same-card run is over twenty
    // events — 40 s of one Darumaka.
    let longest = 0
    let run = 1
    for (let i = 1; i < ALL.length; i++) {
      const s = simToPrev(i)
      if (s !== null && s >= SAME) run++
      else {
        longest = Math.max(longest, run)
        run = 1
      }
    }
    assert.ok(longest >= 15, `longest provable same-card run was ${longest} events`)
  })
})

// ---------------------------------------------------------------------------
// 3. THE REPLAY — the shipping policy, driven, on this session's own stream
// ---------------------------------------------------------------------------
//
// Built the same way round 3's is (`e2e-round3-regressions.test.ts`): the lock
// stream is throttled to one post per 2 s, so the presence signal is
// reconstructed at the engine's own tick cadence before the policy sees it.
//
// TWO HONEST LIMITS ON THIS MODEL, both in the conservative direction.
// Production ticks the policy against EVERY stable and pending track; this can
// only offer the LOCKED one, so a region whose card is present but not currently
// locked goes unrefreshed here and would be refreshed in production — the replay
// therefore over-fires rather than under-fires. And it reproduces 80 % of the
// recorded `suppressedByRegion` flags rather than all of them, for the same
// reason (round 3's replay, with one object in frame, reproduces its build
// exactly). Neither affects the comparison below, which runs both policies
// through the identical reconstruction.

const TICK_MS = DEFAULT_CADENCE_MS
const LOCK_THROTTLE_MS = 2_000
const CONTINUOUS_MS = 3_000

function presence(): Array<{ t: number; tracks: RegionTrack[] }> {
  const out: Array<{ t: number; tracks: RegionTrack[] }> = []
  let li = 0
  for (let t = LOCKS[0].epochMs; t <= ALL[ALL.length - 1].epochMs; t += TICK_MS) {
    while (li + 1 < LOCKS.length && LOCKS[li + 1].epochMs <= t) li++
    const cur = LOCKS[li]
    const nxt = LOCKS[li + 1]
    let present = t - cur.epochMs <= LOCK_THROTTLE_MS
    let e = cur
    if (nxt && nxt.epochMs - cur.epochMs <= CONTINUOUS_MS) {
      present = true
      e = t - cur.epochMs < nxt.epochMs - t ? cur : nxt
    }
    out.push({ t, tracks: present ? [{ id: e.trackId, quad: e.quad }] : [] })
  }
  return out
}

/** The two policies, behind one signature: `ask` reports whether this event is
 *  suppressed, `keep` remembers a capture, `age` runs one tick. */
interface Policy {
  age(now: number, tracks: readonly RegionTrack[]): void
  ask(quad: Quad): boolean
  keep(quad: Quad, trackId: number, now: number): void
}

/** THE SHIPPING POLICY, driven — not a copy of it. */
function shipped(departureMs = REGION_DEPARTURE_MS): Policy {
  const R = createCapturedRegions({ departureMs })
  return { age: (now, tracks) => void R.tick(now, tracks), ask: (q) => R.suppressed(q), keep: (q, id, now) => R.note(q, id, now) }
}

/**
 * THE RULE THAT WAS SHIPPED UNTIL 2026-09-04, reproduced here because it no
 * longer exists in the tree and the whole point is the comparison. Kept to a
 * dozen lines and quoted from the diff it replaced: a region follows the
 * best-overlapping track at or above REGION_SAME_IOU and refreshes on it.
 */
function overlapFollowing(departureMs = REGION_DEPARTURE_MS): Policy {
  let regions: Array<{ quad: Quad; lastSeen: number }> = []
  return {
    age(now, tracks) {
      for (const r of regions) {
        let best: Quad | null = null
        let bestIoU = REGION_SAME_IOU
        for (const t of tracks) {
          const iou = polyIoU(r.quad, t.quad)
          if (iou >= bestIoU) {
            bestIoU = iou
            best = t.quad
          }
        }
        if (best) {
          r.quad = best
          r.lastSeen = now
        }
      }
      regions = regions.filter((r) => now - r.lastSeen < departureMs)
    },
    ask: (q) => regions.some((r) => polyIoU(r.quad, q) >= REGION_SAME_IOU),
    keep: (q, _id, now) => void regions.push({ quad: q, lastSeen: now }),
  }
}

/**
 * Replay the session's own decisions. Every `wouldCapture` lock the policy does
 * not suppress becomes an auto-capture; the owner's manual presses still happen
 * (he pressed the button) and still claim their region, exactly as `Scan.tsx`
 * does. Returns the indices into `ALL` that fired, and the per-lock suppression
 * verdicts so the model can be checked against what was recorded.
 */
function replay(P: Policy) {
  const fired: number[] = []
  const verdict = new Map<string, boolean>()
  let ei = 0
  for (const tk of presence()) {
    P.age(tk.t, tk.tracks)
    while (ei < ALL.length && ALL[ei].epochMs <= tk.t + TICK_MS) {
      const e = ALL[ei]
      const suppressed = P.ask(e.quad)
      if (e.type === 'lock-event') {
        verdict.set(e.file, suppressed)
        if (e.wouldCapture && !suppressed) {
          fired.push(ei)
          P.keep(e.quad, e.trackId, e.epochMs)
        }
      } else if (e.trigger === 'manual') {
        P.keep(e.quad, e.trackId, e.epochMs)
      }
      ei++
    }
  }
  return { fired, verdict }
}

/**
 * How many of the owner's 21 manual presses this policy would have made
 * unnecessary: an auto-capture of the SAME card, within LOOK_BACK_MS before it.
 *
 * IT USED TO BE 8 s, AND THAT WINDOW WAS CARRYING THE ANSWER. The look-back is
 * not scale-free: shortening `REGION_DEPARTURE_MS` moves an auto-capture
 * EARLIER, and one that moves from 5.8 s before the press to 12.0 s before it
 * drops out of an 8 s window — so the metric scored the shorter window as
 * having LOST a rescue it had in fact delivered sooner. Three of the four
 * presses whose verdict changed between the old 12 s constant and the new 5 s
 * one were exactly that (the fourth was a rescue the shorter window genuinely
 * gained), and sweeping the look-back from 8 s to 30 s INVERTS the ranking of
 * the two constants. That is the tell.
 *
 * 20 s is 8 s plus the widest departure window this file sweeps, which makes it
 * the smallest look-back the constant under test cannot push a rescue out of.
 * The number it produces for the no-region ceiling — 12 of 21 — also reproduces
 * the session report's independent attribution of the other nine (4 below the
 * saturation gate, 5 failing shape/straddle), which the 8 s window did not.
 */
const LOOK_BACK_MS = 20_000
function manualPressesSaved(fired: number[]): number {
  let n = 0
  for (const m of MANUALS) {
    const idx = ALL.indexOf(m)
    if (fired.some((i) => ALL[i].epochMs <= m.epochMs && m.epochMs - ALL[i].epochMs <= LOOK_BACK_MS && simToCapture(i, m) >= 0.6)) n++
    else if (idx < 0) throw new Error('unreachable')
  }
  return n
}
/** Fires that are provably the same card as the fire before them. */
function duplicates(fired: number[]): number {
  let n = 0
  for (let k = 1; k < fired.length; k++) {
    const prev = ALL[fired[k - 1]]
    const cur = fired[k]
    // Both are events; compare the later one against the earlier one's own
    // column when the earlier one is a capture, otherwise walk the chain.
    const s = prev.type === 'capture-event' ? simToCapture(cur, prev) : nearestSim(fired[k - 1], cur)
    if (s >= SAME) n++
  }
  return n
}
/** Similarity between two arbitrary events, via the capture each is closest to
 *  in appearance — the identity file stores every event against every capture. */
function nearestSim(a: number, b: number): number {
  let best = -1
  for (const c of CAPS) {
    const sa = simToCapture(a, c)
    const sb = simToCapture(b, c)
    if (sa >= SAME && sb > best) best = sb
  }
  return best
}

describe('owner session 1 — THE FIX, replayed on the session that found it', () => {
  it('THE MODEL IS VALIDATED: the old rule, replayed, reproduces what the build recorded', { skip }, () => {
    // The claim everything below rests on. A replay that cannot reproduce the
    // measured outcome cannot be trusted to predict a different one. Not 100 %,
    // and the header says why (this can only offer the LOCKED track, where
    // production ticks against every stable and pending one) — stated as a floor
    // so the number cannot quietly rot.
    const { verdict } = replay(overlapFollowing())
    let agree = 0
    for (const l of LOCKS) if (verdict.get(l.file) === !!l.suppressedByRegion) agree++
    assert.ok(agree / LOCKS.length > 0.75, `replay reproduced ${agree}/${LOCKS.length} recorded suppression flags`)
  })

  it('THE CEILING: nine of the manual presses are not the region policy to fix', { skip }, () => {
    // With NO region at all, nine of his twenty-one manual presses still had to
    // be manual: the card never locked, because it failed the saturation or the
    // shape/straddle gate. Any claim about "fixing auto-capture" is bounded by
    // this number, and the session report attributes the remainder exactly
    // (4 below the saturation gate, 5 failing shape/straddle) — which is what
    // the twelve below independently reproduces.
    const ceiling = manualPressesSaved(replay(shipped(1)).fired)
    assert.ok(ceiling <= 13, `no-region upper bound is ${ceiling} of 21`)
    assert.ok(ceiling >= 11, `no-region upper bound is ${ceiling} of 21`)
  })

  it('THE FIX: identity-gated follow frees far more of the suppressed locks on this session', { skip }, () => {
    const before = replay(overlapFollowing()).fired
    const after = replay(shipped()).fired
    assert.ok(
      after.length >= before.length * 1.4,
      `auto-captures ${before.length} -> ${after.length}; the identity gate must materially free the suppressed locks`,
    )
    const savedBefore = manualPressesSaved(before)
    const savedAfter = manualPressesSaved(after)
    // Two, not the three this asserted at the old 12 s departure. The gap
    // between the two follow rules NARROWS as the window shortens, and it must:
    // a short window retires an over-adopted region too, so overlap-following
    // costs less when there is less time for it to be wrong. The finding is the
    // direction, and the direction is what is fenced.
    assert.ok(
      savedAfter >= savedBefore + 2,
      `manual presses made unnecessary ${savedBefore} -> ${savedAfter} of 21`,
    )
    // And the cost, bounded: the extra fires are overwhelmingly NEW cards, not
    // repeats of one the reader already has.
    const dupAfter = duplicates(after)
    assert.ok(dupAfter <= after.length * 0.25, `${dupAfter} of ${after.length} fires are duplicates`)
  })

  it("the session's very first swap stops being swallowed", { skip }, () => {
    // t+2.9 s: a Shaymin is captured. t+8.5 s to t+19.1 s: a DIFFERENT card is
    // presented in the same spot, locks six times, and every one of those locks
    // is recorded `wouldCapture: true, suppressedByRegion: true`. It was never
    // captured at all — the region that took the Shaymin had adopted it.
    const first = ALL.findIndex((e) => e.type === 'capture-event')
    const swap = ALL.slice(first + 1, first + 8)
    assert.ok(swap.length >= 6, 'the swap window is in the fixture')
    assert.ok(
      swap.every((e) => e.type === 'lock-event' && e.wouldCapture && e.suppressedByRegion),
      'the shipped build suppressed every lock of the replacement card',
    )
    // ...and the replacement really is a different card, by picture.
    assert.ok(simToCapture(first + 1, ALL[first]) < DIFFERENT, 'the replacement is provably not the captured card')
    const after = replay(shipped()).fired
    assert.ok(
      after.some((i) => i > first && i <= first + 8),
      'the identity-gated policy must capture the replacement card',
    )
  })
})

// ---------------------------------------------------------------------------
// 3b. THE DROPOUT A REGION MUST SURVIVE ON A PHONE — the number that sizes
//     REGION_DEPARTURE_MS, measured here for the first time on real hardware
// ---------------------------------------------------------------------------
//
// REGION_DEPARTURE_MS was 12 s because a desktop fake camera lost a static card
// for up to 11.37 s at a time (`e2e-round3-regressions.test.ts`). The quantity
// that actually justifies the constant is: how long can a region's OWN TRACK be
// gone while the card it holds is still sitting there? Only that stretch runs
// the departure clock under a present card. This session can answer it, because
// `card-identity.json` says which consecutive events are the same card by
// picture and `age`/`hz` say exactly when each track was born.

/** The instant a track came into existence: `epochMs - age / hz`. */
function trackBirth(e: Ev): number {
  const age = e.age ?? e.track?.age ?? 0
  const hz = e.perf?.hz ?? 7.5
  return e.epochMs - (age / hz) * 1000
}

describe('owner session 1 — a phone does not lose a card it can see', () => {
  it('THE MEASUREMENT: same-card track re-ids split into two populations with an empty band', { skip }, () => {
    // Every consecutive pair that is provably the SAME card and carries a NEW
    // track id — i.e. the tracker dropped the card and re-acquired it. The gap
    // is measured from the older event to the moment the NEW track was born,
    // which is the real unseen stretch and not the recorder's 2 s throttle.
    const gaps: number[] = []
    for (let i = 1; i < ALL.length; i++) {
      const s = simToPrev(i)
      if (s === null || s < SAME) continue
      if (ALL[i].trackId === ALL[i - 1].trackId) continue
      gaps.push((trackBirth(ALL[i]) - ALL[i - 1].epochMs) / 1000)
    }
    gaps.sort((a, b) => a - b)
    assert.equal(gaps.length, 7, `expected 7 same-card re-ids in this session, got ${gaps.length}`)

    // THE EMPTY BAND. Four sit at 1.07-2.38 s and three at 4.12-7.26 s, with
    // nothing between. The short group is the tracker re-iding a card that
    // never left. The long group is the card being AWAY, and the session says
    // so in one number: every track in this session reaches its first lock at
    // age 5 (0.67 s), so the detector acquires a card essentially the instant
    // one is present — "no track" on this device means "no card", not "a card
    // the detector cannot see". Each of the three also has the previous track
    // dying with no successor for seconds, and two of them skip an intervening
    // track id entirely (a hand crossing the frame).
    const short = gaps.filter((g) => g < 3)
    const long = gaps.filter((g) => g >= 3)
    assert.equal(short.length, 4, `short group: ${short.map((g) => g.toFixed(2)).join(' ')}`)
    assert.equal(long.length, 3, `long group: ${long.map((g) => g.toFixed(2)).join(' ')}`)
    assert.ok(Math.max(...short) <= 2.4, `re-ids top out at ${Math.max(...short).toFixed(2)}s`)
    assert.ok(Math.min(...long) >= 4.1, `absences start at ${Math.min(...long).toFixed(2)}s`)

    // THE FENCE THIS PUTS UNDER THE CONSTANT. It must outlast the longest gap
    // with the card provably still there, and it must not be sized on the fake
    // camera's 11.37 s — see regions.REGION_DEPARTURE_MS for the argument and
    // `owner-session-2-regressions.test.ts` for the session that priced it.
    assert.ok(
      REGION_DEPARTURE_MS > Math.max(...short) * 1000,
      `the window (${REGION_DEPARTURE_MS} ms) must outlast a real device's track re-id (${Math.max(...short).toFixed(2)} s)`,
    )
    assert.ok(
      REGION_DEPARTURE_MS >= Math.max(...short) * 2000,
      `and with margin: ${REGION_DEPARTURE_MS} ms is only ${(REGION_DEPARTURE_MS / (Math.max(...short) * 1000)).toFixed(1)}x the longest measured re-id`,
    )
  })

  it('the tracker holds a stationary card for as long as it is there', { skip }, () => {
    // The other half of the same claim: when the card stays, the track stays.
    // 113 consecutive observed ticks is 15.1 s of unbroken detection on one id,
    // and nothing in the session is coasting.
    const maxAge = Math.max(...ALL.map((e) => e.age ?? e.track?.age ?? 0))
    assert.ok(maxAge >= 100, `longest unbroken track run was ${maxAge} ticks`)
    assert.equal(LOCKS.filter((l) => l.coasting).length, 0, 'no lock in this session is coasting')
  })

  it('THE SWEEP: what the departure window buys and costs on 39 minutes of real use', { skip }, () => {
    // Duplicate fires on this session are 5.8-18.1 s apart — spread across AND
    // beyond any defensible window — so the count does not fall as the window
    // widens. It is 2-6 at every value from 3 s to 15 s with no trend, which is
    // the honest reading: on phone data this constant is not buying duplicate
    // suppression, it is only deciding how long the NEXT card waits.
    const table = [3_000, 4_000, 5_000, 6_000, 8_000, 12_000].map((d) => {
      const f = replay(shipped(d)).fired
      return { d, fires: f.length, dup: duplicates(f), saved: manualPressesSaved(f) }
    })
    for (const r of table) {
      assert.ok(r.dup <= 6, `departure ${r.d}: ${r.dup} duplicate fires`)
      assert.ok(r.dup >= 2, `departure ${r.d}: ${r.dup} duplicate fires`)
    }
    // Monotone the only way it can be: a shorter window never suppresses more.
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i].fires <= table[i - 1].fires, `auto-fires must not rise as the window widens: ${table.map((r) => r.fires).join(', ')}`)
    }
    // And at the shipped value the session gains seven automatic captures over
    // the 12 s it replaced, for two more duplicates.
    const at5 = table.find((r) => r.d === 5_000)!
    const at12 = table.find((r) => r.d === 12_000)!
    assert.equal(at5.fires - at12.fires, 7, `5 s vs 12 s: ${at12.fires} -> ${at5.fires} auto-captures`)
    assert.equal(at5.dup - at12.dup, 2, `5 s vs 12 s: ${at12.dup} -> ${at5.dup} duplicate fires`)
    assert.ok(at5.saved >= at12.saved, `5 s must not rescue fewer presses than 12 s (${at12.saved} -> ${at5.saved})`)
  })
})

// ---------------------------------------------------------------------------
// 4. THE SATURATION GATE — the first real cards ever measured under it
// ---------------------------------------------------------------------------

describe('owner session 1 — four real cards sat below the clutter gate', () => {
  it('all four are MANUAL captures, because a card below the gate cannot lock', { skip }, () => {
    const low = CAPS.filter((c) => (c.saturation ?? 1) < 0.13)
    assert.equal(low.length, 4, 'four captures below the old 0.13 gate')
    for (const c of low) assert.equal(c.trigger, 'manual', 'a sub-gate card emits no lock-event, so only this channel sees it')
    assert.deepEqual(
      low.map((c) => c.saturation).sort((a, b) => (a ?? 0) - (b ?? 0)),
      [0.079, 0.103, 0.112, 0.126],
    )
    // And the lock stream is censored at the old gate exactly as it must be —
    // which is the proof that this channel was the only window onto them.
    assert.ok(Math.min(...LOCKS.map((l) => l.saturation ?? 1)) >= 0.13, 'lock-events cannot appear below the gate')
  })

  it('THE FINDING: real cards interleave with the printed mail the gate exists for', { skip }, () => {
    // The two envelopes the 2026-09-04 drive auto-captured measured 0.108-0.112.
    // The owner's cards run 0.079-0.126 through that band. There is no
    // threshold that admits his cards and refuses that mail.
    const MAIL_LOW = 0.108
    const MAIL_HIGH = 0.112
    const cards = CAPS.map((c) => c.saturation ?? 1)
    assert.ok(cards.some((s) => s < MAIL_LOW), 'a real card is DULLER than the dullest envelope')
    assert.ok(cards.some((s) => s >= MAIL_LOW && s <= MAIL_HIGH), 'a real card sits inside the envelope band')
    assert.ok(
      DEFAULT_LOCK_MIN_SATURATION < MAIL_HIGH,
      'the gate must not be raised back into the overlap — up there it refuses cards, and the mail it catches it catches by luck',
    )
  })

  it('THE FIX: the shipped gate now admits every card this session measured, with margin', { skip }, () => {
    const min = Math.min(...ALL.map((e) => e.saturation ?? 1))
    assert.equal(min, 0.079, 'the least colourful real card ever measured')
    assert.ok(
      DEFAULT_LOCK_MIN_SATURATION < min,
      `gate ${DEFAULT_LOCK_MIN_SATURATION} would still refuse a card measured at ${min}`,
    )
    // The margin is the same 0.019 the old gate claimed above the mail — sized
    // the same way, against real data this time.
    assert.ok(min - DEFAULT_LOCK_MIN_SATURATION >= 0.018, 'keep at least the old gate\'s own margin below the dullest card')
    // Nothing in the session sits below the new gate, so it costs this session
    // nothing at all.
    assert.equal(ALL.filter((e) => (e.saturation ?? 1) < DEFAULT_LOCK_MIN_SATURATION).length, 0)
    // ...and it is not zero: an achromatic surface is still refused, which is
    // the only claim this statistic can still support.
    assert.ok(DEFAULT_LOCK_MIN_SATURATION > 0, 'the gate is re-sized, not removed')
  })
})

// ---------------------------------------------------------------------------
// 5. THE RECTIFY ORIENTATION RESIDUAL — 3 of 42, and why geometry cannot fix it
// ---------------------------------------------------------------------------

describe('owner session 1 — three crops stored sideways, and the tell that does not tell', () => {
  /**
   * The three, identified from the STORED `rectifiedPng` of each capture — the
   * image the matcher actually hashed, not a re-derivation. Each was measured by
   * gradient anisotropy (a Pokémon card's name bar, art box and text box are
   * horizontal structure; a quarter turn makes them vertical) and then confirmed
   * by eye against its raw frame. The three sit at 0.62, 0.69 and 0.73 with the
   * other 39 from 1.20 to 2.52 — a clean gap, not a judgement call.
   */
  const ROTATED = new Set(['1788559311706.json', '1788559775761.json', '1788559786211.json'])

  const sidePairs = (e: Ev) => {
    const q = orderQuadForCard(e.quad)!
    const len = (a: readonly number[], b: readonly number[]) => Math.hypot(b[0] - a[0], b[1] - a[1])
    return {
      top: (len(q[0], q[1]) + len(q[3], q[2])) / 2,
      side: (len(q[0], q[3]) + len(q[1], q[2])) / 2,
      topAngleDeg: (Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180) / Math.PI,
    }
  }

  it('the rate is 3 of 42, and all three quads are in the fixture', { skip }, () => {
    assert.equal(CAPS.length, 42)
    assert.equal(CAPS.filter((c) => ROTATED.has(c.file)).length, 3, 'the three mis-oriented captures')
  })

  it('all three put the card HEIGHT on the output width — the signature', { skip }, () => {
    for (const c of CAPS.filter((x) => ROTATED.has(x.file))) {
      const { top, side } = sidePairs(c)
      assert.ok(top > side, `${c.file}: expected the longer side-pair on the output width, got ${(top / side).toFixed(2)}`)
    }
  })

  it('THE POINT: five UPRIGHT captures carry the same signature, so it cannot be acted on', { skip }, () => {
    // If the signature discriminated, `orderQuadForCard` could simply flip on
    // it. It does not: eight of the 42 show it and only three are wrong. The
    // five others are foreshortened upright cards — the same phenomenon that
    // made the pre-2026-09-04 "shorter projected side is the card's width" rule
    // wrong on 13 of 13 drive captures. Flipping here trades three for five.
    const flagged = CAPS.filter((c) => {
      const { top, side } = sidePairs(c)
      return top > side
    })
    assert.equal(flagged.length, 8, `expected 8 captures with the longer pair on the width, got ${flagged.length}`)
    const falsePositives = flagged.filter((c) => !ROTATED.has(c.file))
    assert.equal(falsePositives.length, 5, 'five upright cards carry the signature')
    assert.ok(
      falsePositives.length > ROTATED.size,
      'acting on this signature would break more crops than it fixes — see rectify.orderQuadForCard',
    )
  })

  it('what they actually are: cards presented past the 45-degree assumption', { skip }, () => {
    // Rule 3 of `orderQuadForCard` ("start at the corner nearest the frame's
    // top-left") is exactly the assumption that the card is roughly upright, and
    // it is correct for any in-plane rotation under 45 degrees. These three were
    // lying sideways: their true top edges point at 92, 108 and 125 degrees. No
    // corner-picking rule recovers that from four points.
    for (const c of CAPS.filter((x) => ROTATED.has(x.file))) {
      const q = orderQuadForCard(c.quad)!
      // The true top edge is the OTHER side-pair; its direction is the 1->2 edge.
      const trueTop = (Math.atan2(q[2][1] - q[1][1], q[2][0] - q[1][0]) * 180) / Math.PI
      assert.ok(Math.abs(trueTop) > 45, `${c.file}: true top edge at ${trueTop.toFixed(0)} degrees`)
    }
  })
})
