/**
 * THE FUSION RULES — how the image vector becomes a data point in the ladder
 * rather than a second, competing answer.
 *
 * ── THE RULING THIS FILE IS ─────────────────────────────────────────────────
 *
 * Owner, 2026-09-06: "Ensure that the image vector match is still a point of
 * data in the match" — the vector STAYS in the recipe as an independent signal
 * ("all good redundancy"), with phash "demoted to a near-exact fast path +
 * telemetry column" and retired only when the accuracy benchmark shows it never
 * changes an outcome. And from 2026-09-05, unchanged: identity confidence and
 * variant confidence are never blended.
 *
 * So there is ONE resolver, `resolve.ts`, and this module is the arithmetic it
 * consults — not a second matcher with its own opinion about what a card is.
 *
 * ── WHY THIS IS NOT A WEIGHTED SCORE ────────────────────────────────────────
 *
 * The same reason `resolve.ts` is a ladder and not a score, and it applies more
 * sharply here, not less. A cosine similarity and a printed set code are not
 * commensurable: `(setCode, number)` is unique across 20,444 physical cards
 * with ZERO collisions, and a similarity of 0.71 is a number whose meaning
 * depends on what else was in the gallery that day. Adding them with weights
 * would let a confident vector outvote an exact printed key, which is precisely
 * the mistake the 2026-09-03 measurement caught the hash making — its
 * `matched: true` fired four times on 19 correctly-cropped photographs and
 * named a different card every time.
 *
 * The rules below are therefore about AGREEMENT, not magnitude. Three of them:
 *
 *   1. OCR WINS A DISAGREEMENT. A rung that resolved from a badge, a number or
 *      a name has already returned by the time the vector is consulted, and
 *      nothing here can demote it. This is not deference to OCR in general — it
 *      is deference to a KEY. Session 3's evidence is that where the two
 *      disagree on a card the printed key read cleanly, the key is right.
 *
 *   2. CORROBORATION MAKES TWO INSUFFICIENT SIGNALS SUFFICIENT. `014/198`
 *      leaves exactly two candidates — Steenee and Floragato — and OCR cannot
 *      separate them at any confidence. The vector can: they are different
 *      pictures. When an independent signal has narrowed the world to a handful
 *      and the vector's OWN top-1 is one of them, that agreement is worth more
 *      than either signal's strength alone, and the answer becomes confident.
 *
 *   3. ALONE, THE VECTOR NEEDS A DECISIVE MARGIN. With nothing to corroborate,
 *      the only protection against a near-miss is the calibrated gate, and it
 *      is used exactly as the spike measured it.
 *
 * Everything else stays silent. A vector that is merely plausible produces
 * candidates and no claim, which is the failure shape the whole scanner is
 * built around.
 */
import { THRESHOLDS, type IdentityCandidate } from '@deckpal/matching';

/**
 * One candidate from the pgvector search: which card, and how close.
 * `similarity` is cosine in [-1, 1] — `embedMatch.ts` converts pgvector's
 * distance once so nothing downstream has to remember which way round it is.
 */
export interface VectorMatch {
  cardId: string;
  similarity: number;
}

/**
 * What the vector alone is entitled to claim, before anything else is known.
 *
 * The three levels are not a scale, they are three different permissions:
 * `decisive` may name a card, `showable` may only agree with something else,
 * and neither may argue against a key.
 */
export interface VectorVerdict {
  /** The vector's own top-1, or null when nothing cleared `simFloor`. */
  cardId: string | null;
  /** Top-1 cosine similarity. Reported even when nothing is claimed, because
   *  "0.62, rejected" is debuggable and "no match" is not. */
  similarity: number;
  /** Top-1 minus top-2. `null` with a single candidate — a different thing
   *  from a margin of zero, and not to be flattened into one. */
  margin: number | null;
  /**
   * `similarity >= simMin AND margin >= marginMin`: enough to NAME a card with
   * no other evidence at all.
   *
   * The two knobs are not belt-and-braces, they are two different failure
   * modes, and the spike measured both (embed-spike/NOTES.md §5, DECISIONS
   * 2026-09-04). Similarity rejects a photograph of something that is not in
   * the catalogue. Margin rejects the case where two candidates are both right
   * about the PICTURE and the printing is the open question — which the ruling
   * says must go to the reader rather than be resolved by the machine.
   */
  decisive: boolean;
  /** `similarity >= simFloor`: worth putting in front of a person, and worth
   *  believing when something independent says the same thing. Never enough on
   *  its own. */
  showable: boolean;
}

/**
 * Rank-ordered vector candidates in, one verdict out.
 *
 * `matches` must be sorted by descending similarity — the SQL that produces
 * them already is (`ORDER BY embedding <=> $1`) and re-sorting here would paper
 * over a caller that had lost the order for another reason. Only the first two
 * are read.
 *
 * The thresholds come from `@deckpal/matching`'s `THRESHOLDS`, keyed by model,
 * and are NOT re-derived here: they are a property of a vector space, they
 * carry the corpus they were measured on in their own comments, and a second
 * copy in this file is how a model swap silently keeps numbers that no longer
 * mean anything. For `clip-vit-b32-openai` they are simMin 0.74, marginMin
 * 0.02, simFloor 0.55 — the spike's applied gate, which accepted 9 of 10 true
 * matches and 0 of 9 impossible ones.
 */
