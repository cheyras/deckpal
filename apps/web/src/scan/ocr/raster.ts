// Pixel arithmetic for the OCR lane: resample, warp, and the two tensor
// layouts the models want. DOM-free on purpose — every function here takes and
// returns plain buffers, which is what lets the whole pipeline be replayed off
// a Node harness against the recorded bakeoff crops rather than only inside a
// browser. The one canvas call the browser path needs lives in `capture.ts`.

import type { ImageDataLike } from '../engine/geometry'

/** A writable RGBA buffer. `ImageDataLike` is read-only, which is the right
 *  shape for an input and the wrong one for a scratch surface. */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function makeRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/**
 * Resample RGBA to an arbitrary size: BOX AVERAGE when shrinking on an axis,
 * BILINEAR when growing.
 *
 * Both halves are load-bearing and they are not interchangeable. The recogniser
 * is fed line images resized to 48 px tall, and a detected line off a 3×-upscaled
 * band is routinely 90-140 px tall — a 2-3× REDUCTION. Point-sampling or plain
 * bilinear on a reduction that large aliases the strokes of 12 px type into
 * noise, which is the one input this model has no defence against. Averaging
 * every source pixel that falls inside the destination footprint is what a
 * "high quality" image resize means, and it is ~15 lines.
 */
export function resample(src: ImageDataLike, dw: number, dh: number): Raster {
  const out = makeRaster(Math.max(1, dw), Math.max(1, dh))
  const sx = src.width / out.width
  const sy = src.height / out.height
  const shrinkX = sx > 1
  const shrinkY = sy > 1
  for (let y = 0; y < out.height; y++) {
    // Source rows this destination row covers. When growing, y0..y1 collapses to
    // one row and the bilinear branch below takes over.
    const fy0 = y * sy
    const fy1 = (y + 1) * sy
    for (let x = 0; x < out.width; x++) {
      const fx0 = x * sx
      const fx1 = (x + 1) * sx
      const o = (y * out.width + x) * 4
      if (shrinkX || shrinkY) {
        const x0 = Math.max(0, Math.floor(fx0))
        const x1 = Math.min(src.width, Math.max(x0 + 1, Math.ceil(fx1)))
        const y0 = Math.max(0, Math.floor(fy0))
        const y1 = Math.min(src.height, Math.max(y0 + 1, Math.ceil(fy1)))
        let r = 0, g = 0, b = 0, n = 0
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const s = (yy * src.width + xx) * 4
            r += src.data[s]
            g += src.data[s + 1]
            b += src.data[s + 2]
            n++
          }
        }
        out.data[o] = r / n
        out.data[o + 1] = g / n
        out.data[o + 2] = b / n
      } else {
        bilinearInto(src, (fx0 + fx1) / 2 - 0.5, (fy0 + fy1) / 2 - 0.5, out.data, o)
      }
      out.data[o + 3] = 255
    }
  }
  return out
}

/** Bilinear sample at a continuous source coordinate, clamped at the edges,
 *  written straight into `dst` at byte offset `o`. Edge clamp rather than a
 *  transparent border: a black border on a text crop is an artificial maximal
 *  -contrast edge, exactly what the detector is trained to find. */
