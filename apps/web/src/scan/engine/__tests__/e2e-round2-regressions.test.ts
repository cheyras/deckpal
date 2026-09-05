// Regressions for the three follow-ups the 2026-09-04 e2e drive's SECOND round
// found, each fenced against that round's own harvested artifacts.
//
// Round 2 confirmed the rectify corner-order fix (19/19 upright) and the
// straddle gate (0 straddle locks where round 1 had 5). What it also found:
//   1. the duplicate refractory never fired — one card, 15 captures, 13 rows,
//   2. a postal envelope auto-captured twice, which geometry cannot refuse,
//   3. four different energies returned at IDENTICAL distances and the product
//      filed six rows at 86-91% confidence, one of them right.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import { isCardShaped, isSingleCardShaped, DEFAULT_LOCK_MIN_SATURATION } from '../index'
import { judgeTie, gateScanResponse, TIE_MARGIN } from '../../ui/tieGate'
import { createCapturedRegions, REGION_DEPARTURE_MS } from '../../ui/regions'
import type { ScanMatch, ScanResponse } from '../../../lib/api'

const DRIVE = 'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/e2e-drive/'

function load(rel: string): unknown | null {
  const p = DRIVE + rel
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}
function rows(v: unknown): Record<string, unknown>[] {
  if (!v) return []
  return (Array.isArray(v) ? v : Object.values(v as object)) as Record<string, unknown>[]
}

const R2RUN = rows(load('harvest-r2run1/events.json'))
const R2CLUTTER = rows(load('harvest-r2clutter/events.json'))
const haveR2 = R2RUN.length > 0 && R2CLUTTER.length > 0

interface Ev {
  type: string
  epochMs: number
  quad: Quad
  id: number
  trackId: number
}
const caps = (rs: Record<string, unknown>[]) =>
  (rs.filter((e) => e.type === 'capture-event') as unknown as Ev[]).sort((a, b) => a.epochMs - b.epochMs)
const locks = (rs: Record<string, unknown>[]) =>
  (rs.filter((e) => e.type === 'lock-event') as unknown as Ev[]).sort((a, b) => a.epochMs - b.epochMs)

// ---------------------------------------------------------------------------
// 1. Duplicates — presence, not a timer
// ---------------------------------------------------------------------------

/** THE SHIPPING POLICY, not a copy of it. This used to be a hand-reproduction of
 *  the logic inlined in Scan.tsx, which is evidence only for as long as nobody
 *  edits one of the two; it now drives `scan/ui/regions.ts` directly. */
function makeRegions(departMs: number) {
  const R = createCapturedRegions({ departureMs: departMs })
  // A region follows the TRACK it was captured from now, not anything that
  // overlaps it — see regions.ts's header, where the owner session measures
  // overlap adopting 63% of real card changes. The synthetic fixtures below are
  // all ONE object, so one synthetic id is their faithful model; `replay` passes
  // each harvested event's real `trackId` instead.
  const ONE = 1
  return {
    tick(now: number, tracks: readonly Quad[], ids?: readonly number[]) {
      R.tick(now, tracks.map((quad, i) => ({ id: ids?.[i] ?? ONE, quad })))
    },
    suppressed: (quad: Quad) => R.suppressed(quad),
    note: (quad: Quad, now: number, id: number = ONE) => R.note(quad, id, now),
    get count() {
      return R.count
    },
  }
}

/** Replay a harvested run: locks are the presence signal, captures ask to fire. */
function replay(rs: Record<string, unknown>[], departMs: number) {
  const timeline = [
    ...locks(rs).map((e) => ({ t: e.epochMs, kind: 'lock' as const, q: e.quad, id: e.trackId })),
    ...caps(rs).map((e) => ({ t: e.epochMs, kind: 'cap' as const, q: e.quad, id: e.trackId })),
  ].sort((a, b) => a.t - b.t || (a.kind === 'lock' ? -1 : 1))
  const R = makeRegions(departMs)
  let taken = 0
  let blocked = 0
  for (const e of timeline) {
    R.tick(e.t, [e.q], [e.id])
    if (e.kind !== 'cap') continue
    if (R.suppressed(e.q)) blocked++
    else {
      taken++
      R.note(e.q, e.t, e.id)
    }
  }
  return { taken, blocked }
}

