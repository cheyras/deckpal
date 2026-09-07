// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE IDENTITY RACE — the property under test is an ORDERING, not a value.
//
// Two async answers and a timer compete for one thumbnail, and the reader can
// pre-empt all three. The bugs that shape has are never "the wrong card was
// picked"; they are "the right card was picked and then overwritten 900 ms
// later", "the deadline fired after the reader had already chosen", "both
// answers came back unsure and the thumbnail waited for a clock it did not need
// to wait for". None of those is reachable by driving the route component, and
// all of them are one function call away from the reducer, so this file replays
// the orderings straight through the shipping `reduceIdentity`.
//
// Nothing here re-implements the confidence policy. The tie gate's margin and
// the endpoint's `confident` flag are asked the same way the product asks them —
// through `reduceIdentity` — so a fixture that agrees with a local copy of the
// rule cannot pass this file.
//
// ── WHAT THE 2026-09-06 REVERSAL DID AND DID NOT CHANGE HERE ────────────────
//
// "If the resolution is 'needs your input' they should still go down to the
// list." That is a statement about WHERE a settled capture goes, and the machine
// below has never had an opinion about where anything goes — so every ordering
// test in this file is untouched, which is the strongest evidence available that
// the reversal is presentation and not policy.
//
// One thing did go: `engaged`. It existed because the reader could open a picker
// on a thumbnail whose race was still running. They cannot — the picker is on a
// list row this reducer has already let go of — so the field is gone and the
// protection it gave lives where the reader now is. See the last test in "the
// reader" for the shape of what replaced it.
//
// ── AND WHAT THE 2026-09-07 RULING DID ─────────────────────────────────────
//
// This one is policy, and it is the reason half the orderings below now assert
// the opposite of what they asserted. "It should NOT land as needs you and then
// upgrade itself. If it isn't totally resolved, it stays in the side."
//
// So the file's job changed shape. It used to prove that a late answer was
// HONOURED — that a confident resolve at 7 s rescued a thumbnail the 6 s
// deadline had already flipped. It now proves that the situation cannot arise:
// settlement waits for every started signal, so there is no thumbnail to rescue,
// and if the 12 s fuse ever does cut one off the late answer is DROPPED and the
// drop is recorded. The tests that used to be about the rescue are the tests
// about the wait, which is the same ordering asked from the other side.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanMatch, ScanResolveMatch, ScanResponse, ScanResolveResponse } from '../../../lib/api'
import type { OcrRead } from '../../ocr/pipeline'
import { IDENTITY_BACKSTOP_MS, RESOLVE_RTT_TAIL_MS } from '../deadline'
import {
  initialIdentity,
  mergeCandidates,
  ocrHintLabel,
  readCandidates,
  reduceIdentity,
  resolvedIdentity,
  toPickedMatch,
  type IdentityEvent,
  type IdentityState,
} from '../identity'
import { TIE_MARGIN } from '../tieGate'
import { EMBED_TIMEOUT_MS, type EmbedEvidence } from '../vectorEvidence'

// ── fixtures ────────────────────────────────────────────────────────────────

function match(cardId: string, distance: number): ScanMatch {
  return {
    cardId,
    name: `Card ${cardId}`,
    number: '161',
    setId: 'sv10',
    setName: 'Destined Rivals',
    rarity: 'Rare',
    images: { low: `${cardId}.low`, high: `${cardId}.high` },
    distance,
    confidence: 1 - distance / 64,
  }
}

function scanRes(matches: ScanMatch[], matched = true): ScanResponse {
  return { query: { algo: 'dhash', hash: 'abc' }, matched, threshold: 12, indexSize: 20_451, matches }
}

/** A response the tie gate lets through: the best DIFFERENT card is TIE_MARGIN
 *  clear. Built off the shipping constant so raising the margin re-sizes the
 *  fixture instead of quietly turning this file into a test of nothing. */
const CLEAR = scanRes([match('sv10-057', 4), match('sv10-058', 4 + TIE_MARGIN)])
/** The failure the gate exists for: four Basic Energies at the same distance. */
const TIED = scanRes([match('sve-004', 7), match('sve-003', 7), match('sve-002', 7)])

