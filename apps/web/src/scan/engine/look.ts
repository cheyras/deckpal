// THE CARD'S LOOK — a tiny colour layout of whatever card a quad bounds, so the
// capture policy can tell "the same card, still there" from "a different card,
// put down in the same place".
//
// ── WHY THE POLICY NEEDS IT ─────────────────────────────────────────────────
//
// Auto-capture refuses a lock it has already captured: per TRACK (Scan.tsx's
// refractory) and per PLACE (ui/regions.ts). Both are right for the case they
// were built on — one card held in front of the camera for thirty locks — and
// both are blind to the case a stack produces: the next card lands exactly
// where the last one was, the tracker keeps the same track id across the swap
// (the quad barely moved), and the new card is refused for as long as it sits
// there. regions.ts says it plainly — "overlap is not identity". Neither is a
// track id. The PIXELS are, which is what owner session 1's own analysis
// (`analysis/card-identity.mjs`: re-rectify both frames, correlate) used to
// label which locks were a new card; this is that measurement, made live.
//
// ── WHAT IT IS ──────────────────────────────────────────────────────────────
//
// The quad rectified to 48x66 off the refiner's working image (CANONICAL_SIZE,
// which the tick already holds), inset 8% so the border, sleeve edge and the
// fingers at the rim do not dominate, and averaged over an 8x11 grid in Y, Cb
// and Cr: 264 bytes. A 9x8 dHash was tried first and is too noisy for this —
// on video replays one card's ticks sat a median 16 bits apart against 30 for
// two different cards, an overlap no threshold separates. The colour grid put
// one card's ticks at a median 0.35 and different cards at 1.35
// (scripts/scan-bench/video, 2026-10-10). A capture's look also carries its
// three other quarter turns, because a capture can come out sideways
// (captureLook, LOOK_TURN_COST).

import type { Quad } from './contract'
import type { ImageDataLike } from './geometry'
import { CAPTURE_MARGIN, orderQuadForCard, rectifyImageData, warpQuad } from './rectify'

export const LOOK_GRID_W = 8
export const LOOK_GRID_H = 11
const CELLS = LOOK_GRID_W * LOOK_GRID_H
/** One look, one orientation: Y, Cb, Cr planes of CELLS bytes each. */
export const LOOK_BYTES = 3 * CELLS
/** The quarter turns a capture's look carries (captureLook). */
export const LOOK_TURNS = 4
const WARP_W = 48
const WARP_H = 66
const INSET = 0.08

/** Y, Cb, Cr cell means, channel-major (CELLS bytes each) — LOOK_BYTES for a
 *  tick's look, LOOK_TURNS x LOOK_BYTES (turn 0 first) for a capture's. */
export type CardLook = Uint8Array

/**
 * How close the two most top-left corners may come (in x+y, as a share of the
 * edge between them) before the corner order counts as undecided. The warp
 * starts at the corner with the smallest x+y (rectify.orderQuadForCard); a card
 * lying near 45° has two candidates, and a fraction of a degree of jitter flips
 * the pick and turns the look 90° — the same card reading as a different one
 * (PR #292 review: distance 1.8-1.9 at 44.5° vs 45.5°). 0.12 of the edge is
 * about 5° either side of the tie.
 */
const ORDER_TIE_FRAC = 0.12

/** True when the quad's corner order is too close to call (see ORDER_TIE_FRAC). */
export function orderUndecided(quad: Quad): boolean {
  const s = quad.map(([x, y]) => x + y)
  const idx = [0, 1, 2, 3].sort((a, b) => s[a] - s[b])
  const [i, j] = idx
  const edge = Math.hypot(quad[i][0] - quad[j][0], quad[i][1] - quad[j][1])
  return edge > 0 && s[j] - s[i] < ORDER_TIE_FRAC * edge
}

/** The look of the card `quad` bounds in `img` (canonical coordinates), or
 *  null when the quad does not order into a card — or orders ambiguously,
 *  which the re-arm treats as "cannot tell" and so never fires on. */
