// Shared types for the quad labeler — an owner-only dev tool that builds a
// human-verified corpus of correct quads (or explicit, REASON-CODED invalid
// verdicts) against the engine's own canonical square frame. See
// workingFrame.ts for why every frame — camera or upload — converges on one
// format before it ever reaches the annotation editor, and orientation.ts for
// the top-left anchor a quad cannot express on its own.
import type { Quad } from '../engine/contract'
import type { TopLeftIndex } from './orientation'

export type LabelSource = 'camera' | 'upload'
export type SeededFrom = 'detector' | 'default'

/**
 * WHY a `seededFrom: 'default'` row fell back — recorded from 2026-09-07, and
 * the difference matters enormously to a harvest.
 *
 *   'no_object'   THE MODEL RAN AND SAID NO. `hasObj` came in under the
 *                 shipping acquire threshold on a real frame. This is SIGNAL:
 *                 paired with a human positive it is a recorded detector MISS,
 *                 which is the most valuable row the corpus can hold.
 *   'no_quad'     the presence head opened but the corner output was not four
 *                 finite points. Rare; a model fault, not a frame fault.
 *   'unavailable' the detector never ran here at all — assets failed, the
 *                 budget expired, the canvas could not be read. This says
 *                 nothing about the frame and a harvest must not read it as a
 *                 miss. Every `default` row recorded before 2026-09-07 is this
 *                 case (rounds 9-9c: `captureStream` never delivered a frame),
 *                 and none of them carry this field to say so.
 */
export type SeedFallback = 'no_object' | 'no_quad' | 'unavailable'

/**
 * SCHEMA VERSION OF ONE SAVED LABEL — bumped 2026-09-06, and present on every
 * row this build writes.
 *
 *   1 — the 2026-09-04 shape. Three invalid reasons
 *       ('no_card' | 'multiple_cards' | 'too_blurry'), no orientation anchor,
 *       no face. Rows at this version carry NO `labelSchema` key at all,
 *       because the field did not exist: absence IS version 1, and harvest
 *       must read it that way rather than defaulting to the current number.
 *   2 — this build. The nine-reason taxonomy below, plus `topLeftIndex` /
 *       `seededTopLeftIndex` / `face` on every positive.
 *
 * The bump exists so the training harvest can MIX the two rather than choose:
 * a version-1 positive is still a perfectly good quad-regression example, it
 * simply has nothing to say about orientation. See LEGACY_REASON_MAP.
 */
export const LABEL_SCHEMA_VERSION = 2

/**
 * WHY A SHOT HAS NO VALID QUAD. Owner ruling 2026-09-06 replaces the three
 * reasons of 2026-09-04 with a taxonomy shaped by what a future REALTIME
 * classifier would need to say out loud — every reason below is paired with
 * the coaching phrase it would drive (REASON_SPECS), so the labeler doubles as
 * the review surface for that copy.
 *
 * TWO TIERS, and the split is the whole design:
 *
 *   'absent'      — is a card present at all?
 *       no_card       nothing card-like in the frame.
 *       not_a_card    something card-LIKE that is NOT a card — an envelope, a
 *                     shipping label, a coaster, a box lid, a phone screen.
 *                     THE HARD-NEGATIVE CLASS, and deliberately not folded
 *                     into no_card: an empty frame teaches the presence head
 *                     nothing it does not already know, whereas the current
 *                     build's known false positive is EXACTLY a shipping
 *                     envelope. This is the most valuable negative in the set.
 *
 *   'unquaddable' — a card IS present, but no trustworthy quad can be pinned,
 *                   and WHY. Each of these is a different lesson AND a
 *                   different thing to tell the person holding the phone.
 *       too_blurry, too_far, cut_off, too_dark, glare_washout, too_oblique,
 *       multiple_no_clear_foreground
 *
 * THE TWO BORDERLINE RULES SURVIVE THE REWRITE (they are the ones that get
 * mis-called, so they are also printed in the editor):
 *   - Several cards but ONE is clearly the intended foreground subject → that
 *     is a POSITIVE on that card's quad. `multiple_no_clear_foreground` is
 *     only for when none of them reads as the subject.
 *   - Blurry but the corners are still confidently placeable → also a
 *     POSITIVE, and a valuable hard example. `too_blurry` is only for when a
 *     HUMAN cannot place them.
 *
 * Still a closed union, for the same reason as before: every writer and every
 * reader of the corpus stays enumerable and exhaustive-checkable.
 */
