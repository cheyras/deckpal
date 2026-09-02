// Frame -> model input, and the exact way back.
//
// THIS PREPROCESSING IS LOAD-BEARING. DocAligner LC050 is a zero-training
// checkpoint: it is only as good as the tensor it is handed, and the phase-0b
// session-1 failure was nothing but a mismatched tensor (ImageNet mean/std
// normalisation instead of a plain /255) which saturated has_obj to ~1.0 and
// produced incoherent quads — read on-device as "the model is awful" when the
// model was never actually being fed. Forensics: p2-work/phase0b/session1/
// TRIAGE.md. The authoritative reference is phase0a/run_docaligner.py:174
// (`/255` only, NO mean/std) with BGR channel order (run_docaligner.py:17-18).
//
// TWO deliberate differences from the probe (dev-assets/probe/probe.html),
// both required by DECISIONS.md 2026-09-02:
//
//   1. RETICLE CROP. The probe fed the whole frame. We crop to the reticle
//      first. PHASE0-CLOSEOUT §3.4 item 2: "the reticle crop is not cosmetic —
//      it is the fix for 6 of 14 failures" (4 multi-instance unions + 2
//      adjacent-object merges are deleted by construction, because the
//      competing object is no longer in the model's input at all).
//
//   2. LETTERBOX, not stretch. Phase 0a §7.1 measured +6.5 pp for LC050
//      (68.9 -> 75.4) from aspect-preserving letterbox versus the prescribed
//      stretch. The probe used the stretch, and its overlay mapping relied on
//      "a normalized fraction in model space is numerically identical to the
//      normalized fraction in video space" (probe.html:626-636). That
//      reasoning holds ONLY for a full-frame stretch and is now void: the
//      mapping back is an explicit transform, which is what
//      LetterboxTransform is and why every consumer takes one.
//
// The whole module is pure and DOM-free except drawLetterbox(), which is the
// one canvas call the browser path needs.

import type { Quad } from './contract'
import type { ImageDataLike, Point, Rect } from './geometry'

/** LC050 takes 1x3x256x256 NCHW float32 (input name `img`). */
export const MODEL_SIZE = 256

/** Letterbox padding. Mid-gray, not black: a black bar is a maximal-contrast
 *  artificial edge running the full height of the input, exactly the kind of
 *  straight high-gradient boundary a boundary model is trained to like. */
export const PAD_VALUE = 128

/** Everything needed to map model output back to frame pixels, exactly.
 *  model px = norm * size; crop px = (model px - pad) / scale; frame px =
 *  crop px + crop origin. */
export interface LetterboxTransform {
  /** The reticle crop in FRAME pixels (integer-aligned, clamped to the frame). */
  crop: Rect
  /** Model input side (square). */
  size: number
  /** Frame px -> model px. Uniform on both axes: that is the whole point. */
  scale: number
  /** Model-space offset of the crop's left/top edge (half the bar width). */
  padX: number
  padY: number
}

function clampInt(v: number, lo: number, hi: number): number {
  const r = Math.round(v)
  return r < lo ? lo : r > hi ? hi : r
}

/**
 * Geometry only — no pixels touched. `reticle` is in FRACTIONS of the frame
 * (the shape EngineState.reticle carries); the returned crop is in frame px.
 */
export function computeLetterbox(
  frameW: number,
  frameH: number,
  reticle: Rect,
  size = MODEL_SIZE,
): LetterboxTransform {
  const x = clampInt(reticle.x * frameW, 0, Math.max(0, frameW - 1))
  const y = clampInt(reticle.y * frameH, 0, Math.max(0, frameH - 1))
  const w = Math.max(1, Math.min(clampInt(reticle.w * frameW, 1, frameW), frameW - x))
  const h = Math.max(1, Math.min(clampInt(reticle.h * frameH, 1, frameH), frameH - y))
  const scale = Math.min(size / w, size / h)
  return {
    crop: { x, y, w, h },
    size,
    scale,
    padX: (size - w * scale) / 2,
    padY: (size - h * scale) / 2,
  }
}

/** Normalised model-space [0,1] -> frame pixels. LC050's `points` output is
 *  normalised, not absolute (probe.html:540-543, verified empirically). */