export function cardLook(img: ImageDataLike, quad: Quad): CardLook | null {
  if (orderUndecided(quad)) return null
  const r = rectifyImageData(img, quad, WARP_W, WARP_H)
  if (!r) return null
  const out = new Uint8Array(LOOK_BYTES)
  gridMeans(r.data, out, 0)
  return out
}

/** The 8x11 Y/Cb/Cr cell means of one WARP_W x WARP_H warp, into out[off..off+LOOK_BYTES). */
function gridMeans(d: Uint8ClampedArray, out: Uint8Array, off: number): void {
  const x0 = Math.round(WARP_W * INSET)
  const y0 = Math.round(WARP_H * INSET)
  const cw = (WARP_W - 2 * x0) / LOOK_GRID_W
  const ch = (WARP_H - 2 * y0) / LOOK_GRID_H
  for (let gy = 0; gy < LOOK_GRID_H; gy++) {
    for (let gx = 0; gx < LOOK_GRID_W; gx++) {
      let y = 0
      let cb = 0
      let cr = 0
      let n = 0
      for (let py = Math.floor(y0 + gy * ch); py < Math.floor(y0 + (gy + 1) * ch); py++) {
        for (let px = Math.floor(x0 + gx * cw); px < Math.floor(x0 + (gx + 1) * cw); px++) {
          const o = (py * WARP_W + px) * 4
          const R = d[o]
          const G = d[o + 1]
          const B = d[o + 2]
          y += 0.299 * R + 0.587 * G + 0.114 * B
          cb += 128 - 0.168736 * R - 0.331264 * G + 0.5 * B
          cr += 128 + 0.5 * R - 0.418688 * G - 0.081312 * B
          n++
        }
      }
      const k = off + gy * LOOK_GRID_W + gx
      out[k] = n ? Math.round(y / n) : 0
      out[CELLS + k] = n ? Math.round(cb / n) : 128
      out[2 * CELLS + k] = n ? Math.round(cr / n) : 128
    }
  }
}

/**
 * The look of a CAPTURE — the rectified pixels capture() returns (the card
 * widened by CAPTURE_MARGIN per side, at full sensor resolution). Every capture
 * has one, manual or automatic, locked or not, and it is the look of exactly
 * the frame that was taken. Comparable with `cardLook` on the working image:
 * both are 8x11 cell means of a 48x66 warp, so resolution averages out.
 *
 * It carries all FOUR QUARTER TURNS (LOOK_TURNS x LOOK_BYTES): turn k takes the
 * capture's corner k (top-left, top-right, bottom-right, bottom-left) as the
 * card's top-left, i.e. the picture turned k quarter turns counter-clockwise
 * and warped back to portrait. Turn 0 is the capture as taken, byte for byte
 * what `cardLook` of the same rectangle gives. Why: a capture's corner order
 * is chosen by POSITION (rectify.orderQuadForCard), so a card lying past 45°
 * comes out of capture() sideways or upside down — 3 of the owner's 42
 * session-1 captures did — and its look then fails to match the very card it
 * is, still lying there (owner-rearm.ts: a Marill re-captured at 1.45). The
 * turns are warped from the full-resolution capture, not reshuffled from the
 * 8x11 grid: a quarter turn of a portrait grid is a landscape one, which does
 * not resample back to 8x11 without smearing the layout. A tick's look stays
 * one orientation: comparing against a capture's four covers every relative
 * turn, and four warps a tick would be wasted on the steadiness check.
 */