function resolveRes(over: Partial<ScanResolveResponse> = {}): ScanResolveResponse {
  return {
    matched: true,
    confident: true,
    resolvedBy: 'number+denominator',
    matches: [
      {
        cardId: 'sv10-116',
        name: 'Buizel',
        number: '116',
        setId: 'sv10',
        setName: 'Destined Rivals',
        rarity: 'Common',
        images: { low: 'buizel.low', high: 'buizel.high' },
        // The shape the wire really uses for a card phash never nominated.
        distance: null,
        confidence: null,
      },
    ],
    ...over,
  }
}

function read(over: Partial<OcrRead> = {}): OcrRead {
  return { name: null, number: null, denominator: null, setCode: null, pass: 'roi', ms: 340, ...over }
}

/** Replay a sequence of events against the shipping reducer. */
function run(events: IdentityEvent[], from: IdentityState = initialIdentity()): IdentityState {
  return events.reduce(reduceIdentity, from)
}

function embed(over: Partial<EmbedEvidence> = {}): EmbedEvidence {
  return { vectorMatches: [], outcome: 'ok', ms: 1_100, ...over }
}

/**
 * REPLAY A TIMELINE, WITH THE SHIPPING FUSE IN IT.
 *
 * Milliseconds since the shutter, and `IDENTITY_BACKSTOP_MS` is inserted for
 * free — exactly as `Scan.tsx` schedules it at capture time — so a test cannot
 * accidentally describe a world where the backstop does not exist. Reports WHEN
 * the capture left `pending`, which since 2026-09-07 is the only question worth
 * asking about the machine's timing: it is the moment the reader's thumbnail
 * stops spinning, and there is no second moment.
 */
function drive(timeline: Array<[number, IdentityEvent]>): { leftAt: number | null; state: IdentityState } {
  const fused: Array<[number, IdentityEvent]> = [...timeline, [IDENTITY_BACKSTOP_MS, { type: 'backstop' }]]
  fused.sort((a, b) => a[0] - b[0])
  let state = initialIdentity()
  let leftAt: number | null = null
  for (const [t, e] of fused) {
    state = reduceIdentity(state, e)
    if (leftAt === null && state.phase !== 'pending') leftAt = t
  }
  return { leftAt, state }
}

/** What the deadline this ruling deleted used to be, kept as a NUMBER so the
 *  "the common case got faster" claims below are measured against it rather than
 *  asserted about it. Nothing in the app reads 6 000 any more. */
const OLD_DEADLINE_MS = 6_000

// ── the race ────────────────────────────────────────────────────────────────

