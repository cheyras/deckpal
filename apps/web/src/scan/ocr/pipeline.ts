// THE TWO-PASS RECIPE, END TO END — REPORT.md §3.4.
//
//   pass 1   name ROI    3x   ->  the card title
//   pass 2   strip ROI   3x   ->  the collector number, the denominator, and
//                                 the badge candidates
//
// Two passes and not four. `paddle-best` adds a 6× badge pass and a
// sharpened one, raises the raw badge from 33 % to 38 % and the resolved badge
// from 67 % to 81 % — and changes NOTHING that reaches the product, because
// rung 4 (number + denominator + name) already covers the crops the extra badge
// reads rescue (REPORT.md §1.1). It costs 272 ms of a budget projected at
// 1.8-3.4 s on the owner's iPhone. §6.3 is explicit that this is the second
// argument for the cheap config: at ~2-3 s the result arrives while the reader
// is still on the match sheet; at ~4-7 s it does not.

import { decodeCtc, MIN_LINE_CONFIDENCE } from './ctc'
import { detectBoxes, groupIntoLines } from './db'
import { extractFullCropFields, normaliseBodyLines, shouldEscalate } from './escalate'
import { extractFields, type OcrFields, type RoiRead } from './fields'
import { cropRotated, resample, rgbaToBGRPlanar, type Box, type Raster } from './raster'
import type { OcrSession } from './session'
import type { RoiName } from './rois'

/** The recogniser resizes every line it is given to this height. Fixed by the
 *  model, not a tuning knob: REPORT.md §2.2 traces the flat accuracy curve above
 *  480 px to exactly this — "the recogniser resizes every detected line to 48 px
 *  internally, so beyond a point extra pixels only feed the detector". */
const REC_HEIGHT = 48

/** A line image narrower than this after the 48 px resize is a glyph fragment,
 *  not a line; PP-OCRv4's rec graph has a 4× width downsample and a width under
 *  4 px produces a zero-length time axis. */
const MIN_REC_WIDTH = 8

/** Which rungs ran. `roi` is the shipped two-pass recipe and the only value the
 *  happy path can produce; `escalated` means the full-crop pass ran too, which
 *  by the 2026-09-06 ruling can only have happened after the two bands came back
 *  with no name and no number. */
export type OcrPass = 'roi' | 'escalated'

/** The product contract. `ms` is wall-clock for the whole read — every pass,
 *  detection and recognition — measured by the caller of `readFields`. */
export interface OcrRead extends OcrFields {
  ms: number
  pass: OcrPass
  /**
   * The card's own prose, for the API's family-text rung — present ONLY when the
   * escalation ran and still could not produce a name or a number.
   *
   * Absent, not empty, in every other case: a `bodyLines: []` on the wire would
   * be a claim that the card had no readable text on it, which is a different
   * statement from "we never got that far" and exactly the distinction
   * `toResolveFields` exists to preserve for the denominator.
   */
  bodyLines?: string[]
}

/** What one ROI raster is, once `capture.cropRois` has produced it. Kept
 *  structural (not importing the DOM-touching module) so the pipeline stays
 *  replayable off a Node harness. */
export interface RoiInput {
  roi: RoiName
  raster: Raster
}

/**
 * The whole card, prepared for the escalation pass — the raster the detector is
 * fed, plus WHERE THE CARD IMAGE SITS INSIDE IT.
 *
 * The second half is not bookkeeping. `escalate.ts` filters name candidates by
 * the line's height fraction, and a raster rounded up to the detector's
 * multiple-of-32 input carries up to 31 px of letterbox pad that is not card. A
 * fraction measured against the padded raster would be quietly wrong by up to
 * 4.6 % of the band's own width, so the pad is reported and divided out.
 */
export interface FullCropInput {
  raster: Raster
  drawn: { x: number; y: number; w: number; h: number }
}

/** How the escalation gets its raster — a THUNK, never a value. Preparing the
 *  full crop means a canvas draw and a `getImageData` of a 480×672 surface, and
 *  the ruling is that the happy path pays nothing: on the 21 crops the shipped
 *  recipe reads, this is never called. */
export type FullCropSource = () => FullCropInput | null

/** One recognised line, as the recogniser and the grouper leave it. */
export interface OcrLine {
  text: string
  mean: number
  /** Midline in raster pixels — see `db.groupIntoLines`. */
  y: number
}

/**
 * Run detection + recognition over one prepared raster and return its lines in
 * reading order, grouped the way the extractor expects (see `db.groupIntoLines`
 * for why the grouping is not cosmetic).
 */
