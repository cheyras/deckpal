// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE IMAGE RUNG, FROM THE CLIENT'S SIDE — the budget, the four outcomes, and
// the request that goes out at the end of it.
//
// ── WHAT THIS FILE IS SCORED AGAINST ───────────────────────────────────────
//
// `p2-work/e2e-drive/driver/fuse10.mjs`, round 10's harness, and the JSON it
// wrote. That harness had to INVENT the client contract — the deployed bundle
// contained no reference to `vectorMatches`, `/scan/embed` or `similarity`
// (E2E-REPORT.md §1, finding 42) — and then drove twenty-five of the owner's
// real captures through it: 21/25 confident against the baseline's 19/25, zero
// wrong on either arm. So the bodies below are not invented fixtures. They are
// the exact `{fields, priorMatches, vectorMatches}` objects that produced those
// answers off the live endpoint, copied out of `out-r10fuse/fuse10.json`, and
// the point of the first suite is that the SHIPPING builder reproduces them.
//
// ── AND THE PROPERTY THAT LETS THIS SHIP AHEAD OF THE FLAG ─────────────────
//
// `SCAN_EMBED_MATCH` is unset by default and `/scan/embed` 404s on a deployment
// without it. With no vector in hand this client must send the request it sent
// before the matcher was written — not a similar one, the same one, key for key
// — because that is what "the flag changes nothing" has to mean from this side.
// `JSON.stringify` is the assertion, because bytes are the claim.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanEmbedResponse } from '../../../lib/api'
import type { OcrRead } from '../../ocr/pipeline'
import { TimeoutError } from '../deadline'
import { toResolveBody } from '../resolveFields'
import {
  classifyEmbedFailure,
  EMBED_NOT_ASKED,
  EMBED_TIMEOUT_MS,
  embedEvidence,
  latchesUnavailable,
  MAX_VECTOR_MATCHES,
  toVectorMatches,
  type EmbedOutcome,
} from '../vectorEvidence'

// ── fixtures, off round 10's wire ───────────────────────────────────────────

function read(over: Partial<OcrRead> = {}): OcrRead {
  return { name: null, number: null, denominator: null, setCode: null, pass: 'roi', ms: 340, ...over }
}

/** m02 — `fuse.ts`'s corroboration rule, live. OCR read `057/182` and nothing
 *  else; the printed key leaves two cards and cannot choose; the vector's own
 *  top-1 is one of them. Baseline `number+denominator` unconfident on the WRONG
 *  card; fused `corroborated`, confident, right. */
const M02 = {
  read: read({ number: '057', denominator: '182', pass: 'escalated', ms: 807.2999999523163 }),
  priorMatches: [
    { cardId: 'sv06-003', distance: 12 },
    { cardId: 'sv06.5-003', distance: 13 },
    { cardId: 'sv01-150', distance: 13 },
    { cardId: 'sv06-041', distance: 13 },
    { cardId: '2024sv-12', distance: 13 },
  ],
  vectorMatches: [
    { cardId: 'sv10-057', similarity: 0.771810687428397 },
    { cardId: 'ex15-56', similarity: 0.75700816428564 },
    { cardId: 'ex13-79', similarity: 0.73855264553114 },
    { cardId: 'hgss1-88', similarity: 0.736412719701964 },
    { cardId: 'ex10-79', similarity: 0.733845808093378 },
  ],
  /** The body the harness POSTed, character for character. */
  body:
    '{"fields":{"number":"057","denominator":"182"},"priorMatches":[{"cardId":"sv06-003","distance":12},' +
    '{"cardId":"sv06.5-003","distance":13},{"cardId":"sv01-150","distance":13},{"cardId":"sv06-041","distance":13},' +
    '{"cardId":"2024sv-12","distance":13}],"vectorMatches":[{"cardId":"sv10-057","similarity":0.771810687428397},' +
    '{"cardId":"ex15-56","similarity":0.75700816428564},{"cardId":"ex13-79","similarity":0.73855264553114},' +
    '{"cardId":"hgss1-88","similarity":0.736412719701964},{"cardId":"ex10-79","similarity":0.733845808093378}]}',
}

/** m10 — a CARD BACK, and the row that proves the departure is safe. OCR read
 *  nothing at all, so the shipped client did not post it. The fused arm did, and
 *  the ladder answered `vector` UNCONFIDENT: five candidate names, no claim. */