describe('the identity race', () => {
  it('PHASH CONFIDENT FIRST names the card and the later resolve cannot re-name it', () => {
    const afterPhash = run([{ type: 'phash', res: CLEAR }])
    assert.equal(afterPhash.phase, 'confident')
    assert.equal(afterPhash.by, 'phash')
    assert.equal(afterPhash.match?.cardId, 'sv10-057')
    // The distance survives: a phash-named row has a real measurement and the
    // list draws a real meter from it.
    assert.equal(afterPhash.match?.distance, 4)

    // Everything that lands afterwards is the LIST's business now, through
    // `narrowedIdentity`, which can see whether a human has touched the row.
    // The thumbnail is already flying and must not change its mind mid-flight.
    const later = run([{ type: 'resolve', resolved: resolveRes() }, { type: 'backstop' }], afterPhash)
    assert.equal(later, afterPhash, 'a confident state is terminal for the reducer')
  })

  it('RESOLVE CONFIDENT FIRST names the card when phash could not', () => {
    // The real ordering: the resolve call cannot even start until phash has
    // produced the priors it re-ranks, so phash always reports first — it just
    // reports a tie.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ number: '116', denominator: '182' }) },
      { type: 'resolve', resolved: resolveRes() },
    ])
    assert.equal(s.phase, 'confident')
    assert.equal(s.by, 'printing')
    assert.equal(s.match?.cardId, 'sv10-116')
    // AND IT DOES NOT INVENT A DISTANCE. phash never nominated this card; null
    // is "no phash opinion", which is not "distance 64".
    assert.equal(s.match?.distance, null)
    assert.equal(s.match?.confidence, null)
  })

  it('is order-blind: a resolve arriving before phash still wins the race', () => {
    // Not an ordering the product produces today, but the reducer must not be
    // the thing that assumes it — a future variant of the pipeline that fires
    // the resolve on OCR alone would otherwise silently take the phash answer.
    const s = run([{ type: 'resolve', resolved: resolveRes() }, { type: 'phash', res: CLEAR }])
    assert.equal(s.by, 'printing')
    assert.equal(s.match?.cardId, 'sv10-116')
  })

  it('BOTH UNCONFIDENT goes to needs-you immediately, without waiting for the deadline', () => {
    // The ordinary failure — a card back, a blurred crop. Both answers are in
    // and both said no; making the reader watch a spinner run down a 6 s clock
    // for an answer that has already arrived would be a lie about the state.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read() },
      { type: 'resolve', resolved: resolveRes({ confident: false }) },
    ])
    assert.equal(s.phase, 'needs-you')
    assert.equal(s.match, null)
    assert.equal(s.by, null)
  })

  it('NEEDS-YOU IS A DEPARTURE, and it leaves carrying its own evidence', () => {
    // Since 2026-09-06 this state is a flight to the list, not a parking space,
    // and the row it becomes is built entirely out of what is here: the picture
    // (the caller's), the tie-gated candidates for its picker, and the OCR read
    // for its hint chip. Anything the reducer drops at this point is a question
    // the reader gets asked with less to answer it from.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ number: '116', denominator: '182' }) },
      { type: 'resolve', resolved: resolveRes({ confident: false }) },
    ])
    assert.equal(s.phase, 'needs-you')
    // The ladder's candidate first — it narrowed the world with a printed key,
    // which is a stronger claim than a Hamming distance — then the tie-gated
    // hash ranking. See the 2026-09-07 block at the end of this file.
    assert.deepEqual(s.candidates.map((m) => m.cardId), ['sv10-116', 'sve-004', 'sve-003', 'sve-002'])
    assert.equal(ocrHintLabel(s.read), 'read 116/182')
    // And the verdict is still on it, so the row's eventual pick can be recorded
    // beside what the ladder had said (`identityRecord`).
    assert.deepEqual(s.resolveVerdict, { resolvedBy: 'number+denominator', confident: false })
  })

  it('fills the picker from the tie-gated ranking even though the claim was refused', () => {
    const s = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    assert.equal(s.phase, 'needs-you')
    assert.deepEqual(
      s.candidates.map((m) => m.cardId),
      ['sve-004', 'sve-003', 'sve-002'],
      'withholding the claim must never withhold the evidence',
    )
  })

  it('PUTS THE LADDER’S OWN MATCHES IN THE PICKER, above the hash’s', () => {
    // This test used to assert the opposite, on ocrNarrow.ts's standing rule:
    // the ladder's matches carry `distance: null` for cards phash never
    // nominated, and a list ranked by distance must not hold entries that have
    // none. The rule is still true; the conclusion was the 2026-09-07 defect.
    // They are not merged into one ranking — they are the group above it, and
    // `from` is what the popover draws the seam from.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ number: '116', denominator: '182' }) },
      { type: 'resolve', resolved: resolveRes({ confident: false }) },
    ])
    assert.equal(s.candidates[0]?.cardId, 'sv10-116')
    assert.equal(s.candidates[0]?.from, 'read')
    assert.equal(s.candidates[0]?.distance, null, 'and it still says it has no phash opinion')
    assert.deepEqual(
      s.candidates.slice(1).map((m) => m.from),
      [undefined, undefined, undefined],
      'the hash’s entries are not relabelled as something OCR found',
    )
    assert.equal(ocrHintLabel(s.read), 'read 116/182')
  })

  it('a resolve that was never going to happen still completes the pair', () => {
    // OCR off for the session, nothing read, or a backend without the endpoint:
    // the caller sends `resolved: null` to say so. Without that event the pair
    // never completes and the thumbnail waits out a deadline for an answer that
    // was never in flight.
    const s = run([{ type: 'phash', res: TIED }, { type: 'read', read: null }, { type: 'resolve', resolved: null }])
    assert.equal(s.phase, 'needs-you')
  })

  it('one answer alone is not enough — it waits', () => {
    // And since 2026-09-07 it waits for as long as that takes. There is no
    // longer a 6 s deadline behind this to end the wait on the machine's behalf:
    // "if it isn't totally resolved, it stays in the side."
    const onlyPhash = run([{ type: 'phash', res: TIED }])
    assert.equal(onlyPhash.phase, 'pending')
    const onlyResolve = run([{ type: 'resolve', resolved: resolveRes({ confident: false }) }])
    assert.equal(onlyResolve.phase, 'pending')
  })
})