export function vectorVerdict(matches: readonly VectorMatch[], modelId: string): VectorVerdict {
  const t = THRESHOLDS[modelId];
  if (!t) {
    throw new Error(
      `no measured confidence thresholds for '${modelId}' — add them to @deckpal/matching THRESHOLDS with the corpus they came from, or the gate is uncalibrated`,
    );
  }
  const top = matches[0];
  if (!top) return { cardId: null, similarity: 0, margin: null, decisive: false, showable: false };
  const second = matches[1];
  const margin = second ? top.similarity - second.similarity : null;
  const showable = top.similarity >= t.simFloor;
  // A single candidate cannot be checked against a runner-up, and the honest
  // answer to "how sure are you" with nothing to compare against is not "very".
  const decisive = showable && top.similarity >= t.simMin && margin !== null && margin >= t.marginMin;
  return { cardId: showable ? top.cardId : null, similarity: top.similarity, margin, decisive, showable };
}

/**
 * The phash distance at or below which the hash is treated as a NEAR-EXACT
 * confirmation of somebody else's answer.
 *
 * 2, against the ordinary `CONFIDENT_MAX = 9`, and the gap is the whole point
 * of the demotion. `router.ts` carries the measurement both numbers come from:
 * over 389 degraded scans the correct card lands at p50=3, and the rare WRONG
 * top-1s are "near-identical same-art reprints at distance 1-6". So a distance
 * of 1 or 2 is emphatically not proof of a card — the failure mode lives inside
 * that range — but it is strong evidence that the PICTURE is right, which is
 * exactly what a second signal needs to contribute when something else has
 * already narrowed the world to a few candidates with different art.
 *
 * 🔴 This is why `phashNearExact` returns a card to CORROBORATE with and never
 * an answer. A same-art reprint at distance 1 is the one thing it cannot rule
 * out, and letting it name a card alone would rebuild the 0-for-4 gate the
 * 2026-09-03 measurement killed.
 */
export const PHASH_NEAR_EXACT = 2;

/**
 * The independent signals that may confirm a candidate the OCR ladder produced
 * but could not choose between. Both are OPTIONAL and both are ignored when
 * absent, which is what makes the flag-off path identical to the old one.
 */
export interface Corroborators {
  /** The vector's verdict, or null when the embedding matcher is off. */
  vector: VectorVerdict | null;
  /** The phash top-1's card id, only when its distance is <= PHASH_NEAR_EXACT.
   *  Null otherwise, including when the hash was never consulted. */
  phashNearExact: string | null;
}

/**
 * Does an independent signal single out ONE of these candidates?
 *
 * Returns that card's id, or null. The caller decides what to do with it; this
 * function decides only whether the agreement is real.
 *
 * ── THE VECTOR IS REQUIRED. THE HASH IS NEVER ENOUGH BY ITSELF ─────────────
 *
 * The ruling's wording is "vector + any other signal", and it is load-bearing
 * rather than illustrative. A near-exact hash agreeing with an OCR-narrowed
 * candidate list is genuinely good evidence, and promoting on it alone would
 * still be wrong twice over:
 *
 *   * It would give the hash back the power the 2026-09-06 ruling took off it.
 *     "Demoted to a near-exact fast path" means it may CONFIRM, and a signal
 *     that can turn an unconfident answer confident on its own is not
 *     confirming anything — it is deciding. The measured wrong top-1s are
 *     same-art reprints at distance 1-6, which is INSIDE the near-exact band,
 *     so the one thing this signal cannot rule out is the one thing it would
 *     be being trusted to.
 *
 *   * It would make turning the flag on change behaviour BEFORE the catalogue
 *     is embedded. The operator sequence is migrate → embed → flag, and
 *     between the flag and a populated index this rule would already be
 *     promoting answers using no vector at all. A feature switch that alters
 *     results while its own data is still empty is a switch nobody can
 *     roll back cleanly. `__tests__/fuse.test.ts` pins that: with the flag on
 *     and an empty candidate list, the ladder is identical to the flag being
 *     off, for every fixture case.
 *
 * So the hash's contribution here is exactly one thing: it can AGREE with the
 * vector, and it can DISAGREE with it. It cannot speak alone.
 *
 * ── WHAT COUNTS AS THE VECTOR AGREEING, AND WHY IT IS THE TOP-1 ────────────
 *
 * The vector must have the card at its OWN rank 1, not merely somewhere in its
 * top-k. Membership in a list of five is close to no information — five of
 * 23,546 is still five — while "the single closest card in the entire index is
 * one of the two the printed number allows" is a genuine coincidence. The
 * similarity bar is `showable` rather than `decisive` because that is the whole
 * point of corroboration: the vector is being asked to break a tie, not to
 * carry the answer, and requiring it to be decisive first would make this rule
 * do nothing that rule 3 does not already do.
 *
 * ── AND WHY DISAGREEMENT IS SILENCE ────────────────────────────────────────
 *
 * If the vector points at one candidate and a near-exact hash at another, two
 * independent signals have contradicted each other and neither is a
 * confirmation of anything. Picking the "stronger" one would mean inventing a
 * comparison between a cosine and a Hamming distance — the exact blend this
 * design refuses — so nothing is corroborated and the candidates go to the
 * reader unclaimed.
 */
export function corroborate(
  candidateIds: readonly string[],
  signals: Corroborators,
): string | null {
  if (candidateIds.length === 0) return null;
  const v = signals.vector;
  if (!v || !v.showable || !v.cardId) return null;

  const ids = new Set(candidateIds);
  if (!ids.has(v.cardId)) return null;

  // The hash gets a veto and no voice: it may only contradict what the vector
  // already said, and only from inside the near-exact band.
  if (signals.phashNearExact && signals.phashNearExact !== v.cardId) return null;
  return v.cardId;
}

/** The vector's candidates as `identityConfidence` wants them — the same
 *  shape, so the endpoint and the ladder cannot drift about what a candidate
 *  is. */
export function toIdentityCandidates(matches: readonly VectorMatch[]): IdentityCandidate[] {
  return matches.map((m) => ({ cardId: m.cardId, similarity: m.similarity }));
}
