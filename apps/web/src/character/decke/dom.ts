/**
 * Mapping a DOM element to a place for Deck-E to stand.
 *
 * Nothing in the character wiki covers this — it specifies how he flies, not
 * where to. Everything here is a designed decision, and the reasoning is spelled
 * out because there is no upstream source to check it against.
 */
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { BODY_H, BODY_W } from './constants'

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
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
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
  const worldPerPx = (2 * Math.tan(vFov / 2) * distance) / window.innerHeight
  const bodyPx = BODY_W / worldPerPx

  const spaceLeft = rect.left
  const spaceRight = window.innerWidth - rect.right
  let side = opts.side
  if (side === 'auto') side = spaceRight >= spaceLeft ? 'right' : 'left'

  const gap = bodyPx * SIDE_MARGIN
  let x = side === 'right' ? rect.right + gap : rect.left - gap
  // Never let him leave the viewport, however cramped the layout is.
  x = Math.max(bodyPx * 0.6, Math.min(window.innerWidth - bodyPx * 0.6, x))
  const y = rect.top + rect.height / 2

  const position = viewportToBlender(camera, x, y, distance)
  // His ROOT is at his base, not his centre — the rig origin sits at his feet
  // and the body extends 2.4 units up from it. Dropping the target by half his
  // height is what makes him straddle the element's centre line instead of
  // standing on it with his whole body above.
  position.z -= BODY_H / 2

  // Standing to the RIGHT of a thing means facing LEFT to look at it.
  const facing = side === 'right' ? -1 : 1
  return { position, facing }
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
    cruise: dist > 4 ? 0.08 : 0.1,
  }
}