export function modelNormToFrame(t: LetterboxTransform, nx: number, ny: number): Point {
  return [
    (nx * t.size - t.padX) / t.scale + t.crop.x,
    (ny * t.size - t.padY) / t.scale + t.crop.y,
  ]
}

/** Frame pixels -> normalised model space [0,1]. Exact inverse of the above. */
export function frameToModelNorm(t: LetterboxTransform, fx: number, fy: number): Point {
  return [
    ((fx - t.crop.x) * t.scale + t.padX) / t.size,
    ((fy - t.crop.y) * t.scale + t.padY) / t.size,
  ]
}

/** LC050's flat `points` output ([x0,y0,x1,y1,x2,y2,x3,y3], normalised) as a
 *  quad in frame pixels. */
export function modelPointsToQuad(t: LetterboxTransform, points: ArrayLike<number>): Quad | null {
  if (points.length < 8) return null
  const q: Point[] = []
  for (let i = 0; i < 4; i++) {
    const p = modelNormToFrame(t, points[i * 2], points[i * 2 + 1])
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
    q.push(p)
  }
  return [q[0], q[1], q[2], q[3]]
}

/**
 * The pure reference letterbox: crop + uniform scale + mid-gray pad, by
 * nearest-neighbour, into a fresh RGBA buffer. The browser path uses
 * drawLetterbox() below instead (drawImage is smoothed and hardware-assisted),
 * but both are defined by the SAME LetterboxTransform, so what the tests pin
 * down here — padding value, pad placement, and the coordinate mapping — is
 * exactly what ships.
 */
export function letterboxRGBA(src: ImageDataLike, t: LetterboxTransform): ImageDataLike {
  const size = t.size
  const out = new Uint8ClampedArray(size * size * 4)
  const { x: cx, y: cy, w: cw, h: ch } = t.crop
  for (let oy = 0; oy < size; oy++) {
    // pixel CENTRE convention: output pixel oy covers model-space [oy, oy+1)
    const sy = (oy + 0.5 - t.padY) / t.scale + cy
    const iy = Math.floor(sy)
    const rowInside = iy >= cy && iy < cy + ch && iy >= 0 && iy < src.height
    for (let ox = 0; ox < size; ox++) {
      const o = (oy * size + ox) * 4
      const sx = (ox + 0.5 - t.padX) / t.scale + cx
      const ix = Math.floor(sx)
      if (!rowInside || ix < cx || ix >= cx + cw || ix < 0 || ix >= src.width) {
        out[o] = PAD_VALUE
        out[o + 1] = PAD_VALUE
        out[o + 2] = PAD_VALUE
        out[o + 3] = 255
        continue
      }
      const s = (iy * src.width + ix) * 4
      out[o] = src.data[s]
      out[o + 1] = src.data[s + 1]
      out[o + 2] = src.data[s + 2]
      out[o + 3] = 255
    }
  }
  return { width: size, height: size, data: out }
}

/**
 * RGBA -> the NCHW float32 LC050 wants: BGR planar, /255, no mean/std.
 *
 * Canvas ImageData is always RGBA, so bytes 0/1/2 are R/G/B in that order —
 * the swap to BGR is the o+2 / o+1 / o read order below, not a re-labelling.
 *
 * ALWAYS returns a FRESH Float32Array. With ort.env.wasm.proxy = true ORT
 * transfers the tensor's backing ArrayBuffer to the proxy worker as a
 * transferable, which DETACHES it on this thread; reusing one pre-allocated
 * buffer throws `DataCloneError: ... An ArrayBuffer is detached and could not
 * be cloned` on the second run() (probe.html:500-507, verified in a live
 * browser, not read from docs). Do not "optimise" this into a scratch buffer.
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

/**
 * Browser path: paint the reticle crop, letterboxed, into a size x size 2D
 * context. Fills the whole canvas with mid-gray first so the bars carry
 * PAD_VALUE, then draws the crop into the inner box the transform describes.
 */
export function drawLetterbox(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  t: LetterboxTransform,
): void {
  ctx.fillStyle = `rgb(${PAD_VALUE},${PAD_VALUE},${PAD_VALUE})`
  ctx.fillRect(0, 0, t.size, t.size)
  ctx.drawImage(
    source,
    t.crop.x,
    t.crop.y,
    t.crop.w,
    t.crop.h,
    t.padX,
    t.padY,
    t.crop.w * t.scale,
    t.crop.h * t.scale,
  )
}
