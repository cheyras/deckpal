// THE IDENTITY RACE — what the thumbnail on the side is waiting for.
//
// ── THE RULING THIS FILE IS ─────────────────────────────────────────────────
//
// PLAN.md "Addendum — 2026-09-05 owner rulings", verbatim: "scan thumbnail
// stays on the side until the card is resolved confidently by whatever means.
// Then it moves down to the list and variant resolve happens there" — and
// "Unresolvable identities (backs/blur): thumbnail flips to a needs-you state in
// the stack, tappable to pick/retake; batch commit reminds; never blocks
// scanning."
//
// Before this, `Scan.tsx` flew every capture into the list the moment `/scan`
// answered, WHATEVER it answered — a confident match and an "Unidentified card"
// took the same flight into the same list, and the reader ended a run with a
// list that was part collection and part homework. The ruling separates them by
// WHERE they live rather than by how the row is coloured: resolved cards are in
// the list, unresolved captures are still on the camera, and the reader can keep
// scanning past both.
//
// ── WHY A REDUCER AND NOT FOUR `useState`s IN THE ROUTE ─────────────────────
//
// Two independent async answers race for one thumbnail, a timer races both, and
// the reader can pre-empt all three. That is five inputs to one decision, and
// the interesting cases are the ORDERINGS — a confident phash landing after the
// deadline already flipped the card to needs-you, a reader picking while a
// resolve is still in flight. Those are the cases a route component cannot be
// driven through in a test and this can: every transition below is one function
// call, so `__tests__/identity.test.ts` replays the orderings directly against
// the shipping reducer.
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
import type { ScanMatch, ScanResolveMatch, ScanResponse, ScanResolveResponse } from '../../lib/api'
import type { OcrRead } from '../ocr/pipeline'
import { gateScanResponse } from './tieGate'

/**
 * Where one capture's thumbnail is.
 *
 *   pending    on the camera, spinner, both answers still out.
 *   confident  named. A brief tick, then the courier flies it to the list.
 *   needs-you  named by nobody. Stays on the camera, distinct, tappable.
 *   discarded  the reader took the retake. It leaves without a row.
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
   * What the picker offers on a needs-you thumbnail: the TIE-GATED phash
   * ranking, best first.
   *
   * NOT merged with the resolve endpoint's own matches, and that is the same
   * call `ocrNarrow.ts`'s header already made for the feed-row popover: those
   * carry `distance: null` for cards phash never nominated, and a list that
   * ranks by distance must not contain entries with no distance. What OCR
   * contributes to this screen is its READ, shown as a hint chip beside the
   * candidates (`ocrHintLabel`), which is evidence the reader can use rather
   * than a rank the list cannot honour.
   */
  candidates: ScanMatch[]
  /** What OCR read off the card. Null until the read lands, and often after. */
  read: OcrRead | null
  /** Each async answer reports in exactly once, confident or not — the pair is
   *  what "both landed unconfident" is measured on. */
  phashSettled: boolean
  resolveSettled: boolean
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
   * The reader has the picker open on this thumbnail.
   *
   * From here a late confident answer is ignored. The scanner is allowed to
   * change its mind about a card nobody is looking at; it is not allowed to swap
   * the card out from under a reader mid-tap. Same principle `narrowedIdentity`
   * already enforces with `entry.verified` — a field read off a 26x12 px badge
   * does not overrule a human.
   */
  engaged: boolean
}

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
   */
  | { type: 'resolve'; resolved: ScanResolveResponse | null }
  /** `IDENTITY_DEADLINE_MS` elapsed with nothing named. */
  | { type: 'deadline' }
  /** The reader opened the picker. */
  | { type: 'engage' }
  /** The reader chose from the candidates. */
  | { type: 'pick'; match: ScanMatch }
  /** The reader took the retake. The capture is dropped, no row, no apology. */
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

export function initialIdentity(): IdentityState {
  return {
    phase: 'pending',
    match: null,
    by: null,
    candidates: [],
    read: null,
    phashSettled: false,
    resolveSettled: false,
    resolveVerdict: null,
    engaged: false,
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
    number: m.number,
    rarity: m.rarity,
    images: m.images,
    distance: m.distance,
    confidence: m.confidence,
  }
}

export function identityFromResolve(m: ScanResolveMatch): Identity {
  return {
    cardId: m.cardId,
    name: m.name,
    setName: m.setName,
    number: m.number,
    rarity: m.rarity,
    images: m.images,
    distance: m.distance,
    confidence: m.confidence,
  }
}