const M10 = {
  read: read({ pass: 'escalated', ms: 536.3000001907349 }),
  priorMatches: [
    { cardId: 'sm2-167', distance: 13 },
    { cardId: 'sm1-166', distance: 13 },
  ],
  vectorMatches: [
    { cardId: 'ex10-87', similarity: 0.560345597308353 },
    { cardId: 'ex6-97', similarity: 0.554536219887541 },
  ],
}

function embedRes(matches: { cardId: string; similarity: number }[]): ScanEmbedResponse {
  return {
    stamp: 'e1:clip-vit-b32-openai',
    indexSize: 20_308,
    identity: {
      level: 'confident',
      cardId: matches[0]?.cardId ?? null,
      similarity: matches[0]?.similarity ?? 0,
      margin: 0.0668,
      modelId: 'clip-vit-b32-openai',
    },
    variant: { level: 'unknown', reason: 'no-variant-model', requiresUserChoice: false },
    matches: matches.map((m) => ({
      ...m,
      name: `Card ${m.cardId}`,
      number: '057',
      setId: 'sv10',
      setName: 'Destined Rivals',
      seriesId: 'sv',
      rarity: 'Common',
      images: { low: 'l', high: 'h' },
      variantCount: 1,
    })),
  }
}

// ── the wire ────────────────────────────────────────────────────────────────

describe('the resolve body, with the image rung wired', () => {
  it('reproduces round 10’s FUSED request byte for byte', () => {
    const body = toResolveBody(M02.read, M02.priorMatches, M02.vectorMatches)
    assert.equal(JSON.stringify(body), M02.body)
  })

  it('sends NO vectorMatches key when there is no vector — not an empty array', () => {
    // The whole of "the flag changes nothing for this client". An empty array
    // would be a new key on every request to every deployment, asserting the
    // image rung looked and found nothing when the truth is that it was never
    // asked or never answered.
    const body = toResolveBody(M02.read, M02.priorMatches, [])
    assert.equal('vectorMatches' in (body ?? {}), false)
    assert.equal(
      JSON.stringify(body),
      '{"fields":{"number":"057","denominator":"182"},"priorMatches":[{"cardId":"sv06-003","distance":12},' +
        '{"cardId":"sv06.5-003","distance":13},{"cardId":"sv01-150","distance":13},{"cardId":"sv06-041","distance":13},' +
        '{"cardId":"2024sv-12","distance":13}]}',
      'identical to what shipped before the matcher existed',
    )
  })

  it('SPENDS A ROUND TRIP ON THE VECTOR ALONE — m10, the card back', () => {
    // The departure round 10 made from the shipped client and flagged as one:
    // `hasAnySignal` is false, so today this crop is never posted, and the crop
    // OCR cannot read is exactly the crop the image rung answers. The endpoint
    // then refused to be confident about a card back, which is the behaviour
    // that makes the departure safe.
    const body = toResolveBody(M10.read, M10.priorMatches, M10.vectorMatches)
    assert.notEqual(body, null)
    assert.deepEqual(body?.fields, {}, 'nothing was read, and nothing is claimed')
    assert.equal(body?.vectorMatches?.length, 2)
  })

  it('and still declines the round trip when NEITHER rung has anything', () => {
    // Today's behaviour, unchanged: no read, no vector, no request. This is the
    // shape every capture takes on a deployment with the matcher off.
    assert.equal(toResolveBody(M10.read, M10.priorMatches, []), null)
    assert.equal(toResolveBody(null, M10.priorMatches, []), null)
  })

  it('asks anyway when the READ alone has something, vector or no vector', () => {
    assert.notEqual(toResolveBody(read({ number: '161' }), [], []), null)
  })

  it('carries a null read — OCR off for the session is not a reason to skip', () => {
    // `OCR_ENABLED` is false in production. The vector is not behind that flag
    // (it costs the phone an upload and no download), so `read` can be null on
    // exactly the deployment the rung was built for.
    const body = toResolveBody(null, M10.priorMatches, M10.vectorMatches)
    assert.deepEqual(body?.fields, {})
    assert.equal(body?.vectorMatches?.length, 2)
  })

  it('copies the priors rather than forwarding the caller’s objects', () => {
    const priors = [{ cardId: 'sv10-057', distance: 7 }]
    const body = toResolveBody(read({ number: '161' }), priors, M02.vectorMatches)
    assert.notEqual(body?.priorMatches[0], priors[0])
    assert.notEqual(body?.vectorMatches?.[0], M02.vectorMatches[0])
  })
})

