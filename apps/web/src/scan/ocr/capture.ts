// THE ONE PART OF THE OCR LANE THAT TOUCHES THE DOM: rectified crop → the two
// upscaled ROI rasters the detector is fed.
//
// Everything downstream of here (`db.ts`, `ctc.ts`, `raster.ts`, `fields.ts`) is
// pure and takes plain buffers, which is what lets the recipe be replayed off a
// Node harness against the recorded 480×670 crops. This file is where that stops
// being possible, so it is deliberately small.

import { detInputSize, ROI_SCALE, ROIS, roiPixels, type RoiName } from './rois'
import type { FullCropInput } from './pipeline'
import { makeRaster, type Raster } from './raster'

/**
 * CANVAS RESIZE INSTEAD OF LANCZOS — measured, not assumed.
 *
 * REPORT.md §3.2's recipe is "crop → 3× lanczos3 → recogniser", and the 3× is
 * the ONLY preprocessing that pays (100 % on the number against 86 % at 2×). It
 * was measured through sharp, which has a real Lanczos-3 kernel. The browser
 * does not: `drawImage` with `imageSmoothingQuality = 'high'` is a
 * bilinear/bicubic-family filter — Skia's high-quality path is a
 * Mitchell-Netravali cubic — and there is no canvas API that asks for Lanczos.
 *
 * So the substitution was re-measured rather than waved through. The bakeoff
 * harness was re-run over the same 21 native 480×670 crops with the upscale
 * kernel as the ONLY variable (2026-09-05):
 *
 *   kernel      number   num+denom   badge vocab   badge WRONG   name   mean CER
 *   lanczos3     100 %     100 %        67 %            0        76 %    0.16
 *   mitchell     100 %     100 %        67 %            0        76 %    0.16
 *   cubic        100 %     100 %        67 %            0        76 %    0.16
 *   nearest       81 %      81 %        43 %          **3**      43 %    0.39
 *
 * `mitchell` is the closest stand-in for Skia's high-quality path and `cubic`
 * for a Catmull-Rom one; the lanczos3 row reproduces REPORT.md §1.1's published
 * figures exactly, which is what says the re-run is measuring the same thing.
 *
 * **Two findings, and the second is the one that mattered.**
 *
 *  1. Every smooth kernel is IDENTICAL — not close, identical, on all six
 *     columns. The upscale exists to feed the DETECTOR a bigger image (§3.2),
 *     and a detector looking for text-shaped regions cannot tell two smooth
 *     reconstruction filters apart. Canvas is free to use whatever it has.
 *  2. But the filter is not optional. Nearest-neighbour loses a fifth of the
 *     collector numbers, half the names — and produces **3 WRONG badge reads**
 *     where every smooth kernel produces zero. That is the failure mode
 *     REPORT.md §1.2 says this pipeline does not have, reintroduced by a
 *     resampling choice.
 *
 * So: canvas, with `imageSmoothingEnabled` explicitly ON and
 * `imageSmoothingQuality = 'high'` explicitly requested. Neither is a default
 * worth inheriting — a caller that sets `imageSmoothingEnabled = false`
 * somewhere upstream, or a future refactor that reuses a canvas with smoothing
 * off, lands squarely in row four.
 */
const SMOOTHING_QUALITY: ImageSmoothingQuality = 'high'

/** Contain-fit letterbox background for the pad the multiple-of-32 rounding
 *  adds. BLACK, matching the reference implementation (`ImageRaw.resize` uses
 *  sharp's `fit: 'contain'`, whose default background is transparent black and
 *  which reads as black once the alpha is dropped). It matters that this is the
 *  same colour the measurement ran with: a mid-gray pad would put a soft edge
 *  where the detector currently sees a hard one, and the pad is at most 31 px. */
const PAD = '#000'

export interface RoiRaster {
  roi: RoiName
  /** The detector's input, already at a multiple of 32 on both axes. */
  raster: Raster
}

