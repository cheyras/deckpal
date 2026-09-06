// THE ESCALATION RUNG — what happens when the two bands read nothing.
//
// ── THE OWNER'S RULING, 2026-09-06 ──────────────────────────────────────────
//
// "Full-card OCR is an ESCALATION rung — runs ONLY when the two-ROI pass returns
// name=null AND number=null. Zero cost on the happy path."
//
// So nothing in this file is on the ordinary path. `paddle-roi-3x` reads the
// collector number on 21/21 real crops (REPORT.md §1.1); the rung below exists
// for the crop that recipe cannot serve at all, and the shape of that crop is
// known: A TOPLOADER OR A THICK SLEEVE. The quad locks onto the plastic rather
// than the card, `rectify.ts` warps the plastic to 480×670, and the card ends up
// INSET inside its own crop. The two ROI bands — derived in `rois.ts` from where
// text sits on a card that fills the frame — then land on blank plastic, while
// the card's own lines are all still in the picture, just smaller and lower.
//
// ── THE CONFIG IS `paddle-full`, VERBATIM ───────────────────────────────────
//
// REPORT.md §1's row: full crop, NO ROI and NO UPSCALE, det + rec over the whole
// 480×670. Measured on the same 21 crops as the shipped recipe:
//
//   number 95 %   num+denom 95 %   badge vocab 71 %   badge WRONG 1   name 67 %
//
// No greyscale, no contrast stretch, no sharpening — the same negative result
// §3.2 records for the ROI recipe, and the same rule applies here: preprocessing
// this configuration was not measured with does not get added because it sounds
// helpful.
//
// ── THE TWO PLACES A FULL-CARD LINE SET IS NOT A BAND ───────────────────────
//
// `fields.ts`'s rules were written for two narrow bands and two of them do not
// survive contact with an undifferentiated 25-line card. Both were MEASURED
// here, by replaying the 21 recorded `paddle-full` line sets through the shipped
// extractor, and both are corrected below rather than by loosening `fields.ts`:
//
//  1. **THE NAME.** "Most letters left after the furniture" picks the card title
//     out of a 2-3 line title band. Over a whole card it picks the LONGEST LINE
//     OF ATTACK TEXT, every single time — 21 of 21 recorded rows produced a name
//     like "Discard the top 7 cards of your deck and this attack does". That is
//     not a degraded name, it is a WRONG one, and `fields.ts`'s header is built
//     around the pipeline not producing those. So name candidates here are
//     filtered by WHERE THE LINE SAT: `ROIS.name`, the same band the shipped
//     recipe crops to, applied after detection instead of before it.
//
//  2. **THE BADGE FALLBACK.** With no number line, `extractFields` falls back to
//     the first strip line as the badge source. Over a band that is the
//     illustrator line; over a whole card it is the card's TOP line, and on
//     `m03_t43s_B2-225` it resolved flavour text to `ASC` — which is REPORT.md
//     §1's "badge WRONG 1" for this config, reproduced exactly. A badge without
//     a number serves no rung anyway (CROSSWALK §7.3 rung 1 is badge+number), so
//     it is dropped rather than sent.
//
// Replaying all 21 with both corrections in place: 20 numbers, 20 denominators,
// 14 vocabulary-resolved badges, and **zero wrong reads of any of them** — the
// same error shape as the shipped recipe, which is the only condition on which
// this rung was allowed to exist. (`__tests__/escalate.test.ts` is that replay,
// against the recorded lines verbatim.)
//
// ── AND WHEN EVEN THAT READS NOTHING: `bodyLines` ───────────────────────────
//
// The last thing left is the card's PROSE — its ability name, its attack text,
// its flavour line. That identifies a print to a human instantly and it
// identifies one to a full-text index too, so the surviving lines are handed to
// the API's family-text rung as evidence rather than as a claim. See
// `normaliseBodyLines`.

import { extractFields, type OcrFields } from './fields'
import { ROIS } from './rois'

/**
 * One recognised line of a full-card read, with WHERE IT SAT.
 *
 * `y` is the line's midline as a fraction of the card crop's height — 0 at the
 * top edge, 1 at the bottom. The recogniser already computes it (`db.ts`
 * `groupIntoLines` returns `y` and sorts by it); the two ROI passes throw it
 * away because a band has already done the positional filtering for them, and
 * this rung has no band, so it keeps it.
 */
export interface PlacedLine {
  text: string
  y: number
}

/**
 * Did the shipped two-pass recipe come back with nothing to go on?
 *
 * NAME AND NUMBER, both null — the owner's ruling, exactly. Not "no setCode"
 * and not "no denominator": a read carrying a number goes down the ordinary
 * ladder (rung 3 alone resolves 21/21 crops to a candidate set), and a read
 * carrying a name still has rung 4. This is the state where the resolve call
 * would have nothing but the phash priors to offer, i.e. where escalating costs
 * a pass and risks nothing.
 */