export type InvalidReason =
  | 'no_card'
  | 'not_a_card'
  | 'too_blurry'
  | 'too_far'
  | 'cut_off'
  | 'too_dark'
  | 'glare_washout'
  | 'too_oblique'
  | 'multiple_no_clear_foreground'

/**
 * THE CARD'S FACE — added 2026-09-06 with `card_back`, and deliberately NOT an
 * `InvalidReason`.
 *
 * A card back is not a rejection. It is a card, it has a perfectly pinnable
 * quad, and refusing to quad it would teach the detector the opposite of the
 * truth. So it rides as a FLAG ON A POSITIVE — corners, anchor and all — and
 * one label then feeds two trainings at once: the detector learns backs are
 * quaddable cards, and the future realtime classifier learns to say "flip the
 * card" instead of burning an identify round-trip on a picture of a card back.
 * (The owner's real sessions caught three of those. Measured cost, measured
 * class.)
 *
 * This is why `card_back` is not a third editor mode: the union already
 * discriminates on `corners`, a back has corners, and bending the rejection
 * flow to carry a quad would have put an `invalidReason` on a row that is not
 * invalid. One extra field on the positive says it exactly.
 *
 * A v1 row has no `face` at all, and absence means UNKNOWN — see the mapping
 * note below for why it must not be read as 'front'.
 */
export type CardFace = 'front' | 'back'

/**
 * 'absent'      = no card to quad.
 * 'unquaddable' = a card, but not one this frame can pin corners on.
 * 'quaddable'   = a card WITH a quad that the classifier still has something
 *                 to say about — today exactly `card_back`.
 */
export type ReasonGroup = 'absent' | 'unquaddable' | 'quaddable'

/**
 * The full output space of the future realtime coach: every verdict this
 * labeler can record that a classifier would have to predict. The rejection
 * reasons, plus the one quaddable-but-coachable class.
 */
export type CoachClass = InvalidReason | 'card_back'

export interface CoachSpec<V extends CoachClass = CoachClass> {
  value: V
  group: ReasonGroup
  /** The picker's button text. Terse — this gets read hundreds of times. */
  label: string
  /**
   * THE COACHING PHRASE, shown as the picker's subtitle. This is the words a
   * future realtime classifier would put on screen when it predicts this
   * class, which is why it is stored beside the reason rather than invented
   * later: the reader labelling the corpus is simultaneously reviewing the
   * copy the product will speak, and a phrase that reads wrong here would read
   * wrong there.
   */
  coaching: string
  /**
   * FALSE for a trainer-only class — one where the realtime answer is not
   * advice but a refusal. `not_a_card` is the only one: there is nothing to
   * coach, the classifier simply declines to quad, and its `coaching` string
   * is therefore a statement rather than an instruction.
   */
  coachable: boolean
}

/** The rejection-picker's own spec type — a `CoachSpec` narrowed to the
 *  reasons that mean "no quad", which is what the picker offers. */
export type ReasonSpec = CoachSpec<InvalidReason>

/** Picker ORDER, deliberately: the two presence questions first (with the
 *  hard-negative class prominent, per the 2026-09-06 addendum), then the
 *  unquaddable reasons roughly by how often a real session hits them. */
