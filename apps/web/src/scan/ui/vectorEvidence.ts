// THE IMAGE RUNG'S CLIENT HALF — how long this side waits for a vector, and
// what it does with the answer.
//
// ── WHY THIS IS A SEPARATE FILE FROM `ocrNarrow.ts` ─────────────────────────
//
// The same reason `resolveFields.ts` is, stated in that file's header: the
// module next door imports `lib/api`, which reads `import.meta.env` at
// evaluation time, which does not exist under node — so a policy that shares a
// file with the transport cannot be unit-tested at all. Everything here is a
// rule (how long, what counts, what a failure means) and every rule here has a
// test. Only TYPES cross over from `lib/api`, and a type import is erased.
//
// ── WHAT ROUND 10 MEASURED, AND WHAT IT COSTS ──────────────────────────────
//
// `p2-work/e2e-drive/E2E-REPORT.md` §2, on the deployed route, 27 requests:
//
//   warm   733-824 ms
//   cold   4 601-7 595 ms   (a fresh function instance, not concurrency —
//                            three of twenty-five SERIAL requests paid it)
//
// and its own conclusion, verbatim: "Budget the cold path at 5-8 s, not 1.5 s."
// The accuracy this buys is §3's: 21/25 confident against the baseline's 19/25,
// zero wrong on either arm, and two rows turned from a question into an answer
// by evidence the printed key could not supply.
//
// So the vector is worth waiting for and it cannot be waited for on the capture
// path. Both halves are honoured by starting it at the shutter — beside the OCR
// read, which is itself projected at 1.8-3.4 s — and by holding it to a budget
// measured from ITS OWN START rather than from the moment the resolve is ready
// to fire. In the warm case the vector has been sitting in hand for a second by
// then and costs nothing; in the cold case the wait is what is left of the
// budget, and when that runs out the resolve goes without it.
import type { ScanEmbedResponse, ScanVectorMatch } from '../../lib/api'
import { TimeoutError, withTimeout } from './deadline'

/**
 * THE BUDGET. Eight seconds, measured from the embed POST, and the number comes
 * straight off the measurement above: 7 595 ms was the worst of twenty-five
 * real requests, so 8 s is "the slowest thing we have ever seen, and no more".
 *
 * IT IS THE THING THE THUMBNAIL WAITS FOR, and since 2026-09-07 that is literal.
 *
 * This budget used to be defended against a 6 s `IDENTITY_DEADLINE_MS` — "cutting
 * the vector off at 6 s to protect a spinner would trade the answer for the
 * animation" — and the defence was that the deadline was "not final", so a
 * vector landing at 7 s still promoted the row. Round 10b measured what that
 * looked like in the app: six of thirty-one captures crossed the deadline with
 * their embed still out, flipped to needs-you, and upgraded themselves when it
 * landed. The owner ruled against the upgrade, so the deadline went instead of
 * the budget (`deadline.ts`, `identity.ts`): a capture is `pending` until this
 * budget is spent one way or the other, and needs-you now means the vector's
 * eight seconds are UP, not merely late.
 *
 * So the eight seconds are load-bearing twice over — they are how long a reader
 * may watch a spinner for the image rung, and `IDENTITY_BACKSTOP_MS` (12 s) is
 * this number plus the resolve tail that follows it. Moving this moves that.
 *
 * It IS well under `OCR_NARROW_TIMEOUT_MS` (20 s), which is the outer bound on
 * the whole narrowing pass, so a stalled embed can never be the thing that holds
 * that open.
 */
export const EMBED_TIMEOUT_MS = 8_000

/** How many candidates to ask for. Five, the same k the phash identify uses and
 *  the same k round 10 drove — `fuse.ts` reads the top few and the ladder's
 *  corroboration rule never looks past them. */
export const EMBED_K = 5

/** The endpoint accepts at most 50 `vectorMatches` and rejects the body with a
 *  400 above that. We ask for 5; this is the guard for the day something asks
 *  for more, so a generous `k` can never turn the narrowing call into an error. */
export const MAX_VECTOR_MATCHES = 25

/**
 * What happened when this capture asked for a vector.
 *
 *   ok           the ranking arrived (possibly empty — an unindexed stamp is a
 *                200 with no matches, and that is an answer).
 *   timeout      the budget above ran out. The vector is DROPPED, not awaited:
 *                see `resolveFields.ts` for why there is no second attempt.
 *   unavailable  404 — this deployment has no embedding matcher. Latched for
 *                the session, so it is also what every later capture reports.
 *   error        anything else: a 500, a 400, a dead connection, a body that
 *                would not parse.
 */
export type EmbedOutcome = 'ok' | 'timeout' | 'unavailable' | 'error'

