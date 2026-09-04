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
import { CARD_ASPECT_W_OVER_H, centroid, cloneQuad, orderQuad, type ImageDataLike, type Point } from './geometry'

/** ~480 px wide, per the scan contract; the height follows from the GAME's
 *  aspect. Pokémon's 63:88 gives 670. */
export const CARD_RECT_WIDTH = 480
export const CARD_RECT_HEIGHT = Math.round(CARD_RECT_WIDTH / CARD_ASPECT_W_OVER_H) // 670

/** The rectified output's size for a given game aspect — the per-game half of
 *  the frame spec (frame.ts holds the universal half). The 480 px width is
 *  fixed; the height is whatever that game's cards actually are, so a warp never
 *  squashes one TCG's cards into another's proportions. */
export function cardRectSize(cardAspect: number = CARD_ASPECT_W_OVER_H): { width: number; height: number } {
  return { width: CARD_RECT_WIDTH, height: Math.round(CARD_RECT_WIDTH / cardAspect) }
}

/** JPEG quality for the POSTed capture. */
export const CAPTURE_QUALITY = 0.85
export const CAPTURE_MIME = 'image/jpeg'

/**
 * CAPTURE MARGIN — background deliberately included beyond the detected quad,
 * per side, as a fraction of the card's own width and height. 0.05 here is the
 * same idea the ORIGINAL scanner shipped as `CAPTURE_MARGIN = 1.14` (a total
 * dimension multiplier; this is the per-side half of one, so 0.05 === 1.10).
 *
 * WHY A CAPTURE IS DELIBERATELY LOOSE. The two errors are not symmetric. The
 * identify stage is a perceptual hash over a server-side pipeline that TRIMS
 * background before hashing — so a sliver of table around the card costs
 * essentially nothing — but nothing downstream can restore a strip of card that
 * was never in the JPEG. The old scanner measured exactly that asymmetry:
 * exact-guide crop of an overflowing card ~81% top-1, margin + server trim
 * ~98% (routes/Scan.tsx before the engine rewrite). Background is cheap; a
 * missing name/HP header is fatal.
 *
 * WHY IT IS BACK. The engine's own detection is good — blind visual
 * verification over the 61 real-card frames of phase 0b session 2 put 95% of
 * quads on the card — but the residual failure is ONE-SIDED: 13 of the 17
 * near-miss frames lose the card's TOP STRIP (the Stage badge, the name, the
 * HP) while the bottom survives (engine-diag/BLIND-VERIFICATION.md). The bias
 * is in LC050's own output, not in the refiner: rotation-neutral, the model's
 * raw quad cuts into the card's top edge on 16 of the 19 labelled frames
 * (median 1.3% of a card height) and into the left edge on 12 (median 1.9%),
 * while bottom and right are unbiased.
 *
 * Measured over those 19 hand-labelled frames (__tests__/diag-run.ts
 * --margin-sweep). `full card` counts captures holding 99.9% or more of the
 * labelled card; `top border` counts captures whose own top edge clears the
 * card's; `header band` counts captures holding 99% of the card's top fifth —
 * the strip with the badge, the name and the HP; `background` is the share of
 * the JPEG that is not card.
 *
 *   margin   full card   top border   header band   mean coverage   background
 *     0%       0/19         3/19          0/19          0.912          5.7%
 *     3%       8/19        14/19         11/19          0.956         11.7%
 *     4%      10/19        16/19         11/19          0.963         14.2%
 *     5%      11/19        16/19         13/19          0.969         16.7%
 *     6%      11/19        16/19         14/19          0.974         19.1%
 *     7%      11/19        16/19         14/19          0.978         21.5%
 *
 * 5% is the smallest margin at which whole-card containment saturates (11/19,
 * unchanged at 6% and 7%), with top-border recovery already saturated since 4%.
 * It is preferred over 4% for headroom as much as for the two extra header
 * bands: at 4% the last top border it rescues (F050's) clears the card by 0.4%
 * of a card height — three pixels of a 670 px capture, inside the
 * hand-labelling's own slop — where at 5% every rescued border clears by more
 * than 1%. 6% buys one further header band for another 2.4 points of
 * background and 7% buys nothing at all. Confirmed by eye over all 16 near-miss
 * captures (--sheets): at 3% several headers still sit flush against the crop
 * edge; at 5% every one of the 16 is complete and clear of it.
 *
 * The three frames a margin never rescues are the ones it is not for: F079 (an
 * interior lock, 28% of the card still outside at 5%), F070 and F061 (quads
 * that miss the top by 7-11% of a card height). A margin widens a capture; it
 * cannot move one onto a different object.
 *
 * ONE CAVEAT ON THE NUMBERS, IN THE CONSERVATIVE DIRECTION. On sleeved frames
 * the hand labels trace the SLEEVE, not the card (the 8-30 px rim ambiguity
 * DECISIONS.md 2026-09-02 logged as an accepted residual), so a coverage below
 * 1.0 there can mean "missing sleeve rim" rather than "missing card". F070 and
 * F061 score 0.90 and 0.93 at 5% and yet their captures show the whole card,
 * badge and borders included. The table therefore UNDER-states the recovery;
 * nothing in it over-states it.
 *
 * The expansion is UNIFORM even though the bias is not, because a directional
 * correction would bake this corpus's camera angles into the product — and the
 * left edge, which no one notices because that strip is plain border, is
 * measurably worse than the top.
 */
