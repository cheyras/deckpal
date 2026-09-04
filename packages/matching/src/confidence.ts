// IDENTITY CONFIDENCE — and the deliberate absence of a blended one.
//
// ── THE RULING THIS FILE IS ───────────────────────────────────────────────────
//
// Owner, 2026-09-04 (PLAN.md, "MATCHING ARCHITECTURE RULING"):
//
//   "identity and variant/printing carry SEPARATE confidence scores, never
//    blended. The system may confidently match a card while reporting variant
//    unknown; in that state verification MUST require the user to specify the
//    printing — no silent default-to-primary commit."
//
// A single "confidence: 0.83" is the thing that ruling forbids, so this module
// does not export one and there is no function here that could compute one. It
// exports two answers to two questions, and the shape of `VariantConfidence`
// makes the second one unable to lie: today it has exactly one inhabitant,
// `unknown`, because nothing in this system measures a printing yet.
//
// ── WHY THE OLD `confidence` FIELD WAS WORSE THAN NOTHING ────────────────────
//
// `apps/api/src/scan/router.ts` reports `confidence: 1 - distance/64`, an
// honest restatement of a hash distance — and the 2026-09-03 measurement
// (p2-work/phash-on-crops/RESULTS.md) found the flag built on it fired four
// times on 19 correctly-cropped photographs and was wrong all four times.
// 0-for-4 precision. The number was not miscalibrated; it was measuring hash
// agreement and being read as card identity, which are different claims.
//
// So this module's contract is precision-first: it is allowed to say "not sure"
// about a card it could have named, and it is not allowed to say "confident"
// about a card that is not there.
//
// ── THE TWO SIGNALS, AND WHY BOTH ────────────────────────────────────────────
//
// Measured on the 19-frame ground truth against a 2,608-card gallery
// (p2-work/embed-spike, 2026-09-04). Nine of those 19 frames are photographs of
// cards that have NO catalog art in any approved source (`mep-058/059/060`;
// research/CARD-ART-SOURCES.md, art-sweep/SWEEP.md) — which makes them the best
// negative set this project could ask for: real photographs of real cards whose
// right answer genuinely is not in the index, so a matcher that names one is
// demonstrably wrong rather than arguably wrong.
//
//   * SIMILARITY separates them outright for the shipped checkpoint: the
//     weakest true match scores 0.7659 and the strongest wrong-by-necessity
//     top-1 scores 0.7533. A threshold in that gap admits 10/10 and rejects
//     9/9.
//   * MARGIN (top-1 minus top-2) separates them almost as well, and it fails
//     DIFFERENTLY: a near-identical reprint of the same art depresses the margin
//     while similarity stays high. That is the one case where two candidates
//     are both "right" about the picture and the printing is the open question
//     — which is precisely the state the ruling says must be handed to the
//     reader rather than resolved by the machine.
//
// Requiring both is therefore not belt-and-braces, it is the two failure modes.
// The gap between them is what `uncertain` is for: a top candidate worth
// showing, labelled as not confirmed, which the verify UI must treat as a
// question and not as an answer.

import { EMBED_MODEL_ID } from './input-spec.js'

export interface EmbedThresholds {
  /** Minimum cosine similarity for the top candidate to be called confident. */
  simMin: number
  /** Minimum (top1 - top2) cosine gap for the top candidate to be confident. */
  marginMin: number
  /** Below this the top candidate is not worth showing at all. */
  simFloor: number
}

/**
 * Per-checkpoint, because a threshold is a property of a vector space and not
 * of an idea. Swapping the model without re-measuring these would keep the
 * numbers and lose their meaning, which is the failure mode a shared constant
 * makes easy and a keyed table makes visible.
 *
 * `__tests__/confidence.test.ts` asserts the active `EMBED_MODEL_ID` has an
 * entry, so a model change that forgets this file fails a test instead of
 * shipping a gate calibrated for a different model.
 */
