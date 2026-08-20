/**
 * Mapping a DOM element to a place for Deck-E to stand.
 *
 * Nothing in the character wiki covers this — it specifies how he flies, not
 * where to. Everything here is a designed decision, and the reasoning is spelled
 * out because there is no upstream source to check it against.
 */
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { BODY_H, BODY_W } from './constants'
import { viewHeight, viewWidth } from './viewport'

export type Depth = 'foreground' | 'background'
export type Side = 'auto' | 'left' | 'right'

export type FlyTarget =
  | { selector: string }
  | { rect: DOMRect }
  | { x: number; y: number }

/**
 * Apparent scale at the background plane, matching the Blender staging: he
 * recedes to a third of his foreground size. Implemented as distance rather than
 * a scale, so perspective does the work and he genuinely looks further away.
 */
export const BACKGROUND_SCALE = 0.333

/** How far to his side of the element he parks, as a multiple of his own width.
 *  He stands BESIDE the thing he is showing, never on top of it. */
const SIDE_MARGIN = 0.9

/** Where `returnHome` puts him, as a fraction of the viewport in from the
 *  bottom-right corner. "For now, let's have home be, like, actually in the
 *  bottom right corner" — a parking spot, not a stage mark, and it will move
 *  again once he is wired into the real product chrome. */
const HOME_INSET = { x: 0.17, y: 0.22 } as const

export function resolveRect(target: FlyTarget): DOMRect | null {
  if ('selector' in target) {
    const el = document.querySelector(target.selector)
    return el ? el.getBoundingClientRect() : null
  }
  if ('rect' in target) return target.rect
  return new DOMRect(target.x, target.y, 0, 0)
}

/**
 * Unproject a viewport point onto a plane at a chosen distance in front of the
 * camera, and return it in the BLENDER frame (which is what the flight solver
 * and the rig both speak).
 */
export function viewportToBlender(
  camera: PerspectiveCamera,
  clientX: number,
  clientY: number,
  distance: number,
  out = new Vector3(),
): Vector3 {
  const ndc = new Vector2(
    (clientX / viewWidth()) * 2 - 1,
    -(clientY / viewHeight()) * 2 + 1,
  )
  const ray = new Raycaster()
  ray.setFromCamera(ndc, camera)

  const fwd = new Vector3()
  camera.getWorldDirection(fwd)
  const camPos = new Vector3()
  camera.getWorldPosition(camPos)
  const planePoint = camPos.clone().addScaledVector(fwd, distance)
  const plane = new Plane().setFromNormalAndCoplanarPoint(fwd.clone().negate(), planePoint)

  const hit = new Vector3()
  if (!ray.ray.intersectPlane(plane, hit)) hit.copy(planePoint)

  // three Y-up -> Blender Z-up, and drop him to his own base (the rig's origin
  // is at his feet, so an unadjusted point puts his base at the element's centre
  // and his body above it).
  return out.set(hit.x, -hit.z, hit.y)
}

export type ParkResult = {
  /** Where to fly to, in the Blender frame. */
  position: Vector3
  /** Which way he should face so he looks INWARD at the element. */
  facing: number
}

/**
 * Choose a spot beside an element and the facing that looks at it.
 *
 * `auto` puts him on whichever side has more room. Facing is then whichever
 * direction turns him toward the element — the whole point is that he presents
 * the thing rather than turning his back on it.
 */
