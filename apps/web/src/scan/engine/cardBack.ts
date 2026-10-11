// THE CARD BACK — the one thing a scanner is pointed at that is card-shaped,
// card-sized, card-coloured, held exactly like a card, and never a card face.
//
// ── WHY THE POLICY NEEDS IT ─────────────────────────────────────────────────
//
// Every gate upstream asks a question a card back passes: the presence head
// ("an object"), the aspect prior (it IS 63:88), the straddle gate (one card),
// the saturation floor (a saturated blue). So a back that sits in the reticle
// for two ticks auto-captures — when a pulled stack is flipped, when the last
// card of a pack is face down, when a sleeved back is turned up in a binder —
// and the capture is a row the reader has to delete.
//
// ── WHAT IT IS ──────────────────────────────────────────────────────────────
//
// The English back is one fixed design — blue border and swirl, the Poké Ball
// in the middle, the yellow logo above it and again, upside down, below — so
// its LOOK (engine/look.ts: the 8x11 Y/Cb/Cr cell means the lock already
// computes every tick) is a template. A look within CARD_BACK_MAX_DISTANCE of
// it, either way up, is a back. No extra pixels are read: the look is
// EngineState.look, and the comparison is one lookDistance per orientation.
//
// The template is the mean look of eight backs: six the owner photographed
// (quad-queue/verify-truth.jsonl, kind "negative", "Pokemon card back") and two
// a video replay captured (scripts/scan-bench/video: R20ttkcolco 341.9 s,
// dXzZTc85QtM 143.0 s), each measured with captureLook on its 480x670 crop.
//
// ── THE NUMBERS (2026-10-10) ────────────────────────────────────────────────
//
// Distance to the template, the nearer of the two orientations:
//
//   backs, crops (8; leave-one-out)                  0.15 - 0.62
//   backs, replay lock ticks (R20tt, dXzZ)           0.20 - 0.70 (thumb on it)
//   catalog art, every English card (20,467)         min 0.770   p01 1.04
//   real card crops (776: owner, telemetry, video)   min 0.842   p01 0.95
//   lock ticks on a GT card appearance (1,033)       min 0.850   p01 0.97
//
// 0.65 sits 0.12 below the nearest card ever measured. It refuses NOTHING on
// the 14 ground-truth videos (no lock tick there comes near), and it is not
// a claim to catch every back: a back the quad sees only part of, or two
// backs under one quad, does not look like the whole design and still fires.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// It is not a booster-pack, code-card or "not a card" detector. Those were
// measured and none separates at zero card loss on pixels this cheap: a
// logistic head on the full look, cross-validated by video, refused 0 of 33
// packs at zero real-card loss; packs' aspect, saturation, specular and
// telemetry overlap cards; the pack logo is only legible in good light.
// Japanese backs are a different design and are not modelled.

import { lookDistance, LOOK_GRID_H, LOOK_GRID_W, type CardLook } from './look'

/** A look within this of the back (either way up) is a card back. See above. */
export const CARD_BACK_MAX_DISTANCE = 0.65

/** The mean look of the English card back: Y, Cb, Cr cell means, channel-major, rows top to bottom. */
export const CARD_BACK_LOOK: CardLook = Uint8Array.from([
  // Y
  128, 135, 144, 147, 146, 154, 154, 167,
  144, 142, 148, 148, 142, 152, 147, 153,
  125, 143, 161, 160, 141, 122, 118, 134,
  120, 172, 186, 142, 142, 140, 118, 106,
  154, 191, 138, 128, 135, 134, 148, 108,
  161, 190, 156, 120, 176, 179, 164, 126,
  109, 179, 173, 161, 192, 194, 175, 161,
   89, 113, 153, 144, 171, 175, 178, 122,
   95,  91,  98, 124, 168, 175, 141, 111,
  140, 130, 125, 128, 138, 136, 132, 119,
  153, 145, 147, 133, 137, 130, 124, 118,
  // Cb
  125, 129, 128, 126, 127, 119, 129, 126,
   99, 102,  95,  95, 105,  88, 101,  94,
  134, 118, 120, 130, 134, 134, 127, 119,
  142, 131, 122, 115, 111, 129, 151, 148,
  134, 122, 110, 116, 101,  99, 133, 148,
  131, 123, 122, 123, 118, 115, 123, 136,
  141, 126, 121, 120, 119, 119, 124, 130,
  147, 138, 127, 122, 120, 122, 124, 136,
  144, 146, 145, 138, 129, 123, 127, 136,
   97, 109, 120, 124, 114, 103, 106, 116,
  115, 121,  98, 115, 111, 115, 116, 106,
  // Cr
  130, 129, 130, 131, 131, 136, 131, 132,
  146, 145, 149, 150, 144, 153, 147, 150,
  128, 137, 136, 130, 128, 128, 132, 137,
  121, 130, 139, 150, 156, 135, 114, 116,
  127, 137, 152, 141, 164, 171, 129, 115,
  129, 135, 133, 133, 138, 142, 136, 125,
  122, 132, 135, 135, 136, 136, 134, 130,
  116, 123, 131, 135, 136, 136, 135, 127,
  119, 117, 118, 125, 133, 137, 135, 129,
  149, 143, 135, 133, 141, 149, 147, 140,
  138, 135, 147, 139, 141, 140, 140, 144,
])

const CELLS = LOOK_GRID_W * LOOK_GRID_H

/** A look turned 180 degrees — the same card upside down. The warp is always
 *  portrait (rectify.orderQuadForCard), so these are the only two ways round. */
export function rotateLook180(look: CardLook): CardLook {
  const out = new Uint8Array(look.length)
  for (let c = 0; c < 3; c++) for (let k = 0; k < CELLS; k++) out[c * CELLS + (CELLS - 1 - k)] = look[c * CELLS + k]
  return out
}

const CARD_BACK_LOOK_TURNED = rotateLook180(CARD_BACK_LOOK)

/** How far a look is from the card back, the nearer way up (lookDistance units). */
export function cardBackDistance(look: CardLook): number {
  return Math.min(lookDistance(CARD_BACK_LOOK, look), lookDistance(CARD_BACK_LOOK_TURNED, look))
}

/** True when this look is a card back. A missing look is not one: "cannot tell" fires as before. */
export function isCardBackLook(look: CardLook | null, maxDistance: number = CARD_BACK_MAX_DISTANCE): boolean {
  return !!look && cardBackDistance(look) <= maxDistance
}
