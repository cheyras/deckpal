// THE IDENTITY RACE — what the thumbnail on the side is waiting for.
//
// ── THE RULING THIS FILE IS ─────────────────────────────────────────────────
//
// PLAN.md "Addendum — 2026-09-05 owner rulings", verbatim: "scan thumbnail
// stays on the side until the card is resolved confidently by whatever means.
// Then it moves down to the list and variant resolve happens there."
//
// Before that, `Scan.tsx` flew every capture into the list the moment `/scan`
// answered, WHATEVER it answered — the thumbnail left the camera while the
// answer was still unknown, so the reader watched cards fly away and only found
// out downstairs which ones had been identified. The ruling's fix is the WAIT:
// a capture stays on the camera until something has settled its identity, and
// nothing flies while it is pending. That half is unchanged and this file is it.
//
// ── AND THE PART THAT WAS REVERSED, 2026-09-06 ──────────────────────────────
//
// The same addendum went on to park the FAILURES on the camera too — "thumbnail
// flips to a needs-you state in the stack, tappable to pick/retake". The owner
// used it and ruled against it, verbatim: "I do not like the change where ones
// that need my input stay in the side. If the resolution is 'needs your input'
// they should still go down to the list."
//
// So `needs-you` is a settlement like any other now, not a parking space. The
// thumbnail waits for it exactly as it waits for `confident`, shows its own
// brief marker exactly as `confident` shows its tick, and takes the SAME flight
// down — landing as a marked "needs your input" row with the capture, the OCR
// hint and the candidates on it, where the same picker opens in place.
//
// What that costs this file: nothing in the machine, which is the point. The
// five outcomes below are unchanged and so is every transition between them.
// What it removed is one field — `engaged` — which existed only because the
// reader could tap a thumbnail while its race was still running. They cannot;
// the stack is untappable again, and the row's own picker opens long after the
// reducer has finished with the capture. See `feed.ts` for the rules that took
// over at the moment the thumbnail lands.
//
// ── AND WHAT NEEDS-YOU NOW MEANS, 2026-09-07 ───────────────────────────────
//
// The 2026-09-06 reversal said where a needs-you capture GOES. This one says
// when it is allowed to be one at all, and it is the ruling that reshaped the
// machine below.
//
// Round 10b put the image rung on the wire and measured the consequence
// (`p2-work/e2e-drive/E2E-REPORT.md` §3.3): six of thirty-one captures crossed
// the old 6 s `IDENTITY_DEADLINE_MS` while their embed was still in flight, so
// six thumbnails flipped to needs-you, flew down as amber "needs your input"
// rows, and then upgraded themselves when the answer they were still waiting for
// arrived. The owner ruled on it, verbatim:
//
//   "it should NOT [land] as needs you and then upgrade itself. If it isn't
//    totally resolved, it stays in the side. That's the point of the side."
//
// NEEDS-YOU MEANS THE SYSTEM IS FINISHED TRYING. Not "the clock ran out", not
// "we are fairly sure by now" — finished. A capture stays `pending` on the
// camera while ANY signal it actually started is still out: the phash round
// trip, the OCR read, the embed call, the resolve round trip, cold starts
// included. It leaves the stack exactly once, in a final state:
//
//   confident   something named it →  identified row.
//   needs-you   everything that was started has reported and none of them named
//               it →  needs-input row.
//
// Three consequences, and all three are structural below rather than promised:
//
//  1. THE DEADLINE IS GONE. Settlement is a property of the SIGNALS, not of a
//     clock — `settleOrWait` was already computing it and the deadline was
//     overriding it. In the ordinary failure the pair completes inside 2-3 s, so
//     the common case got FASTER, not slower.
//  2. `needs-you` IS TERMINAL, exactly as `confident` and `discarded` are. A
//     late answer landing on a settled capture is dropped, not honoured, and
//     that is the only way "never upgrades itself" can be a guarantee rather
//     than a race the timing usually wins.
//  3. THE FUSE IS THE ONLY CLOCK LEFT. `IDENTITY_BACKSTOP_MS` (deadline.ts,
//     12 s = the embed's 8 s budget + a 4 s resolve tail) treats whatever is
//     still out as failed and settles the capture FINALLY, so a hung request
//     cannot park a thumbnail forever. It is a fuse, not a verdict: reaching it
//     is a fault, and `backstopped` on the record says so.
//
// ── WHY A REDUCER AND NOT FOUR `useState`s IN THE ROUTE ─────────────────────
//
// Two independent async answers race for one thumbnail, a fuse races both, and
// the reader can pre-empt all three. That is five inputs to one decision, and
// the interesting cases are the ORDERINGS — an answer landing after the fuse has
// already settled the capture, a reader picking a card from a row whose resolve
// is somehow still out. Those are the cases a route component cannot be driven
// through in a test and this can: every transition below is one function call,
// so `__tests__/identity.test.ts` replays the orderings directly against the
// shipping reducer.
//
// It is also why the 2026-09-07 ruling could be honoured by DELETING a branch
// rather than by adding one. "Do not land as needs-you and then upgrade" is a
// statement about orderings, the orderings live here, and the fix is one early
// return — not a flag threaded through a 1,600-line component.
//
// ── WHAT "CONFIDENT" MEANS, AND WHERE THAT IS DECIDED ───────────────────────
//
// Not here. Both halves are owned elsewhere and this file only asks them:
//
//   phash    `tieGate.gateScanResponse` — a top hit must be TIE_MARGIN clear of
//            the best DIFFERENT card. Round 3 committed three captures of one
//            orange Fighting Energy as three other cards behind 88 % bars; that
//            file is why.
//   printed  `ocrNarrow.resolvedIdentity` — the endpoint's own `confident` flag
//            over CROSSWALK §7.3's ladder. Extended out of `narrowedIdentity`
//            rather than re-expressed here, so the two callers cannot drift.
//
// FIRST CONFIDENT WINS. In practice phash almost always answers first (the
// resolve call cannot even start until phash has produced the priors it
// re-ranks — see ocrNarrow.ts), but the reducer is deliberately order-blind:
// nothing below reads "which one came first" from anything but which one got
// here first.
//
// ── ONE VALUE IMPORT, ON PURPOSE ────────────────────────────────────────────
//
// `tieGate`, and nothing else. Everything else this file touches is a TYPE, so
// the reducer's runtime graph is itself plus one pure module — which is what
// lets `__tests__/identity.test.ts` drive the shipping code under plain node
// instead of a browser. `ocrNarrow.ts` is the module this policy grew out of and
// it is deliberately NOT imported here: it holds the fetch calls, and pulling an
// API client (and, behind it, a Supabase client) into a pure reducer to borrow
// one three-line judgement is the wrong way round. The judgement moved here
// instead, and that file calls it.
import type { ScanCandidate, ScanMatch, ScanResolveMatch, ScanResponse, ScanResolveResponse } from '../../lib/api'
import type { OcrRead } from '../ocr/pipeline'
import { gateScanResponse } from './tieGate'
import type { EmbedEvidence } from './vectorEvidence'

