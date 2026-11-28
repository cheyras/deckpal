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
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import { DEFAULT_CADENCE_MS, isCardShaped, isSingleCardShaped, DEFAULT_LOCK_MIN_SATURATION } from '../index'
import type { CardLook } from '../look'
import { judgeTie, gateScanResponse, TIE_MARGIN } from '../../ui/tieGate'
import { createPresentation } from '../../ui/presentation'
import { lookOf } from '../../ui/__tests__/lookScenes'
import { replayPresentation, type StreamEvent } from './presentationReplay'
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
//
// RE-BASELINED 2026-11-27 (decision "a flip is always captured"). This section
// used to replay the captured-region policy (scan/ui/regions.ts) over this
// run; that policy is gone, replaced by the presentation episode
// (scan/ui/presentation.ts), and the replay below drives the replacement over
// the same stream (`presentationReplay.ts`). The numbers, old and new:
//
//   card run (15 recorded captures of ONE card)
//     regions, 5 s departure, this file's event replay     9
//     regions, 5 s departure, round 3's tick replay        7
//     presentation, a dropout leaves the card on its spot  7
//     presentation, every dropout a departure              9
//   clutter run (4 separate presentations)                 4 -> 4
//
// The truth on this desktop fake camera is between the two presentation rows:
// its detector loses a STATIC card for 4.7-11.4 s, which the device's spot look
// (EngineState.spotLook) reads as the card still there, but this stream has no
// pixels to say so. The phone does not have those dropouts at all
// (owner-session-2: "no track means no card").

const TICK_MS = DEFAULT_CADENCE_MS
/** A gap this small is the recorder's 2 s throttle, not the card leaving (round 3's empty band). */
const CONTINUOUS_MS = 2_750
const present = (rs: Record<string, unknown>[], gap: 'card' | 'empty') =>
  replayPresentation(rs as unknown as StreamEvent[], { continuousMs: CONTINUOUS_MS, cardOf: () => 'the card', gap, manuals: false }).fires

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

  it('THE PRESENTATION EPISODE: fifteen captures of one card become seven to nine', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    // Re-baselined (see the section header): the regions took this to 9 (7 on
    // the tick replay). The episode takes it to 7 when a dropout leaves the
    // card on its spot, which is what the spot look sees on a device — two on
    // the clip's loop boundaries (58 s), where the card really does leave and
    // come back; the rest where this fake camera's tracker re-ids the card
    // (fifteen ids for one card) onto a quad off its spot, which the episode
    // counts as supporting evidence of a swap (`reidIsHard`; without it, 4) —
    // and to 9, the same 9, when every dropout is read as the card leaving.
    // The phone does not churn ids like this (owner-session-2: one track per
    // presentation).
    const kept = present(R2RUN, 'card')
    const gone = present(R2RUN, 'empty')
    assert.equal(kept.length, 7, `card on its spot through the dropouts: ${kept.map((f) => (f.t / 1000).toFixed(1)).join(' ')}`)
    assert.equal(kept.filter((f) => Math.abs(f.t / 1000 - 58) < 1.5 || Math.abs(f.t / 1000 - 116) < 1.5).length, 2, 'two on the loop boundaries')
    assert.equal(gone.length, 9, `every dropout a departure: ${gone.length}`)
    assert.ok(gone.length < 15 * 0.7, 'still well under the 15 the 2.5 s timer took')
    assert.ok(gone.slice(1).every((f) => f.kind === 'disturbed'), 'every later one is a capture after a break, which identity flags as the same card')
  })

  it('there is no clock left: each capture after the first is one departure and return', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    // The regions' answer here was a function of their departure constant
    // (0.9 s -> 14, 5 s -> 9, 30 s -> 5). The episode has no constant to sweep:
    // read as departures, the fires are exactly the reconstructed absences.
    const L = locks(R2RUN)
    const absences = L.slice(1).filter((l, i) => l.epochMs - L[i].epochMs > CONTINUOUS_MS).length
    assert.equal(present(R2RUN, 'empty').length, 1 + absences)
  })

  it('...without suppressing genuinely separate presentations', {
    skip: haveR2 ? false : 'artifacts unavailable',
  }, () => {
    // The clutter run's four captures are 17-34s apart with IoU 0.32-0.38 — the
    // object left and came back. All four are still taken.
    assert.equal(present(R2CLUTTER, 'empty').length, caps(R2CLUTTER).length, 'separate presentations must all capture')
  })

  it('a card lifted away and another put down in its spot captures', () => {
    const p = createPresentation()
    const card = (dx: number): Quad => [
      [100 + dx, 100],
      [280 + dx, 100],
      [280 + dx, 351],
      [100 + dx, 351],
    ]
    let t = 0
    const tick = (lock: number | null, look: CardLook | null, spot: CardLook | null = look) => {
      t += TICK_MS
      return p.observe({ now: t, lock: lock === null ? null : { id: lock, quad: card(0) }, look, spotLook: p.watchQuad() ? spot : null })
    }
    tick(1, lookOf(1))
    p.fire({ kind: 'first', now: t, captureId: 'a', trackId: 1, quad: card(0), look: lookOf(1) })
    for (let i = 0; i < 4; i++) assert.equal(tick(1, lookOf(1)).candidate, null, 'the same card in the same place is not taken again')
    // Nothing on screen for a second: the card was lifted away.
    for (let i = 0; i < 8; i++) tick(null, null, lookOf(60))
    let fired = null
    for (let i = 0; i < 4 && !fired; i++) fired = tick(2, lookOf(2)).candidate
    assert.equal(fired, 'disturbed', 'a new card in that spot must capture')
  })

  it('the spot FOLLOWS drift, so a slowly-moving card is never taken again', () => {
    const p = createPresentation()
    const card = (dx: number): Quad => [
      [100 + dx, 100],
      [280 + dx, 100],
      [280 + dx, 351],
      [100 + dx, 351],
    ]
    let t = 0
    p.observe({ now: t, lock: { id: 1, quad: card(0) }, look: lookOf(1), spotLook: null })
    p.fire({ kind: 'first', now: t, captureId: 'a', trackId: 1, quad: card(0), look: lookOf(1) })
    // Drift 150px over 25 ticks — far enough that the ORIGINAL quad no longer
    // overlaps the final one at all.
    for (let i = 1; i <= 25; i++) {
      t += TICK_MS
      const r = p.observe({ now: t, lock: { id: 1, quad: card(i * 6) }, look: lookOf(1, { exposure: i % 2 ? 0.95 : 1 }), spotLook: lookOf(1) })
      assert.equal(r.state, 'watching', `tick ${i}`)
    }
    assert.ok(polyIoU(card(0), card(150)) < 0.5, 'the card really did move out of its start position')
    assert.ok(polyIoU(p.watchQuad()!, card(150)) >= 0.5, 'the spot must have followed it')
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