export const CAPTURE_MARGIN = 0.05

/**
 * Scale a quad about its own centroid so each side sits `margin` card-dimensions
 * further out — the capture margin, applied in FRAME space before the warp.
 *
 * Scaling about the centroid keeps the shape projectively honest: the expanded
 * quad is still the image of a rectangle under the same homography (a card
 * 10% larger, coplanar with the real one), so the rectified output is still a
 * fronto-parallel view and not a distortion. Expanding each side along its own
 * normal instead would not be.
 *
 * The result may leave the frame. That is deliberate and handled downstream:
 * rectifyImageData's sampler clamps at the border, so an off-frame margin
 * comes back as a smear of the frame's own edge pixels rather than as black —
 * background-like, which is what the server's trim expects. Clamping the
 * corners here instead would bend the quad off its rectangle and reintroduce
 * the keystone this function is careful to preserve.
 */
export function expandQuad(quad: Quad, margin: number = CAPTURE_MARGIN): Quad {
  if (!(margin > 0)) return cloneQuad(quad)
  const k = 1 + 2 * margin
  const [cx, cy] = centroid(quad)
  return [
    [cx + (quad[0][0] - cx) * k, cy + (quad[0][1] - cy) * k],
    [cx + (quad[1][0] - cx) * k, cy + (quad[1][1] - cy) * k],
    [cx + (quad[2][0] - cx) * k, cy + (quad[2][1] - cy) * k],
    [cx + (quad[3][0] - cx) * k, cy + (quad[3][1] - cy) * k],
  ]
}

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
 * ── THE 90-DEGREE BUG THIS REPLACES (e2e drive, 2026-09-04) ────────────────
 *
 * The previous version rotated the corner order so that side 0->1 was one of the
 * two SHORTER PROJECTED SIDES, reasoning that a card's short side is its 63 mm
 * width and so belongs on the output's width. That reasoning holds only for a
 * card photographed square-on. It INVERTS under the foreshortening every
 * hand-held frame has: tilt a card away from the camera and its 88 mm height
 * projects shorter than its 63 mm width, so the "short projected side" becomes
 * the card's HEIGHT and the warp turns the card a quarter turn.
 *
 * Not a corner case — the failure was total. Over the 13 captures the e2e drive
 * harvested from the deployed build, the old rule put side 0 on a NON-TOP edge
 * 13/13 times, and an independent pixel bake-off against the app's own
 * `rectifiedPng` ranked rot90CCW first on all 13 (mean abs diff 35.2, against
 * 55.5 / 56.6 / 57.0 for the other orders). Ten of those quads were projected
 * LANDSCAPE (aspect 1.11-2.87) while the cards in the raw frames were plainly
 * upright — exactly the inversion above.
 *
 * ── THE RULE NOW ───────────────────────────────────────────────────────────
 *
 *   1. repair + order the corners cyclically (the OUTPUT VALIDITY GATE),
 *   2. wind them clockwise in image coordinates (y down),
 *   3. start at the corner nearest the frame's top-left, so side 0->1 is the
 *      quad's TOP edge whatever its projected length.
 *
 * i.e. plain TL, TR, BR, BL by POSITION — which the drive verified directly by
 * re-warping its own recorded quads that way and getting upright, square-on,
 * document-scanner output on all 13.
 *
 * WHAT THIS GIVES UP, STATED PLAINLY. A card presented genuinely sideways (the
 * user turns it 90 degrees in frame) now rectifies sideways rather than being
 * rotated upright. That is the honest trade: geometry alone cannot separate a
 * sideways card from a foreshortened upright one — both are landscape quads —
 * and the old rule effectively guessed "sideways" for every tilted card, which
 * is the common case. Guessing "upright" is right far more often, and the
 * identify stage's counter-rotation probes span only +/-12 degrees
 * (apps/api/src/scan/phash.ts), so nothing downstream could rescue a 90-degree
 * error anyway.
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
  // Top-left by POSITION: smallest x+y. `cw` is already a clockwise cycle, so
  // starting there makes 0->1 the top edge, 1->2 the right, and so on.
  let pick = 0
  for (let i = 1; i < 4; i++) {
    const s = cw[i][0] + cw[i][1]
    const b = cw[pick][0] + cw[pick][1]
    if (s < b || (s === b && cw[i][1] < cw[pick][1])) pick = i
  }
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
 *
 * THIS is where the capture margin is applied — the one place a JPEG is made
 * for the server. rectifyImageData stays the exact warp of the quad it is
 * given, so the unit tests, the ground-truth rectifications and any future
 * "show me this quad" caller are unaffected; only the thing that goes over the
 * wire is loosened. Pass `margin: 0` for an exact-quad crop.
 */
export async function rectifyToJpeg(
  src: ImageDataLike,
  quad: Quad,
  quality = CAPTURE_QUALITY,
  outW = CARD_RECT_WIDTH,
  outH = CARD_RECT_HEIGHT,
  margin = CAPTURE_MARGIN,
): Promise<Blob | null> {
  const out = rectifyImageData(src, expandQuad(quad, margin), outW, outH)
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
