// THE TWO REGIONS THE RECIPE READS, AND THE UPSCALE — both measured, neither
// guessed. (Plus, since 2026-10-10, a third region read only when those two
// find no number: the bottom-right `corner`, where pre-2017 cards print theirs.
// It has its own derivation and its own scales — see `CORNER_SCALES`.)
//
// ── THE BANDS WERE DERIVED FROM THE DETECTOR, NOT DRAWN BY EYE ──────────────
//
// `p2-work/ocr/bakeoff/derive-roi.mjs` ran the text detector over all 21 native
// 480×670 crops the owner's session produced and recorded the box of the line
// carrying the collector number and the box carrying the card name. Observed
// spans, as fractions of the crop (REPORT.md §3.3):
//
//   number line   y0 0.855 .. 0.957   y1 0.894 .. 0.987   x0 0.033 .. 0.179
//   name line     y0 0.007 .. 0.133   y1 0.082 .. 0.163   x0 0.102 .. 0.252
//
// The ~10 % vertical spread is real quad error plus `rectify.ts`'s 5 %
// CAPTURE_MARGIN moving with it. That is why a tight single-line ROI is the
// WRONG SHAPE: a band covering the whole observed range, letting the
// recogniser's own line segmentation find the line inside it, is more robust and
// costs nothing (REPORT.md §3.3).
//
// ── THESE ARE FRACTIONS OF THE RECTIFIED CROP, NOT OF THE CARD ──────────────
//
// `rectify.ts` expands the quad by CAPTURE_MARGIN = 0.05 per side before
// warping, so the card occupies the middle ~90.9 % of the 480×670 output and
// every card-relative landmark is pulled ~4.5 % toward the centre. The bands
// below already absorb that. **If CAPTURE_MARGIN or CARD_RECT_WIDTH changes,
// they must be re-derived** — re-run `derive-roi.mjs` against fresh crops
// rather than nudging the numbers here.

/** A rectangle in fractions of the rectified crop. `x1`/`y1` are exclusive
 *  edges, so `{x0:0,x1:1}` is the whole width. */