/**
 * Where one capture's thumbnail is.
 *
 *   pending    on the camera, spinner, AT LEAST ONE STARTED SIGNAL STILL OUT.
 *              NOTHING FLIES from here — the wait is the 2026-09-05 ruling's
 *              whole point, and since 2026-09-07 it is the whole of the wait:
 *              this is the only phase a capture can be in while the system is
 *              still trying, and the only one it can leave.
 *   confident  named. A brief tick, then the courier flies it to the list.
 *   needs-you  EVERY started signal reported and none of them named it. A brief
 *              amber marker — the tick's mirror — then the SAME courier, to the
 *              same list, as a "needs your input" row (2026-09-06: "they should
 *              still go down to the list").
 *   discarded  the reader took the retake. It leaves without a row.
 *
 * ALL THREE SETTLED PHASES ARE TERMINAL. `pending` is the only one with an exit,
 * and a capture takes it once. That is the 2026-09-07 ruling as a type: there is
 * no state in this enum that means "provisionally needs you".
 */
export type IdentityPhase = 'pending' | 'confident' | 'needs-you' | 'discarded'

/** Which signal named the card. Surfaced because a row identified from the
 *  PRINTED number has no phash distance and must not pretend to (below). */
export type IdentitySource = 'phash' | 'printing' | 'reader'

/**
 * A settled identity, whichever signal produced it.
 *
 * Deliberately NOT `ScanMatch`. `ScanResolveMatch` already makes this
 * distinction on the wire and states the reason: "a card the ladder resolved by
 * its printed key was never nominated by phash and has no distance. Null means
 * 'no phash opinion', which is not 'distance 64'." Flattening the two here would
 * put that lie back one layer down.
 */
export interface Identity {
  cardId: string
  name: string
  setName: string
  /** The catalog set id (`sv10`, `sv03.5`, `swsh12`). Carried since 2026-09-07
   *  for the verify list's catalog sort order — `sort.ts` reads a series out of
   *  the id's `<series><n>` shape, which is the only series signal a row has
   *  without a round trip per row. Both wire shapes already have it. */
  setId: string
  number: string
  rarity: string | null
  images: { low: string; high: string }
  distance: number | null
  confidence: number | null
}