export function parkBeside(
  camera: PerspectiveCamera,
  rect: DOMRect,
  opts: { depth: Depth; side: Side; baseDistance: number },
): ParkResult {
  const distance =
    opts.depth === 'background' ? opts.baseDistance / BACKGROUND_SCALE : opts.baseDistance

  // How wide is he, in CSS pixels, at this depth? Needed so the margin is a real
  // gap rather than a guess that collapses at the background plane.
  const vFov = (camera.fov * Math.PI) / 180
  const worldPerPx = (2 * Math.tan(vFov / 2) * distance) / viewHeight()
  const bodyPx = BODY_W / worldPerPx

  // WHICH SIDE HE STANDS ON IS DECIDED BY THE ELEMENT'S HALF OF THE SCREEN,
  // NOT BY WHERE THERE HAPPENS TO BE ROOM.
  //
  // The old rule put him wherever the larger gap was, which for anything left
  // of centre means "over on the right", a long way from the thing he is meant
  // to be presenting. Reviewed as: "these targets are not really accurate — I
  // clicked this and I would expect him to be flying right HERE instead of
  // where he is."
  //
  // The rule asked for instead: "if the DOM element is anywhere on the right
  // half of the screen, he should go to the right of that element and face
  // inward. If it's to the left of the screen, then he should go to the left of
  // that element and face inward toward the center of the screen." So he ends
  // up OUTBOARD of the element and looks back across it — the element sits
  // between him and the middle of the page, which is where the reader is.
  const centre = rect.left + rect.width / 2
  let side: 'left' | 'right' =
    opts.side !== 'auto' ? opts.side : centre >= viewWidth() / 2 ? 'right' : 'left'

  const gap = bodyPx * SIDE_MARGIN
  const margin = bodyPx * 0.6
  // THE EDGE EXCEPTION, and it is the only one: "if he's flying to something
  // that is right on the edge — like the nav over here on a standard page —
  // obviously if he goes to the left of that, he's off the screen. So that
  // would be the only exception; I would have him go to the right of it and
  // look that way." Outboard is a preference; being on screen is not.
  const outboard = side === 'right' ? rect.right + gap : rect.left - gap
  if (outboard < margin || outboard > viewWidth() - margin) {
    side = side === 'right' ? 'left' : 'right'
  }

  let x = side === 'right' ? rect.right + gap : rect.left - gap
  // Never let him leave the viewport, however cramped the layout is.
  x = Math.max(margin, Math.min(viewWidth() - margin, x))
  const y = rect.top + rect.height / 2

  const position = viewportToBlender(camera, x, y, distance)
  // His ROOT is at his base, not his centre — the rig origin sits at his feet
  // and the body extends 2.4 units up from it. Dropping the target by half his
  // height is what makes him straddle the element's centre line instead of
  // standing on it with his whole body above.
  position.z -= BODY_H / 2

  // FACING IS IN HIS FRAME, NOT THE VIEWER'S, AND THIS HAD IT BACKWARDS.
  //
  // "When he goes to present something, he's facing away from it, which is
  // incorrect. He's always facing away from it." Always, and on both sides,
  // which is the signature of a sign rather than of a rule.
  //
  // The rule itself was right: standing to the viewer's right of a thing means
  // turning toward the viewer's LEFT to look at it. What was wrong is which
  // `facing` value that is. `facing` is named from HIS point of view — the
  // reviewer's note is "we need to remember that these are talking about his
  // right and his left rather than viewer right and viewer left" — so `+1` turns
  // him to HIS right, which the viewer sees as turning to screen LEFT.
  // Confirmed on screen at both ends before this was changed.
  //
  // So: on the viewer's right of the element, face `+1`. It holds after the edge
  // exception too — whichever side he ended up on, he turns back across it.
  const facing = side === 'right' ? 1 : -1
  return { position, facing }
}

/**
 * The parking spot `returnHome` flies to, in the BLENDER frame.
 *
 * Bottom-right of the VIEWPORT rather than the origin of the world. The origin
 * is where he is STAGED for review — it is what the Blender camera frames and
 * where every parity still is taken — but it is the worst place to leave an
 * assistant on a page, because it is on top of the content. Deriving it from the
 * viewport also means it survives a resize, which a world coordinate cannot.
 */
export function homeCorner(camera: PerspectiveCamera, baseDistance: number): Vector3 {
  const p = viewportToBlender(
    camera,
    viewWidth() * (1 - HOME_INSET.x),
    viewHeight() * (1 - HOME_INSET.y),
    baseDistance,
  )
  p.z -= BODY_H / 2
  return p
}

/**
 * Path shaping for an arbitrary A->B.
 *
 * The three `arc`/`bow` values in the source are hand-picked constants for three
 * hand-picked Blender legs; an arbitrary DOM destination needs them derived.
 * Both scale with distance, and `bow` alternates sign per leg so an out-and-back
 * traces a lens rather than retracing one line.
 */
export function shapeFor(a: Vector3, b: Vector3, legIndex: number) {
  const dist = a.distanceTo(b)
  return {
    // He rises into the trip and descends onto the mark.
    arc: Math.min(1.1, 0.18 + dist * 0.06),
    // Lateral sweep is what makes a long move read as flight rather than a zoom.
    bow: Math.min(4, dist * 0.22) * (legIndex % 2 === 0 ? 1 : -1),
    // Short hops are crisper; the long traverse gets a lower cruise so it reads
    // as covering ground rather than darting.
    //
    // NOT the knob for overall pace, however much it looks like one. These are
    // the solver's INTEGRATION speeds, and it integrates until it arrives:
    // raising them shortens the trip right up to the point where the
    // stopping-distance law overshoots its own settle window every frame and the
    // leg limit-cycles out to the 600-frame cap. Measured, raising the long
    // cruise from 0.08 to 0.185 turned a 3067 ms leg into a 20167 ms one — the
    // cap exactly. Pace is set by `TRAVEL_RATE` in `flight.ts`, which scales the
    // finished track and cannot destabilise a controller that has already run.
    cruise: dist > 4 ? 0.08 : 0.1,
  }
}