describe('e2e round 2 — one card must not become fifteen captures', () => {
  it('the drive artifacts are present', () => {
    assert.ok(haveR2, 'round-2 harvest missing')
  })

  it('SHIPPED BEHAVIOUR: a 2.5s window never fires, because every gap exceeds it', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    const c = caps(R2RUN)
    assert.equal(c.length, 15, 'round 2 recorded 15 captures of one card')
    let insideWindow = 0
    let minGap = Infinity
    for (let i = 1; i < c.length; i++) {
      const gap = c[i].epochMs - c[i - 1].epochMs
      minGap = Math.min(minGap, gap)
      if (gap < 2500 && polyIoU(c[i - 1].quad, c[i].quad) >= 0.5) insideWindow++
    }
    assert.equal(insideWindow, 0, 'the 2.5s window caught nothing — this is the bug')
    assert.ok(minGap >= 2700, `the tightest real gap was ${(minGap / 1000).toFixed(2)}s, not the reported 0.2s`)
  })

  it('the IoU half of the test was always sound', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    const c = caps(R2RUN)
    let overlapping = 0
    for (let i = 1; i < c.length; i++) if (polyIoU(c[i - 1].quad, c[i].quad) >= 0.5) overlapping++
    assert.ok(overlapping >= 12, `expected >=12 of 14 consecutive pairs to overlap, got ${overlapping}`)
  })

  it('THE FIX: at the shipped departure window, fifteen captures of one card become six', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    // A LOWER BOUND, and deliberately reported as one. The only presence signal
    // the drive recorded is lock-events, which the recorder throttles to 1 per
    // 2 s — and consecutive quads 2 s apart sometimes overlap below the
    // threshold, so the region loses its card and retires when production would
    // not have. Production refreshes from `engineState` every detect tick
    // (~8 Hz), where consecutive quads of one card overlap almost completely.
    const r = replay(R2RUN, REGION_DEPARTURE_MS)
    assert.equal(r.taken + r.blocked, 15, 'all fifteen captures are offered to the policy')
    assert.ok(r.blocked >= 9, `expected >=9 of 15 suppressed even on the sparse signal, got ${r.blocked}`)
    assert.ok(r.taken <= 6, `expected <=6 captures from one card, got ${r.taken}`)
  })

  it('ON THIS FIXTURE the departure clock is doing the work, and that is the honest reading', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    // This test used to assert the opposite — "it is presence, not a timer",
    // because a 14x change in the departure constant moved nothing. That was
    // true of the OVERLAP-following region, and the owner session
    // (regions.ts's header) is why overlap-following is gone: overlap adopts
    // 63% of real card changes, so it cannot be an identity test and a region
    // that lives on it lives forever.
    //
    // A region now follows the TRACK it was captured from, and round 2's own
    // harvest is the worst case for that: its fifteen captures of ONE physical
    // card carry fifteen DIFFERENT track ids (2, 3, 5, 7, 9, 15, ...) — the
    // tracker lost and re-acquired the card between every one of them. Every
    // region here is therefore anchored to a track that is already dead, is
    // never refreshed, and retires purely on the clock. So on this fixture the
    // answer IS a function of the constant, monotonically:
    //
    //   depart   0.9 s  2.5 s  5 s  9 s  12 s  20 s  30 s
    //   taken     15     12     9    8    6     6     5
    //
    // That is a real cost of the identity gate and it is stated rather than
    // hidden. What buys it back is that the tracker churns like this on a
    // compressed MJPEG fake camera and does NOT on a real device: over the
    // owner session's 176 quads a card keeps its track id across 93% of
    // consecutive sightings, which is where the presence half of the policy
    // does its work.
    //
    // (Round 5's re-anchor bridge shaves exactly one capture off the 0.9 s
    // column — one within-throttle rebirth now re-anchors a region that used
    // to expire — and touches nothing from 2.5 s up, where the departure
    // clock already outlived that churn.)
    const table = [900, 2_500, 5_000, 9_000, 12_000, 30_000].map((d) => replay(R2RUN, d).taken)
    assert.deepEqual(table, [14, 12, 9, 8, 6, 5], `departure sweep moved: ${table.join(', ')}`)
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i] <= table[i - 1], 'a longer window must never take MORE captures')
    }
  })

  it('...without suppressing genuinely separate presentations', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    // The clutter run's four captures are 17-34s apart with IoU 0.32-0.38 — the
    // object left and came back. All four must still be taken, at every
    // departure value the card run was checked at.
    for (const dep of [900, 2_500, 5_000, 9_000, 13_000]) {
      const r = replay(R2CLUTTER, dep)
      assert.equal(r.taken, caps(R2CLUTTER).length, `depart ${dep}: separate presentations must all capture`)
      assert.equal(r.blocked, 0, `depart ${dep}: nothing may be suppressed here`)
    }
  })

  it('a region retires once nothing overlaps it, so a swapped card captures', () => {
    const R = makeRegions(900)
    const card = (dx: number): Quad => [
      [100 + dx, 100],
      [280 + dx, 100],
      [280 + dx, 351],
      [100 + dx, 351],
    ]
    R.tick(0, [card(0)])
    R.note(card(0), 0)
    assert.ok(R.suppressed(card(0)), 'the same card in the same place is suppressed')
    // Nothing on screen for a second: the card was lifted away.
    R.tick(1000, [])
    assert.equal(R.count, 0, 'the region must retire once the card departs')
    assert.ok(!R.suppressed(card(0)), 'a new card in that spot must capture')
  })

  it('a region FOLLOWS drift, so a slowly-moving card never escapes its own region', () => {
    const R = makeRegions(900)
    const card = (dx: number): Quad => [
      [100 + dx, 100],
      [280 + dx, 100],
      [280 + dx, 351],
      [100 + dx, 351],
    ]
    R.tick(0, [card(0)])
    R.note(card(0), 0)
    // Drift 150px over 25 ticks — far enough that the ORIGINAL quad no longer
    // overlaps the final one at all.
    for (let i = 1; i <= 25; i++) R.tick(i * 120, [card(i * 6)])
    assert.ok(polyIoU(card(0), card(150)) < 0.5, 'the card really did move out of its start position')
    assert.ok(R.suppressed(card(150)), 'the region must have followed it')
  })
})

