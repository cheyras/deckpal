// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE IDENTITY RECORD — round 7's 26 device-unknown outcomes, closed.
//
// The capture event already records what the MATCHER said (`Scan.tsx`'s
// `matcherOutcomeFor`, added after the 2026-09-04 session could only be scored
// on the 21 captures the owner happened to press *report* on). What it did not
// record is what happened NEXT — whether the row was named by phash, corrected
// by the printed key, left on the camera for the reader, picked by hand, or
// thrown away. So the one question the OCR lane exists to answer, "does it name
// cards phash could not", was unanswerable from a device session.
//
// EVERY FIXTURE HERE IS PRODUCED BY THE REAL REDUCER. A hand-written
// `IdentityState` could describe a phase the machine never actually reaches, and
// this file's whole job is to say what the machine's states MEAN — so the states
// have to be its own.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanMatch, ScanResponse, ScanResolveMatch, ScanResolveResponse } from '../../../lib/api'
import type { OcrRead } from '../../ocr/pipeline'
import {
  identityOutcome,
  identityRecord,
  initialIdentity,
  reduceIdentity,
  type IdentityEvent,
  type IdentityState,
} from '../identity'
import { TIE_MARGIN } from '../tieGate'

// ── fixtures ────────────────────────────────────────────────────────────────

function match(cardId: string, distance: number): ScanMatch {
  return {
    cardId,
    name: `Card ${cardId}`,
    number: '127',
    setId: 'sv10',
    setName: 'Destined Rivals',
    rarity: 'Common',
    images: { low: 'l', high: 'h' },
    distance,
    confidence: 1 - distance / 64,
  }
}
function scanRes(matches: ScanMatch[]): ScanResponse {
  return { query: { algo: 'dhash', hash: 'abc' }, matched: true, threshold: 12, indexSize: 20_451, matches }
}
function resolveRes(
  over: Partial<ScanResolveResponse> = {},
  m: Partial<ScanResolveMatch> = {},
): ScanResolveResponse {
  return {
    matched: true,
    confident: true,
    resolvedBy: 'number+denominator',
    matches: [{ ...match('sv10-161', 6), distance: null, confidence: null, ...m }],
    ...over,
  }
}
function read(over: Partial<OcrRead> = {}): OcrRead {
  return { name: null, number: null, denominator: null, setCode: null, pass: 'roi', ms: 340, ...over }
}
function run(events: IdentityEvent[]): IdentityState {
  return events.reduce(reduceIdentity, initialIdentity())
}

/** A clearly-decided phash answer, and a tied one that the gate demotes. */
const CLEAR = scanRes([match('sv10-057', 4), match('sv10-058', 4 + TIE_MARGIN)])
const TIED = scanRes([match('sv10-057', 7), match('sv10-058', 7)])

// ── the five outcomes ───────────────────────────────────────────────────────

describe('identityOutcome', () => {
  it('says nothing at all while the capture is still pending', () => {
    // A capture nothing has decided yet is not an outcome, and recording it as
    // one would put a row in the evidence for every capture that was merely slow.
    assert.equal(identityOutcome(initialIdentity()), null)
    assert.equal(identityOutcome(run([{ type: 'phash', res: TIED }])), null)
    assert.equal(identityRecord(initialIdentity(), 400), null)
  })

  it('separates the matcher from the printed key', () => {
    assert.equal(identityOutcome(run([{ type: 'phash', res: CLEAR }])), 'confident-phash')
    assert.equal(
      identityOutcome(
        run([
          { type: 'phash', res: TIED },
          { type: 'read', read: read({ number: '161', denominator: '182' }) },
          { type: 'resolve', resolved: resolveRes() },
        ]),
      ),
      'confident-resolve',
    )
  })

  it('names the two the reader produces', () => {
    const stuck: IdentityEvent[] = [
      { type: 'phash', res: TIED },
      { type: 'read', read: null },
      { type: 'resolve', resolved: null },
    ]
    assert.equal(identityOutcome(run(stuck)), 'needs-you')
    assert.equal(identityOutcome(run([...stuck, { type: 'pick', match: match('sv10-058', 7) }])), 'picked')
    assert.equal(identityOutcome(run([...stuck, { type: 'retake' }])), 'retaken')
  })
})