export interface EmbedEvidence {
  /** Ready for the resolve body. Empty on every outcome but `ok`, and possibly
   *  empty on that one too. */
  vectorMatches: ScanVectorMatch[]
  outcome: EmbedOutcome
  /** How long the call took, rounded. Null when no call was made — which is a
   *  different fact from "it took no time" and is recorded as one. */
  ms: number | null
}

/** The evidence of a capture that never asked, because an earlier one already
 *  found out there is no such endpoint on this backend. */
export const EMBED_NOT_ASKED: EmbedEvidence = { vectorMatches: [], outcome: 'unavailable', ms: null }

/**
 * SHOULD THE SESSION STOP ASKING? — the latch rule, named so it can be tested
 * rather than living as a comparison inside a route component.
 *
 * Only `unavailable`. A 404 is a fact about the DEPLOYMENT: this backend does
 * not have `/scan/embed`, it will not grow one between two captures, and asking
 * again would upload a crop per card to learn the same thing. That is the rule
 * `/scan/resolve`'s own 404 has always followed.
 *
 * A timeout or an error is a fact about ONE REQUEST — a cold function instance,
 * a phone moving between wifi and cell, a model file missing on a deployment
 * somebody is mid-way through fixing. Latching on those would switch the rung
 * off for the rest of a session over a single slow moment, which is the failure
 * mode a latch is supposed to prevent, not cause.
 */
export function latchesUnavailable(outcome: EmbedOutcome): boolean {
  return outcome === 'unavailable'
}

/**
 * The endpoint's ranking, reduced to the two fields `/scan/resolve` accepts.
 *
 * FILTERS RATHER THAN REPAIRS, and the endpoint's own validator is why: it
 * refuses a `similarity` outside -1..1 with a 400 because "a value outside it
 * did not come from POST /scan/embed". A response carrying one is a response
 * this client does not understand, and forwarding it would turn the narrowing
 * call — the thing that still had a job to do — into an error. Dropping the
 * entry loses one candidate; forwarding it loses the answer.
 */
export function toVectorMatches(res: ScanEmbedResponse | null | undefined): ScanVectorMatch[] {
  const out: ScanVectorMatch[] = []
  for (const m of res?.matches ?? []) {
    if (out.length >= MAX_VECTOR_MATCHES) break
    if (typeof m?.cardId !== 'string' || m.cardId === '') continue
    const s = m.similarity
    if (typeof s !== 'number' || !Number.isFinite(s) || s < -1 || s > 1) continue
    out.push({ cardId: m.cardId, similarity: s })
  }
  return out
}

/**
 * Which of the four a thrown failure was.
 *
 * READS THE STATUS STRUCTURALLY instead of importing `ApiError`, so this module
 * keeps the property its header claims — no value import from `lib/api`, and
 * therefore testable under node. `instanceof` would buy nothing here anyway: the
 * one fact wanted is a number, and an `ApiError` is the only thing in this app
 * that carries a `status`.
 *
 * A timeout arrives by either of two routes at once — `withTimeout`'s own timer
 * and the abort signal, which `deadlineSignal` aborts WITH a `TimeoutError` — so
 * whichever wins the race says the same thing. `AbortError` is accepted too, for
 * the runtimes that substitute their own reason.
 */
export function classifyEmbedFailure(e: unknown): EmbedOutcome {
  if (e instanceof TimeoutError) return 'timeout'
  const name = (e as { name?: unknown } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  const status = (e as { status?: unknown } | null)?.status
  if (status === 404) return 'unavailable'
  return 'error'
}

/**
 * Run one embed call under the budget and never throw.
 *
 * Takes a thunk rather than a blob so the whole of this — the budget, the
 * clock, the four outcomes — is drivable from a test with a fake call, which is
 * what `__tests__/vectorEvidence.test.ts` does. `ocrNarrow.embedCapture` is the
 * ten-line adapter that turns a capture into that thunk.
 *
 * The underlying request is NOT cancelled from here; the caller supplies a
 * signal that does it (`deadlineSignal`), and this guarantees the AWAIT ends
 * regardless of whether the socket does — the same division `withTimeout`'s own
 * header draws.
 */
export async function embedEvidence(
  run: () => Promise<ScanEmbedResponse>,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<EmbedEvidence> {
  const timeoutMs = opts.timeoutMs ?? EMBED_TIMEOUT_MS
  const now = opts.now ?? Date.now
  const started = now()
  const elapsed = () => Math.round(now() - started)
  try {
    const res = await withTimeout(run(), timeoutMs, 'embed')
    return { vectorMatches: toVectorMatches(res), outcome: 'ok', ms: elapsed() }
  } catch (e) {
    // Every failure is the same failure to the capture: no vector for this card.
    // The four are told apart only so the telemetry can say WHICH, because
    // "the endpoint is not deployed" and "the phone's connection died" produce
    // the same empty answer and must not produce the same row in the record.
    return { vectorMatches: [], outcome: classifyEmbedFailure(e), ms: elapsed() }
  }
}