// ── settlement, on a clock ──────────────────────────────────────────────────
//
// THE 2026-09-07 RULING, DRIVEN. Every test here used to have a 6 s deadline in
// it deciding the answer; the deadline is gone and the SIGNALS decide, so these
// assert two things the old file could not: WHEN a capture leaves the stack, and
// that it never leaves twice.

describe('when a capture leaves the stack', () => {
  it('EVERYTHING SETTLES EARLY — needs-you well before the 6 s deadline it replaced', () => {
    // The ordinary failure, on the ordinary clock: identify back at 1.2 s, the
    // read at 2.1 s, the narrowing at 2.6 s, and all three said no. The old
    // machine reached the same verdict at the same instant — `settleOrWait` was
    // always the fast path — and the deadline only ever mattered when it fired
    // FIRST. What changed is that this is now the only way to get here.
    const { leftAt, state } = drive([
      [1_200, { type: 'phash', res: TIED }],
      [2_100, { type: 'read', read: read() }],
      [2_600, { type: 'resolve', resolved: resolveRes({ confident: false }), embed: embed({ ms: 1_100 }) }],
    ])
    assert.equal(state.phase, 'needs-you')
    assert.equal(leftAt, 2_600, 'it leaves when the last signal reports, not when a clock says so')
    assert.ok(leftAt !== null && leftAt < OLD_DEADLINE_MS, 'the common case is FASTER than the old deadline')
    assert.equal(state.backstopped, false, 'settled by its own signals')
    assert.equal(state.lateAnswerDropped, false, 'and nothing arrived afterwards to throw away')
  })

  it('AN EMBED STILL IN FLIGHT AT 6 s KEEPS IT PENDING — this is the defect', () => {
    // Round 10b §3.3: six of thirty-one captures were here, and the old machine
    // flipped every one of them to needs-you with the answer still on the wire.
    // At six seconds this capture has phash (tied) and a read that found nothing,
    // and the vector is still coming.
    const atSixSeconds = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read() },
    ])
    assert.equal(atSixSeconds.phase, 'pending', 'the system has not finished trying, so it is not needs-you')
    assert.equal(atSixSeconds.resolveSettled, false)
  })

  it('…AND THE 9 s VECTOR LANDS AS AN IDENTIFIED ROW, never as needs-you first', () => {
    // The same capture, followed through. `r10bs59`'s third capture is this one:
    // `needs-you` at +91.7 s, `confident-resolve` at +92.0 s, two machine records
    // and a row that changed its mind in front of the reader. It leaves ONCE now,
    // three seconds later, already named.
    const { leftAt, state } = drive([
      [1_400, { type: 'phash', res: TIED }],
      [3_100, { type: 'read', read: read() }],
      [9_000, { type: 'resolve', resolved: resolveRes(), embed: embed({ ms: 5_992 }) }],
    ])
    assert.equal(leftAt, 9_000, 'one departure, and it is the confident one')
    assert.equal(state.phase, 'confident')
    assert.equal(state.by, 'printing')
    assert.equal(state.match?.cardId, 'sv10-116')
    assert.equal(state.backstopped, false)
    assert.equal(state.lateAnswerDropped, false)
  })

})

// ── the fuse ────────────────────────────────────────────────────────────────