export interface IdentityState {
  phase: IdentityPhase
  /** The card, once something has named it. Null in every other phase. */
  match: Identity | null
  by: IdentitySource | null
  /**
   * What the picker offers once this capture is a needs-input ROW. Carried down
   * by the flight as the row's `alternates`.
   *
   * ── BOTH SIGNALS NOW, IN TWO GROUPS. 2026-09-07 ───────────────────────────
   *
   * This used to be the TIE-GATED PHASH RANKING and nothing else, on the rule
   * `ocrNarrow.ts` still states: the resolve endpoint's matches carry
   * `distance: null` for cards phash never nominated, and a list ranked by
   * distance must not hold entries that have none.
   *
   * The rule was right and the conclusion was wrong, and the owner found out
   * with a screenshot: a toploadered Ultra Ball landed needs-input, the chip
   * read `read "Ultra Ball"`, and the five candidates beneath it were the hash's
   * near-random list — Binding Mochi at 81 %. "As silly as it gets." Withholding
   * the ladder's candidates did not protect the ranking; it threw away the only
   * evidence on the screen that knew what the card was called.
   *
   * So the list holds both, ordered and LABELLED rather than interleaved:
   *
   *   1. the ladder's candidates, in the order the endpoint returned them,
   *      marked `from: 'read'`;
   *   2. then the tie-gated phash ranking, minus anything already above.
   *
   * Neither ranking is polluted: the popover draws them as two groups, and a
   * card with no distance is never given a percentage it did not earn.
   * `mergeCandidates` is where the order is decided and `readCandidates` is
   * where the policy about which responses may contribute lives.
   */
  candidates: ScanCandidate[]
  /** What OCR read off the card. Null until the read lands, and often after. */
  read: OcrRead | null
  /**
   * THE IN-FLIGHT LEDGER — the two bits the 2026-09-07 ruling turns on.
   *
   * Each async answer reports in exactly once, confident or not, and the PAIR
   * being complete is now the entire definition of "the system is finished
   * trying". Nothing else settles a capture; there is no clock left that can.
   *
   *   phashSettled    the identify round trip answered or failed.
   *   resolveSettled  the WHOLE second-answer leg is done — the OCR read, the
   *                   embed call, and the `/scan/resolve` round trip behind
   *                   them. One bit for three legs, and that is deliberate: it
   *                   is the trap this design has to avoid.
   *
   * WHY ONE BIT AND NOT THREE. A settlement tracker must only count requests
   * that were ACTUALLY STARTED, or a capture waits out the backstop for a call
   * nobody made. OCR off for the session, a read that produced nothing, a
   * backend with no `/scan/embed`, a backend with no `/scan/resolve`, an embed
   * latched unavailable after one 404 — on every one of those paths a leg is
   * skipped entirely, and a per-leg flag would sit false forever. So the caller
   * owns "was it started?" (it is the only thing that knows) and reports the
   * whole leg's completion as ONE event it promises to send on every path,
   * including the paths where nothing was sent. See the `resolve` event below,
   * whose exactly-once contract is now load-bearing rather than merely tidy: it
   * is what makes flag-off captures settle in milliseconds instead of at 12 s.
   */
  phashSettled: boolean
  resolveSettled: boolean
  /**
   * THE FUSE BLEW — this capture was settled by `IDENTITY_BACKSTOP_MS` with a
   * signal still out, rather than by its own signals reporting.
   *
   * For the RECORD, never for the decision, like the two verdict fields below.
   * A `needs-you` row means "the system finished trying", and this is the column
   * that says whether it finished or was cut off — which is the one distinction
   * round 10b's telemetry could not draw and the reason six captures' embed
   * outcomes went unrecorded (§2, unknown 49).
   */
  backstopped: boolean
  /**
   * AN ANSWER ARRIVED AFTER SETTLEMENT AND WAS THROWN AWAY.
   *
   * A `phash` or `resolve` event reaching a capture that has already settled.
   * Under the rules above this should be UNREACHABLE except behind the
   * backstop — settlement waits for every started signal, so there is nothing
   * left to arrive late unless the fuse cut it off — and this field is how that
   * claim gets checked on real hardware instead of asserted here.
   *
   * A late `read` does not set it. The read is a hint and cannot name a card;
   * this counts answers.
   */
  lateAnswerDropped: boolean
  /**
   * WHICH RUNG OF THE LADDER ANSWERED, kept for the RECORD and never for the
   * decision — that is `resolvedIdentity`'s, taken the moment the event lands.
   *
   * Two scalars rather than the whole `ScanResolveResponse`, because the rest of
   * that response is five matches with names and image URLs and this exists so a
   * capture's telemetry can say `number+denominator` instead of leaving the next
   * session to guess. Null until the resolve event arrives, and still null when
   * it arrives empty (no OCR, nothing read, no such endpoint).
   */
  resolveVerdict: { resolvedBy: ScanResolveResponse['resolvedBy']; confident: boolean } | null
  /**
   * WHAT THE IMAGE RUNG COST AND WHETHER IT ANSWERED — for the RECORD, like
   * `resolveVerdict`, and read by nothing that decides anything.
   *
   * It rides the `resolve` event rather than arriving as one of its own, because
   * that event is already the one the caller promises to send exactly once per
   * capture on EVERY path — including the paths where no call was made. A vector
   * that timed out on a capture whose OCR was also silent produces no resolve
   * request at all, and this is still the place its four seconds get written
   * down.
   *
   * Null until that event lands. `outcome: 'unavailable'` with `ms: null` is the
   * capture that never asked, because an earlier one in the session already
   * found out this backend has no `/scan/embed`.
   */
  embed: { outcome: EmbedEvidence['outcome']; ms: number | null } | null
}
// NO `engaged` FIELD, AND THAT IS THE 2026-09-06 REVERSAL SHOWING THROUGH.
//
// It used to be here: the reader tapped a needs-you thumbnail, the picker opened
// ON THE CAMERA while the resolve was still in flight, and a late confident
// answer had to be stopped from swapping the card out from under their finger.
//
// The stack is untappable now. A capture's race is over — settled or timed out —
// before its thumbnail leaves, and the picker the reader opens is on a LIST ROW,
// which this reducer has already finished with. The protection did not go away
// with the field; it moved to where the reader now is, as `Scan.tsx`'s
// picker-open guard in front of the narrowing patch. Same rule, same reason
// (`narrowedIdentity`'s: a field read off a 26x12 px badge does not overrule a
// human), one screen further down.

