// The ONE working-frame format both capture and upload converge on — the
// core of "reuse the engine's actual modules": `squareCrop`/`CANONICAL_SIZE`
// come straight from scan/engine/frame.ts, the owner's own 2026-09-04 ruling
// ("standardize the photos/photo stream to take square photos") and the live
// pipeline's frame spec — `createScanEngine` now derives its canonical frame
// from those same two exports (PIPELINE_VERSION 3), so a label built here and a
// frame the detector sees at runtime are the same square by construction, not
// by agreement. See detectSeed.ts for the seeded-quad path.
//
// TWO CANVASES, ONE CROP. `canonical` is exactly what the detector sees —
// CANONICAL_SIZE x CANONICAL_SIZE, the frame that gets saved as the label's
// PNG and that a seeded detector quad's coordinates are already relative to.
// `reference` is the SAME square region at up to its full native resolution,
// used ONLY for on-screen sharpness (the main pan/zoom view and the corner
// loupe) — the owner asked to "pinch to zoom to get the corner pinning
// exact", and a 416px source has nothing left to zoom INTO. Corners are
// stored as fractions of the square (0..1), which is what makes the two
// canvases interchangeable for editing: a fraction means the same point on
// either one.
import { CANONICAL_SIZE, squareCrop, type SquareCrop } from '../engine/frame'

/** Caps how large `reference` gets for a big upload (a modern phone photo
 *  can be 4000px+ on a side) — plenty sharp for zooming without holding an
 *  enormous canvas in memory for no visible benefit. */
const MAX_REFERENCE_SIZE = 1600

export interface WorkingFrame {
  /** CANONICAL_SIZE x CANONICAL_SIZE — saved as the label's PNG. */
  canonical: HTMLCanvasElement
  /** The same square crop, sharp — display and loupe sampling only. */
  reference: HTMLCanvasElement
  crop: SquareCrop
  sourceWidth: number
  sourceHeight: number
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return c
}

function drawSquare(src: CanvasImageSource, crop: SquareCrop, dest: HTMLCanvasElement): void {
  const ctx = dest.getContext('2d')
  if (!ctx) throw new Error('this browser could not prepare the working frame')
  ctx.drawImage(src, crop.x, crop.y, crop.size, crop.size, 0, 0, dest.width, dest.height)
}

/** Build a `WorkingFrame` from a live video frame or a decoded upload —
 *  identical draw path either way, which is the whole point: by the time
 *  this returns, nothing downstream can tell which mode produced it. */
export function buildWorkingFrame(src: CanvasImageSource, sourceWidth: number, sourceHeight: number): WorkingFrame {
  const crop = squareCrop(sourceWidth, sourceHeight)
  const canonical = makeCanvas(CANONICAL_SIZE)
  drawSquare(src, crop, canonical)
  const refSize = Math.max(1, Math.min(crop.size, MAX_REFERENCE_SIZE))
  const reference = makeCanvas(refSize)
  drawSquare(src, crop, reference)
  return { canonical, reference, crop, sourceWidth, sourceHeight }
}