/** A source rectangle in pixels. */
interface PixelBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * One region → one detector input: scale it, letterbox it to the multiple of
 * 32, and report where inside the padded raster the image actually landed.
 *
 * CONTAIN, not fill: the reference resizes to the multiple of 32 with sharp's
 * `fit: 'contain'`, so the region's aspect ratio is preserved and the ≤31 px of
 * slack becomes a pad. Stretching instead would shear every glyph by up to 8 %
 * on one axis, which is a change to the measured recipe made for no reason other
 * than that it is one line shorter.
 *
 * The returned `drawn` rectangle is what lets a caller turn a detected line's
 * pixel midline back into a fraction of the REGION rather than of the padded
 * raster — see `pipeline.FullCropInput`. Band callers ignore it, because a band
 * is already a positional filter.
 */
function rasterise(
  source: CanvasImageSource,
  box: PixelBox,
  scale: number,
): { raster: Raster; drawn: PixelBox } {
  const scaledW = Math.round(box.w * scale)
  const scaledH = Math.round(box.h * scale)
  const input = detInputSize(scaledW, scaledH)
  const fit = Math.min(input.w / scaledW, input.h / scaledH)
  const drawW = Math.round(scaledW * fit)
  const drawH = Math.round(scaledH * fit)
  const dx = Math.round((input.w - drawW) / 2)
  const dy = Math.round((input.h - drawH) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = input.w
  canvas.height = input.h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('this browser could not prepare the OCR crop')
  ctx.fillStyle = PAD
  ctx.fillRect(0, 0, input.w, input.h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = SMOOTHING_QUALITY
  ctx.drawImage(source, box.x, box.y, box.w, box.h, dx, dy, drawW, drawH)
  const img = ctx.getImageData(0, 0, input.w, input.h)
  const raster = makeRaster(input.w, input.h)
  raster.data.set(img.data)
  return { raster, drawn: { x: dx, y: dy, w: drawW, h: drawH } }
}

/**
 * Crop the two ROIs out of a rectified card image, upscale each by
 * `ROI_SCALE`, and letterbox to the detector's multiple-of-32 input.
 *
 * `source` is whatever the capture path already has — an `ImageBitmap` of the
 * rectified JPEG is the intended caller. Its dimensions are passed explicitly
 * rather than read off the source because `CanvasImageSource` has no common
 * width/height shape across its seven member types.
 */
export function cropRois(
  source: CanvasImageSource,
  width: number,
  height: number,
  rois: readonly RoiName[] = ['name', 'strip'],
): RoiRaster[] {
  return rois.map((roi) => ({
    roi,
    raster: rasterise(source, roiPixels(ROIS[roi], width, height), ROI_SCALE).raster,
  }))
}

/**
 * THE ESCALATION RUNG'S INPUT: the whole card, no ROI and no upscale.
 *
 * `paddle-full` from REPORT.md §1, verbatim — `{ roi: null, prep: {} }` in the
 * bakeoff's own `configs.mjs`. The upscale is deliberately absent and this is
 * the one place in the lane where that is true: §3.2's 3× exists to feed the
 * DETECTOR a bigger BAND, and the full crop is already 480×670. Tripling it
 * would be a configuration nobody measured, at nine times the detector cost,
 * on the one path that is already the slow one.
 *
 * At scale 1 the contain-fit is a no-op — `detInputSize(480, 670)` is 480×672,
 * so the card is drawn 1:1 with a single pixel of black above and below it and
 * no resampling happens at all. `drawn` carries that offset out so the caller's
 * height fractions are the card's and not the pad's.
 *
 * Called through a thunk from `readFields` and therefore NEVER on a read that
 * found a name or a number: a canvas allocation and a 480×672 `getImageData`
 * are not free, and the ruling is that the happy path pays nothing.
 */
export function cropFullCard(source: CanvasImageSource, width: number, height: number): FullCropInput {
  return rasterise(source, { x: 0, y: 0, w: width, h: height }, 1)
}