describe('the backstop', () => {
  it('IS THE ONLY CLOCK LEFT, and it settles the capture FINALLY', () => {
    const { leftAt, state } = drive([
      [1_500, { type: 'phash', res: TIED }],
      [3_000, { type: 'read', read: read() }],
      // The resolve never comes — a wedged round trip, the case the fuse is for.
    ])
    assert.equal(leftAt, IDENTITY_BACKSTOP_MS)
    assert.equal(state.phase, 'needs-you')
    assert.equal(state.backstopped, true, 'and the record says it was cut off, not finished')
    // "Whatever is unsettled is treated as failed" — in the STATE, not just the
    // phase, so `identityRecord` cannot describe a leg as still in flight on a
    // capture that has already left the camera.
    assert.equal(state.resolveSettled, true)
  })

  it('DROPS A LATE ANSWER AND WRITES THE DROP DOWN', () => {
    // The whole ruling in one assertion. The answer is confident, it names a
    // card, and it arrives 400 ms after the fuse blew — and the capture stays
    // needs-you, because by then the reader has been told the scanner gave up.
    const { state } = drive([
      [1_500, { type: 'phash', res: TIED }],
      [3_000, { type: 'read', read: read() }],
      [IDENTITY_BACKSTOP_MS + 400, { type: 'resolve', resolved: resolveRes(), embed: embed({ outcome: 'timeout' }) }],
    ])
    assert.equal(state.phase, 'needs-you', 'it does NOT upgrade itself — 2026-09-07')
    assert.equal(state.match, null)
    assert.equal(state.by, null)
    assert.equal(state.lateAnswerDropped, true)
    assert.equal(state.backstopped, true)
  })

  it('the drop is recorded ONCE, however many answers turn up late', () => {
    const settled = run([{ type: 'phash', res: TIED }, { type: 'backstop' }])
    const once = reduceIdentity(settled, { type: 'resolve', resolved: resolveRes() })
    assert.equal(once.lateAnswerDropped, true)
    // Identity, not a new object: `dispatchIdentity` skips the re-render and the
    // second telemetry post on `next === prev`.
    assert.equal(reduceIdentity(once, { type: 'phash', res: CLEAR }), once)
  })

  it('a late READ is not an answer, and does not trip the alarm', () => {
    // It is a hint chip's worth of text and could never have named the card.
    // Counting it would blunt the one signal that says the fuse cost something.
    const settled = run([{ type: 'phash', res: TIED }, { type: 'backstop' }])
    const late = reduceIdentity(settled, { type: 'read', read: read({ number: '116', denominator: '182' }) })
    assert.equal(late, settled)
    assert.equal(late.lateAnswerDropped, false)
  })

  it('is a no-op on a capture that already settled honestly', () => {
    // `Scan.tsx` clears the timer in a `finally`, but a fuse that survives its
    // own race must not be able to re-decide anything or forge a `backstopped`.
    const named = run([{ type: 'phash', res: CLEAR }])
    assert.equal(run([{ type: 'backstop' }], named), named)
    const settled = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    assert.equal(run([{ type: 'backstop' }], settled), settled)
    assert.equal(settled.backstopped, false)
  })

  it('COVERS THE WORST HONEST CHAIN — the arithmetic, as an assertion', () => {
    // `deadline.ts`'s sizing, from round 10b's measured tails, checked against
    // the constants it is made of rather than left as prose beside them:
    //
    //   the embed    EMBED_TIMEOUT_MS, 8 s, anchored at the SHUTTER. Round 10b
    //                §3.1: 29 in-app embeds, p50 4 202 ms, max 6 363 ms of wall
    //                latency (telemetry `embedMs` max 5 992), 2 of 31 over.
    //   the resolve  RESOLVE_RTT_TAIL_MS, 4 s, and it cannot start until the
    //                embed has settled. Round 10b's msToResolve ran p50
    //                4 283-6 001 ms against those embeds — a remainder of about
    //                1-2 s — and §3.2 measured /api/scan itself reaching
    //                4 847 ms once the two routes share a function instance.
    //
    // Firing inside that sum would put the deadline back under another name.
    assert.ok(
      IDENTITY_BACKSTOP_MS >= EMBED_TIMEOUT_MS + RESOLVE_RTT_TAIL_MS,
      `${IDENTITY_BACKSTOP_MS}ms would cut off a chain that was still inside its own budgets`,
    )
    assert.equal(IDENTITY_BACKSTOP_MS, 12_000)
    // And it is not a deadline in disguise: it must clear the old 6 s by enough
    // that the captures round 10b caught crossing it are nowhere near it.
    assert.ok(IDENTITY_BACKSTOP_MS >= 2 * OLD_DEADLINE_MS)
  })
})

// ── nothing waits on a request that was never made ─────────────────────────
//
// THE TRAP IN THIS DESIGN, and the reason the machine has two settlement bits
// and not four. Every leg of the second answer can be skipped entirely — OCR off
// for the session, a read that produced nothing, an embed latched unavailable
// after one 404, a backend with no `/scan/resolve` — and a tracker that counted
// legs rather than the LEG would sit waiting for a call nobody made until the
// fuse blew. Twelve seconds of spinner for a capture that was decided at one.

