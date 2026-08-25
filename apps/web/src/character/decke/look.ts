/**
 * Looking at the camera — the constraint that did not export, rebuilt.
 *
 * THE DEFECT. In the .blend, `Ctrl_Target` carries a Copy Location from the
 * camera with `use_offset`, so `(0,0,0)` means "look exactly at the camera,
 * wherever the camera is", and every gaze behaviour — the state's authored `gx`
 * / `gz`, the micro-saccade flits, the blink-masked glance-aways — is an offset
 * on top of it. `Ctrl_Pupil_{L,R}` then track that empty inside a roam limit.
 *
 * None of that is expressible in glTF. Constraints do not export, and the
 * exporter emitted `Ctrl_Target_anim` as a ROOT node with no children — so the
 * port's `rig.ts` faithfully wrote `gx/gy/gz` onto an object that nothing reads.
 * The pupils were left at their bind pose, `(x 0.115, z 0.158)`, which is a
 * BAKED SAMPLE of this constraint at the staging camera: he was frozen at
 * "looking up and to the right" and stayed there through every state, every
 * turn, and every flight.
 *
 * That is three of the screen-recording notes at once — "he's not continuing to
 * look at the camera, he's just continuing to look up and to the right",
 * "facing right he's looking at the camera, face left he is not any more", and
 * "it doesn't seem like he is actually looking at the camera at all, his eyes
 * are just locked in one position... the actual look-at-the-camera functionality
 * doesn't seem to have been ported over."
 *
 * THE MODEL. In each eye's own local frame (Blender axes: +X lateral, -Y
 * forward, +Z up) the direction to the target gives a tangent pair
 *
 *     u = local.x / depth,   v = local.z / depth,   depth = max(-local.y, eps)
 *
 * and the pupil sits at `(GAIN*u, GAIN*v)` clamped to the roam ellipse. One
 * gain, two clamps.
 *
 * IT IS CALIBRATED, NOT GUESSED. At the Blender staging camera the left eye
 * measures `u = 1.0230`, `v = 0.6158`. `GAIN = 0.2563` reproduces the glb's
 * authored bind pose:
 *
 *     z = 0.6158 * 0.2563 = 0.15783   vs the file's 0.157857   (0.02% off)
 *     x = 1.0230 * 0.2563 = 0.26220   ->  clamped to 0.115  == the file's 0.115
 *
 * and the same gain clamps the RIGHT eye's 0.8674 to 0.115 as well, which is
 * what the file has. So the model reproduces both eyes' lateral value and the
 * left eye's vertical value from one constant. It does NOT reproduce the right
 * eye's authored `z` of 0.16757 — the file's two eyes differ by 6% on an axis a
 * symmetric rig cannot differ on, so something in that bind frame was not
 * symmetric. 0.0097 blender units is about a third of a pixel at the staging
 * framing; it is recorded here rather than fitted away.
 *
 * `PARITY.md`'s alert_star still (IoU 0.991) was taken against the frozen bind
 * pose, so it is now a comparison against a DIFFERENT thing on any frame where
 * the gaze has moved. That is intended: the frozen pose was the bug.
 */
import type { Object3D, PerspectiveCamera, Vector3 } from 'three'
import { Matrix4, Vector3 as V3 } from 'three'

/**
 * Tangent-units per blender-unit of pupil travel. See the calibration above.
 * Equivalently: the pupil saturates laterally at atan(0.115/0.2563) = 24.2 deg
 * off the eye's axis, and vertically at 41.3 deg.
 */
export const GAZE_GAIN = 0.2563

/**
 * The roam limits, measured as the full excursion of `Ctrl_Pupil.location`
 * across the whole authored timeline. The wiki's 0.0570 x 0.1420 is stale by a
 * factor of two; these are the values `README.md` already records as corrected.
 */
export const PUPIL_ROAM = { x: 0.115, z: 0.225 } as const

type LookTarget = {
  /** The gaze target in the BLENDER frame: the camera plus the pose offset. */
  target: V3
}

const _inv = new Matrix4()
const _local = new V3()

/** three.js (x, y, z) -> blender (x, -z, y), in place on a scratch vector. */
function toBlender(v: V3): V3 {
  const { x, y, z } = v
  return v.set(x, -z, y)
}