// ── what comes back off /scan/embed ─────────────────────────────────────────

describe('the embed response, reduced to evidence', () => {
  it('keeps cardId and similarity and drops the rest', () => {
    assert.deepEqual(toVectorMatches(embedRes(M02.vectorMatches)), M02.vectorMatches)
  })

  it('survives an empty index and a missing response', () => {
    // `indexSize: 0` is a 200 with no matches — "nothing is indexed" is an
    // answer, and a different one from "nothing matched".
    assert.deepEqual(toVectorMatches(embedRes([])), [])
    assert.deepEqual(toVectorMatches(null), [])
  })

  it('FILTERS a similarity the endpoint would refuse, rather than forwarding it', () => {
    // `/scan/resolve` 400s on a similarity outside -1..1 because "a value outside
    // it did not come from POST /scan/embed". Forwarding one would turn the
    // narrowing call — which still had a job to do — into an error, so the
    // candidate is dropped and the request survives.
    const res = embedRes([{ cardId: 'a', similarity: 1.4 }, { cardId: 'b', similarity: 0.8 }])
    assert.deepEqual(toVectorMatches(res), [{ cardId: 'b', similarity: 0.8 }])
    const nan = embedRes([{ cardId: 'a', similarity: Number.NaN }])
    assert.deepEqual(toVectorMatches(nan), [])
  })

  it('caps the list below the endpoint’s own limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ cardId: `c${i}`, similarity: 0.5 }))
    assert.equal(toVectorMatches(embedRes(many)).length, MAX_VECTOR_MATCHES)
  })
})

// ── the four outcomes ───────────────────────────────────────────────────────

