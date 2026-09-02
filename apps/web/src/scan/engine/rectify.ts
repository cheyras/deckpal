// Tracked quad -> fronto-parallel card JPEG: the body of POST /scan.
//
// The identify stage downstream is a perceptual hash (AGENTS.md B5, api.scan
// in src/lib/api.ts), and a phash is not projection-invariant: an oblique
// photograph of a card and a scan of the same card hash differently. Every
// percentage point PHASE0-CLOSEOUT measured on corner accuracy exists to be
// spent HERE, on a warp that puts the card back in its own plane before the
// hash is taken. That is also why the capture is taken from the FULL
// RESOLUTION frame and not from the ~512 px working image the detector and
// refiner run on: detection can afford to be coarse, the hash cannot.
//
// The output is 63:88 — the card's true aspect (0.7159), which the live claim
// distribution is already centred on to three decimals (PHASE0-CLOSEOUT §2.3).
// The quad is warped INTO that aspect rather than cropped to it, so a quad
// whose aspect is slightly off is corrected instead of clipped.

import type { Quad } from './contract'
import { CARD_ASPECT_W_OVER_H, orderQuad, type ImageDataLike, type Point } from './geometry'

/** ~480 px wide, per the scan contract; the height follows from 63:88. */
export const CARD_RECT_WIDTH = 480
export const CARD_RECT_HEIGHT = Math.round(CARD_RECT_WIDTH / CARD_ASPECT_W_OVER_H) // 670

/** JPEG quality for the POSTed capture. */
export const CAPTURE_QUALITY = 0.85
export const CAPTURE_MIME = 'image/jpeg'

/** Row-major 3x3, h[8] normalised to 1. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

/** Like ImageDataLike, but pinned to a non-shared buffer so the result can be
 *  handed straight to `new ImageData(...)` without a copy. */
export interface RectifiedImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray<ArrayBuffer>
}

/**
 * The projective transform taking the four `src` points to the four `dst`
 * points, solved exactly (8 unknowns, 8 equations, h22 fixed at 1) by Gaussian
 * elimination with partial pivoting.
 *
 * Returns null for a degenerate correspondence (three collinear points), which
 * the caller must treat as "this quad cannot be rectified" rather than warping
 * with a singular matrix.
 */
export function solveHomography(src: Quad, dst: Quad): Mat3 | null {
  // Each correspondence contributes two rows:
  //   x*h0 + y*h1 + h2 - u*x*h6 - u*y*h7 = u
  //   x*h3 + y*h4 + h5 - v*x*h6 - v*y*h7 = v
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  const n = 8
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-12) return null
    if (piv !== col) {
      const tmp = A[piv]
      A[piv] = A[col]
      A[col] = tmp
    }
    const p = A[col][col]
    for (let c = col; c <= n; c++) A[col][c] /= p
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]
    }
  }
  const h = A.map((row) => row[n])
  for (const v of h) if (!Number.isFinite(v)) return null
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyHomography(H: Mat3, x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8]
  const iw = w === 0 ? 0 : 1 / w
  return [(H[0] * x + H[1] * y + H[2]) * iw, (H[3] * x + H[4] * y + H[5]) * iw]
}

/**
 * Put the quad's corners in the order the rectified canvas expects:
 * [top-left, top-right, bottom-right, bottom-left] of the CARD.
 *
 * A quad carries no "which way is up" of its own, so this is decided by shape
 * and position, in three steps:
 *   1. repair + order the corners cyclically (the OUTPUT VALIDITY GATE),
 *   2. wind them clockwise in image coordinates (y down),
 *   3. rotate so the first side is one of the two SHORT sides — the card's
 *      63 mm width — which is what makes a card presented in landscape come
 *      out portrait rather than squashed; of the two rotations that satisfy
 *      that, take the one whose first corner is highest in the frame.
 *
 * The residual 180 deg ambiguity (a card presented upside-down rectifies
 * upside-down) is not resolvable from geometry, and is left to the identify
 * stage rather than guessed at here.
 */