export const THRESHOLDS: Readonly<Record<string, EmbedThresholds>> = {
  // Measured 2026-09-04 on the 19-frame corpus. The gap between the weakest
  // true match (0.7659) and the strongest impossible top-1 (0.7533) is where
  // simMin sits; marginMin sits above the largest impossible margin (0.0222)
  // and below the second-smallest true margin (0.0884).
  'vitamin-small-datacomp1b': { simMin: 0.76, marginMin: 0.05, simFloor: 0.55 },
  // The fallback checkpoint, same corpus: true matches 0.7015-0.9058,
  // impossible top-1s 0.5842-0.7512, so its usable gap is much narrower and its
  // weakest true match sits BELOW the strongest impossible one. It buys a
  // smaller download with a worse confidence gate, and that trade is the reason
  // both sets of numbers are written down instead of one.
  'tinyclip-vit-m32-laion400m': { simMin: 0.755, marginMin: 0.04, simFloor: 0.55 },
}

export type IdentityLevel = 'confident' | 'uncertain' | 'none'

export interface IdentityCandidate {
  cardId: string
  /** Cosine similarity to the query, in [-1, 1]. */
  similarity: number
}

export interface IdentityConfidence {
  level: IdentityLevel
  /** The top candidate, or null when nothing cleared `simFloor`. */
  cardId: string | null
  /** Top-1 cosine similarity. Reported even when the level is `none`, because
   *  "0.62, rejected" is a debuggable answer and "no match" is not. */
  similarity: number
  /** Top-1 minus top-2. `null` when there was only one candidate — which is a
   *  different thing from a margin of zero and must not be flattened into one. */
  margin: number | null
  /** Which checkpoint's thresholds were applied. Travels with the answer so a
   *  logged verdict can be re-read after a model change. */
  modelId: string
}

/**
 * Rank-ordered candidates in, one honest verdict out.
 *
 * `candidates` must be sorted by descending similarity — the SQL that produces
 * them already is (`ORDER BY embedding <=> $1`), and re-sorting here would
 * quietly paper over a caller that had lost the order for some other reason.
 * The function asserts nothing about it and reads only the first two.
 */
export function identityConfidence(
  candidates: readonly IdentityCandidate[],
  modelId: string = EMBED_MODEL_ID,
): IdentityConfidence {
  const t = THRESHOLDS[modelId]
  if (!t) {
    throw new Error(
      `no measured confidence thresholds for '${modelId}' — add them to THRESHOLDS with the corpus they came from, or the gate is uncalibrated`,
    )
  }
  const top = candidates[0]
  if (!top) {
    return { level: 'none', cardId: null, similarity: 0, margin: null, modelId }
  }
  const second = candidates[1]
  const margin = second ? top.similarity - second.similarity : null

  if (top.similarity < t.simFloor) {
    return { level: 'none', cardId: null, similarity: top.similarity, margin, modelId }
  }
  // A single candidate cannot be checked against a runner-up, and the answer to
  // "how sure are you" when there is nothing to compare against is not "very".
  const marginOk = margin !== null && margin >= t.marginMin
  const level: IdentityLevel = top.similarity >= t.simMin && marginOk ? 'confident' : 'uncertain'
  return { level, cardId: top.cardId, similarity: top.similarity, margin, modelId }
}

export type VariantLevel = 'unknown'

export interface VariantConfidence {
  level: VariantLevel
  /** Machine-readable, so the client branches on this and not on prose. */
  reason: 'no-variant-model'
  /** Whether the reader MUST choose a printing before this can be committed.
   *  True whenever the card has more than one legal variant, which is the
   *  ruling's "no silent default-to-primary commit" expressed as a field the
   *  UI cannot ignore by accident. */
  requiresUserChoice: boolean
}

/**
 * The variant half of the ruling — and the whole of what this system can
 * honestly say about a printing today.
 *
 * There is no finish classifier, no foil detector, and no multi-frame variant
 * evidence in this build. phash was variant-blind and the embedding is
 * variant-blind too: it is trained to be invariant to exactly the surface
 * effects (gloss, holo shimmer, sleeve reflection) that distinguish a reverse
 * holo from a normal, which is what makes it good at identity and useless here.
 *
 * So this returns `unknown`, always, and the only interesting thing it computes
 * is whether that unknown BLOCKS the commit. When the catalog says a card has
 * one legal printing there is nothing to choose and nothing to ask; when it says
 * several, the reader is the only source of truth this system has.
 *
 * When a finish classifier lands, this function grows other levels and every
 * caller keeps compiling — which is why the shape is a discriminated union with
 * one member today rather than a boolean or a nullable number.
 */
export function variantConfidence(legalVariantCount: number): VariantConfidence {
  return {
    level: 'unknown',
    reason: 'no-variant-model',
    requiresUserChoice: legalVariantCount > 1,
  }
}