export async function readLines(session: OcrSession, raster: Raster): Promise<OcrLine[]> {
  const det = await session.det.run(rgbaToBGRPlanar(raster), [1, 3, raster.height, raster.width])
  // DB's head emits [1, 1, H, W] at the input's own resolution. Read H and W
  // back off the tensor rather than assuming: an export with a different stride
  // would otherwise be silently reinterpreted as a differently-shaped image,
  // which produces boxes in the wrong place rather than an error.
  const h = det.dims[det.dims.length - 2] ?? raster.height
  const w = det.dims[det.dims.length - 1] ?? raster.width
  const boxes = detectBoxes(det.data, w, h)

  const recognised: { box: Box; text: string; mean: number }[] = []
  for (const { box } of boxes) {
    const crop = cropRotated(raster, box)
    const width = Math.max(1, Math.round((crop.width * REC_HEIGHT) / crop.height))
    if (width < MIN_REC_WIDTH) continue
    const line = resample(crop, width, REC_HEIGHT)
    const out = await session.rec.run(rgbaToBGRPlanar(line), [1, 3, REC_HEIGHT, width])
    // [1, T, C]: T timesteps over the line's width, C = 6,625 classes.
    const c = out.dims[out.dims.length - 1] ?? session.keys.length + 1
    const t = out.dims[out.dims.length - 2] ?? 0
    const decoded = decodeCtc(out.data, t, c, session.keys)
    if (!decoded.text) continue
    // The reference's own line filter, and one of the guards that make the
    // failure mode silence rather than lies.
    if (decoded.mean < MIN_LINE_CONFIDENCE) continue
    recognised.push({ box, text: decoded.text, mean: decoded.mean })
  }
  return groupIntoLines(recognised)
}

/**
 * The same read, text only — what a band pass needs, because the band has
 * already done the positional filtering the geometry would be used for.
 */
export async function readRoi(session: OcrSession, input: RoiInput): Promise<string[]> {
  return (await readLines(session, input.raster)).map((l) => l.text)
}

/**
 * The whole read: both ROIs through the model, then the field extractor — and
 * then, ONLY IF THOSE READ NOTHING, the escalation rung.
 *
 * Passes run SEQUENTIALLY on purpose. They are inferences on one WASM runtime
 * with `numThreads` clamped to 1 (no COOP/COEP headers, so ORT never starts a
 * worker pool — `model.ts`'s header), so issuing them concurrently would
 * interleave in the proxy worker's queue for no throughput and would make a slow
 * phone's memory high-water mark the sum of them rather than the max.
 *
 * ── THE ESCALATION COSTS THE HAPPY PATH NOTHING, AND THAT IS STRUCTURAL ─────
 *
 * `fullCrop` is a thunk and `shouldEscalate` is checked before it is called, so
 * a read that produced a name or a number does not prepare the crop, does not
 * run a third detection, and returns at exactly the moment it returned before.
 * That matters beyond CPU: this function's result is what gates the FIRST
 * `/scan/resolve` POST (`Scan.tsx`'s race awaits the read, then calls
 * `resolveWithOcr`), so a full-card pass that ran unconditionally would push
 * every narrowing round trip ~1-1.5 s later on the owner's iPhone — the probe
 * measures 137 ms of detection plus 38-48 ms per recognised line, and a whole
 * card is 15-25 lines. `__tests__/escalate.test.ts` asserts the thunk is never
 * touched on a read that found something.
 *
 * The escalation still runs INSIDE `OCR_NARROW_TIMEOUT_MS`, and arriving late is
 * survivable by construction: `identity.ts`'s reducer promotes a confident
 * answer whenever it lands, and the deadline only decides what the thumbnail
 * looks like while it waits.
 */
export async function readFields(
  session: OcrSession,
  inputs: readonly RoiInput[],
  fullCrop?: FullCropSource,
): Promise<OcrRead> {
  const t0 = performance.now()
  const reads: RoiRead[] = []
  for (const input of inputs) {
    reads.push({ roi: input.roi, lines: await readRoi(session, input) })
  }
  const fields = extractFields(reads)
  if (!fullCrop || !shouldEscalate(fields)) {
    return { ...fields, pass: 'roi', ms: performance.now() - t0 }
  }
  // A browser that cannot give us a canvas is not a reason to lose the read we
  // already have — `capture.ts` throws there, and the ROI answer stands.
  let full: FullCropInput | null = null
  try {
    full = fullCrop()
  } catch {
    full = null
  }
  if (!full) return { ...fields, pass: 'roi', ms: performance.now() - t0 }
  const { raster, drawn } = full

  const lines = await readLines(session, raster)
  // Pixel midlines to card-height fractions, with the letterbox divided out.
  const placed = lines.map((l) => ({ text: l.text, y: (l.y - drawn.y) / drawn.h }))
  const rescued = extractFullCropFields(placed)
  const ms = () => performance.now() - t0
  // THE RESCUE. Fields came out of the full crop after all, so the ordinary
  // resolve flow takes it from here and nothing new goes on the wire.
  if (!shouldEscalate(rescued)) return { ...rescued, pass: 'escalated', ms: ms() }
  // And the last rung: no key, but the card's prose is right there.
  const bodyLines = normaliseBodyLines(placed.map((l) => l.text))
  return bodyLines.length
    ? { ...rescued, pass: 'escalated', bodyLines, ms: ms() }
    : { ...rescued, pass: 'escalated', ms: ms() }
}