/**
 * May an incoming answer name this card? Only while the reader is not naming it
 * themselves.
 *
 * `engaged` is STICKY — closing the picker without choosing does not hand the
 * capture back to the race. The reader looked at the five candidates and did not
 * take any of them, which is information: whatever they do next, having a round
 * trip decide it for them thirty seconds later is not it. The capture stays
 * needs-you, which is an actionable state, not a stuck one.
 */
function mayName(s: IdentityState): boolean {
  return !s.engaged
}

/** Both answers are in and neither named the card — that IS needs-you. Reached
 *  before the deadline in the ordinary failure (a card back, a blurred crop):
 *  nothing is gained by making the reader watch a spinner run down a clock for
 *  an answer that has already arrived and said no. */
function settleOrWait(s: IdentityState): IdentityState {
  if (!s.phashSettled || !s.resolveSettled) return s
  return s.phase === 'needs-you' ? s : { ...s, phase: 'needs-you' }
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

  switch (e.type) {
    case 'phash': {
      const gated = gateScanResponse(e.res)
      // The evidence survives the gate even when the claim does not — the
      // ranked list IS the picker, so a demoted result still fills it.
      const next: IdentityState = { ...s, candidates: gated?.matches ?? s.candidates, phashSettled: true }
      const top = gated?.matched ? gated.matches[0] : undefined
      if (top && mayName(s)) return { ...next, phase: 'confident', match: identityFromMatch(top), by: 'phash' }
      return settleOrWait(next)
    }

    case 'read':
      return { ...s, read: e.read }

    case 'resolve': {
      const next: IdentityState = {
        ...s,
        resolveSettled: true,
        resolveVerdict: e.resolved
          ? { resolvedBy: e.resolved.resolvedBy, confident: e.resolved.confident }
          : s.resolveVerdict,
      }
      const top = resolvedIdentity(e.resolved)
      if (top && mayName(s)) return { ...next, phase: 'confident', match: identityFromResolve(top), by: 'printing' }
      return settleOrWait(next)
    }

    case 'deadline':
      return s.phase === 'pending' ? { ...s, phase: 'needs-you' } : s

    case 'engage':
      return s.engaged ? s : { ...s, engaged: true }

    case 'pick':
      return { ...s, phase: 'confident', match: identityFromMatch(e.match), by: 'reader' }

    case 'retake':
      return { ...s, phase: 'discarded' }
  }
}

/**
 * The hint chip on the needs-you picker: what OCR actually read off this card.
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
 *   needs-you          both answers landed and neither named it (or the deadline
 *                      ran out first). Still on the camera, waiting.
 *   picked             the reader chose from the candidates.
 *   retaken            the reader took the retake and the capture was dropped.
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
      resolvedBy: s.resolveVerdict?.resolvedBy ?? null,
      confident: s.resolveVerdict?.confident ?? null,
      cardId: s.match?.cardId ?? null,
      msToResolve: Math.round(msToResolve),
    },
  }
}

/** How many captures are sitting on the camera waiting for the reader. */
export function unresolvedCount(items: readonly { identity: IdentityState }[]): number {
  return items.reduce((n, i) => n + (i.identity.phase === 'needs-you' ? 1 : 0), 0)
}

// ── THE GATE IN FRONT OF THE BATCH COMMIT ───────────────────────────────────
//
// 2026-09-05 ruling: "batch commit reminds [about unresolved ones]". It is a
// stack question, not a write question, and it is deliberately not in
// `commit.ts` — that module holds the API client, and a rule about what the
// reader has to be told before their session ends should be answerable by a test
// that does not need one.
//
// It matters more under this ruling than it would have before it, because the
// captures it protects ARE NOT IN THE LIST. An unnamed capture stays on the
// camera, and Step 2 does not render the camera at all — so the reader presses
// "Add 12 cards" looking at twelve rows while two more go in the bin with the
// session. The drop is possible, it is invisible, and it is therefore only
// allowed to happen once somebody has said so out loud.
//
// One acknowledgement, not a blocker: "yes, those two were card backs" is a
// perfectly good answer, and the same ruling is explicit that unresolved
// captures never block the reader.

export interface CommitGate {
  /** May the write run now? */
  proceed: boolean
  /** How many captures are still on the camera, unnamed. */
  unresolved: number
  /** What to ask, or null when there is nothing to ask about. */
  prompt: string | null
}

export function commitGate(items: readonly { identity: IdentityState }[], acknowledged: boolean): CommitGate {
  const unresolved = unresolvedCount(items)
  if (unresolved === 0) return { proceed: true, unresolved: 0, prompt: null }
  return {
    proceed: acknowledged,
    unresolved,
    prompt: `${unresolved} scan${unresolved === 1 ? '' : 's'} unresolved — commit without them?`,
  }
}