export type PupilAim = { x: number; z: number }

/**
 * A target-space offset applied to the pupil AFTER the aim has been clamped.
 *
 * WHY AFTER. The micro-saccades and the blink-masked glance-aways are stored as
 * offsets on the gaze TARGET, which is how the .blend expresses them, and
 * composing them into the target before the solve is the obvious thing to do. It
 * also silences them completely at this staging: the camera sits 45.6 degrees
 * off the left eye's axis and the eye saturates at 24.2, so the aim is pinned at
 * the roam limit with 2.3x of headroom above it — a flit worth 0.135 of tangent
 * moves the clamped result by exactly zero. Measured: 45 seconds of idle with
 * the pupil's lateral position spread of 0.0000.
 *
 * That is a real answer to the wrong question. The flits exist so that "his eyes
 * very slightly flit around, like he's looking at one of their eyes and then the
 * other" — they are motion of the EYE, not a change of what he is looking at.
 * Applying them past the clamp gives them back their amplitude while keeping the
 * roam ellipse a hard limit, and it leaves the calibration untouched, because a
 * zero offset is still exactly the bind pose.
 *
 * The result is one-sided at saturation: from the corner of the eye the pupil
 * can flit inward and not further out. That is also what a real eye does at the
 * end of its travel.
 */
export type GazeOffset = { x: number; z: number }
const NO_OFFSET: GazeOffset = { x: 0, z: 0 }

/**
 * Where one pupil should sit, in its own local frame.
 *
 * `eye` is the pupil's PARENT (`Eye_L_anim` / `Eye_R_anim`) — the frame the
 * pupil's `position` is expressed in. Its world matrix must be current; the
 * caller refreshes it once per frame before the eye uniforms are pushed.
 *
 * `alert` collapses the aim to zero. During the alert reel the pupil is a drum
 * that rolls straight up out of the eye while the symbol rolls in beneath it,
 * and a drum that is also 0.115 off to one side reads as a broken slot machine —
 * which is what "both of the pupils are not centered as they were in the blender
 * file, this one is a little bit over to the left" is describing. The eye stops
 * being a gaze and starts being a mechanism, so the gaze lets go of it.
 */
export function aimPupil(
  eye: Object3D,
  targetBlender: V3,
  alert: number,
  micro: GazeOffset = NO_OFFSET,
  out: PupilAim = { x: 0, z: 0 },
): PupilAim {
  _inv.copy(eye.matrixWorld).invert()
  // The target arrives in the blender frame; convert to three to multiply, then
  // read the result back in blender axes.
  _local.set(targetBlender.x, targetBlender.z, -targetBlender.y).applyMatrix4(_inv)
  toBlender(_local)

  const depth = Math.max(-_local.y, 1e-4)
  const u = (_local.x / depth) * GAZE_GAIN
  const v = (_local.z / depth) * GAZE_GAIN
  // The micro-offset converts through the SAME gain and the SAME live depth, so
  // it is the movement that offset would have produced if the aim had room for
  // it — not a second, unrelated amplitude to keep in sync by hand.
  const mx = (micro.x / depth) * GAZE_GAIN
  const mz = (micro.z / depth) * GAZE_GAIN

  const hold = 1 - Math.min(1, Math.max(0, alert))
  out.x = clamp(clamp(u, PUPIL_ROAM.x) + mx, PUPIL_ROAM.x) * hold
  out.z = clamp(clamp(v, PUPIL_ROAM.z) + mz, PUPIL_ROAM.z) * hold
  return out
}

function clamp(v: number, lim: number): number {
  return v < -lim ? -lim : v > lim ? lim : v
}

/**
 * The gaze target in the blender frame: the camera's world position plus the
 * pose's `gx / gy / gz` offset, exactly as the Copy-Location-with-offset does.
 *
 * `gx` has already been negated for facing by `resolveFacing`; the procedural
 * layer's own offset is negated by the caller, for the same reason and against
 * the same `facing`.
 */
export function gazeTarget(
  camera: PerspectiveCamera,
  gx: number,
  gy: number,
  gz: number,
  out: V3,
): V3 {
  camera.getWorldPosition(out as unknown as Vector3)
  toBlender(out)
  out.x += gx
  out.y += gy
  out.z += gz
  return out
}