export type IdentityEvent =
  /** The identify round trip answered — or failed, which is `res: null`. */
  | { type: 'phash'; res: ScanResponse | null }
  /** The on-device OCR read landed. Never settles anything by itself: it is a
   *  hint, and the claim it might support is the `resolve` event below. */
  | { type: 'read'; read: OcrRead | null }
  /**
   * The narrowing endpoint answered.
   *
   * THE CALLER MUST SEND THIS EXACTLY ONCE PER CAPTURE, including when there
   * was never going to be a call — OCR off for the session, nothing read, a 404
   * from a backend without the endpoint. `resolved: null` is how those say "no
   * answer is coming", and without it the pair above never completes and the
   * thumbnail waits for the deadline instead of flipping the moment it can.
   *
   * `embed` is what the image rung did for this capture, carried on the same
   * event for the same reason — it is telemetry, it must be recorded on the
   * paths where no request went out, and this is the one event guaranteed to
   * reach the machine on all of them. Optional, so the fifty-odd existing tests
   * that drive this reducer keep meaning what they meant.
   *
   * SINCE 2026-09-07 THE EXACTLY-ONCE PROMISE IS THE PRODUCT, not a nicety.
   * This event is the machine's only word on whether the second-answer leg —
   * read, embed and round trip together — is still out, and a thumbnail now
   * waits for it with no clock to rescue it but the 12 s fuse. A caller that
   * forgets it on one path parks a capture on the camera for twelve seconds.
   */
  | { type: 'resolve'; resolved: ScanResolveResponse | null; embed?: EmbedEvidence }
  /**
   * `IDENTITY_BACKSTOP_MS` elapsed with a signal still in flight — THE FUSE.
   *
   * The successor to `deadline`, and not a rename: that event flipped a capture
   * to needs-you at 6 s and let a later answer promote it back out again, which
   * is the behaviour the 2026-09-07 ruling removed. This one is FINAL. Whatever
   * has not reported is treated as failed, both settlement bits are forced, and
   * the capture leaves as a needs-input row that nothing can change afterwards.
   *
   * Reaching it is a FAULT, not a flow: it means a request outlived the sum of
   * its own budgets. `backstopped` on the record is how often that happens.
   */
  | { type: 'backstop' }
  /**
   * The reader chose from the candidates.
   *
   * DISPATCHED FROM THE LIST NOW, not from the stack — the row's picker, on a
   * capture whose thumbnail flew down minutes ago. `Scan.tsx` reduces the state
   * the row carried with it so the reader's answer is still attributed to the
   * capture that asked the question; see `identityRecord` below, which is the
   * only reason this event still exists.
   *
   * A `ScanCandidate` and not a `ScanMatch`, because the picker now offers both
   * kinds and the reader is allowed to choose a card phash never nominated —
   * which is the entire point of putting the ladder's candidates in front of
   * them. `Identity.distance` has always been nullable, so nothing downstream
   * has to learn anything new.
   */
  | { type: 'pick'; match: ScanCandidate }
  /** The reader discarded the capture. Same picker, same list row, and the row
   *  goes with it. */
  | { type: 'retake' }

/**
 * THE PRINTED-NUMBER HALF OF THE CONFIDENCE POLICY.
 *
 * Was the first two lines of `ocrNarrow.narrowedIdentity` until this file gave
 * it a second caller (the reducer below, judging a capture that has no feed row
 * yet). One definition, two callers: `narrowedIdentity` calls this too, so the
 * question "may the ladder's answer be presented as the card?" cannot be
 * answered one way for a stack thumbnail and another for a list row.
 *
 * `confident` AND `matched`, both. The endpoint sets `confident` per CROSSWALK
 * §7.3's rungs and `matched` is its own claim that there is anything to be
 * confident about; a response asserting one without the other is not one this
 * side gets to interpret.
 */