describe('the flag-off paths settle promptly', () => {
  it('OCR OFF — the read is null, the resolve event still arrives, and it is over', () => {
    const { leftAt, state } = drive([
      [900, { type: 'phash', res: TIED }],
      [900, { type: 'read', read: null }],
      [1_050, { type: 'resolve', resolved: null, embed: embed({ ms: 860 }) }],
    ])
    assert.equal(state.phase, 'needs-you')
    assert.equal(leftAt, 1_050)
    assert.equal(state.backstopped, false, 'it did not wait out the fuse for a read nobody took')
  })

  it('NO EMBED EITHER — the latched 404 path, where the whole leg is skipped', () => {
    // `EMBED_NOT_ASKED`'s shape: `unavailable`, `ms: null`, no request made. The
    // machine must not distinguish it from an answer, because from here they are
    // the same fact — the leg is done.
    const { leftAt, state } = drive([
      [800, { type: 'phash', res: TIED }],
      [800, { type: 'read', read: null }],
      [820, { type: 'resolve', resolved: null, embed: embed({ outcome: 'unavailable', ms: null }) }],
    ])
    assert.equal(leftAt, 820)
    assert.equal(state.phase, 'needs-you')
    assert.equal(state.embed?.ms, null, 'and "never asked" is still recorded as a different fact')
  })

  it('AN EMBED-FREE BUILD SETTLES TOO — `embed` is optional and is not a signal', () => {
    // The fifty-odd tests that predate the image rung drive the reducer with no
    // `embed` at all. If settlement required one, every one of them would be
    // describing a capture that hangs.
    const { leftAt, state } = drive([
      [1_000, { type: 'phash', res: TIED }],
      [1_400, { type: 'resolve', resolved: resolveRes({ confident: false }) }],
    ])
    assert.equal(leftAt, 1_400)
    assert.equal(state.phase, 'needs-you')
    assert.equal(state.embed, null)
  })
})

// ── the reader ──────────────────────────────────────────────────────────────

// ── the reader ──────────────────────────────────────────────────────────────
//
// THEY ANSWER FROM THE LIST NOW. `Scan.tsx` reduces the state the needs-input
// ROW carried down with it (`FeedEntry.identity`) rather than a live stack
// entry — not to drive anything, since the row's own state is what changes, but
// so the answer is still ATTRIBUTED to the capture that asked the question. That
// is the only reason these two events survive the reversal, and the reason they
// are still tested against the shipping reducer rather than against a copy.

describe('the reader', () => {
  it('PICKING from the row’s picker names the card', () => {
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    assert.equal(needsYou.phase, 'needs-you')
    const picked = reduceIdentity(needsYou, { type: 'pick', match: needsYou.candidates[1] })
    assert.equal(picked.phase, 'confident')
    assert.equal(picked.by, 'reader')
    assert.equal(picked.match?.cardId, 'sve-003')
  })

  it('DISCARDING drops the capture — the row goes with it', () => {
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    const gone = reduceIdentity(needsYou, { type: 'retake' })
    assert.equal(gone.phase, 'discarded')
    assert.equal(gone.match, null)
    // And it stays gone: a resolve landing after the reader binned the capture
    // must not resurrect it.
    assert.equal(reduceIdentity(gone, { type: 'resolve', resolved: resolveRes() }).phase, 'discarded')
  })

  it('THE MACHINE NO LONGER TRACKS WHETHER THEY ARE MID-DECISION', () => {
    // `engaged` used to live here, and it stopped a late confident answer
    // swapping the card out from under a reader who had the thumbnail's picker
    // open. There is no thumbnail picker: the reader's picker is on a list row,
    // long after this reducer has finished with the capture, so the field would
    // have been a lock on a door nobody uses.
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    assert.equal('engaged' in needsYou, false, 'the stack-only field is gone, not merely unused')

    // AND THE DOOR IT LOCKED IS BRICKED UP, 2026-09-07. This assertion used to
    // read "a late confident answer ALWAYS promotes, with no second condition to
    // satisfy" — which is exactly the behaviour the owner ruled against once the
    // vector lane made it common. A settled capture is settled: the answer is
    // dropped and the drop is recorded, and `engaged` is not needed to protect a
    // reader from a promotion that can no longer happen to anyone.
    const late = reduceIdentity(needsYou, { type: 'resolve', resolved: resolveRes() })
    assert.equal(late.phase, 'needs-you')
    assert.equal(late.match, null)
    assert.equal(late.by, null)
    assert.equal(late.lateAnswerDropped, true)
    // …and this state was reached WITHOUT the fuse, which is the tell that this
    // ordering is only reachable in a test: the caller sends one resolve per
    // capture, so a second one is a contract violation and not a race.
    assert.equal(late.backstopped, false)
  })

  it('and their own answer beats a late one, by arriving first', () => {
    // The remaining ordering guarantee, and it needs no flag: `pick` makes the
    // state confident, and confident is terminal.
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    const picked = reduceIdentity(needsYou, { type: 'pick', match: needsYou.candidates[0] })
    assert.equal(reduceIdentity(picked, { type: 'resolve', resolved: resolveRes() }), picked)
    assert.equal(picked.by, 'reader')
  })
})

