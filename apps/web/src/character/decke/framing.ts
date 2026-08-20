/**
 * How he is SEEN, as against where he stands.
 *
 * THE DEFECT. The camera is Blender's, fixed in place and aimed slightly below
 * his centre at the world origin, because that is the staging every parity still
 * was taken against and the 3/4 facing angle is defined relative to it. Parking
 * him anywhere else then hands the perspective two problems at once, and the
 * reviewer named both:
 *
 *   "We're still having this issue where right now he's like perfectly aligned,
 *    edges are straight, mostly parallel with the edges of the screen. But as
 *    soon as he's presenting, he's super off... see how this angle here is, it's
 *    like he's leaning forward. I'd like him to not be."
 *
 *   "He's like at a really weird angle when he's down here. He's not facing...
 *    he should be like, you know, roughly just this angle."
 *
 * Neither is a bug in the parking maths. They are what a fixed perspective
 * camera does to an object it is not pointed at:
 *
 *   1. THE YAW DRIFTS. The facing system puts him 40.195 degrees off
 *      camera-forward, which is what makes the 3/4 "standing beside it, facing
 *      inward" read. That angle is measured against the direction from the
 *      camera to the ORIGIN. Move him 40% of the way across the viewport and the
 *      direction from the camera to HIM is a different direction, so the 3/4
 *      view is no longer a 3/4 view.
 *
 *   2. HE LEANS. A camera pitched down has a vertical vanishing point below the
 *      frame, so world-vertical lines converge downward and anything off to one
 *      side keystones toward it. That is the lean, and it is strongest exactly
 *      where he spends most of his time — parked in a corner.
 *
 * THE FIX, and what it deliberately does NOT fix. Give every parked position its
 * own view frame and rotate him into it, so his relationship to the LINE OF
 * SIGHT is the same wherever he is. That kills both — a rendering that matches
 * the staged one is a rendering with the staged yaw and no lean.
 *
 * It would also kill the vertical parallax, and that one is wanted:
 *
 *   "I was kind of thinking that when he's presenting, the camera space is like
 *    center of the DOM. So that if he's up here, it's like he's above the
 *    camera. And if he's down here, it's like he's below the camera... at the top
 *    of the page it's like he's above the camera, at the bottom of the page it's
 *    like he's below the camera, in the middle of the page he's kind of aligned
 *    with the camera, on a vertical. He should always be at this angle on the
 *    yaw, but then a higher or lower angle, like this visual angle."
 *
 * So the alignment is applied and then its ELEVATION component is taken back
 * out, leaving azimuth and roll corrected and the vertical angle free to follow
 * his height on the page. That is one virtual camera per position, level with
 * the middle of the viewport, which is what "camera space is the center of the
 * DOM" means geometrically.
 *
 * A MOVE STRAIGHT UP OR DOWN PRODUCES ALMOST NO ROTATION AT ALL, and that is
 * the design rather than a bug. It looks like one: park him at the top of the
 * page and at the bottom and the quaternion reads as the identity to five
 * decimal places both times, which invites the conclusion that the vertical cue
 * is not wired up. It is — it is just not this layer's job. A purely vertical
 * move changes neither his azimuth nor his roll, so the alignment has nothing to
 * correct; and the pitch give-back then deliberately adds nothing either,
 * because `PITCH_FOLLOW = 1` means "let the camera do it". Measured over a
 * 780 px vertical sweep at the shipped framing: the quaternion moves by 1e-5 and
 * the angle you are looking at him from swings 37.5 degrees. The rotation this
 * module produces is for HORIZONTAL travel, which is where the yaw drift and the
 * keystone lean both live.
 *
 * WHAT THIS IS NOT. It is not a billboard and it is not a lookAt. He is not
 * turned to face the camera — his own facing yaw still sits underneath this and
 * still turns him a full 80.39 degrees between his two directions. This only
 * says which way is "toward the viewer" at the place he happens to be standing.
 */
import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { BODY_H } from './constants'

/**
 * How much of the natural vertical parallax to keep, after the alignment has
 * removed all of it.
 *
 * 1 is exactly what an ordinary camera at the middle of the viewport would show,
 * which at the shipped framing is about +/- 10 degrees between the top and the
 * bottom of a 900 px window — a real cue and a gentle one. 0 would pin him level
 * everywhere and is what the alignment alone gives.
 */
export const PITCH_FOLLOW = 1

/**
 * How far the vertical cue is allowed to run before it stops growing, as a
 * multiple of the camera's HALF vertical fov.
 *
 * The parallax is a function of where he is on the page, and the page is taller
 * than the window — so a rule with no ceiling keeps tilting him further the
 * further he scrolls past the edge, long after there is any screen left for the
 * cue to mean anything on. Ten degrees across the window became forty with him
 * three screens down, which is what the review was looking at:
 *
 *   "At the top of the viewport it's like he's a little bit above the camera,
 *    and at the bottom of the window he's a little bit below the camera. AND
 *    BEYOND THAT, HE DOESN'T NEED TO SHIFT, REALLY."
 *
 * Half the vertical fov is the elevation of the frame edge, so his centre can
 * only reach this limit by leaving the frame: inside the window the clamp is
 * never active and the shipped cue is untouched, and outside it the angle simply
 * holds at what it was when he left.
 */
const PITCH_LIMIT_FOVS = 0.5

/** His centre, up the body axis from the rig origin at his feet. Everything here
 *  is measured to the centre, because that is what the eye reads as "him" — and
 *  because rotating about his feet would swing his head across the screen. */
export const CENTRE_OFFSET = BODY_H / 2