export function resolvedIdentity(resolved: ScanResolveResponse | null): ScanResolveMatch | null {
  if (!resolved?.confident || !resolved.matched) return null
  return resolved.matches[0] ?? null
}

/**
 * WHICH OF THE LADDER'S MATCHES THE PICKER MAY OFFER — the 2026-09-07 half of
 * the fix, and the only place that policy is written down.
 *
 * Two exclusions, both of which would otherwise be a lie about provenance:
 *
 *  * A CONFIDENT response. The ladder named the card, `resolvedIdentity` has
 *    already taken it, and the capture is going to the list identified. There is
 *    no picker to fill.
 *  * `prior-only`. That rung's matches ARE the phash priors — the same cards,
 *    possibly filtered to a set or a number — so offering them as a separate
 *    group headed by what OCR read would show the reader the same list twice and
 *    credit the read with a list it did not produce.
 *
 * Everything else contributes: `name-family` and `family-text` (a family is not
 * a card, and its printings are exactly what a person is being asked to choose
 * between), the multi-candidate `number+denominator` and `name+number` cases
 * (`014/198` is Steenee or Floragato and the print genuinely cannot say), and
 * the unconfident `vector`. All of them narrowed the world with something other
 * than a Hamming distance, which is what earns the top of the list.
 */
export function readCandidates(resolved: ScanResolveResponse | null): ScanCandidate[] {
  if (!resolved || resolved.confident) return []
  if (resolved.resolvedBy === 'prior-only') return []
  return resolved.matches.map((m) => ({ ...m, from: 'read' as const }))
}

/**
 * The two groups into one list: what the read found, then what the hash found
 * and the read did not.
 *
 * Deduped on `cardId` with the READ's entry winning, which is not arbitrary —
 * the ladder's copy of a card the hash also nominated carries the hash's
 * distance anyway (the endpoint ranks its own matches by the priors it was
 * sent), so nothing is lost and the agreement shows up where the reader is
 * looking first.
 *
 * Pure, exported and order-independent so the reducer can rebuild it from
 * whichever event lands second — the phash answer and the resolve answer race,
 * and a merge that only worked in one order would be a bug the timing usually
 * hides.
 */
export function mergeCandidates(read: readonly ScanCandidate[], phash: readonly ScanCandidate[]): ScanCandidate[] {
  const seen = new Set(read.map((m) => m.cardId))
  return [...read, ...phash.filter((m) => !seen.has(m.cardId))]
}

export function initialIdentity(): IdentityState {
  return {
    phase: 'pending',
    match: null,
    by: null,
    candidates: [],
    read: null,
    phashSettled: false,
    resolveSettled: false,
    backstopped: false,
    lateAnswerDropped: false,
    resolveVerdict: null,
    embed: null,
  }
}

// Two adapters with the same body and deliberately not one generic: their
// INPUTS differ in the only way that matters here. `ScanMatch.distance` is a
// number and `ScanResolveMatch.distance` is `number | null`, so widening both
// through one signature would erase the distinction at the exact point the
// product needs it — a row built from the second must not draw a match meter.
export function identityFromMatch(m: ScanMatch): Identity {
  return {
    cardId: m.cardId,
    name: m.name,
    setName: m.setName,
    setId: m.setId,
    number: m.number,
    rarity: m.rarity,
    images: m.images,
    distance: m.distance,
    confidence: m.confidence,
  }
}

/**
 * A candidate the reader picked, in the shape the FEED ROW takes.
 *
 * `-1` and `0` are the row's own encoding of "no phash opinion" — `Scan.tsx`
 * already writes exactly those when the printed-number ladder names a card, and
 * `FeedEntryCard` reads the -1 and draws provenance instead of a meter. So this
 * is a translation into an existing convention rather than an invented distance:
 * the nullable pair belongs to the WIRE, where "null" and "distance 64" have to
 * stay different facts, and the row has always spoken the other dialect.
 */
export function toPickedMatch(c: ScanCandidate): ScanMatch {
  return {
    cardId: c.cardId,
    name: c.name,
    number: c.number,
    setId: c.setId,
    setName: c.setName,
    rarity: c.rarity,
    images: c.images,
    distance: c.distance ?? -1,
    confidence: c.confidence ?? 0,
  }
}

export function identityFromResolve(m: ScanResolveMatch): Identity {
  return {
    cardId: m.cardId,
    name: m.name,
    setName: m.setName,
    setId: m.setId,
    number: m.number,
    rarity: m.rarity,
    images: m.images,
    distance: m.distance,
    confidence: m.confidence,
  }
}

