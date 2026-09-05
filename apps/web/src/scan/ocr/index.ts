// ON-DEVICE OCR — the whole lane's public surface.
//
// PaddleOCR PP-OCRv4 mobile (Chinese det + rec) under the ORT-web session the
// scanner already loads, running the two-pass 3× ROI recipe from
// `roadmap/plans/card-scanner-redesign/p2-work/ocr/bakeoff/REPORT.md` §3.
// On the 21 real 480×670 crops the pipeline produces:
//
//   collector number      100 %      set badge (vocabulary-resolved)   67 %
//   number + denominator  100 %      card name (exact)                 76 %
//   WRONG READS OF ANY OF THEM: 0
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ───────────────────────────────
//
// It is for NARROWING a phash result that has already been asked for. §6.3:
// "OCR must not sit on the capture path" — the whole unsuppressed capture is
// 0.67 s and this is projected at 1.8-3.4 s on the owner's iPhone, so putting it
// ahead of the matcher would undo the entire latency win the scanner rebuild
// bought. The shape is: fire the capture and the existing phash query
// immediately, run this in parallel, and let the result narrow or confirm the
// candidate list when it lands.
//
// It is NOT an identifier on its own, and nothing here should grow into one.
// The API owns the resolution ladder (`apps/api/src/scan/resolve.ts`,
// CROSSWALK §7.3), because the ladder needs the catalogue.
//
// ── THE CONTRACT IS "NULL RATHER THAN WRONG" ───────────────────────────────
//
// Every field is null unless it is believed, and `fields.ts` is where that is
// enforced. One deliberate exception, stated so nobody has to discover it: the
// NAME is a ranking signal and may be approximate. See that module's header.

export { extractFields, cleanNameLine, resolveSetCode, normaliseBadge, eliminatedByDenominator, levenshtein } from './fields'
export type { OcrFields, RoiRead } from './fields'
export { PRINTED_SETS, PRINTED_DENOMINATOR, PRINTED_SET_ID } from './codes'
export type { PrintedSet } from './codes'
export { ROIS, ROI_SCALE, DET_BASE_SIZE, roiPixels, detInputSize } from './rois'
export type { Roi, RoiName } from './rois'
export { ocrEnabled, readOcrOverride, OCR_OVERRIDE_KEY } from './flag'
export type { OcrFlagInputs } from './flag'
export { loadOcrSession, resetOcrSession, ocrSessionStarted } from './session'
export type { OcrSession } from './session'
export { readFields, readRoi } from './pipeline'
export type { OcrRead, RoiInput } from './pipeline'
export { cropRois } from './capture'
export type { RoiRaster } from './capture'

import { cropRois } from './capture'
import { readFields, type OcrRead } from './pipeline'
import { loadOcrSession } from './session'

/**
 * STAGE 1 — start fetching the 15.6 MB, in the background, and never throw.
 *
 * Call this once the camera is live and the DETECTOR IS READY, not before. The
 * detector is what makes the scanner work; this is what makes it work better,
 * and a lane that competes with LC050's own 19 MB for the first seconds of a
 * scanning session would be a straight regression on time-to-first-capture.
 *
 * Failure is swallowed on purpose. A download that does not complete leaves the
 * scanner exactly as it is without this lane, which is a working scanner;
 * surfacing "OCR could not load" to a reader who never asked for OCR would be
 * noise. `readCard` below reports the failure to its own caller, where there IS
 * someone waiting on an answer.
 */
export function warmOcr(): void {
  void loadOcrSession().catch(() => {
    // Deliberately silent — see above. The next `readCard` retries, because
    // `loadOcrSession` clears its cache on rejection.
  })
}

/**
 * STAGE 2 — read one rectified card crop.
 *
 * `source` is the rectified capture (an `ImageBitmap` of the JPEG the scanner
 * already produced, 480×670 per `rectify.ts`'s `CARD_RECT_WIDTH`). The ROIs are
 * fractions of THAT crop and already absorb `CAPTURE_MARGIN`; handing this the
 * raw camera frame instead would read the ROI bands off the wrong rectangle and
 * return confident nonsense, so the argument is the rectified image or nothing.
 *
 * NEVER OCR THE 229×320 TELEMETRY CROP (REPORT.md §9.4). At that size the number
 * reads 0 % on PERFECT input and the configurations that read the most numbers
 * read most of them WRONG — it is not a degraded input, it is a hazardous one.
 */
export async function readCard(source: CanvasImageSource, width: number, height: number): Promise<OcrRead> {
  const session = await loadOcrSession()
  return readFields(session, cropRois(source, width, height))
}
