// HOW SHARP THE CARD IS ON THIS TICK — the variance of the luma Laplacian over
// the middle of the quad, on the canonical working image.
//
// WHY. The owner's 2026-11-25 session on deckpal.app: 5 of 17 auto-captures were
// blurred (motion, or focus still settling), and nothing downstream can read a
// smeared number strip or match a smeared picture. One of them is the whole case
// for waiting: a Hypno captured blurred, then captured sharp by the same track
// 0.85 s later. Measured here, in exactly this space (canonical 416 frame, quad
// shrunk 20% toward its centre), the five blurred captures scored 101-259 and
// the twelve sharp ones 375-1403. `ui/focusGate.ts` turns the number into a wait.
//
// WHY THE LAPLACIAN'S VARIANCE. It is the standard focus measure, one pass,
// no allocation beyond a running sum, and on that session it separated blurred
// from sharp with no overlap where the detector's motion jitter did not (a
// blurred Azurill had a jitter of 5.9 px: focus blur, not motion).
//
// WHY THE MIDDLE OF THE QUAD, AXIS-ALIGNED. The border is where the background
// and the quad's own fitting error live; the art and text inside are what has
// to be sharp. An axis-aligned box inside the shrunk quad needs no warp, and at
// the tilts a lock allows it stays on the card.

import type { Quad } from './contract'
import type { ImageDataLike } from './geometry'

/** How far the quad is shrunk toward its centre before measuring. */
export const SHARPNESS_SHRINK = 0.8

/**
 * Laplacian variance of the luma inside `quad` (shrunk by SHARPNESS_SHRINK),
 * or null when the region is too small to mean anything.
 */
export function quadSharpness(img: ImageDataLike, quad: Quad, shrink = SHARPNESS_SHRINK): number | null {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of quad) {
    const sx = cx + (x - cx) * shrink
    const sy = cy + (y - cy) * shrink
    x0 = Math.min(x0, sx)
    y0 = Math.min(y0, sy)
    x1 = Math.max(x1, sx)
    y1 = Math.max(y1, sy)
  }
  const W = img.width
  const H = img.height
  const left = Math.max(1, Math.floor(x0))
  const top = Math.max(1, Math.floor(y0))
  const right = Math.min(W - 2, Math.ceil(x1))
  const bottom = Math.min(H - 2, Math.ceil(y1))
  if (right - left < 8 || bottom - top < 8) return null
  const d = img.data
  const luma = (x: number, y: number): number => {
    const o = (y * W + x) * 4
    return 0.299 * d[o]! + 0.587 * d[o + 1]! + 0.114 * d[o + 2]!
  }
  let n = 0
  let sum = 0
  let sum2 = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const l = luma(x - 1, y) + luma(x + 1, y) + luma(x, y - 1) + luma(x, y + 1) - 4 * luma(x, y)
      sum += l
      sum2 += l * l
      n++
    }
  }
  const mean = sum / n
  return sum2 / n - mean * mean
}