/**
 * THE WHOLE SETTLEMENT RULE, since 2026-09-07: every started signal has
 * reported and none of them named the card — that IS needs-you, and it is the
 * only thing that produces one short of the fuse.
 *
 * It used to be the fast path and the deadline was the fallback. It is now the
 * ONLY path, which is what "if it isn't totally resolved, it stays in the side"
 * means once written down: while either bit is false the system is still trying,
 * and a capture that is still being tried is `pending` — spinner, on the camera,
 * no row, no amber marker, nothing for the reader to react to and then watch
 * change its mind.
 *
 * In the ordinary failure — a card back, a blurred crop, a caption of a card in
 * a magazine — both answers are in at 2-3 s and say no, and the capture leaves
 * then. That is EARLIER than the 6 s deadline it replaced, which is worth
 * stating plainly: honouring the ruling made the common case faster and only the
 * slow tail slower.
 */
function settleOrWait(s: IdentityState): IdentityState {
  if (!s.phashSettled || !s.resolveSettled) return s
  return { ...s, phase: 'needs-you' }
}

/**
 * The whole machine. Pure and total — every event is legal in every phase, and
 * the ones that no longer mean anything return the state unchanged (identity,
 * so a caller can skip the re-render on `next === prev`).
 */
export function reduceIdentity(s: IdentityState, e: IdentityEvent): IdentityState {
  // TERMINAL. A confident thumbnail is already flying to the list and the list
  // owns it from there — including the narrowing's own late correction, which
  // goes through `narrowedIdentity` against the ROW, where it can see whether a
  // human has since touched it. A discarded one is gone.
  if (s.phase === 'confident' || s.phase === 'discarded') return s

  // AND SO IS NEEDS-YOU, SINCE 2026-09-07 — this is the ruling, structurally.
  //
  // "It should NOT [land] as needs you and then upgrade itself." The old machine
  // honoured a late confident answer here, because the old machine could reach
  // needs-you while an answer was still in flight and would otherwise have
  // thrown away a card it had. It cannot: settlement now waits for every started
  // signal, so anything arriving after this point either lost a race it had
  // already been given (impossible — the pair is complete) or was cut off by the
  // fuse. Either way the row has flown and the reader has been told the scanner
  // gave up, and taking that back is the behaviour the owner ruled against.
  //
  // Making it an EARLY RETURN rather than a condition inside each case is the
  // point: there is no branch left in this function that can promote a settled
  // capture, so the guarantee holds for events that do not exist yet.
  if (s.phase === 'needs-you') {
    // The reader's two, and only theirs. They arrive from the ROW's picker
    // minutes later — `Scan.tsx`'s `recordRowOutcome` reduces the state the row
    // carried down — so they are not late answers from the race; they are a
    // human overruling it, which is the one thing allowed to.
    if (e.type === 'pick') return { ...s, phase: 'confident', match: identityFromResolve(e.match), by: 'reader' }
    if (e.type === 'retake') return { ...s, phase: 'discarded' }
    // A late `read` is dropped SILENTLY: it is a hint, it could never have named
    // the card, and counting it would blunt the alarm below. A `backstop` on a
    // settled capture is not late either — it is a fuse whose timer outlived the
    // race it was insuring, which is the ordinary way a fuse ends.
    if (e.type === 'read' || e.type === 'backstop' || s.lateAnswerDropped) return s
    // What is left is a `phash` or a `resolve`: an ANSWER, arriving too late to
    // be used. Dropped, and written down once — see `lateAnswerDropped`, which
    // is the alarm on the claim that this path is unreachable short of the fuse.
    return { ...s, lateAnswerDropped: true }
  }

  switch (e.type) {
    case 'phash': {
      const gated = gateScanResponse(e.res)
      // The evidence survives the gate even when the claim does not — the
      // ranked list IS the picker, so a demoted result still fills it.
      //
      // MERGED, NOT ASSIGNED. The resolve answer may already be in (the events
      // race, and the reducer is order-blind by design), and overwriting the
      // list would drop the ladder's candidates whenever phash happened to
      // answer second. The read group is recovered from the list itself, which
      // is what `from` is on it for.
      const next: IdentityState = {
        ...s,
        candidates: mergeCandidates(
          s.candidates.filter((m) => m.from === 'read'),
          gated?.matches ?? s.candidates.filter((m) => m.from !== 'read'),
        ),
        phashSettled: true,
      }
      const top = gated?.matched ? gated.matches[0] : undefined
      if (top) return { ...next, phase: 'confident', match: identityFromMatch(top), by: 'phash' }
      return settleOrWait(next)
    }

    case 'read':
      return { ...s, read: e.read }

    case 'resolve': {
      const next: IdentityState = {
        ...s,
        // The ladder's own candidates go to the TOP of the picker, ahead of
        // whatever the hash had. `readCandidates` decides which responses are
        // entitled to contribute; this only decides where they sit.
        candidates: mergeCandidates(
          readCandidates(e.resolved),
          s.candidates.filter((m) => m.from !== 'read'),
        ),
        resolveSettled: true,
        resolveVerdict: e.resolved
          ? { resolvedBy: e.resolved.resolvedBy, confident: e.resolved.confident }
          : s.resolveVerdict,
        embed: e.embed ? { outcome: e.embed.outcome, ms: e.embed.ms } : s.embed,
      }
      const top = resolvedIdentity(e.resolved)
      if (top) return { ...next, phase: 'confident', match: identityFromResolve(top), by: 'printing' }
      return settleOrWait(next)
    }

    // THE FUSE. Only `pending` can reach here (every settled phase returned
    // above), so this is unconditional: force both settlement bits, because
    // "whatever is unsettled is treated as failed" has to be written into the
    // STATE and not merely into the phase — `identityRecord` reads those bits,
    // and a record claiming a leg is still in flight on a capture that has left
    // the camera would be the same lie the deadline used to tell.
    case 'backstop':
      return { ...s, phase: 'needs-you', phashSettled: true, resolveSettled: true, backstopped: true }

    case 'pick':
      return { ...s, phase: 'confident', match: identityFromResolve(e.match), by: 'reader' }

    case 'retake':
      return { ...s, phase: 'discarded' }
  }
}

