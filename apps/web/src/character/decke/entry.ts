/**
 * The entrance: growing from nothing, as a RIG-ROOT SCREEN-SPACE SCALE.
 *
 * THE COMPLAINT (C3/C35). He is simply parked at `homeCorner` and the canvas
 * opacity fades over 500 ms. There is no whole-body scale anywhere, so his
 * arrival is a cross-fade rather than an entrance: *"he should be absent, then
 * scale up from zero and travel in"*.
 *
 * WHY NOT `setCharacterHeight`. It is the obvious knob and it is the wrong one.
 * `Stage.applyDolly` makes him a chosen number of pixels tall by DOLLYING THE
 * CAMERA along its own axis — `dist = BODY_H * viewportHeight / (2 * px *
 * tan(fov/2))` (`stage.ts`). The height is in the DENOMINATOR, so asking for
 * "grows from nothing" asks the camera to travel to infinity: at 1 px he is
 * three hundred times further away than at 300, every other distance-derived
 * quantity in the runtime (the park solve's `baseDistance`, the background
 * plane, the flight shaping) moves with him, and at exactly 0 the distance is
 * not a number at all. A dolly can zoom. It cannot make him small.
 *
 * So the scale goes on `DeckE_Root`, the node above everything he does with his
 * body — above the facing yaw, the tilt, the float, the squash, the deformation
 * field and the cards. Uniform scale on that node is a similarity transform on
 * the whole character and NOTHING BELOW IT HAS TO KNOW:
 *
 *   - `riders.ts` and `eyeSocket.ts` both solve a world matrix and then
 *     premultiply their node's `parent.matrixWorld` inverse. Root scale appears
 *     in both factors and cancels exactly, so every rider and the eye socket
 *     write the same local transform they would have written at scale 1.
 *   - the eye shader takes `inverse(empty.matrixWorld)` per control and maps
 *     world positions into that empty's object space; a similarity applied to
 *     the geometry AND the empties leaves object space unchanged.
 *   - `look.ts` solves the pupil aim in the eye's own frame as a RATIO
 *     (`local.x / depth`), which a uniform scale divides out of both terms.
 *
 * WHAT DOES HAVE TO KNOW is anything that measures him in the world rather than
 * riding his node chain: `screenRect` (the speech bubble's box) and the beacon's
 * silhouette half-height. Both are given the scale here rather than left to
 * describe a full-sized character who is not on screen.
 *
 * PIVOT ABOUT HIS CENTRE, NOT HIS FEET. The rig origin is at his base, so a
 * scale there shrinks him toward the floor and his centre slides down the screen
 * as he grows — an entrance that also travels. His centre is what every other
 * part of this runtime treats as "him": `parkOn` drops the root by half a body
 * precisely so that a centre park lands his CENTRE on the mark, and
 * `solveFraming` rotates about the same point for the same reason. Scaling about
 * it means he grows out of the button rather than up from under it.
 */
import { Quaternion, Vector3 } from 'three'
import { BODY_H } from './constants'
import { CENTRE_OFFSET } from './framing'

/**
 * How long the grow takes.
 *
 * Short enough to read as a pop rather than an inflation, and inside the
 * 200-280 ms band the chat panel's own entrance keyframes already use, plus a
 * little — he is a body appearing, not a panel sliding.
 */
export const ENTRY_MS = 380

/**
 * The grow curve: eased out with a small overshoot.
 *
 * `easeOutBack` with the standard 1.70158 overshoots by 10%, which on a whole
 * body reads as a bounce; 1.2 peaks at 1.053 near u = 0.64, which reads as
 * arriving with weight. Exactly 0 at u = 0 and exactly 1 at u = 1, so the two
 * ends are the two ends and no clean-up frame is needed.
 */
const BACK = 1.2

export function entryEase(u: number): number {
  // The ends are RETURNED, not computed. `1 + (c+1)(-1)^3 + c` is zero in
  // algebra and -2.2e-16 in doubles, and a negative scale — however small — is a
  // mirrored character, not a small one.
  if (u <= 0) return 0
  if (u >= 1) return 1
  const t = u - 1
  return 1 + (BACK + 1) * t * t * t + BACK * t * t
}

/** The scale at progress `u` through the beat, growing from `from` to 1. */
export function entryScaleAt(u: number, from: number): number {
  const e = entryEase(u)
  return from + (1 - from) * e
}

/**
 * The smallest scale the RIG is ever handed.
 *
 * EXACTLY ZERO IS A SINGULAR MATRIX, and two layers of this runtime invert one
 * every frame: `riders.ts` and `eyeSocket.ts` both premultiply their node's
 * `parent.matrixWorld` inverse to cancel the chain above them. three returns an
 * all-zero matrix for a singular invert rather than NaN, so the frame is not
 * poisoned and the next one recovers — but "the eye socket solve is meaningless
 * for one frame" is not a thing to leave lying around for the sake of a number
 * nobody can see. At 1e-3 he is a third of a pixel tall at the shipped framing:
 * absent by any measure that matters, and invertible.
 */
export const ENTRY_MIN = 1e-3

/** Clamp a caller's scale into the range the rig can actually be given. */
export function clampEntryScale(s: number): number {
  return !Number.isFinite(s) ? 1 : s < ENTRY_MIN ? ENTRY_MIN : s
}

/**
 * What to ADD to the framing position so the scale pivots about his centre.
 *
 * `solveFraming` returns `position = C - R*f` where `C` is his centre and
 * `f = (0, CENTRE_OFFSET, 0)`, because it rotates about the centre. Scaling the
 * root by `s` moves the local point `f` to `position + s*R*f`, so holding the
 * centre fixed wants `position = C - s*R*f`, which is the shipped position plus
 * `(1 - s) * R*f`. At `s = 1` that is exactly zero — the correction cannot
 * perturb the ordinary case.
 *
 * The un-framed branch (parity mode, staging) is the same identity with `R` the
 * identity quaternion, so one function serves both.
 */
export function entryPivotOffset(
  quaternion: Quaternion,
  scale: number,
  out = new Vector3(),
): Vector3 {
  return out.set(0, CENTRE_OFFSET, 0).applyQuaternion(quaternion).multiplyScalar(1 - scale)
}

/**
 * His body span in the BLENDER frame at a given entry scale — the two points
 * `screenRect` projects.
 *
 * Blender Z is up, and `base` is the rig origin at his feet, so at scale 1 this
 * is exactly `base` and `base + BODY_H` as it always was. Below 1 the span
 * shrinks about his centre, which is the same pivot `entryPivotOffset` holds.
 */
export function bodySpan(base: Vector3, scale: number, feet: Vector3, head: Vector3): void {
  const half = (BODY_H / 2) * scale
  const centreZ = base.z + BODY_H / 2
  feet.set(base.x, base.y, centreZ - half)
  head.set(base.x, base.y, centreZ + half)
}
