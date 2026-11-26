// THE SIZE GATE: an auto-capture waits until the card is big enough in the
// frame for its printed text to be read.
//
// THE FLOOR IS THE FARTHEST A CARD CAN BE AND STILL READ, NOT A TARGET.
// Measured 2026-11-26 (`scripts/scan-bench/size-sweep.{py,ts}`): 292 of the
// owner's card photos, each captured as the scanner would capture it at nine
// distances (the 960 px square of the 960x1280 stream every camera capture on
// record used, the 5% margin, 480x670, JPEG 0.85), read by the device OCR.
// Against what each card reads up close (0.70-0.80 of the frame):
//
//   long side / frame     0.80  0.70  0.60  0.55  0.50  0.45  0.40  0.35  0.30
//   a printed field kept   95%   92%   84%   83%   83%   71%   63%   48%   43%
//   the number kept        92%   95%   80%   73%   65%   52%   32%    7%    1%
//   number MISREAD          0     0     3     2     2     5     6    12     2   (of 128)
//
// A usable printed field (the name, or number/total) plateaus down to 0.50,
// nine in ten of what reads up close, then steps down. From 0.45 the number
// is not just missed but misread more often, and number/total is a confident
// rung on the server. Names survive almost any distance and are never misread.
//
// WHY NOT HIGHER. The sweep downscales sharp still photos; a real camera at
// distance adds noise and focus hunting, so the real knee sits a little above
// 0.50. But the owner's live captures that were sharp read their number at
// 0.59-0.61 (2026-11-25 field session), the image match still identifies a
// card OCR misses, and a floor people hit is an annoyance: of the owner's 115
// real camera captures, 0.50 would have held 6, 0.55 would hold 12 and 0.60
// would hold 30. People hold a card at a median 0.70 of the frame, and the
// outline drawn on screen is 0.88 of it, so 0.50 (a little over half the
// outline's height) leaves a wide margin either side of where they aim.
//
// Only AUTO-capture is held, and only on the size of the lock it is about to
// take. The lock itself, the outline and manual capture are untouched: a card
// held a little far still locks, the scanner says "Move a little closer", and
// the same track fires the moment it is big enough, with no re-aim. Pressing
// the button is the reader deciding the frame is good enough.

import type { Quad } from '../engine/contract'

/** The card's LONG side as a fraction of the square the detector sees: the
 *  farthest a card can be and still read (see above). */
export const MIN_CARD_SIDE = 0.5

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)

/**
 * The card's long side, the mean of its two long edges, as a fraction of the
 * detector's square frame (`frameSide`: 416 in pipeline v3). The mean of the
 * two edges, not the longer one, so a card tilted away from the camera is
 * judged by its middle, which is roughly where its text sits.
 */
export function cardSideFraction(quad: Quad, frameSide: number): number {
  if (!(frameSide > 0)) return 0
  const a = (dist(quad[0], quad[1]) + dist(quad[2], quad[3])) / 2
  const b = (dist(quad[1], quad[2]) + dist(quad[3], quad[0])) / 2
  return Math.max(a, b) / frameSide
}

/** Too small to read: hold the auto-capture and ask the reader to come closer. */
export function isTooFar(quad: Quad, frameSide: number, minSide: number = MIN_CARD_SIDE): boolean {
  return cardSideFraction(quad, frameSide) < minSide
}