export const REASON_SPECS: readonly ReasonSpec[] = [
  {
    value: 'no_card',
    group: 'absent',
    label: 'No card',
    coaching: 'Point the camera at a card.',
    coachable: true,
  },
  {
    value: 'not_a_card',
    group: 'absent',
    label: 'Not a card',
    coaching: "That's not a card — envelope, label, coaster, screen.",
    coachable: false,
  },
  {
    value: 'too_blurry',
    group: 'unquaddable',
    label: 'Too blurry',
    coaching: 'Hold steady.',
    coachable: true,
  },
  {
    value: 'too_far',
    group: 'unquaddable',
    label: 'Too far',
    coaching: 'Move closer.',
    coachable: true,
  },
  {
    value: 'cut_off',
    group: 'unquaddable',
    label: 'Cut off',
    coaching: 'Fit the whole card in frame.',
    coachable: true,
  },
  {
    value: 'too_dark',
    group: 'unquaddable',
    label: 'Too dark',
    coaching: 'More light.',
    coachable: true,
  },
  {
    value: 'glare_washout',
    group: 'unquaddable',
    label: 'Glare',
    coaching: 'Tilt the card to kill the glare.',
    coachable: true,
  },
  {
    value: 'too_oblique',
    group: 'unquaddable',
    label: 'Too angled',
    coaching: 'Face the card more directly.',
    coachable: true,
  },
  {
    value: 'multiple_no_clear_foreground',
    group: 'unquaddable',
    label: 'Several cards',
    coaching: 'Show one card at a time.',
    coachable: true,
  },
]

/** Not in `REASON_SPECS` and not in the rejection picker on purpose — a back
 *  is SAVED AS A POSITIVE with `face: 'back'`. It lives here so the coaching
 *  copy for every class the classifier can emit sits in one reviewable table. */
export const CARD_BACK_SPEC: CoachSpec<'card_back'> = {
  value: 'card_back',
  group: 'quaddable',
  label: 'Card back',
  coaching: 'Flip the card.',
  coachable: true,
}

/** THE COACHING TABLE — every class the future realtime classifier can emit,
 *  each with the words it would say. The labeler renders these strings, so
 *  labelling the corpus doubles as reviewing this copy. */
export const COACH_SPECS: readonly CoachSpec[] = [...REASON_SPECS, CARD_BACK_SPEC]

/** Lookup by value — for the session counter, the save toast, and anything
 *  that has a reason in hand and wants its words. */
export const REASON_BY_VALUE: Record<InvalidReason, ReasonSpec> = Object.fromEntries(
  REASON_SPECS.map((r) => [r.value, r]),
) as Record<InvalidReason, ReasonSpec>

export const COACH_BY_VALUE: Record<CoachClass, CoachSpec> = Object.fromEntries(
  COACH_SPECS.map((r) => [r.value, r]),
) as Record<CoachClass, CoachSpec>

/**
 * ── READING VERSION-1 ROWS ─────────────────────────────────────────────────
 *
 * Nothing already recorded is thrown away; the harvest maps it forward.
 *
 *   'multiple_cards' ≈ 'multiple_no_clear_foreground'
 *        The old name described the frame, the new one describes the verdict,
 *        but the rule that produced them is identical — the 2026-09-04 editor
 *        printed the same "one clear foreground subject is a POSITIVE"
 *        guidance beside the button. APPROXIMATE, hence ≈.
 *   'too_blurry'     → 'too_blurry'          unchanged, same meaning.
 *   'no_card'        → 'no_card'             unchanged NAME, but NARROWER now:
 *        v1 had nowhere to put a shipping envelope, so v1 'no_card' rows are a
 *        MIXTURE of empty frames and card-like non-cards. Harvest must NOT
 *        mine them for the `not_a_card` hard-negative class — that class
 *        starts at schema 2 and has no v1 population.
 *
 * ORIENTATION: absent on every v1 row and on any v2 negative. Absent means
 * UNKNOWN, never "index 0" — a v1 positive trains quad regression exactly as
 * before and is simply skipped by the orientation head.
 *
 * FACE: absent on every v1 row, and absent means UNKNOWN — NOT 'front'. This
 * matters more than it looks. A v1 labeler had no way to say "card back", so a
 * back it was shown was saved as a plain positive; the owner's own sessions
 * contain three. Defaulting v1 positives to 'front' would therefore feed the
 * face head a small number of confidently WRONG labels, which is the one thing
 * a small corpus cannot absorb. v1 positives train the detector and the quad,
 * and are skipped by the face head.
 */
export type LegacyInvalidReason = 'no_card' | 'multiple_cards' | 'too_blurry'