export function shouldEscalate(fields: OcrFields): boolean {
  return fields.name === null && fields.number === null
}

/**
 * Re-extract the product fields from a whole-card line set, using THE SAME
 * RULES — see this file's header for the two that need the geometry.
 *
 * This is the toploader rescue and it is deliberately tried BEFORE anything new
 * is put on the wire: if the number is sitting in the crop after all, the ordinary
 * resolve flow takes it from here and the server never learns this rung ran.
 */
export function extractFullCropFields(lines: readonly PlacedLine[]): OcrFields {
  // The title band, applied as a filter rather than as a crop. `ROIS.name` is
  // y 0.0-0.2 and `derive-roi.mjs` measured every real name line's midline
  // between 0.045 and 0.148, so this is the measured band with its measured
  // margin — NOT a wider one chosen to catch an inset card. A title that has
  // been pushed below 0.2 by the sleeve reads as no name at all, which is the
  // right failure: the number carries the rescue when it is there, and when it
  // is not, the title travels in `bodyLines` as text instead of as a claim.
  const named = lines.filter((l) => l.y >= ROIS.name.y0 && l.y < ROIS.name.y1).map((l) => l.text)
  const all = lines.map((l) => l.text)
  const fields = extractFields([
    { roi: 'name', lines: named },
    { roi: 'strip', lines: all },
  ])
  // Rule 2 of the header: no number, no badge. `number` and `denominator` are
  // set together by `NUMBER_PAIR`, so this one test covers the pair.
  return fields.number ? fields : { ...fields, setCode: null }
}

// ───────────────────────────────────────────────────────────── body lines ──

/** At most this many lines go on the wire. The 21 recorded full-crop reads
 *  produced between 4 and 16 lines each, so this is headroom rather than a
 *  budget — it is here because the endpoint takes whatever it is handed and a
 *  wedged recogniser emitting hundreds of fragments must not become a megabyte
 *  of JSON. FIRST 24 in reading order: the top of the card is the ability and
 *  attack text, which is what identifies a print. */
export const MAX_BODY_LINES = 24

/** And at most this many characters each. The longest line in those 21 reads is
 *  65 characters; a card's printed lines do not get longer than this, so
 *  anything past it is two lines the grouper glued together. */
export const MAX_BODY_LINE_CHARS = 80

/** Fewer letters than this is not a phrase. Catches `4x2`, `90`, `TAG`, the
 *  rarity glyph, and every pure-digit line — the spec's "pure digits ≤ 3 chars"
 *  is a strict subset, because a line of digits has no letters at any length. */
const MIN_LETTERS = 4

/**
 * ENERGY-SYMBOL SOUP, measured as a RATIO rather than matched against a glyph
 * list. The recogniser returns the type symbols as CJK, stars, box-drawing and
 * asterisks and the set of things it has returned for them is open-ended, so
 * enumerating them is a losing game. What the soup lines have in common is that
 * there is barely a word in them.
 *
 * Measured on the recorded full-crop reads (note that a CJK energy glyph is a
 * `\p{L}` and counts as a letter, which is why this number is lower than it
 * looks like it should be):
 *
 *   线057/182                            0.13   dropped
 *   *水水                                0.67   dropped by MIN_LETTERS
 *   4x2 retreat ***水                    0.64   KEPT
 *   * Waterfall 120                      0.69   kept
 *   weaknessx2 resistance retreat ****   0.84   kept
 *   Discard the top 7 cards of your…     0.93   kept
 *
 * The line this threshold draws is "has words in it", not "is worth reading":
 * the retreat row survives, and that is the right call for a payload whose whole
 * contract is that the SERVER decides what the lines mean. Raising the bar far
 * enough to catch it also catches `* Waterfall 120`, which is an attack name and
 * is exactly the kind of phrase a family-text rung matches on.
 */
const MIN_LETTER_RATIO = 0.6

/**
 * The surviving prose of a card whose printed key could not be read — the
 * payload of the last rung, and the only thing in this lane that puts free text
 * on the wire.
 *
 * NORMALISED, NOT INTERPRETED. Whitespace is collapsed, obvious furniture is
 * dropped and the result is capped; nothing is spell-corrected, reordered or
 * matched against anything. The judgement about what these lines mean belongs to
 * the API's family-text rung, which has the catalogue; all this side is allowed
 * to decide is which lines are text at all.
 */
export function normaliseBodyLines(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of lines) {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t) continue
    const letters = (t.match(/\p{L}/gu) ?? []).length
    if (letters < MIN_LETTERS) continue
    const ink = t.replace(/\s/g, '').length
    if (ink === 0 || letters / ink < MIN_LETTER_RATIO) continue
    out.push(t.length > MAX_BODY_LINE_CHARS ? t.slice(0, MAX_BODY_LINE_CHARS) : t)
    if (out.length === MAX_BODY_LINES) break
  }
  return out
}
