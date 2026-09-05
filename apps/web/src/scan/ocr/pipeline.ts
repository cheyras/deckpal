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

/** The product contract. `ms` is wall-clock for the whole read — both passes,
 *  detection and recognition — measured by the caller of `readFields`. */
export interface OcrRead extends OcrFields {
  ms: number
}

/** What one ROI raster is, once `capture.cropRois` has produced it. Kept
 *  structural (not importing the DOM-touching module) so the pipeline stays
 *  replayable off a Node harness. */
export interface RoiInput {
  roi: RoiName
  raster: Raster
}

/**
 * Run detection + recognition over one prepared ROI raster and return its lines
 * in reading order, grouped the way the extractor expects (see
 * `db.groupIntoLines` for why the grouping is not cosmetic).
 */
export async function readRoi(session: OcrSession, input: RoiInput): Promise<string[]> {
  const { raster } = input
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
  return groupIntoLines(recognised).map((l) => l.text)
}

/**
 * The whole read: both ROIs through the model, then the field extractor.
 *
 * Passes run SEQUENTIALLY on purpose. They are two inferences on one WASM
 * runtime with `numThreads` clamped to 1 (no COOP/COEP headers, so ORT never
 * starts a worker pool — `model.ts`'s header), so issuing them concurrently
 * would interleave in the proxy worker's queue for no throughput and would make
 * a slow phone's memory high-water mark the sum of both rather than the max.
 */
export async function readFields(session: OcrSession, inputs: readonly RoiInput[]): Promise<OcrRead> {
  const t0 = performance.now()
  const reads: RoiRead[] = []
  for (const input of inputs) {
    reads.push({ roi: input.roi, lines: await readRoi(session, input) })
  }
  return { ...extractFields(reads), ms: performance.now() - t0 }
}