// ---------------------------------------------------------------------------
// 2. Clutter — the postal envelope
// ---------------------------------------------------------------------------

describe('e2e round 2 — geometry cannot refuse a postal envelope', () => {
  const MAIL_IDS = new Set([1788508779253, 1788508832704])

  it('both mail captures pass BOTH geometric gates — this is why a signature is needed', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    const mail = caps(R2CLUTTER).filter((e) => MAIL_IDS.has(e.id))
    assert.equal(mail.length, 2, 'expected the two mail captures')
    for (const m of mail) {
      assert.ok(isCardShaped(m.quad), `${m.id}: the envelope is genuinely card-proportioned`)
      assert.ok(isSingleCardShaped(m.quad), `${m.id}: and cleanly parallelogram — no straddle to catch`)
    }
  })

  it('the mail and real cards OVERLAP on this statistic, so no threshold refuses one and keeps the other', () => {
    // This test used to assert the gate did both. It did, on the data that
    // existed: corpus cards bottomed out at 0.149 and the two envelopes topped
    // out at 0.112, so 0.13 sat in an 0.037-wide gap. The 2026-09-04 owner
    // session photographed four real cards INSIDE that gap and below it —
    // 0.079, 0.103, 0.112, 0.126 — and one of them is the envelopes' own value
    // to three decimals. The gap was an artefact of never having measured a dull
    // card, and this is the record that it is gone.
    const LEAST_COLOURFUL_CARD = 0.079 // owner session 1, manual capture, owner-confirmed
    const MOST_COLOURFUL_MAIL = 0.112 // this drive's envelopes
    assert.ok(
      LEAST_COLOURFUL_CARD < MOST_COLOURFUL_MAIL,
      'if a real card is ever measured above the mail again, a separating threshold exists and this gate can be one',
    )
    // So the gate keeps only the claim that survives: an achromatic surface is
    // not a card. It must stay below every real card ever measured...
    assert.ok(
      DEFAULT_LOCK_MIN_SATURATION < LEAST_COLOURFUL_CARD,
      `threshold ${DEFAULT_LOCK_MIN_SATURATION} would refuse the least colourful measured card (${LEAST_COLOURFUL_CARD})`,
    )
    // ...and it must NOT be raised back into the overlap on the theory that it
    // refuses mail, because up there it refuses cards too.
    assert.ok(
      DEFAULT_LOCK_MIN_SATURATION < MOST_COLOURFUL_MAIL,
      `threshold ${DEFAULT_LOCK_MIN_SATURATION} sits inside the card/mail overlap — see index.DEFAULT_LOCK_MIN_SATURATION`,
    )
  })

  it('is honest about being a paper rejector, not a card detector', () => {
    // Corpus cards bottom out at 0.149 and corpus CLUTTER at 0.159 — the classes
    // overlap, so this gate cannot and does not separate cards from household
    // objects. If someone later widens it hoping it will, this is the record
    // that it was never measured to.
    const CORPUS_CARD_MIN = 0.149
    const CORPUS_CLUTTER_MIN = 0.159
    assert.ok(
      CORPUS_CLUTTER_MIN > CORPUS_CARD_MIN,
      'the classes overlap: no saturation threshold separates cards from clutter',
    )
    assert.ok(
      DEFAULT_LOCK_MIN_SATURATION < CORPUS_CARD_MIN && DEFAULT_LOCK_MIN_SATURATION < CORPUS_CLUTTER_MIN,
      'the threshold must sit below BOTH corpus classes — it only removes paper',
    )
  })
})

// ---------------------------------------------------------------------------
// 3. The tie gate
// ---------------------------------------------------------------------------

/** Build ScanMatch-shaped records from the drive's probe output. Its rows carry
 *  name/set/num/d rather than cardId, so identity is `set-num` — which is what
 *  distinguishes Fighting/014 from Psychic/013 in exactly the way the gate needs. */
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

