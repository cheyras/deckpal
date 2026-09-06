// THE ORIENTATION ANCHOR — the one thing a quad cannot say on its own.
//
// Owner ruling 2026-09-06. Four points describe WHERE the card is; they do not
// describe WHICH WAY UP it is. The shipping pipeline guesses that geometrically
// and the guess is documented as breaking by construction: `orderQuadForCard`
// (scan/engine/rectify.ts) winds the corners clockwise and starts at "the
// corner nearest the frame's top-left", which "assumes roughly upright and
// breaks past 45 degrees". Measured on the owner's own session 1, three of 42
// captures came out a quarter turn wrong — all three cards lying sideways on a
// table (true top edges at 92, 108 and 125 degrees) — and rectify.ts's header
// records that the obvious geometric tells do NOT discriminate: the fix has to
// come from somewhere other than geometry.
//
// This is that somewhere. A human looking at the frame knows instantly which
// corner is the CARD's top-left, and saying so costs one tap. So the label
// gains an assignment: `topLeftIndex`, an index INTO the corner array rather
// than a reordering of it.
//
// WHY AN INDEX AND NOT A REORDER. Rotating the array to put the card's TL
// first would conflate two facts that must stay separable — the quad the
// detector proposed (which the corpus regresses against) and the orientation
// the human asserted (which is the new signal). Keeping them apart means the
// corner handles never renumber under the reader's fingers mid-edit, the
// detector's own winding is preserved verbatim for anyone diffing against it,
// and `seededTopLeftIndex` vs `topLeftIndex` is a direct measurement of how
// often the geometric rule is wrong — the 7.1 % above, re-measured
// continuously, on real frames, for free.
import type { Quad } from '../engine/contract'

/** Which of `corners[0..3]` is the CARD's own top-left — under whatever
 *  rotation the card sits at in frame, not the screen's top-left. */
export type TopLeftIndex = 0 | 1 | 2 | 3

export const TOP_LEFT_INDICES: readonly TopLeftIndex[] = [0, 1, 2, 3]

export function isTopLeftIndex(v: unknown): v is TopLeftIndex {
  return v === 0 || v === 1 || v === 2 || v === 3
}

/** Direct assignment — the reader tapped a specific corner marker. Narrows an
 *  arbitrary number to the union, or throws: an out-of-range top-left would
 *  poison a training row silently, and there are only four legal answers. */
export function assignTopLeft(index: number): TopLeftIndex {
  if (!isTopLeftIndex(index)) throw new RangeError(`top-left index must be 0-3, got ${String(index)}`)
  return index
}

/**
 * Winding of the corner array AS DRAWN ON SCREEN, in image coordinates (y
 * grows downward). Shoelace sign, with the y-down flip already accounted for:
 * a positive sum is clockwise on screen. Needed because "rotate the anchor a
 * quarter turn clockwise" is a statement about the SCREEN, and whether that is
 * `+1` or `-1` on the index depends on which way the array happens to wind —
 * the tracker preserves whatever winding the detector produced
 * (`alignToReference` only rotates the starting corner, it never reverses).
 *
 * A degenerate quad (zero area — three collinear points, or a collapsed drag)
 * reports 'cw' rather than throwing: the reader is mid-edit, the marker still
 * has to move somewhere sensible, and the saved row is the reader's problem
 * to have made non-degenerate before saving.
 */
export function quadWinding(quad: Quad): 'cw' | 'ccw' {
  let sum = 0
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = quad[i]!
    const [x2, y2] = quad[(i + 1) % 4]!
    sum += x1 * y2 - x2 * y1
  }
  return sum >= 0 ? 'cw' : 'ccw'
}

/**
 * Move the anchor `steps` corners CLOCKWISE ON SCREEN. This is what the rotate
 * button drives, and the on-screen promise is the point: the reader taps and
 * watches the amber marker walk clockwise around the card, one corner per tap,
 * whichever way the underlying array winds. Negative steps walk it back.
 */
export function rotateTopLeft(quad: Quad, current: TopLeftIndex, steps = 1): TopLeftIndex {
  const dir = quadWinding(quad) === 'cw' ? 1 : -1
  const next = (((current + dir * steps) % 4) + 4) % 4
  return next as TopLeftIndex
}

/**
 * THE SEED'S GUESS — deliberately the SAME rule the shipping pipeline uses, so
 * the reader is confirming or contradicting production rather than answering an
 * unrelated question. `orderQuadForCard` rule 3 is "start at the corner nearest
 * the frame's top-left"; the corner nearest the origin is winding-independent,
 * so reproducing it here is one argmin over the four distances.
 *
 * `quad` is in NORMALIZED canonical-square space ([0,1] fractions, per
 * types.ts) — the frame's top-left is therefore exactly (0, 0). Ties (a
 * perfectly diamond-oriented card) resolve to the lowest index, which is
 * arbitrary but stable, and is precisely the case a human is being asked about.
 */
export function seedTopLeftIndex(quad: Quad): TopLeftIndex {
  let best: TopLeftIndex = 0
  let bestD2 = Infinity
  for (const i of TOP_LEFT_INDICES) {
    const [x, y] = quad[i]!
    const d2 = x * x + y * y
    if (d2 < bestD2) {
      bestD2 = d2
      best = i
    }
  }
  return best
}

/**
 * THE HARVEST-TIME VIEW: the same four points re-read as the CARD's
 * [top-left, top-right, bottom-right, bottom-left] — the order
 * `rectifyImageData` wants, now sourced from a human instead of a guess.
 *
 * Winding decides which neighbour is the card's top-RIGHT: walking the array
 * forward from the anchor traces the card clockwise only when the array itself
 * winds clockwise on screen; a counter-clockwise array has to be walked
 * backwards to visit TL -> TR -> BR -> BL.
 */
export function orientedCorners(quad: Quad, topLeftIndex: TopLeftIndex): Quad {
  const dir = quadWinding(quad) === 'cw' ? 1 : -1
  return [0, 1, 2, 3].map((step) => quad[(((topLeftIndex + dir * step) % 4) + 4) % 4]!) as Quad
}

/** True when the reader left the geometric seed alone — i.e. production would
 *  have oriented this card correctly. The corpus-level rate of this is the
 *  live re-measurement of rectify.ts's documented ~7 % residual. */
export function seedAgreed(seeded: TopLeftIndex, chosen: TopLeftIndex): boolean {
  return seeded === chosen
}