export interface Roi {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The two passes of the shipped recipe (REPORT.md §3.4).
 *
 * `number` and `badge` exist in the bakeoff's ROI table too and are deliberately
 * NOT here: the configs that read them separately (`paddle-roi-split`,
 * `paddle-best`) bought +14 pp of raw badge for +272 ms, and the extra badge
 * reads changed no field that reaches the product because rung 4 already covers
 * those crops (REPORT.md §1.1). Two passes is the recommendation.
 */
export const ROIS = {
  /** Title + HP + stage badge. Basic cards start the name further left than
   *  Stage 1/2 (which carry an evolution circle), so x is generous. */
  name: { x0: 0.02, y0: 0.0, x1: 0.99, y1: 0.2 } satisfies Roi,
  /** The whole bottom info block: illustrator line, regulation mark, set badge,
   *  NNN/NNN, rarity glyph, copyright. Stops at 0.62 of the width because
   *  everything right of that is flavour text and the ©-line's tail, which the
   *  extractor only has to throw away again. */
  strip: { x0: 0.0, y0: 0.83, x1: 0.62, y1: 1.0 } satisfies Roi,
  /** THE BOTTOM-RIGHT CORNER — where every card printed before Sun & Moon
   *  (2017) puts its collector number: WotC's `93/102`, and the EX, DP, HGSS, BW
   *  and XY eras after it. `strip` stops at x 0.62 and never sees it. NOT one of
   *  the two shipped passes: it is read only when they found no number — see
   *  `CORNER_SCALES` and `pipeline.readFields`. */
  corner: { x0: 0.66, y0: 0.85, x1: 0.98, y1: 1.0 } satisfies Roi,
} as const

export type RoiName = keyof typeof ROIS

/**
 * THE CORNER IS READ TWICE, AT TWO SCALES, AND THE TWO READS MUST AGREE.
 *
 * ── WHY IT NEEDS ITS OWN SCALE ──────────────────────────────────────────────
 *
 * A vintage collector number is TINY: on a 480×670 crop of a card that filled
 * the frame, `93/102` is about 5 px tall — roughly half the height of the
 * modern bottom-left number the 3× recipe was measured on — and on Base Set it
 * is black on a dark grey band. At 3× the detector mostly returns nothing for
 * it; 4× and 6× each find about as many as anything tried (3-8×, two ROI
 * shapes, contrast stretch, CLAHE, ImageNet normalisation — none did better and
 * most added wrong reads).
 *
 * ── WHY TWICE, AND WHY THE GATES ────────────────────────────────────────────
 *
 * Because a wrong pair is the worst thing this lane can emit: `number +
 * denominator` is a confident rung on the server, so a misread names a card.
 * Measured on this ROI over all 147 pre-2017 card crops in the owner's
 * `quad-verify` photos (2026-10-10, `scripts/scan-bench`; right / wrong pairs):
 *
 *                                      4×       6×     both, agreeing
 *   any NNN/NNN                       11 / 2    9 / 2      8 / 1
 *   + plausibility gates              11 / 1    9 / 2      8 / 1
 *   + every digit at ≥ 0.6            9 / 0    9 / 0      8 / 0   <- shipped
 *
 * (`fields.readCornerPair` has the gates and the digit floor.) The one wrong
 * pair the two scales AGREED on (`53/147` for `56/147`) is why agreement alone
 * is not enough; the dropped digits the floor cannot see (`9/62` for `19/62`,
 * seen at 5×) are why the floor alone is not either. Two detections at two
 * scales resample the glyphs differently and mostly make different mistakes.
 *
 * Only 9 of 147 is not a typo: most of those photos are binder pages whose
 * cards are under 400 px tall in the original, where a 5 px number was 3 px
 * before it was upscaled and no OCR can read it. Of the 45 whose card was at
 * least 400 px tall, 8 read.
 *
 * ── WHAT IT COSTS ───────────────────────────────────────────────────────────
 *
 * Nothing on a card whose strip read its number. Otherwise the 4× pass: the ROI
 * is 153×100 px of the crop, a 640×416 detector input — 84 % of `strip`'s
 * 896×352. The 6× confirmation (928×608, 1.8× `strip`) runs ONLY when the 4×
 * read found a plausible pair.
 */
export const CORNER_SCALES = [4, 6] as const

/**
 * 3×, AND THAT IS THE WHOLE OF THE PREPROCESSING (REPORT.md §3.2).
 *
 * Measured at 480×670 over the 21 real crops:
 *
 *   3× upscale, nothing else            number 100 %   name 76 %   <- shipped
 *   + greyscale + contrast stretch      number  90 %   name 57 %
 *   2× instead of 3×                    number  86 %   name 52 %
 *   no ROI, no upscale                  number  95 %   name 67 %
 *
 * No greyscale, no contrast stretch, no sharpening, no binarisation, no
 * allowlist. This is the OPPOSITE of the classic Tesseract recipe, which is
 * exactly why it is written down: greyscale and contrast stretching actively
 * HURT, because the models were trained on colour photographs and flattening the
 * card's colour separation removes information they use.
 *
 * The upscale pays by feeding the DETECTOR a bigger image — the recogniser
 * rescales every line it is handed to 48 px tall regardless, so the 3× is not
 * buying the recogniser anything at all.
 */
export const ROI_SCALE = 3

/** The detector's input must be a multiple of 32 on both axes (PP-OCRv4 DB is a
 *  4-stage downsample with an 8× upsample head; a non-multiple silently changes
 *  the output stride). `ceil`, never `round`: rounding down loses a strip of the
 *  band, and losing the bottom of the strip band loses the number. */
export const DET_BASE_SIZE = 32

/** Integer pixel rectangle for `roi` inside a `w`×`h` image. Clamped to the
 *  image and never empty, so a degenerate ROI yields a 1 px box rather than a
 *  crash on a zero-sized canvas. */
export function roiPixels(
  roi: Roi,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const left = Math.max(0, Math.round(roi.x0 * w))
  const top = Math.max(0, Math.round(roi.y0 * h))
  const right = Math.min(w, Math.round(roi.x1 * w))
  const bottom = Math.min(h, Math.round(roi.y1 * h))
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }
}

/** The detector input size for a `w`×`h` upscaled ROI: each axis rounded UP to
 *  a multiple of `DET_BASE_SIZE`, never below one base tile. */
export function detInputSize(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.max(DET_BASE_SIZE, Math.ceil(w / DET_BASE_SIZE) * DET_BASE_SIZE),
    h: Math.max(DET_BASE_SIZE, Math.ceil(h / DET_BASE_SIZE) * DET_BASE_SIZE),
  }
}