export function captureLook(raw: ImageDataLike, margin: number = CAPTURE_MARGIN): CardLook | null {
  const mx = (raw.width * margin) / (1 + 2 * margin)
  const my = (raw.height * margin) / (1 + 2 * margin)
  const rect: Quad = [
    [mx, my],
    [raw.width - mx, my],
    [raw.width - mx, raw.height - my],
    [mx, raw.height - my],
  ]
  // The order rectifyImageData would warp the rectangle in (top-left first), so
  // turn 0 is exactly cardLook(raw, rect); null where cardLook would be.
  const c = orderUndecided(rect) ? null : orderQuadForCard(rect)
  if (!c) return null
  const out = new Uint8Array(LOOK_TURNS * LOOK_BYTES)
  for (let k = 0; k < LOOK_TURNS; k++) {
    const r = warpQuad(raw, [c[k], c[(k + 1) % 4], c[(k + 2) % 4], c[(k + 3) % 4]], WARP_W, WARP_H)
    if (!r) return null
    gridMeans(r.data, out, k * LOOK_BYTES)
  }
  return out
}

/** How many quarter turns a look carries: 1 for a tick's (`cardLook`), LOOK_TURNS for a capture's. */
export function lookTurns(l: CardLook): number {
  return Math.floor(l.length / LOOK_BYTES)
}

/**
 * What comparing at a quarter turn other than the capture as taken adds to the
 * distance (lookDistance). Each extra turn is another draw at a chance
 * look-alike: on the owner's sessions 1-7 % of unrelated pairs land within
 * REARM_NEW_MIN at each extra turn, on top of the 13-27 % that do upright, and
 * with the turns free the re-arm held 3 of the 23 new cards it rescues there
 * and lost 3 of 30 captured cards on two of the videos. The same card captured
 * turned matched at its turn at 0.14-0.57 there, so at 0.3 it still refuses
 * with room to spare — and at REARM_NEW_MIN the re-arm's results on both
 * benches come back exactly as they were without turns, less the Marill
 * duplicates (ui/rearm.ts).
 */
export const LOOK_TURN_COST = 0.3

/**
 * How different two looks are: 0 for identical, about 1.3 for two unrelated
 * cards, up to ~3 — at the NEAREST QUARTER TURN either look carries (a
 * capture's carries all four, see captureLook; a tick's only itself), a turn
 * other than the capture as taken costing LOOK_TURN_COST, so a capture that
 * came out sideways still matches its card. Two ticks' looks are compared as
 * they are.
 *
 * One minus the Pearson correlation of the LUMA layouts — exposure- and
 * contrast-proof, so the same card under a passing shadow stays close — plus
 * the mean chroma difference scaled so a whole type-colour change (~40 levels)
 * adds about 1. Two cards of one type share colour but not layout; two
 * printings with near-identical art share both, and THAT is fine: the policy
 * only needs "same card or not", and a reprint swapped in is also caught by
 * the identity layer behind it.
 */
export function lookDistance(a: CardLook, b: CardLook): number {
  // a's upright against each of b's turns, and each of a's against b's upright:
  // every relative turn either look can supply.
  let d = turnDistance(a, 0, b, 0)
  for (let k = 1; k < lookTurns(b); k++) d = Math.min(d, LOOK_TURN_COST + turnDistance(a, 0, b, k * LOOK_BYTES))
  for (let k = 1; k < lookTurns(a); k++) d = Math.min(d, LOOK_TURN_COST + turnDistance(a, k * LOOK_BYTES, b, 0))
  return d
}

/** lookDistance between orientation `ao` of `a` and orientation `bo` of `b` (byte offsets). */
function turnDistance(a: CardLook, ao: number, b: CardLook, bo: number): number {
  let ma = 0
  let mb = 0
  for (let i = 0; i < CELLS; i++) {
    ma += a[ao + i]
    mb += b[bo + i]
  }
  ma /= CELLS
  mb /= CELLS
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < CELLS; i++) {
    const x = a[ao + i] - ma
    const y = b[bo + i] - mb
    sab += x * y
    saa += x * x
    sbb += y * y
  }
  const corr = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
  let chroma = 0
  for (let i = CELLS; i < 3 * CELLS; i++) chroma += Math.abs(a[ao + i] - b[bo + i])
  return 1 - corr + chroma / (2 * CELLS) / 40
}