/**
 * The hint chip on a needs-input ROW's picker: what OCR actually read off this
 * card. (It was the stack picker's chip until 2026-09-06 moved the picker into
 * the list; the chip is the same chip, drawn one screen down.)
 *
 * Written as a quotation, not a conclusion — the reader is being asked to
 * identify a card the scanner could not, and "read 161/182" is the single most
 * useful thing to hand them for that, because it is printed on the card in front
 * of them and they can check it in a second.
 *
 * THE NAME IS LAST AND ONLY ON ITS OWN. `ocr/fields.ts`'s header is explicit
 * that the name is the one field allowed to be approximate — 76 % exact, mean
 * CER 0.16 — where number, denominator and badge are claims. So the printed key
 * is offered first whenever there is one, and the name only when there is
 * nothing else, quoted so it reads as "this is what the letters looked like"
 * rather than as an identification.
 */
export function ocrHintLabel(read: OcrRead | null): string | null {
  if (!read) return null
  const key: string[] = []
  if (read.setCode) key.push(read.setCode)
  if (read.number && read.denominator) key.push(`${read.number}/${read.denominator}`)
  else if (read.number) key.push(read.number)
  if (key.length) return `read ${key.join(' ')}`
  if (read.name) return `read “${read.name}”`
  return null
}

// ── WHAT THE RECORD SAYS ABOUT HOW THIS CAPTURE WAS NAMED ──────────────────
//
// Round 7 closed with 26 captures whose identity outcome was simply UNKNOWN:
// the capture-event carries what the matcher said (`Scan.tsx`'s
// `matcherOutcomeFor`, added for exactly this reason after the 2026-09-04
// session could only score the 21 captures the owner happened to press *report*
// on), and then the trail stops. Whether the row was named by phash, corrected
// by the printed key, left for the reader, picked by hand or thrown away was not
// written down anywhere, so the one question the OCR lane exists to answer —
// does it name cards phash could not? — was unanswerable on device.
//
// This is the missing half, and it is deliberately PURE and HERE rather than in
// the route: it is a statement about the reducer's own state, the reducer is
// where that state is defined, and a mapping in a 1,400-line component is a
// mapping nothing can test. `Scan.tsx` posts it; this decides what it says.

/**
 * The five ways a capture's identity settles.
 *
 *   confident-phash    the matcher named it and the tie gate let the claim
 *                      stand.
 *   confident-resolve  the printed key named it — the OCR lane's whole purpose,
 *                      and the number this telemetry exists to produce.
 *   needs-you          every started signal reported and none named it. Since
 *                      2026-09-07 that is the whole of it — "or the deadline ran
 *                      out first" used to be part of this line and is not any
 *                      more, which is the ruling in one clause. The fuse can
 *                      still produce one, and `backstopped` on the record says
 *                      when it did. It goes to the list as a needs-input row.
 *   picked             the reader chose from the candidates.
 *   retaken            the reader discarded the capture.
 *
 * UNCHANGED BY THE 2026-09-06 REVERSAL, deliberately. The five are outcomes of
 * the IDENTIFICATION, and where a needs-you thumbnail comes to rest is not one:
 * the ruling moved the question from the camera to the list without changing
 * what was asked or who answered it. Adding a `rowLocation` to say "list"
 * would be a column with one value, and the sessions either side of the change
 * are separated by `pipelineVersion` already (`flags.ts`).
 *
 * `picked` and `retaken` are still produced — from the ROW's picker now rather
 * than the thumbnail's, by reducing the identity state the row carried down with
 * it. That is the whole reason a landed needs-input row keeps one.
 */