export const LEGACY_REASON_MAP: Record<LegacyInvalidReason, InvalidReason> = {
  no_card: 'no_card',
  multiple_cards: 'multiple_no_clear_foreground',
  too_blurry: 'too_blurry',
}

/** Forward-map one schema-1 reason. Total over the v1 union by construction,
 *  so a v1 row can never fail to harvest. */
export function migrateLegacyReason(reason: LegacyInvalidReason): InvalidReason {
  return LEGACY_REASON_MAP[reason]
}

/** Version of a row read back from the corpus. A missing `labelSchema` is
 *  version 1 — see LABEL_SCHEMA_VERSION. */
export function labelSchemaOf(row: { labelSchema?: number }): number {
  return row.labelSchema ?? 1
}

interface QuadLabelBase {
  /** See LABEL_SCHEMA_VERSION. Written on every row from 2026-09-06. */
  labelSchema: typeof LABEL_SCHEMA_VERSION
  /** The CANONICAL frame's dimensions — what `corners` are fractions of, and
   *  what the attached PNG is. Always `canonicalSize` square; kept because a
   *  future canonical resolution must not silently rewrite old rows' meaning. */
  dims: { width: number; height: number }
  /**
   * THE SOURCE THE CANONICAL FRAME WAS CUT FROM — the camera stream's native
   * resolution, or the uploaded photo's. Added 2026-09-07; ABSENT on the
   * schema-2 rows recorded 2026-09-06.
   *
   * Without it a row cannot be mapped back to the pixels it came from, and
   * `dims` cannot supply it: `dims` is always the canonical square, so every
   * row looked like a 416x416 photo. A 12 MP phone frame and a 640x480 webcam
   * frame produce identical `dims` and very different amounts of real detail,
   * which is exactly what a training run wants to weight by.
   */
  stream?: { width: number; height: number }
  /** The centre-square crop taken from `stream` to build the canonical frame
   *  (engine/frame.ts `squareCrop`), in STREAM pixels. With `stream` above,
   *  this is the complete inverse map from a normalized corner back to a pixel
   *  in the original photo. Added 2026-09-07 alongside `stream`. */
  crop?: { x: number; y: number; size: number }
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
    /** Raw presence head for this frame, ungated. Present from 2026-09-07
     *  whenever the model actually ran — including when it declined, which is
     *  the case worth having the number for. */
    hasObj?: number
    /** The threshold `hasObj` was judged against (gate.ts DEFAULT_ACQUIRE at
     *  the time of labelling), so a re-tune later cannot retroactively change
     *  what a recorded row meant. */
    seedAcquireThreshold?: number
    /** Why a `seededFrom: 'default'` row fell back. See SeedFallback — the
     *  distinction between a detector MISS and a detector that never ran. */
    seedFallback?: SeedFallback
    /** Wall time the seed took, ms — model load included on the first frame of
     *  a session. Diagnostic only. */
    seedMs?: number
  }
  savedAt: string
}

/** A correct quad — NORMALIZED, fractions [0,1] of the canonical square's
 *  own width/height, matching how the engine already reports its own
 *  reticle (contract.ts EngineState.reticle) — so the label means the same
 *  thing regardless of which resolution CANONICAL_SIZE is tuned to next. */
export interface PositiveQuadLabel extends QuadLabelBase {
  corners: Quad
  /** THE ORIENTATION ANCHOR (orientation.ts): which of `corners` is the
   *  CARD's own top-left, as asserted by a human. */
  topLeftIndex: TopLeftIndex
  /** What the geometric rule guessed before the human looked — the same rule
   *  production uses. `topLeftIndex !== seededTopLeftIndex` is one recorded
   *  instance of rectify.ts's orientation residual. */
  seededTopLeftIndex: TopLeftIndex
  /** 'back' is the `card_back` class (CARD_BACK_SPEC): a real card, a real
   *  quad, and a real thing to say about it — "flip the card". */
  face: CardFace
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
  /** Positives where the reader MOVED the anchor off the geometric seed —
   *  the live count of frames production would have oriented wrongly. */
  reorientedPositives: number
  /** Positives saved as `face: 'back'` — counted separately from `positive`'s
   *  total, not subtracted from it: a back IS a positive quad. */
  cardBacks: number
}