describe('the embed budget', () => {
  it('is eight seconds, which is round 10’s slowest real request', () => {
    // 7 595 ms was the worst of twenty-five, on a cold function instance. The
    // number is "the slowest thing we have ever seen, and no more" — it is not
    // sized against IDENTITY_DEADLINE_MS, which is a spinner and not an answer.
    assert.equal(EMBED_TIMEOUT_MS, 8_000)
  })

  it('EMBED-FAST — the warm case, where the vector is already in hand', () => {
    // 733-824 ms warm, against an OCR read projected at 1.8-3.4 s. The wait at
    // the resolve point is zero because the embed started at the shutter.
    return embedEvidence(async () => embedRes(M02.vectorMatches), { now: fakeClock([0, 780]) }).then((ev) => {
      assert.equal(ev.outcome, 'ok')
      assert.equal(ev.ms, 780)
      assert.deepEqual(ev.vectorMatches, M02.vectorMatches)
    })
  })

  it('EMBED-SLOW — the budget runs out and the vector is DROPPED', async () => {
    // Not awaited afterwards, and not retried: the resolve goes without it, which
    // is today's behaviour exactly. `resolveWithOcr`'s header states why there is
    // no second attempt, and this outcome is how often it costs anything.
    const started = Date.now()
    const ev = await embedEvidence(() => new Promise<ScanEmbedResponse>(() => {}), { timeoutMs: 30 })
    assert.equal(ev.outcome, 'timeout')
    assert.deepEqual(ev.vectorMatches, [], 'the resolve is built as if nothing came back')
    assert.ok(Date.now() - started < 5_000, 'it gave up rather than waiting on a promise that never settles')
  })

  it('EMBED-404 — the deployment has no matcher, and that is `unavailable`', async () => {
    // The signal `Scan.tsx` latches on. One upload to learn it, never again this
    // session — the same rule `/scan/resolve`'s own 404 already follows.
    const ev = await embedEvidence(() => Promise.reject(apiError(404)))
    assert.equal(ev.outcome, 'unavailable')
    assert.deepEqual(ev.vectorMatches, [])
  })

  it('EMBED-ERROR — anything else, and the capture carries on regardless', async () => {
    // A 500 (the model file is missing on that deployment), a 400, a dead
    // socket. None of them is a failed capture and none of them latches: the
    // next card asks again, because the reason might have been the connection.
    for (const e of [apiError(500), apiError(400), new TypeError('Failed to fetch')]) {
      const ev = await embedEvidence(() => Promise.reject(e))
      assert.equal(ev.outcome, 'error')
      assert.deepEqual(ev.vectorMatches, [])
    }
  })

  it('never throws, whatever the call does', async () => {
    // The rule `readCardFields` is written under, one lane along: an optional
    // enrichment that can take down a capture is worse than no enrichment.
    await assert.doesNotReject(() =>
      embedEvidence(() => {
        throw new Error('synchronous, before the promise even exists')
      }),
    )
  })

  it('tells a timeout from a 404 from everything else', () => {
    assert.equal(classifyEmbedFailure(new TimeoutError('embed', 8_000)), 'timeout')
    // `deadlineSignal` aborts WITH a TimeoutError, and fetch rejects with the
    // abort reason — but a runtime that substitutes its own must land here too.
    assert.equal(classifyEmbedFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout')
    assert.equal(classifyEmbedFailure(apiError(404)), 'unavailable')
    assert.equal(classifyEmbedFailure(apiError(503)), 'error')
    assert.equal(classifyEmbedFailure(null), 'error')
    assert.equal(classifyEmbedFailure('a string, somehow'), 'error')
  })
})

// ── the session latch ───────────────────────────────────────────────────────

describe('what a session stops asking for', () => {
  /** `Scan.tsx`'s `embedUnavailableRef`, as a value a test can walk: each
   *  capture asks only if nothing has latched, and reports its outcome back. */
  function session(outcomes: EmbedOutcome[]): { asked: number; evidence: EmbedOutcome[] } {
    let latched = false
    const evidence: EmbedOutcome[] = []
    let asked = 0
    for (const outcome of outcomes) {
      if (latched) {
        evidence.push(EMBED_NOT_ASKED.outcome)
        continue
      }
      asked++
      evidence.push(outcome)
      if (latchesUnavailable(outcome)) latched = true
    }
    return { asked, evidence }
  }

  it('EMBED-404-LATCH — one upload finds out, and no later capture asks', () => {
    // `SCAN_EMBED_MATCH` is unset by default, and `pnpm dev` talks to the LIVE
    // backend, so "this app has the code and that server does not" is the
    // ORDINARY case here — the same sentence `resolveWithOcr`'s 404 branch is
    // written under.
    const s = session(['unavailable', 'unavailable', 'unavailable', 'unavailable'])
    assert.equal(s.asked, 1, 'four captures, one request')
    assert.deepEqual(s.evidence, ['unavailable', 'unavailable', 'unavailable', 'unavailable'])
  })

  it('but a SLOW or BROKEN request never latches — the next card asks again', () => {
    // A cold function instance cost 6 271 ms on round 10's very first request
    // and 733 ms on its second. Latching on that would switch the rung off for
    // the session on the strength of the one request guaranteed to be slowest.
    assert.equal(session(['timeout', 'ok', 'ok']).asked, 3)
    assert.equal(session(['error', 'ok']).asked, 2)
    assert.equal(latchesUnavailable('timeout'), false)
    assert.equal(latchesUnavailable('error'), false)
    assert.equal(latchesUnavailable('ok'), false)
    assert.equal(latchesUnavailable('unavailable'), true)
  })

  it('and the capture that never asked reports no duration', () => {
    // Null, not zero: "we did not ask" and "it was instant" are different facts
    // and the record keeps them apart.
    assert.equal(EMBED_NOT_ASKED.ms, null)
    assert.deepEqual(EMBED_NOT_ASKED.vectorMatches, [])
  })
})

/** `ApiError` without importing it: that module reads `import.meta.env` at load
 *  and cannot be pulled into a node test process — the whole reason
 *  `vectorEvidence.ts` reads the status structurally in the first place. */
function apiError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { name: 'ApiError', status })
}

/** A clock that hands out the given readings in order, so a duration can be
 *  asserted exactly instead of within a tolerance. */
function fakeClock(readings: number[]): () => number {
  let i = 0
  return () => readings[Math.min(i++, readings.length - 1)] ?? 0
}
