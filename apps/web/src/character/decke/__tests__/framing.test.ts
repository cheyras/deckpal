/**
 * The framing solve, checked against the four things it promises.
 *
 * This is the layer that decides how he is ORIENTED wherever he happens to be
 * parked, and every one of its promises is a thing the reviewer named on screen:
 * he keeps his 3/4 yaw, he does not lean, he is seen from above when he is low
 * on the page and from below when he is high, and he does not drift off the mark
 * the parking solve put him on. None of those is checkable by reading the
 * quaternion, so all four are checked as PROPERTIES of the rendered geometry.
 *
 * The fifth test is the one that protects everything else in the project: at the
 * staging origin the solve must be exactly the identity, or every parity still
 * ever taken against Blender is measuring a different character.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree, BODY_H } from '../constants'
import { CENTRE_OFFSET, makeFraming, solveFraming } from '../framing'
import { envRotation, envRotationForFacing } from '../stage'

function stagingCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(BLENDER_CAMERA.fovDeg, 16 / 9, BLENDER_CAMERA.near, BLENDER_CAMERA.far)
  cam.position.copy(
    blenderToThree(
      BLENDER_CAMERA.position.x,
      BLENDER_CAMERA.position.y,
      BLENDER_CAMERA.position.z,
    ),
  )
  cam.quaternion.copy(
    blenderCameraQuaternion(
      BLENDER_CAMERA.rotationEuler.x,
      BLENDER_CAMERA.rotationEuler.y,
      BLENDER_CAMERA.rotationEuler.z,
    ),
  )
  cam.updateMatrixWorld(true)
  return cam
}

const cam = stagingCamera()
const out = makeFraming()

/** Solve at a rig-origin position, in the three frame. */
function at(x: number, y: number, z: number) {
  return solveFraming(cam, new Vector3(x, y, z), out)
}

/** His centre, given a rig origin. */
function centre(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y + CENTRE_OFFSET, z)
}

/** Where a world point lands on a 1000 x 1000 screen. */
function project(p: Vector3): { x: number; y: number } {
  const v = p.clone().project(cam)
  return { x: (v.x * 0.5 + 0.5) * 1000, y: (-v.y * 0.5 + 0.5) * 1000 }
}

test('the staging origin is exactly the identity', () => {
  // THE PARITY GUARANTEE. Every still in `PARITY.md` was taken with him at the
  // world origin, and the whole comparison is only meaningful if this layer is a
  // no-op there. It is by construction — the solve measures everything relative
  // to the staging frame — and this pins it so a future refactor cannot quietly
  // introduce a constant offset.
  const f = at(0, 0, 0)
  assert.ok(f.quaternion.angleTo(new Quaternion()) < 1e-9, `rotated by ${f.quaternion.angleTo(new Quaternion())}`)
  assert.ok(f.position.length() < 1e-9, `moved to ${f.position.toArray()}`)
  assert.ok(Math.abs(f.yaw) < 1e-9)
})

