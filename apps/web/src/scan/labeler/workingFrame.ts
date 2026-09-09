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
  /** How much of the square is mirrored padding rather than photograph. All
   *  zero for every camera frame and for any upload cropped wholly inside. */
  pad: CropPad
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

/**
 * How far the chosen square hangs off each edge of the photo, in SOURCE pixels.
 * All zero when the crop sits wholly inside — which is every camera frame and
 * most uploads.
 */
export interface CropPad {
  left: number
  top: number
  right: number
  bottom: number
}

/** Was anything padded at all? The cheap test every caller wants. */
export function isPadded(pad: CropPad): boolean {
  return pad.left > 0 || pad.top > 0 || pad.right > 0 || pad.bottom > 0
}

/**
 * The MINIMUM share of each axis that must be real photograph.
 *
 * Not a taste judgement. A mirror pad reflects the real content outward, so a
 * gap wider than the content it reflects has nothing left to copy and would
 * have to smear an edge pixel instead. Half keeps every reflection fully
 * sourced, and it is well past what the request needs: pushing the square off
 * one edge to sit a card that was photographed near the border.
 */
export const MIN_REAL_FRACTION = 0.5

/** Where the square overhangs, given a crop that is allowed to. */
export function cropPad(crop: SquareCrop, sourceWidth: number, sourceHeight: number): CropPad {
  return {
    left: Math.max(0, -crop.x),
    top: Math.max(0, -crop.y),
    right: Math.max(0, crop.x + crop.size - sourceWidth),
    bottom: Math.max(0, crop.y + crop.size - sourceHeight),
  }
}

/**
 * Clamp a crop that is ALLOWED to overhang — the 2026-09-08 ruling that a card
 * photographed near the edge of a frame must still be positionable.
 *
 * Unlike `clampCrop` this does not pull the square back inside. It keeps the
 * square from exceeding the photo's LONGER edge (past that, both axes are
 * mostly padding and the frame stops being a photograph of anything), and keeps
 * at least `MIN_REAL_FRACTION` of each axis over real pixels so the mirror
 * always has something to mirror.
 */
export function clampCropAllowingPad(crop: SquareCrop, sourceWidth: number, sourceHeight: number): SquareCrop {
  const maxSize = Math.max(1, Math.max(sourceWidth | 0, sourceHeight | 0))
  const size = Math.max(1, Math.min(Math.round(crop.size), maxSize))
  const keepX = Math.min(size * MIN_REAL_FRACTION, sourceWidth)
  const keepY = Math.min(size * MIN_REAL_FRACTION, sourceHeight)
  return {
    size,
    x: Math.round(Math.min(Math.max(crop.x, -(size - keepX)), sourceWidth - keepX)),
    y: Math.round(Math.min(Math.max(crop.y, -(size - keepY)), sourceHeight - keepY)),
  }
}

/**
 * Draw `crop` into `dest`, MIRRORING the photo's own pixels into any part of
 * the square that falls outside it.
 *
 * ── WHY MIRROR, AND NOT BLACK, AND NOT GENERATED ───────────────────────────
 *
 * Black was the old honest failure, and `clampCrop` existed to prevent it: a
 * black rectangle is a region no camera produces, the reader cannot label it,
 * and in the corpus it is indistinguishable from a genuinely dark card edge.
 *
 * Reflection fixes the appearance WITHOUT inventing content. Every padded pixel
 * is a real pixel of this photograph, mirrored — the `reflect` border mode every
 * vision toolkit ships, for this exact reason. It is deterministic (the same
 * photo and crop produce the same square forever, which a generative fill is
 * not), costs nothing, needs no network, and introduces no new distribution:
 * the texture on both sides of the seam is the same texture.
 *
 * The pad is recorded on the row (`pipeline.pad`), so a harvest can always find
 * these frames whatever it later decides to do with them.
 *
 * ── HOW ────────────────────────────────────────────────────────────────────
 *
 * The real intersection is drawn once. Then the destination reflects outward
 * from it: top and bottom first, across the real content's own columns, then
 * left and right across the FULL height — which fills the four corner gaps as a
 * side effect, because by then those columns already carry their own vertical
 * padding.
 */