// ── the pieces around it ────────────────────────────────────────────────────

describe('resolvedIdentity', () => {
  it('needs BOTH confident and matched', () => {
    assert.equal(resolvedIdentity(resolveRes())?.cardId, 'sv10-116')
    assert.equal(resolvedIdentity(resolveRes({ confident: false })), null)
    assert.equal(resolvedIdentity(resolveRes({ matched: false })), null)
    assert.equal(resolvedIdentity(resolveRes({ matches: [] })), null)
    assert.equal(resolvedIdentity(null), null)
  })
})

describe('the OCR hint chip', () => {
  it('prefers the printed key, because the reader can check it on the card', () => {
    assert.equal(ocrHintLabel(read({ number: '161', denominator: '182' })), 'read 161/182')
    assert.equal(ocrHintLabel(read({ setCode: 'DRI', number: '161', denominator: '182' })), 'read DRI 161/182')
    assert.equal(ocrHintLabel(read({ number: '161' })), 'read 161')
  })

  it('falls back to the name only when there is no key, and quotes it', () => {
    // `ocr/fields.ts` is explicit that the name is the one field allowed to be
    // approximate — 76 % exact, mean CER 0.16 — so it is offered as something
    // the letters looked like, never as an identification.
    assert.equal(ocrHintLabel(read({ name: 'Murkrow' })), 'read “Murkrow”')
    assert.equal(ocrHintLabel(read({ name: 'Murkrow', number: '161' })), 'read 161')
  })

  it('says nothing when nothing was read', () => {
    assert.equal(ocrHintLabel(read()), null)
    assert.equal(ocrHintLabel(null), null)
  })
})

// ── WHAT THE PICKER IS OFFERED. 2026-09-07 ─────────────────────────────────
//
// The owner scanned an Ultra Ball in a toploader: the name read, the bottom
// strip did not, and the needs-input row said `read "Ultra Ball"` above five
// cards that were not Ultra Balls — Binding Mochi at 81 %. "As silly as it
// gets." The API half of the fix is rung 5b (the catalogue knows every Ultra
// Ball); this is the half that gets those candidates onto the screen.
//
// The property under test is not "the list is longer". It is that TWO RANKINGS
// STAY TWO: what the read found comes first and is marked, what the hash found
// follows and keeps its distances, and neither borrows the other's meaning.

/** The endpoint's answer for the reported case: a name family, claiming nothing. */
function ultraBalls(over: Partial<ScanResolveResponse> = {}): ScanResolveResponse {
  const printing = (cardId: string, setName: string): ScanResolveMatch => ({
    cardId,
    name: 'Ultra Ball',
    number: '196',
    setId: cardId.split('-')[0]!,
    setName,
    rarity: 'Common',
    images: { low: `${cardId}.low`, high: `${cardId}.high` },
    // A family the catalogue knows and the hash never nominated.
    distance: null,
    confidence: null,
  })
  return {
    matched: false,
    confident: false,
    resolvedBy: 'name-family',
    matches: [printing('sv01-196', 'Scarlet & Violet'), printing('sv03.5-182', '151')],
    ...over,
  }
}