test('he does not lean, wherever he stands', () => {
  // "Right now he's like perfectly aligned, edges are straight, mostly parallel
  // with the edges of the screen. But as soon as he's presenting, he's super
  // off... it's like he's leaning forward. I'd like him to not be."
  //
  // Checked as the thing the eye actually sees: project his own up axis at the
  // top and the bottom, and measure how far the line between them tilts from
  // screen vertical. The UNCORRECTED case is included so the numbers mean
  // something — this is a comparison, not an absolute.
  const spots: [number, number, number][] = [
    [3.2, 0.4, 1.1],
    [-3.6, -1.4, 0.8],
    [2.4, 2.6, -1.2],
    [-1.8, 2.2, 2.0],
  ]
  for (const [x, y, z] of spots) {
    const f = at(x, y, z)
    // Two points on his own vertical axis, after the framing rotation.
    const base = new Vector3(0, 0, 0).applyQuaternion(f.quaternion).add(f.position)
    const top = new Vector3(0, BODY_H, 0).applyQuaternion(f.quaternion).add(f.position)
    const a = project(base)
    const b = project(top)
    const tiltDeg = Math.abs((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI)

    // The same two points with NO framing applied, which is what used to ship.
    const ua = project(new Vector3(x, y, z))
    const ub = project(new Vector3(x, y + BODY_H, z))
    const rawDeg = Math.abs((Math.atan2(ub.x - ua.x, ua.y - ub.y) * 180) / Math.PI)

    assert.ok(tiltDeg < 0.6, `leans ${tiltDeg.toFixed(2)} deg at ${x},${y},${z}`)
    assert.ok(
      rawDeg > tiltDeg,
      `the framing did not improve the lean at ${x},${y},${z} (${rawDeg.toFixed(2)} -> ${tiltDeg.toFixed(2)})`,
    )
  }
})

/** The view frame at a point — the same construction `framing.ts` uses, rebuilt
 *  here so the tests measure the result rather than trusting the module. */
function viewFrame(p: Vector3) {
  const camUp = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize()
  const w = p.clone().sub(cam.position).normalize()
  const u = camUp.clone().addScaledVector(w, -camUp.dot(w)).normalize()
  const r = new Vector3().crossVectors(w, u).normalize()
  return { w, u, r }
}

/** How far round he READS as turned, at the place he is standing: the bearing of
 *  his forward axis within the view frame, in degrees. */
function apparentYaw(forward: Vector3, p: Vector3): number {
  const { w, r } = viewFrame(p)
  return (Math.atan2(forward.dot(r), forward.dot(w)) * 180) / Math.PI
}

/** How far you are looking UP at him, in degrees. Negative is looking down. */
function apparentPitch(up: Vector3, p: Vector3): number {
  const { w } = viewFrame(p)
  return (Math.asin(Math.max(-1, Math.min(1, up.dot(w)))) * 180) / Math.PI
}

const SPOTS: [number, number, number][] = [
  [3.0, 1.2, 0.6],
  [-2.8, -1.6, 1.4],
  [1.2, 3.0, -2.0],
  [3.5, 0.5, 0],
  [-3.5, 0.5, 0],
]

test('his yaw against the line of sight barely moves, where it used to swing', () => {
  // The facing system puts him 40.195 degrees off camera-forward, and that angle
  // IS the 3/4 read: "he should always be at this angle on the yaw." It is
  // defined against the direction from the camera to the ORIGIN, so parking him
  // anywhere else used to change it.
  //
  // A RESIDUAL IS EXPECTED AND IS NOT AN ERROR. The framing gives back the
  // vertical parallax on purpose (see the next test), and pitching a turned
  // object always shifts its apparent bearing a little — a real camera does the
  // same. So the test is comparative: what matters is that the swing is a few
  // degrees where it used to be tens.
  const base = at(0, 0, 0)
  const ref = apparentYaw(
    new Vector3(0, 0, 1).applyQuaternion(base.quaternion),
    centre(0, 0, 0),
  )
  let worst = 0
  let worstRaw = 0
  for (const [x, y, z] of SPOTS) {
    const f = at(x, y, z)
    const got = apparentYaw(new Vector3(0, 0, 1).applyQuaternion(f.quaternion), centre(x, y, z))
    // Uncorrected: his forward is world +Z, wherever he stands. That is what
    // shipped, and what "as soon as he's presenting, he's super off" described.
    const raw = apparentYaw(new Vector3(0, 0, 1), centre(x, y, z))
    worst = Math.max(worst, Math.abs(got - ref))
    worstRaw = Math.max(worstRaw, Math.abs(raw - ref))
  }
  assert.ok(worst < 7, `3/4 angle swings ${worst.toFixed(1)} deg`)
  assert.ok(
    worstRaw > worst * 2,
    `the framing barely improved the yaw: ${worstRaw.toFixed(1)} -> ${worst.toFixed(1)} deg`,
  )
})

test('the vertical angle follows his height on the page, at full strength', () => {
  // "At the top of the page it's like he's above the camera, at the bottom of the
  // page it's like he's below the camera, in the middle of the page he's kind of
  // aligned with the camera, on a vertical."
  //
  // High on screen you should be looking UP at him and low on screen DOWN, and
  // by the amount an ordinary camera at the middle of the viewport would give —
  // that is what `PITCH_FOLLOW = 1` means. So this checks both the direction of
  // the cue and its size, against the uncorrected perspective.
  const pitchAt = (x: number, y: number, z: number) => {
    const f = at(x, y, z)
    return apparentPitch(new Vector3(0, 1, 0).applyQuaternion(f.quaternion), centre(x, y, z))
  }
  const rawAt = (x: number, y: number, z: number) =>
    apparentPitch(new Vector3(0, 1, 0), centre(x, y, z))

  const high = pitchAt(0, 3.4, 0)
  const level = pitchAt(0, 0, 0)
  const low = pitchAt(0, -3.4, 0)
  assert.ok(high > level + 5, `no upward cue when high: ${high.toFixed(1)} vs ${level.toFixed(1)}`)
  assert.ok(low < level - 5, `no downward cue when low: ${low.toFixed(1)} vs ${level.toFixed(1)}`)

  for (const [x, y, z] of SPOTS) {
    const got = pitchAt(x, y, z)
    const raw = rawAt(x, y, z)
    assert.ok(
      Math.abs(got - raw) < 2.5,
      `the vertical cue is ${Math.abs(got - raw).toFixed(1)} deg off the natural one at ${x},${y},${z}`,
    )
  }
})

test('the rotation pivots on his centre, not his feet', () => {
  // The parking solve puts his CENTRE on the element's centre line. A rotation
  // about the rig origin — which is at his feet — would swing his head most of a
  // body length across the screen and take him off the mark.
  for (const [x, y, z] of [
    [3.2, 1.0, 0.5],
    [-2.0, -2.4, 1.8],
  ] as [number, number, number][]) {
    const f = at(x, y, z)
    const moved = new Vector3(0, CENTRE_OFFSET, 0).applyQuaternion(f.quaternion).add(f.position)
    assert.ok(
      moved.distanceTo(centre(x, y, z)) < 1e-9,
      `centre moved ${moved.distanceTo(centre(x, y, z))} at ${x},${y},${z}`,
    )
  }
})

test('the environment yaw matches the rotation it is compensating', () => {
  // The environment is a sphere and can only turn, so it gets the azimuth part.
  // If this disagreed with the quaternion his metal would be lit from a
  // different side at every place he parks — the same defect as the lights,
  // reached a different way.
  for (const [x, y, z] of [
    [3.5, 0.5, 0],
    [-3.5, 0.5, 0],
  ] as [number, number, number][]) {
    const f = at(x, y, z)
    const fwd = new Vector3(0, 0, 1).applyQuaternion(f.quaternion)
    assert.ok(Math.abs(Math.atan2(fwd.x, fwd.z) - f.yaw) < 1e-9)
  }
  // And the two sides turn opposite ways, or it is not tracking him at all.
  assert.ok(at(3.5, 0.5, 0).yaw * at(-3.5, 0.5, 0).yaw < 0)
})

test('a degenerate position cannot produce NaN', () => {
  // A NaN quaternion is permanent: it propagates into every matrix below it and
  // the character never comes back. The camera position itself is the one input
  // that makes the basis degenerate.
  const f = solveFraming(cam, cam.position.clone().sub(new Vector3(0, CENTRE_OFFSET, 0)), out)
  for (const v of [...f.quaternion.toArray(), ...f.position.toArray(), f.yaw]) {
    assert.ok(Number.isFinite(v), `non-finite framing component: ${v}`)
  }
})

test('the environment turns with him, by the law the facing pair already sets', () => {
  // The risky sign is the FRAMING term in `envRotation`, and comparing it with
  // the quaternion it came from would be circular — both are computed from the
  // same atan2. So it is checked against a term that is known correct: the
  // facing pair, which was measured against Blender. Turning the character
  // +80.39 degrees about Y pairs with turning the environment -80.39. The
  // framing yaw turns him about the same axis in the same sense, so it must
  // move the environment the same way, by the same amount.
  const facingDelta = envRotationForFacing(-1) - envRotationForFacing(1)
  const objectDelta = (80.39 * Math.PI) / 180 // what `rig.facing.rotation.y` does
  assert.ok(
    Math.abs(facingDelta + objectDelta) < 1e-9,
    `the facing pair is not equal-and-opposite: ${facingDelta} vs ${objectDelta}`,
  )
  // Now the framing term, against that same law.
  const yaw = 0.3
  assert.ok(
    Math.abs(envRotation(1, yaw) - envRotation(1, 0) + yaw) < 1e-12,
    'a framing yaw does not turn the environment equal-and-opposite',
  )
  // And the two compose rather than fighting: both turning him one way turns the
  // environment the other way twice.
  assert.ok(envRotation(-1, 0.3) < envRotation(1, 0))
})

test('the vertical cue stops growing once he has left the frame', () => {
  // "At the top of the viewport it's like he's a little bit above the camera,
  //  and at the bottom of the window he's a little bit below the camera. AND
  //  BEYOND THAT, HE DOESN'T NEED TO SHIFT, REALLY."
  //
  // The page is taller than the window, so an unbounded rule keeps tilting him
  // further the further he scrolls past the edge — reviewed from the top of a
  // long page as "we're like looking at him almost completely from the top down
  // here". The limit is half the vertical fov, which IS the frame edge, so the
  // property has two halves and both matter: it must bite outside the window,
  // and it must not be detectable inside it.
  const pitch = (y: number) =>
    apparentPitch(new Vector3(0, 1, 0).applyQuaternion(at(0, y, 0).quaternion), centre(0, y, 0))

  // Far outside the frame, top and bottom, the cue is FLAT — going further
  // changes nothing.
  assert.ok(Math.abs(pitch(9) - pitch(14)) < 1e-6, `still moving above the frame`)
  assert.ok(Math.abs(pitch(-9) - pitch(-14)) < 1e-6, `still moving below the frame`)

  // And it is a clamp, not a cap on the whole cue: the two ends are still a long
  // way apart, and the middle still moves monotonically between them.
  assert.ok(pitch(9) - pitch(-9) > 25, `the cue collapsed: ${(pitch(9) - pitch(-9)).toFixed(1)} deg`)
  let prev = -Infinity
  for (let y = -3; y <= 3; y += 0.5) {
    const v = pitch(y)
    assert.ok(v > prev, `not monotonic through the window at y=${y}`)
    prev = v
  }
})

test('at pitchFollow 0 he is seen from the same angle wherever he is', () => {
  // What the BEACON CHIP renders with. "When he's in this little pointer, as we
  // go down you notice that his angle goes down and I don't want that to happen
  // when he's in here... I'd like it to be as though the camera is just on his
  // level. Vertically centred with him."
  //
  // The chip only exists when he is off screen, which is exactly when the
  // vertical cue has nothing left to say. Solving at zero give-back leaves the
  // alignment alone, and the alignment's whole job is to make his relationship
  // to the LINE OF SIGHT the same everywhere — so this angle must not move at
  // all, over a sweep far larger than any viewport.
  const level = makeFraming()
  const seenFrom = (y: number) => {
    solveFraming(cam, new Vector3(0, y, 0), level, 0)
    return apparentPitch(new Vector3(0, 1, 0).applyQuaternion(level.quaternion), centre(0, y, 0))
  }
  const ref = seenFrom(0)
  for (const y of [-14, -9, -5, -2.5, 0, 2.5, 5, 9, 14]) {
    assert.ok(
      Math.abs(seenFrom(y) - ref) < 1e-6,
      `the chip tilts by ${(seenFrom(y) - ref).toFixed(3)} deg at y=${y}`,
    )
  }
  // And it is not the same as the main view, or the chip would not be fixing
  // anything: at the same place, with the cue on, he is seen from elsewhere.
  const withCue = apparentPitch(
    new Vector3(0, 1, 0).applyQuaternion(at(0, 5, 0).quaternion),
    centre(0, 5, 0),
  )
  assert.ok(Math.abs(withCue - ref) > 5, `the cue and the chip agree — is the cue wired up?`)
})