export function orderQuadForCard(quad: Quad): Quad | null {
  const q = orderQuad(quad)
  if (!q) return null
  // Signed area in y-down image coordinates: positive === clockwise on screen.
  let a2 = 0
  for (let i = 0; i < 4; i++) {
    const p = q[i]
    const n = q[(i + 1) % 4]
    a2 += p[0] * n[1] - n[0] * p[1]
  }
  const cw: Quad = a2 >= 0 ? q : [q[0], q[3], q[2], q[1]]
  const side = (i: number) => Math.hypot(cw[(i + 1) % 4][0] - cw[i][0], cw[(i + 1) % 4][1] - cw[i][1])
  const meanA = (side(0) + side(2)) / 2 // sides 0-1 and 2-3
  const meanB = (side(1) + side(3)) / 2 // sides 1-2 and 3-0
  // Rotations whose FIRST side is a short side.
  const starts = meanA <= meanB ? [0, 2] : [1, 3]
  const pick = starts.reduce((best, s) => {
    const b = cw[best]
    const c = cw[s]
    if (c[1] < b[1] || (c[1] === b[1] && c[0] < b[0])) return s
    return best
  }, starts[0])
  return [cw[pick % 4], cw[(pick + 1) % 4], cw[(pick + 2) % 4], cw[(pick + 3) % 4]]
}

function sampleBilinear(src: ImageDataLike, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const W = src.width
  const H = src.height
  if (x < 0) x = 0
  else if (x > W - 1) x = W - 1
  if (y < 0) y = 0
  else if (y > H - 1) y = H - 1
  const x0 = x | 0
  const y0 = y | 0
  const x1 = x0 + 1 < W ? x0 + 1 : x0
  const y1 = y0 + 1 < H ? y0 + 1 : y0
  const fx = x - x0
  const fy = y - y0
  const d = src.data
  const i00 = (y0 * W + x0) * 4
  const i10 = (y0 * W + x1) * 4
  const i01 = (y1 * W + x0) * 4
  const i11 = (y1 * W + x1) * 4
  for (let c = 0; c < 3; c++) {
    const t = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx
    const u = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx
    out[o + c] = t + (u - t) * fy
  }
  out[o + 3] = 255
}

/**
 * Inverse-map the quad into a fronto-parallel image. Pure: no canvas, so the
 * warp itself is unit-testable and identical in node and the browser.
 *
 * Inverse mapping (destination pixel -> source coordinate -> bilinear sample)
 * rather than forward mapping, because a forward warp leaves holes wherever
 * the source is magnified.
 */
export function rectifyImageData(
  src: ImageDataLike,
  quad: Quad,
  outW = CARD_RECT_WIDTH,
  outH = CARD_RECT_HEIGHT,
): RectifiedImage | null {
  const ordered = orderQuadForCard(quad)
  if (!ordered) return null
  const dst: Quad = [
    [0, 0],
    [outW, 0],
    [outW, outH],
    [0, outH],
  ]
  const H = solveHomography(dst, ordered) // destination -> source
  if (!H) return null
  const data = new Uint8ClampedArray(outW * outH * 4)
  for (let oy = 0; oy < outH; oy++) {
    const cy = oy + 0.5
    for (let ox = 0; ox < outW; ox++) {
      const [sx, sy] = applyHomography(H, ox + 0.5, cy)
      sampleBilinear(src, sx, sy, data, (oy * outW + ox) * 4)
    }
  }
  return { width: outW, height: outH, data }
}

/**
 * Browser path: rectify, then encode. Returns the JPEG the scan endpoint takes
 * as a raw body (`api.scan(await blob.arrayBuffer(), blob.type)`).
 */
export async function rectifyToJpeg(
  src: ImageDataLike,
  quad: Quad,
  quality = CAPTURE_QUALITY,
  outW = CARD_RECT_WIDTH,
  outH = CARD_RECT_HEIGHT,
): Promise<Blob | null> {
  const out = rectifyImageData(src, quad, outW, outH)
  if (!out) return null
  const image = new ImageData(out.data, out.width, out.height)
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(out.width, out.height)
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(image, 0, 0)
    return await c.convertToBlob({ type: CAPTURE_MIME, quality })
  }
  const c = document.createElement('canvas')
  c.width = out.width
  c.height = out.height
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(image, 0, 0)
  return await new Promise<Blob | null>((resolve) => c.toBlob(resolve, CAPTURE_MIME, quality))
}