export type Framing = {
  /** The orientation to apply above his facing node. */
  quaternion: Quaternion
  /** Where the rig ORIGIN goes, once the rotation is taken about his centre. */
  position: Vector3
  /** The azimuth part of `quaternion`, in radians. The environment map is a
   *  sphere and can only be turned, so this is its share. */
  yaw: number
}

export function makeFraming(): Framing {
  return { quaternion: new Quaternion(), position: new Vector3(), yaw: 0 }
}

const _c = new Vector3()
const _camUp = new Vector3()
const _w = new Vector3()
const _u = new Vector3()
const _r = new Vector3()
const _w0 = new Vector3()
const _u0 = new Vector3()
const _r0 = new Vector3()
const _m = new Matrix4()
const _m0 = new Matrix4()
const _qAlign = new Quaternion()
const _qPitch = new Quaternion()
const _fwd = new Vector3()
const _centre = new Vector3()

/**
 * The view frame at a point: which way is INTO the screen, which way is UP on
 * the screen, and which way is RIGHT.
 *
 * `u` is the exact answer to "which direction appears vertical here", not an
 * approximation of it. A direction `d` at a point `P` draws a screen line from
 * `P` toward `d`'s vanishing point, so `d` appears vertical exactly when `d`
 * lies in the plane spanned by the view ray and the camera's own up axis. The
 * component of `camUp` perpendicular to the ray is the one such direction that
 * is also perpendicular to the ray, which is what a frame needs.
 *
 * `r` cannot be exact at the same time — a rectangle seen off-axis genuinely
 * keystones and no rigid rotation makes both of its axes screen-parallel. The
 * vertical is the one that matters: a character who leans reads as broken, where
 * a couple of degrees of horizontal shear reads as perspective.
 */
function viewFrame(
  camPos: Vector3,
  camUp: Vector3,
  point: Vector3,
  w: Vector3,
  u: Vector3,
  r: Vector3,
): void {
  w.copy(point).sub(camPos)
  // Degenerate only if he is exactly at the camera, which cannot happen — but a
  // zero-length basis would produce NaN quaternions that persist forever.
  if (w.lengthSq() < 1e-12) w.set(0, 0, -1)
  w.normalize()
  u.copy(camUp).addScaledVector(w, -camUp.dot(w))
  if (u.lengthSq() < 1e-12) u.set(0, 1, 0).addScaledVector(w, -w.y)
  u.normalize()
  r.crossVectors(w, u).normalize()
}

/**
 * Solve the framing for a rig origin at `rootThree`, in the three.js frame.
 *
 * `staging` is where the camera was aimed when the character was posed — the
 * world origin — and is what every angle here is measured RELATIVE to, so that
 * the solve is the identity at the staging position and parity mode is
 * unaffected.
 */
export function solveFraming(
  camera: PerspectiveCamera,
  rootThree: Vector3,
  out: Framing,
  pitchFollow = PITCH_FOLLOW,
): Framing {
  camera.getWorldPosition(_c)
  _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize()

  _centre.copy(rootThree)
  _centre.y += CENTRE_OFFSET
  viewFrame(_c, _camUp, _centre, _w, _u, _r)

  // The staging frame: his centre at the world origin, which is where the
  // Blender camera is aimed and where every authored pose was judged.
  _fwd.set(0, CENTRE_OFFSET, 0)
  viewFrame(_c, _camUp, _fwd, _w0, _u0, _r0)

  _m.makeBasis(_r, _u, _w)
  _m0.makeBasis(_r0, _u0, _w0)
  // M * M0^-1, and M0 is orthonormal so the inverse is the transpose.
  _m0.transpose()
  _m.multiply(_m0)
  _qAlign.setFromRotationMatrix(_m)

  // Give the vertical angle back. The elevation of a view ray above the camera's
  // own optical axis is its component along the camera's up vector; the
  // DIFFERENCE from the staging ray is exactly what the alignment removed.
  const e = Math.asin(Math.max(-1, Math.min(1, _w.dot(_camUp))))
  const e0 = Math.asin(Math.max(-1, Math.min(1, _w0.dot(_camUp))))
  // CLAMP `e`, NOT `e - e0`. They differ by the staging ray's own elevation —
  // the Blender camera is aimed a little below his centre — so limiting the
  // DIFFERENCE starts cutting the cue while he is still comfortably on screen,
  // which is a change to the shipped framing rather than a bound on it. `e` is
  // measured against the camera's own optical axis, so `|e| = fov/2` is exactly
  // the frame edge and nothing inside the window is touched.
  const limit = ((camera.fov * Math.PI) / 180) * PITCH_LIMIT_FOVS
  const eClamped = Math.max(-limit, Math.min(limit, e))
  _qPitch.setFromAxisAngle(_r, -(eClamped - e0) * pitchFollow)
  out.quaternion.copy(_qPitch).multiply(_qAlign)

  // Rotate about his CENTRE, not his feet: the rig origin is at his base, and a
  // rotation there swings his head by most of a body length. Composing
  // T(centre) * R * T(-centre) leaves the centre exactly where the parking
  // solve put it, which is what keeps him lined up with the element he is
  // presenting.
  _fwd.set(0, CENTRE_OFFSET, 0)
  out.position.copy(_fwd).applyQuaternion(out.quaternion).negate().add(_fwd).add(rootThree)

  // The environment is a sphere: it can follow him in azimuth and nothing else.
  // Without this his metal is lit from a different side at every place he parks,
  // which is the same complaint as the lights and has the same answer.
  _fwd.set(0, 0, 1).applyQuaternion(out.quaternion)
  out.yaw = Math.atan2(_fwd.x, _fwd.z)
  return out
}
