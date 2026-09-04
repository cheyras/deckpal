// Shared types for the quad labeler — an owner-only dev tool that builds a
// human-verified corpus of correct quads (or explicit, REASON-CODED invalid
// verdicts) against the engine's own canonical square frame. See
// workingFrame.ts for why every frame — camera or upload — converges on one
// format before it ever reaches the annotation editor.
import type { Quad } from '../engine/contract'

export type LabelSource = 'camera' | 'upload'
export type SeededFrom = 'detector' | 'default'

/**
 * Why a shot has no valid quad. Owner-approved 2026-09-04, replacing the
 * single "no valid card" verdict — a training corpus benefits from knowing
 * WHICH failure mode a negative represents, and the three below are
 * genuinely different lessons for the detector:
 *
 *   no_card         — nothing card-shaped is in frame at all.
 *   multiple_cards  — several cards, and NONE reads as the clearly intended
 *                      foreground subject (see AnnotationEditor's guidance
 *                      text for the borderline rule: if one card IS clearly
 *                      the subject, that is a POSITIVE on that card's quad,
 *                      not this).
 *   too_blurry      — even a human cannot confidently place corners (NOT
 *                      "blurry but placeable", which is a valuable POSITIVE
 *                      hard example, not this).
 *
 * Deliberately not a fully open string: an extensible closed union keeps
 * every writer (this file, the editor's buttons, anything that ever reads
 * the corpus back) enumerable and exhaustive-checkable, while still being a
 * one-line addition when 'glare'/'partial' or similar join later.
 */
export type InvalidReason = 'no_card' | 'multiple_cards' | 'too_blurry'

interface QuadLabelBase {
  dims: { width: number; height: number }
  source: LabelSource
  seededFrom: SeededFrom
  pipeline: {
    pipelineVersion: number
    canonicalSize: number
    model: string
    modelLoadMs?: number
    modelNumThreads?: number
    modelProxy?: boolean
    modelCrossOriginIsolated?: boolean
  }
  savedAt: string
}

/** A correct quad — NORMALIZED, fractions [0,1] of the canonical square's
 *  own width/height, matching how the engine already reports its own
 *  reticle (contract.ts EngineState.reticle) — so the label means the same
 *  thing regardless of which resolution CANONICAL_SIZE is tuned to next. */
export interface PositiveQuadLabel extends QuadLabelBase {
  corners: Quad
}

/** No valid quad, and WHY — never inferred from an empty/degenerate quad. */
export interface NegativeQuadLabel extends QuadLabelBase {
  corners: null
  invalidReason: InvalidReason
}

/** One label, ready to POST. A discriminated union on `corners`: present for
 *  a positive, `null` (with `invalidReason`) for a negative. */
export type QuadLabel = PositiveQuadLabel | NegativeQuadLabel

export interface SessionStats {
  total: number
  positive: number
  /** Every negative, broken out by `InvalidReason` — an `InvalidReason` not
   *  yet seen this session simply has no key rather than a pre-seeded 0, so
   *  a future reason added to the enum needs no matching edit here. */
  negativeByReason: Partial<Record<InvalidReason, number>>
}