// ── what the record says ────────────────────────────────────────────────────

describe('identityRecord', () => {
  it('reports the RUNG the read came off', () => {
    // The three values, and the one the escalation added. `'null'` is a string
    // because it is one of three values of an enum, not a missing field.
    const withRead = (r: OcrRead | null) =>
      (
        identityRecord(
          run([
            { type: 'read', read: r },
            { type: 'phash', res: CLEAR },
          ]),
          900,
        )?.identity as Record<string, unknown>
      ).ocr
    assert.equal(withRead(null), 'null')
    assert.equal(withRead(read()), 'roi')
    assert.equal(withRead(read({ pass: 'escalated' })), 'escalated')
  })

  it('says how much the escalation actually produced', () => {
    // The question a reviewer will have about every `escalated` row: did the
    // re-extraction rescue a key, or did it fall through to the prose?
    const rescued = identityRecord(
      run([
        { type: 'read', read: read({ pass: 'escalated', number: '103', denominator: '182' }) },
        { type: 'phash', res: CLEAR },
      ]),
      900,
    )?.identity as Record<string, unknown>
    assert.equal(rescued.ocr, 'escalated')
    assert.equal(rescued.bodyLines, null)

    const proseOnly = identityRecord(
      run([
        { type: 'read', read: read({ pass: 'escalated', bodyLines: ['Deceit', 'Search your deck'] }) },
        { type: 'phash', res: CLEAR },
      ]),
      900,
    )?.identity as Record<string, unknown>
    assert.equal(proseOnly.bodyLines, 2)
  })

  it('records WHICH RUNG OF THE LADDER answered, and whether it was sure', () => {
    const record = identityRecord(
      run([
        { type: 'phash', res: TIED },
        { type: 'read', read: read({ number: '161', denominator: '182' }) },
        { type: 'resolve', resolved: resolveRes({ resolvedBy: 'badge+number' }) },
      ]),
      2_100,
    )?.identity as Record<string, unknown>
    assert.deepEqual(record, {
      identityOutcome: 'confident-resolve',
      ocr: 'roi',
      bodyLines: null,
      ocrMs: 340,
      // No `embed` on this event, so both columns are null — the shape a capture
      // records on a build, or a backend, where the image rung is not in play.
      embedMs: null,
      embedOutcome: null,
      resolvedBy: 'badge+number',
      confident: true,
      cardId: 'sv10-161',
      msToResolve: 2_100,
    })
  })

  it('RECORDS WHAT THE IMAGE RUNG COST AND WHETHER IT ANSWERED', () => {
    // `resolvedBy: 'vector'` and `'corroborated'` flow through by themselves —
    // the record passes the endpoint's own word along and never interprets it.
    // What round 10 could NOT see, and what these two columns exist for, is the
    // other half: how long the vector took, and — when it did not contribute —
    // which of the four reasons that was.
    const record = identityRecord(
      run([
        { type: 'phash', res: TIED },
        { type: 'read', read: read({ number: '057', denominator: '182' }) },
        {
          type: 'resolve',
          resolved: resolveRes({ resolvedBy: 'corroborated' }),
          embed: { vectorMatches: [{ cardId: 'sv10-057', similarity: 0.7718 }], outcome: 'ok', ms: 1_329 },
        },
      ]),
      2_400,
    )?.identity as Record<string, unknown>
    assert.equal(record.resolvedBy, 'corroborated', 'passed straight through from the endpoint')
    assert.equal(record.embedOutcome, 'ok')
    assert.equal(record.embedMs, 1_329)
  })

  it('and tells the four failures APART, because they are different facts', () => {
    // "This deployment has no matcher", "the phone gave up waiting" and "we never
    // asked" all produce the same absent vector. A single boolean would collapse
    // them and leave the next session unable to say whether the rung is off or
    // merely slow.
    const withEmbed = (embed: { outcome: 'timeout' | 'unavailable' | 'error'; ms: number | null }) =>
      identityRecord(
        run([
          { type: 'phash', res: TIED },
          { type: 'read', read: null },
          { type: 'resolve', resolved: null, embed: { vectorMatches: [], ...embed } },
        ]),
        9_000,
      )?.identity as Record<string, unknown>

    assert.equal(withEmbed({ outcome: 'timeout', ms: 8_000 }).embedOutcome, 'timeout')
    assert.equal(withEmbed({ outcome: 'timeout', ms: 8_000 }).embedMs, 8_000, 'the wait is recorded even though it bought nothing')
    assert.equal(withEmbed({ outcome: 'error', ms: 240 }).embedOutcome, 'error')
    // The latched capture: no call was made, so there is no duration to report —
    // which is a different fact from "it took no time" and is recorded as one.
    const latched = withEmbed({ outcome: 'unavailable', ms: null })
    assert.equal(latched.embedOutcome, 'unavailable')
    assert.equal(latched.embedMs, null)
  })

  it('keeps the embed columns across the READER’s later answer', () => {
    // The second post comes from a list row minutes later, reduced against the
    // state the row carried down. "The vector timed out and the reader picked the
    // phash runner-up" is one row of evidence, and it only exists if the embed
    // half survives the `pick`.
    const settled = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: null },
      { type: 'resolve', resolved: null, embed: { vectorMatches: [], outcome: 'timeout', ms: 8_000 } },
    ])
    const record = identityRecord(reduceIdentity(settled, { type: 'pick', match: match('sv10-058', 7) }), 31_000)
      ?.identity as Record<string, unknown>
    assert.equal(record.identityOutcome, 'picked')
    assert.equal(record.embedOutcome, 'timeout')
    assert.equal(record.embedMs, 8_000)
  })

  it('leaves the ladder columns null when no answer was ever in flight', () => {
    // OCR off for the session, nothing read, or a backend with no such endpoint
    // — all three send `resolved: null`, and none of them is a verdict.
    const record = identityRecord(
      run([
        { type: 'phash', res: TIED },
        { type: 'read', read: null },
        { type: 'resolve', resolved: null },
      ]),
      3_400,
    )?.identity as Record<string, unknown>
    assert.equal(record.identityOutcome, 'needs-you')
    assert.equal(record.resolvedBy, null)
    assert.equal(record.confident, null)
    assert.equal(record.cardId, null)
    assert.equal(record.ocr, 'null')
  })

  it('KEEPS AN UNCONFIDENT VERDICT, because that is the interesting row', () => {
    // "The ladder answered `number+denominator` and was not sure" is a different
    // finding from "the ladder never answered", and the pair of them is how the
    // next session's rung-by-rung hit rate gets computed.
    const record = identityRecord(
      run([
        { type: 'phash', res: TIED },
        { type: 'read', read: read({ pass: 'escalated', bodyLines: ['Deceit'] }) },
        { type: 'resolve', resolved: resolveRes({ confident: false, resolvedBy: 'prior-only' }) },
      ]),
      5_000,
    )?.identity as Record<string, unknown>
    assert.equal(record.identityOutcome, 'needs-you')
    assert.equal(record.resolvedBy, 'prior-only')
    assert.equal(record.confident, false)
  })

  it('rounds the two clocks — a float64 costs bytes and says nothing', () => {
    const record = identityRecord(
      run([
        { type: 'read', read: read({ ms: 1_842.667_1 }) },
        { type: 'phash', res: CLEAR },
      ]),
      912.348_9,
    )?.identity as Record<string, unknown>
    assert.equal(record.ocrMs, 1_843)
    assert.equal(record.msToResolve, 912)
  })

  it('follows a LATE confident answer onto a thumbnail the reader had not touched', () => {
    // `identity.ts`: a confident answer promotes whenever it lands, deadline or
    // no deadline. The record has to say `confident-resolve` for that capture,
    // because the escalation rung is exactly the thing that makes answers late.
    const late = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ pass: 'escalated', bodyLines: ['Deceit'] }) },
      { type: 'deadline' },
      { type: 'resolve', resolved: resolveRes() },
    ])
    assert.equal(identityOutcome(late), 'confident-resolve')
    const record = identityRecord(late, 18_400)?.identity as Record<string, unknown>
    assert.equal(record.ocr, 'escalated')
    assert.equal(record.msToResolve, 18_400)
  })

  it('and records the READER as the answer when they give one', () => {
    // THE SECOND POST, and the reason `picked`/`retaken` survived 2026-09-06.
    //
    // The reader answers from a LIST ROW now, minutes after the thumbnail flew
    // down, and by then the reducer has let the capture go. `Scan.tsx` keeps the
    // settled state on the row (`FeedEntry.identity`) and reduces the reader's
    // event against it — exactly what this does — so the pair "the machine said
    // needs-you, and here is what the reader made of it" still lands.
    const settled = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: null },
      { type: 'resolve', resolved: resolveRes({ confident: false, resolvedBy: 'prior-only' }) },
    ])
    assert.equal(identityOutcome(settled), 'needs-you', 'the first post, from the race')

    const record = identityRecord(reduceIdentity(settled, { type: 'pick', match: match('sv10-058', 7) }), 31_000)
      ?.identity as Record<string, unknown>
    assert.equal(record.identityOutcome, 'picked')
    assert.equal(record.cardId, 'sv10-058')
    assert.equal(record.msToResolve, 31_000, 'measured from the SHUTTER, not from when the row landed')
    // The ladder's verdict is still recorded — it just did not name the card.
    // "The endpoint answered prior-only and was not sure, and the reader chose
    // the phash runner-up" is the single most useful row this channel produces.
    assert.equal(record.resolvedBy, 'prior-only')
    assert.equal(record.confident, false)
  })

  it('and the discard the same way, so a binned capture is not a silent gap', () => {
    const settled = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ pass: 'escalated', bodyLines: ['Deceit'] }) },
      { type: 'resolve', resolved: null },
    ])
    const record = identityRecord(reduceIdentity(settled, { type: 'retake' }), 12_000)?.identity as Record<
      string,
      unknown
    >
    assert.equal(record.identityOutcome, 'retaken')
    assert.equal(record.cardId, null)
    assert.equal(record.ocr, 'escalated')
  })

  it('THE FIVE OUTCOMES ARE STILL FIVE, and none of them says where the row is', () => {
    // The reversal moved the question from the camera to the list without
    // changing what was asked or who answered it, so nothing here gains a
    // `rowLocation` — a column with one value. Sessions either side of the
    // change are separated by `pipelineVersion`, which `flags.ts` stamps.
    const stuck: IdentityEvent[] = [
      { type: 'phash', res: TIED },
      { type: 'read', read: null },
      { type: 'resolve', resolved: null },
    ]
    const seen = new Set([
      identityOutcome(run([{ type: 'phash', res: CLEAR }])),
      identityOutcome(run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: resolveRes() }])),
      identityOutcome(run(stuck)),
      identityOutcome(reduceIdentity(run(stuck), { type: 'pick', match: match('sv10-058', 7) })),
      identityOutcome(reduceIdentity(run(stuck), { type: 'retake' })),
    ])
    assert.deepEqual(
      [...seen].sort(),
      ['confident-phash', 'confident-resolve', 'needs-you', 'picked', 'retaken'],
    )
    const record = identityRecord(run(stuck), 900)?.identity as Record<string, unknown>
    assert.deepEqual(Object.keys(record).sort(), [
      'bodyLines',
      'cardId',
      'confident',
      // The image rung's two, and they are COLUMNS OF THE SAME RECORD rather
      // than a sixth outcome: what named the card is still one of five, and a
      // vector that helped says so through `resolvedBy`, which was already here.
      'embedMs',
      'embedOutcome',
      'identityOutcome',
      'msToResolve',
      'ocr',
      'ocrMs',
      'resolvedBy',
    ])
  })
})