function drawSquarePadded(
  src: CanvasImageSource,
  crop: SquareCrop,
  dest: HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
): void {
  const ctx = dest.getContext('2d')
  if (!ctx) throw new Error('this browser could not prepare the working frame')
  const S = dest.width
  const scale = S / crop.size

  // The part of the crop that is real photograph, in source pixels...
  const ix0 = Math.max(crop.x, 0)
  const iy0 = Math.max(crop.y, 0)
  const ix1 = Math.min(crop.x + crop.size, sourceWidth)
  const iy1 = Math.min(crop.y + crop.size, sourceHeight)
  if (ix1 <= ix0 || iy1 <= iy0) {
    // No overlap at all. Nothing to mirror, so refuse rather than emit a blank
    // square that would enter the corpus looking like a photograph of nothing.
    throw new Error('the crop does not overlap the photo')
  }
  // ...and where it lands in the destination square.
  const dx = (ix0 - crop.x) * scale
  const dy = (iy0 - crop.y) * scale
  const dw = (ix1 - ix0) * scale
  const dh = (iy1 - iy0) * scale

  ctx.clearRect(0, 0, S, S)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, ix0, iy0, ix1 - ix0, iy1 - iy0, dx, dy, dw, dh)

  /** Reflect a rect of `dest` back into `dest`, flipped. Reading the canvas it
   *  is writing is deliberate: the real content is already there, and after the
   *  vertical pass the columns carry their padding too, which is what fills the
   *  corners without four more draws. */
  const reflect = (
    sxr: number,
    syr: number,
    swr: number,
    shr: number,
    tx: number,
    ty: number,
    flipX: boolean,
    flipY: boolean,
  ) => {
    if (swr <= 0 || shr <= 0) return
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
    ctx.drawImage(dest, sxr, syr, swr, shr, 0, 0, swr, shr)
    ctx.restore()
  }

  // TOP / BOTTOM, over the real content's columns only.
  if (dy > 0) {
    const h = Math.min(dy, dh)
    reflect(dx, dy, dw, h, dx, dy, false, true)
  }
  const belowY = dy + dh
  if (belowY < S) {
    const h = Math.min(S - belowY, dh)
    reflect(dx, belowY - h, dw, h, dx, belowY + h, false, true)
  }

  // LEFT / RIGHT, over the FULL height — the columns are padded by now, so the
  // corners come out of this pass.
  if (dx > 0) {
    const w = Math.min(dx, dw)
    reflect(dx, 0, w, S, dx, 0, true, false)
  }
  const rightX = dx + dw
  if (rightX < S) {
    const w = Math.min(S - rightX, dw)
    reflect(rightX - w, 0, w, S, rightX + w, 0, true, false)
  }
}

/**
 * Clamp an arbitrary square to lie wholly inside a source image, and to be at
 * least one pixel. A crop that hangs off the edge would draw transparent black
 * into the canonical frame — a region the detector has never seen in training
 * and the reader cannot label, so it is refused here rather than explained
 * later.
 */
export function clampCrop(crop: SquareCrop, sourceWidth: number, sourceHeight: number): SquareCrop {
  const bound = Math.max(1, Math.min(sourceWidth | 0, sourceHeight | 0))
  const size = Math.max(1, Math.min(Math.round(crop.size), bound))
  return {
    size,
    x: Math.round(Math.min(Math.max(crop.x, 0), Math.max(0, sourceWidth - size))),
    y: Math.round(Math.min(Math.max(crop.y, 0), Math.max(0, sourceHeight - size))),
  }
}

/**
 * Build a `WorkingFrame` from a live video frame or a decoded upload —
 * identical draw path either way, which is the whole point: by the time this
 * returns, nothing downstream can tell which mode produced it.
 *
 * ── `crop` IS FOR UPLOADS ONLY (owner request, 2026-09-08) ─────────────────
 *
 * Omit it and the centre square is used, which is what the LIVE path must
 * always do: `EngineState.frame`'s working-frame invariant makes the canonical
 * frame a pure function of the camera stream, and a camera frame the reader
 * could re-aim after the fact would break the one guarantee that lets a label
 * and a runtime detection describe the same square.
 *
 * An upload has no such constraint — the photo is already taken, its framing is
 * whatever it is, and forcing the centre square threw away every card that
 * happened to sit off-centre. So upload mode passes a chosen square, and
 * `QuadLabelBase.crop` (already recorded on every row since the schema was
 * written) is what tells a harvest which one it was.
 */
export function buildWorkingFrame(
  src: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  chosen?: SquareCrop,
): WorkingFrame {
  // THE LIVE PATH IS UNTOUCHED. No `chosen` means the centre square, wholly
  // inside the stream, `pad` all zero — the working-frame invariant holds
  // exactly as before and a camera frame can never be padded.
  const crop = chosen
    ? clampCropAllowingPad(chosen, sourceWidth, sourceHeight)
    : squareCrop(sourceWidth, sourceHeight)
  const pad = cropPad(crop, sourceWidth, sourceHeight)
  const canonical = makeCanvas(CANONICAL_SIZE)
  const refSize = Math.max(1, Math.min(crop.size, MAX_REFERENCE_SIZE))
  const reference = makeCanvas(refSize)
  if (isPadded(pad)) {
    // Both canvases take the SAME mirrored fill. They must: `reference` is what
    // the editor displays and what the loupe samples, so a padded region that
    // looked different between the two would have the reader placing corners
    // against pixels the saved frame does not contain.
    drawSquarePadded(src, crop, canonical, sourceWidth, sourceHeight)
    drawSquarePadded(src, crop, reference, sourceWidth, sourceHeight)
  } else {
    drawSquare(src, crop, canonical)
    drawSquare(src, crop, reference)
  }
  return { canonical, reference, crop, sourceWidth, sourceHeight, pad }
}

/**
 * A standalone padded square, for the crop stage's live preview.
 *
 * Same `drawSquarePadded` the working frame uses — the preview must be the
 * thing itself, not a second renderer that could disagree with it, because the
 * whole point is deciding a crop by looking at the result.
 */
export function buildPaddedPreview(
  src: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop: SquareCrop,
  size: number,
): HTMLCanvasElement {
  const out = makeCanvas(Math.max(1, Math.round(size)))
  drawSquarePadded(src, crop, out, sourceWidth, sourceHeight)
  return out
}
