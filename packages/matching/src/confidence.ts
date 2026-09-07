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
// Measured on the 19-frame ground truth against a 6,464-card gallery
// (p2-work/embed-spike, 2026-09-04). Nine of those 19 frames are photographs of
// cards that have NO catalog art in any approved source (`mep-058/059/060`;
// research/CARD-ART-SOURCES.md, art-sweep/SWEEP.md) — which makes them the best
// negative set this project could ask for: real photographs of real cards whose
// right answer genuinely is not in the index, so a matcher that names one is
// demonstrably wrong rather than arguably wrong.
//
// WHAT THOSE NINE ACTUALLY RETRIEVE IS THE POINT. They are photographs of a
// Chespin, a Fennekin and a Froakie whose own printings are missing, and the
// embedding returns OTHER PRINTINGS OF THE SAME POKÉMON — a Chespin photo tops
// out on `xy1-12` Chespin, a Fennekin on `xy8-25` Fennekin. That is a far
// better failure than the hash's (which answered "Earthen Vessel"), and for
// this gate it is a WORSE one, because a near-miss scores high. The gate is
// calibrated against the hardest available negatives on purpose.
//
//   * SIMILARITY does most of the work. For the shipped checkpoint the nine
//     impossible frames top out at 0.7028 and the true matches run
//     0.6787-0.8545, so a threshold at 0.74 admits nine of ten and rejects all
//     nine — with ~0.037 of headroom on each side, which is the whole reason
//     it sits between the two rather than just above the negatives.
//   * MARGIN (top-1 minus top-2) fails DIFFERENTLY, and that is why it is not
//     redundant: a near-identical reprint of the same art depresses the margin
//     while similarity stays high. That is the case where two candidates are
//     both "right" about the picture and the PRINTING is the open question —
//     precisely the state the ruling says must be handed to the reader rather
//     than resolved by the machine. It also independently rejects all nine
//     negatives here (their margins top out at 0.0181, against 0.02).
//
// THE THRESHOLDS ARE SET TO THE MIDPOINT OF THE GAP, NOT TO THE EDGE OF IT.
// A cut placed 0.0001 above the strongest negative scores perfectly on this
// sample and is fitted to it. The gap's width is the only thing here that
// predicts whether the calibration survives the real 23,546-row catalogue, and
// the 2,608 -> 6,464 expansion showed how fast a narrow one closes: the
// checkpoint that separated PERFECTLY at 2,608 (`vitamin_small`, weakest true
// 0.7659 vs strongest impossible 0.7533) stopped separating at 6,464, where its
// strongest impossible reached 0.8056. This checkpoint's numbers did not move
// AT ALL between the two galleries, which is why it is the one shipping.
//
// Requiring both knobs is therefore not belt-and-braces, it is the two failure
// modes. The band between them is what `uncertain` is for: a top candidate
// worth showing, labelled as not confirmed, which the verify UI must treat as a
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
  // SHIPPED. 19-frame corpus, 6,464-card gallery, 2026-09-04.
  //   true matches      0.6787 .. 0.8545   margins 0.0107 .. 0.1474
  //   impossible top-1s 0.6102 .. 0.7028   margins 0.0024 .. 0.0181
  // simMin 0.74 is the midpoint of (0.7028, 0.7759) — the strongest negative
  // and the weakest true match above it. marginMin 0.02 sits just above every
  // negative's margin and below every accepted true one. Result: 9 of 10 true
  // matches accepted, 0 of 9 negatives.
  'clip-vit-b32-openai': { simMin: 0.74, marginMin: 0.02, simFloor: 0.55 },
  // The pre-measured smaller alternative, same corpus and gallery: true matches
  // 0.7015-0.9058, impossible top-1s 0.5842-0.7512, so simMin is the midpoint
  // of (0.7512, 0.8197) and marginMin of (0.0291, 0.0462). Same 9-of-10 at zero
  // false accepts, with 0.0685 of similarity headroom against the shipped
  // checkpoint's 0.0731 — 6% less margin for a 62 MB int8 download instead of
  // 88 MB. Written down rather than recomputed later, so the device probe can
  // switch to it on one line plus a migration.
  'tinyclip-vit-betwixt32-laion400m': { simMin: 0.785, marginMin: 0.035, simFloor: 0.55 },
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
