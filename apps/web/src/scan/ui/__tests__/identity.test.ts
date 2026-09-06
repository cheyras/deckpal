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
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanMatch, ScanResponse, ScanResolveResponse } from '../../../lib/api'
import type { OcrRead } from '../../ocr/pipeline'
import { IDENTITY_DEADLINE_MS } from '../deadline'
import {
  initialIdentity,
  ocrHintLabel,
  reduceIdentity,
  resolvedIdentity,
  unresolvedCount,
  type IdentityEvent,
  type IdentityState,
} from '../identity'
import { TIE_MARGIN } from '../tieGate'

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
    const later = run([{ type: 'resolve', resolved: resolveRes() }, { type: 'deadline' }], afterPhash)
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

  it('fills the picker from the tie-gated ranking even though the claim was refused', () => {
    const s = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    assert.equal(s.phase, 'needs-you')
    assert.deepEqual(
      s.candidates.map((m) => m.cardId),
      ['sve-004', 'sve-003', 'sve-002'],
      'withholding the claim must never withhold the evidence',
    )
  })

  it('does NOT put the resolve endpoint’s own matches in the picker', () => {
    // ocrNarrow.ts's standing rule: those carry `distance: null` for cards phash
    // never nominated, and a list that ranks by distance must not contain
    // entries that have none. What OCR contributes here is its READ, as a hint.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'read', read: read({ number: '116', denominator: '182' }) },
      { type: 'resolve', resolved: resolveRes({ confident: false }) },
    ])
    assert.equal(
      s.candidates.some((m) => m.cardId === 'sv10-116'),
      false,
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
    const onlyPhash = run([{ type: 'phash', res: TIED }])
    assert.equal(onlyPhash.phase, 'pending')
    const onlyResolve = run([{ type: 'resolve', resolved: resolveRes({ confident: false }) }])
    assert.equal(onlyResolve.phase, 'pending')
  })
})

// ── the deadline ────────────────────────────────────────────────────────────

describe('the deadline', () => {
  it('flips a still-waiting capture to needs-you', () => {
    const s = run([{ type: 'phash', res: TIED }, { type: 'deadline' }])
    assert.equal(s.phase, 'needs-you')
  })

  it('is a no-op once the card has been named', () => {
    const s = run([{ type: 'phash', res: CLEAR }, { type: 'deadline' }])
    assert.equal(s.phase, 'confident')
    assert.equal(s.match?.cardId, 'sv10-057')
  })

  it('does not stop a late confident answer from rescuing the thumbnail', () => {
    // The deadline is a projection's headroom, not a verdict. A card the ladder
    // names at 7 s is still that card, and nobody is looking at the thumbnail.
    const s = run([
      { type: 'phash', res: TIED },
      { type: 'deadline' },
      { type: 'resolve', resolved: resolveRes() },
    ])
    assert.equal(s.phase, 'confident')
    assert.equal(s.by, 'printing')
  })

  it('is longer than the slow branch it is waiting on', () => {
    // The sizing, as an assertion rather than only as prose in deadline.ts:
    // OCR read (REPORT.md §8.3's 1.8-3.4 s projection, stated as a FLOOR) plus a
    // resolve round trip of the same class as identify (~1-2 s). Firing inside
    // that band would flip cards that were about to identify themselves.
    const SLOWEST_OCR_READ_MS = 3_400
    const RESOLVE_RTT_MS = 2_000
    assert.ok(
      IDENTITY_DEADLINE_MS >= SLOWEST_OCR_READ_MS + RESOLVE_RTT_MS,
      `${IDENTITY_DEADLINE_MS}ms would pre-empt the OCR branch's own worst case`,
    )
  })
})

// ── the reader ──────────────────────────────────────────────────────────────

describe('the reader', () => {
  it('PICKING from a needs-you thumbnail names the card', () => {
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    assert.equal(needsYou.phase, 'needs-you')
    const picked = reduceIdentity(needsYou, { type: 'pick', match: needsYou.candidates[1] })
    assert.equal(picked.phase, 'confident')
    assert.equal(picked.by, 'reader')
    assert.equal(picked.match?.cardId, 'sve-003')
  })

  it('RETAKING discards the capture — no row, no identity', () => {
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    const gone = reduceIdentity(needsYou, { type: 'retake' })
    assert.equal(gone.phase, 'discarded')
    assert.equal(gone.match, null)
    // And it stays gone: a resolve landing after the reader binned the capture
    // must not resurrect it.
    assert.equal(reduceIdentity(gone, { type: 'resolve', resolved: resolveRes() }).phase, 'discarded')
  })

  it('ONCE THE PICKER IS OPEN, a late confident answer does not overrule them', () => {
    // The bug this pins: the reader taps the thumbnail, reads the five
    // candidates, and the card changes under their finger because a round trip
    // finally came back. Same principle `narrowedIdentity` enforces with
    // `verified` — a badge read does not overrule a human.
    const engaged = run([
      { type: 'phash', res: TIED },
      { type: 'resolve', resolved: null },
      { type: 'engage' },
    ])
    assert.equal(engaged.phase, 'needs-you')
    const late = reduceIdentity(engaged, { type: 'resolve', resolved: resolveRes() })
    assert.equal(late.phase, 'needs-you', 'the reader is mid-decision; the answer waits its turn')
    // Their own choice still lands.
    assert.equal(reduceIdentity(late, { type: 'pick', match: late.candidates[0] }).by, 'reader')
  })

  it('opening the picker on a still-pending capture stops the race naming it too', () => {
    const s = run([{ type: 'engage' }, { type: 'phash', res: CLEAR }])
    assert.equal(s.phase, 'pending', 'engaged: nothing may name it but the reader')
    assert.deepEqual(s.candidates.map((m) => m.cardId), ['sv10-057', 'sv10-058'])
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

describe('unresolvedCount', () => {
  it('counts only the thumbnails waiting on the reader', () => {
    const pending = initialIdentity()
    const needsYou = run([{ type: 'phash', res: TIED }, { type: 'resolve', resolved: null }])
    const confident = run([{ type: 'phash', res: CLEAR }])
    assert.equal(
      unresolvedCount([{ identity: pending }, { identity: needsYou }, { identity: confident }, { identity: needsYou }]),
      2,
    )
    assert.equal(unresolvedCount([]), 0)
  })
})