function bilinearInto(
  src: ImageDataLike,
  fx: number,
  fy: number,
  dst: Uint8ClampedArray,
  o: number,
): void {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const xa = clampInt(x0, 0, src.width - 1)
  const xb = clampInt(x0 + 1, 0, src.width - 1)
  const ya = clampInt(y0, 0, src.height - 1)
  const yb = clampInt(y0 + 1, 0, src.height - 1)
  const p00 = (ya * src.width + xa) * 4
  const p10 = (ya * src.width + xb) * 4
  const p01 = (yb * src.width + xa) * 4
  const p11 = (yb * src.width + xb) * 4
  for (let c = 0; c < 3; c++) {
    const top = src.data[p00 + c] * (1 - tx) + src.data[p10 + c] * tx
    const bot = src.data[p01 + c] * (1 - tx) + src.data[p11 + c] * tx
    dst[o + c] = top * (1 - ty) + bot * ty
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export type Point = readonly [number, number]
/** Four corners, clockwise from top-left, in the source image's pixels. */
export type Box = readonly [Point, Point, Point, Point]

/**
 * Lift a detected quadrilateral out of the source image as an upright rectangle
 * — PaddleOCR's `get_rotate_crop_image`, which is what the recogniser expects to
 * be handed.
 *
 * The upstream implementation calls `cv.getPerspectiveTransform` +
 * `cv.warpPerspective`; this solves the same 8-parameter homography directly
 * (destination → source, so every output pixel is sampled exactly once) and
 * samples bilinearly. On a rectified card crop the detected boxes are nearly
 * axis-aligned, so this is usually within rounding of a plain sub-rectangle
 * copy — but "usually" is not "always", and a box that IS tilted (a card
 * photographed under residual perspective, which REPORT.md §2.3 names as one of
 * the two causes of the real-vs-pristine accuracy gap) is exactly the case where
 * feeding the recogniser a sheared line matters.
 */
export function cropRotated(src: ImageDataLike, box: Box): Raster {
  const w = Math.max(1, Math.trunc(Math.max(dist(box[0], box[1]), dist(box[2], box[3]))))
  const h = Math.max(1, Math.trunc(Math.max(dist(box[0], box[3]), dist(box[1], box[2]))))
  const m = homography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    box,
  )
  const out = makeRaster(w, h)
  if (!m) return out
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const d = m[6] * px + m[7] * py + 1
      const sx = (m[0] * px + m[1] * py + m[2]) / d
      const sy = (m[3] * px + m[4] * py + m[5]) / d
      bilinearInto(src, sx - 0.5, sy - 0.5, out.data, (y * w + x) * 4)
      out.data[(y * w + x) * 4 + 3] = 255
    }
  }
  return out
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/**
 * The 8 coefficients mapping `from` (4 points) to `to` (4 points), as
 * [a,b,c,d,e,f,g,h] with the projective denominator `gx+hy+1`. Straight
 * Gauss-Jordan on the 8×8; returns null if the points are degenerate, which the
 * caller reads as "hand back a blank crop" rather than as a crash.
 */
function homography(from: readonly Point[], to: Box): number[] | null {
  const a: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]
    const [u, v] = to[i]
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u])
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v, v])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (Math.abs(a[pivot][col]) < 1e-9) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const p = a[col][col]
    for (let c = col; c <= 8; c++) a[col][c] /= p
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = a[r][col]
      if (!f) continue
      for (let c = col; c <= 8; c++) a[r][c] -= f * a[col][c]
    }
  }
  return a.map((row) => row[8])
}

/**
 * RGBA → the NCHW float32 both PP-OCR models take: **BGR planar, /255, no
 * mean/std**.
 *
 * Same channel order and same absent normalisation as the detector's own
 * `preprocess.rgbaToBGRPlanar`, and for the same reason: it is what the
 * reference implementation feeds, and phase-0b's session-1 failure was nothing
 * but a mismatched tensor. `@gutenye/ocr-common`'s `ModelBase.imageToInput`
 * builds `[...B, ...G, ...R]` with `mean = [0,0,0]`, `std = [1,1,1]` and has the
 * ImageNet constants commented out with the note "omit reshapeOptions is more
 * accurate" — the 21-crop measurement is a measurement of THAT, so this must
 * stay plain.
 *
 * ALWAYS a FRESH Float32Array. `ort.env.wasm.proxy = true` transfers the backing
 * ArrayBuffer to the proxy worker as a transferable, DETACHING it on this
 * thread; a reused scratch buffer throws `DataCloneError` on the second run.
 * The detector's `preprocess.ts` carries the same warning and the same reason —
 * do not "optimise" either of them into a shared buffer.
 */
export function rgbaToBGRPlanar(img: ImageDataLike): Float32Array {
  const n = img.width * img.height
  const out = new Float32Array(3 * n)
  const d = img.data
  for (let i = 0; i < n; i++) {
    const o = i * 4
    out[i] = d[o + 2] / 255 // B -> ch0
    out[n + i] = d[o + 1] / 255 // G -> ch1
    out[2 * n + i] = d[o] / 255 // R -> ch2
  }
  return out
}