describe('the picker’s candidates', () => {
  it('THE ULTRA BALL CASE: a name read puts Ultra Balls on top of the junk', () => {
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ name: 'Ultra Ball' }) },
      { type: 'resolve', resolved: ultraBalls() },
    ])
    assert.equal(s.phase, 'needs-you', 'a family is not a card, so the reader is still asked')
    assert.deepEqual(
      s.candidates.map((m) => m.cardId),
      ['sv01-196', 'sv03.5-182', 'sve-004', 'sve-003', 'sve-002'],
      'the cards named on the chip come first; the hash’s guesses are still offered, below',
    )
    assert.equal(ocrHintLabel(s.read), 'read “Ultra Ball”')
  })

  it('is ORDER-BLIND — the two answers race and the list comes out the same', () => {
    // The reducer's whole design principle, and the one this merge could most
    // easily have broken: a phash answer landing second must not overwrite the
    // ladder's candidates with its own list.
    const first = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: ultraBalls() }])
    const second = run([{ type: 'resolve', resolved: ultraBalls() }, { type: 'phash', res: TIED }])
    assert.deepEqual(
      second.candidates.map((m) => m.cardId),
      first.candidates.map((m) => m.cardId),
    )
    assert.deepEqual(second.candidates.map((m) => m.from), first.candidates.map((m) => m.from))
  })

  it('does not offer the same card twice, and the read’s copy is the one kept', () => {
    // The interesting agreement: both signals nominated it. The endpoint ranks
    // its own matches by the priors it was sent, so the read's copy carries the
    // distance anyway and nothing is lost by dropping the hash's duplicate.
    const agreed = ultraBalls({
      matches: [{ ...ultraBalls().matches[0]!, cardId: 'sve-003', distance: 7, confidence: 1 - 7 / 64 }],
    })
    const s = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: agreed }])
    assert.deepEqual(s.candidates.map((m) => m.cardId), ['sve-003', 'sve-004', 'sve-002'])
    assert.equal(s.candidates[0]?.from, 'read')
    assert.equal(s.candidates[0]?.distance, 7)
  })

  it('never re-offers the hash’s own list as something OCR found', () => {
    // `prior-only` means "OCR added no key, here is the hash's list, possibly
    // filtered". Marking those `from: 'read'` would credit the read with a list
    // it did not produce and draw a seam through one ranking.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'resolve', resolved: ultraBalls({ resolvedBy: 'prior-only', matches: [] }) },
    ])
    assert.deepEqual(s.candidates.map((m) => m.cardId), ['sve-004', 'sve-003', 'sve-002'])
    assert.deepEqual(s.candidates.map((m) => m.from), [undefined, undefined, undefined])
  })

  it('a CONFIDENT answer fills no picker, because there is no question left', () => {
    const s = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: resolveRes() }])
    assert.equal(s.phase, 'confident')
    assert.deepEqual(readCandidates(resolveRes()), [])
  })

  it('mergeCandidates is the whole ordering rule, and it is two lines', () => {
    const a = { ...match('a', 1), from: 'read' as const }
    const b = match('b', 2)
    const dupe = match('a', 9)
    assert.deepEqual(mergeCandidates([a], [b, dupe]).map((m) => m.cardId), ['a', 'b'])
    assert.deepEqual(mergeCandidates([], [b]).map((m) => m.cardId), ['b'])
    assert.deepEqual(mergeCandidates([a], []).map((m) => m.cardId), ['a'])
  })

  it('the reader may pick a card phash never saw, and the row gets a shape it understands', () => {
    // `toPickedMatch` translates the wire's "no opinion" (null) into the feed
    // row's long-standing -1/0, which is what `FeedEntryCard` reads to draw
    // provenance instead of a meter reading 0 %.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'resolve', resolved: ultraBalls() },
    ])
    const picked = reduceIdentity(s, { type: 'pick', match: s.candidates[0]! })
    assert.equal(picked.phase, 'confident')
    assert.equal(picked.by, 'reader')
    assert.equal(picked.match?.cardId, 'sv01-196')
    assert.equal(picked.match?.distance, null, 'the identity keeps the honest null')

    const forTheRow = toPickedMatch(s.candidates[0]!)
    assert.equal(forTheRow.distance, -1)
    assert.equal(forTheRow.confidence, 0)
    assert.equal('from' in forTheRow, false, 'provenance is a picker concern and stops here')
    // A candidate that DID have a distance keeps it, untouched.
    assert.equal(toPickedMatch(s.candidates[2]!).distance, 7)
  })
})

// `unresolvedCount` used to be tested here, counting `needs-you` across the
// stack. It counts LIST ROWS now and lives in `feed.ts` with the rest of the
// list's rules — see `commitGate.test.ts`. Counting phases would have meant
// counting a stack that empties itself, and reporting zero for a screen full of
// unanswered rows.