export type IdentityOutcome = 'confident-phash' | 'confident-resolve' | 'needs-you' | 'picked' | 'retaken'

/**
 * Which of the five this state is, or null while it is still `pending` — a
 * capture nothing has decided yet is not an outcome and must not be recorded as
 * one.
 */
export function identityOutcome(s: IdentityState): IdentityOutcome | null {
  if (s.phase === 'discarded') return 'retaken'
  if (s.phase === 'needs-you') return 'needs-you'
  if (s.phase !== 'confident') return null
  // `by` is set on every transition into `confident`; the fallback is the
  // reader's, because a confident phase with no source recorded is a bug in the
  // reducer and 'picked' is the reading that does not overstate the machine.
  return s.by === 'phash' ? 'confident-phash' : s.by === 'printing' ? 'confident-resolve' : 'picked'
}

/**
 * The capture's identity record, in the shape `flags.recordIdentityEvent` posts.
 *
 * `Record<string, unknown>` and not a typed struct on purpose — this is the same
 * contract `matcherOutcomeFor` returns, meta merged into a JSON sidecar the fix
 * bench reads, and giving it a nominal type here would imply a schema the
 * endpoint does not enforce.
 *
 * `ocr` is the RUNG, straight off the read: `'roi'` for the shipped two-pass
 * recipe, `'escalated'` when the full-crop rung ran too, `'null'` when there was
 * no read at all (lane off for the session, model fetch failed, or the read
 * timed out). Written as the string `'null'` and not as JSON null because it is
 * one of three values of an enum, not a missing field.
 */
export function identityRecord(s: IdentityState, msToResolve: number): Record<string, unknown> | null {
  const outcome = identityOutcome(s)
  if (!outcome) return null
  return {
    identity: {
      identityOutcome: outcome,
      ocr: s.read ? s.read.pass : 'null',
      // How much the escalation actually produced, which is the question a
      // reviewer will have about every `'escalated'` row: did the re-extraction
      // rescue a key, or did it fall through to the prose?
      bodyLines: s.read?.bodyLines?.length ?? null,
      ocrMs: s.read ? Math.round(s.read.ms) : null,
      // THE IMAGE RUNG'S TWO COLUMNS, riding the record exactly as `ocrMs`
      // does. `resolvedBy` already reports `vector` and `corroborated` when the
      // ladder answers on them — it is a passthrough of whatever the endpoint
      // said — so what was missing was the other half: how long the vector took
      // and, when it did not contribute, WHY. Round 10 could not distinguish
      // "the deployment has no matcher" from "the phone gave up waiting" from
      // "we never asked", and all three produce the same absent `similarity`.
      //
      // Null on both when no resolve event has landed yet, which is the same
      // convention `resolvedBy` and `confident` already use here.
      embedMs: s.embed?.ms ?? null,
      embedOutcome: s.embed?.outcome ?? null,
      // THE TWO COLUMNS THE 2026-09-07 RULING ADDED, and they are the audit of
      // it rather than decoration. `needs-you` now asserts "the system finished
      // trying"; these say whether that is true of THIS capture.
      //
      //   backstopped        false on every honest settlement. True means the
      //                      12 s fuse cut a request off, which is a fault — and
      //                      the one round 10b could not see, because a capture
      //                      whose embed timed out recorded `embedOutcome: null`
      //                      and looked identical to one that settled cleanly
      //                      (§2, unknown 49).
      //   lateAnswerDropped  an answer arrived after settlement and was thrown
      //                      away. Should be false on every capture that was not
      //                      also backstopped; a row with this true and
      //                      `backstopped` false is the machine's claim about
      //                      itself failing, and worth finding out about.
      backstopped: s.backstopped,
      lateAnswerDropped: s.lateAnswerDropped,
      resolvedBy: s.resolveVerdict?.resolvedBy ?? null,
      confident: s.resolveVerdict?.confident ?? null,
      cardId: s.match?.cardId ?? null,
      msToResolve: Math.round(msToResolve),
    },
  }
}

// ── WHERE THE UNRESOLVED-COUNT AND THE COMMIT GATE WENT ─────────────────────
//
// `feed.ts`. They used to be here, counting `phase === 'needs-you'` across the
// STACK, because that is where an unnamed capture lived and Step 2 could not
// show it. Under the 2026-09-06 reversal an unnamed capture is a ROW, so
// "unresolved" is `cardId === null` on the list — a question about the list, in
// the list's own module, asked of the same field `commit.ts` skips on.
//
// Leaving them here counting stack phases would have kept the reminder pointed
// at a stack that empties itself: every gate would have passed, and the rows the
// reader still owed an answer to would have gone in with the batch unremarked.