const SCAN_R2 = rows(load('harvest-r2run1/analysis/scan-results.json'))
const SCAN_CLUTTER = rows(load('harvest-r2clutter/analysis/scan-results.json'))
const haveScans = SCAN_R2.length > 0

describe('e2e round 2 — a tied top-1 may not present as confident', () => {
  it('SHIPPED BEHAVIOUR: every confident result the drive got was tied within 1', {
    skip: haveScans ? false : 'scan results unavailable',
  }, () => {
    let confident = 0
    let tied = 0
    for (const r of [...SCAN_R2, ...SCAN_CLUTTER]) {
      const app = (r as { app?: { matched?: boolean; threshold?: number; top?: never[] } }).app
      if (!app?.matched || !app.top?.length) continue
      const m = matchesFrom(app.top)
      if (m[0].distance > (app.threshold ?? 9)) continue
      confident++
      if (judgeTie(m).margin <= 1) tied++
    }
    assert.ok(confident >= 11, `expected the drive's 11 confident results, saw ${confident}`)
    assert.equal(tied, confident, 'every one of them had a different-card rival within 1 — that is the violation')
  })

  it('THE FIX: the gate downgrades all of them to needs-attention', {
    skip: haveScans ? false : 'scan results unavailable',
  }, () => {
    let stillConfident = 0
    for (const r of [...SCAN_R2, ...SCAN_CLUTTER]) {
      const app = (r as { app?: { matched?: boolean; threshold?: number; top?: never[] } }).app
      if (!app?.matched || !app.top?.length) continue
      const res = { matched: true, matches: matchesFrom(app.top) } as unknown as ScanResponse
      if (gateScanResponse(res)?.matched) stillConfident++
    }
    assert.equal(stillConfident, 0, 'no tied result may survive as a confident match on this footage')
  })

  it('the evidence is never discarded — only the claim', () => {
    const res = {
      matched: true,
      matches: matchesFrom([
        { name: 'Fighting Energy', set: 'sve', num: '014', d: 7 },
        { name: 'Psychic Energy', set: 'sve', num: '013', d: 7 },
      ]),
    } as unknown as ScanResponse
    const out = gateScanResponse(res)
    assert.equal(out?.matched, false, 'the claim is withheld')
    assert.equal(out?.matches.length, 2, 'the ranked list is untouched, so pick-a-match still works')
  })

  it('a clearly-separated top hit is still confident', () => {
    const m = matchesFrom([
      { name: 'Charizard', set: 'base', num: '004', d: 2 },
      { name: 'Something Else', set: 'base', num: '099', d: 18 },
    ])
    const v = judgeTie(m)
    assert.equal(v.confident, true)
    assert.equal(v.margin, 16)
  })

  it('a rival that is the SAME card does not block confidence', () => {
    // Two entries for one cardId (e.g. the index holding two crops of it) are
    // not a disagreement about what the card is.
    const m = matchesFrom([
      { name: 'Fighting Energy', set: 'sve', num: '014', d: 7 },
      { name: 'Fighting Energy', set: 'sve', num: '014', d: 7 },
    ])
    assert.equal(judgeTie(m).confident, true)
    assert.equal(judgeTie(m).rival, null)
  })

  it('the rule is a strict "at least TIE_MARGIN ahead", with the boundary on the right side', () => {
    // Round 2 fences the RULE; the VALUE is round 3's, and is fenced against
    // round 3's own margin distribution in e2e-round3-regressions.test.ts.
    // Round 2's own requirement is only that a tie and a one-unit lead are
    // refused, which every margin >= 2 satisfies.
    const at = (d2: number) =>
      judgeTie(
        matchesFrom([
          { name: 'A', set: 's', num: '1', d: 7 },
          { name: 'B', set: 's', num: '2', d: d2 },
        ]),
      ).confident
    assert.ok(TIE_MARGIN >= 2, `round 2's finding requires a margin of at least 2, got ${TIE_MARGIN}`)
    assert.equal(at(7), false, 'a tie is not confident')
    assert.equal(at(8), false, 'one apart is not confident')
    // Exactly at the threshold is confident; one short of it is not. The
    // boundary is inclusive, wherever the constant sits.
    assert.equal(at(7 + TIE_MARGIN), true, 'exactly TIE_MARGIN ahead is confident')
    assert.equal(at(7 + TIE_MARGIN - 1), false, 'one short of TIE_MARGIN is not')
  })

  it('an empty or unmatched response passes through untouched', () => {
    assert.equal(gateScanResponse(null), null)
    const un = { matched: false, matches: [] } as unknown as ScanResponse
    assert.equal(gateScanResponse(un), un)
    assert.equal(judgeTie([]).confident, false)
  })
})
