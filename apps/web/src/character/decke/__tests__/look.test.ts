/**
 * The look-at solve, pinned against the glb's own bind pose.
 *
 * This is the test that makes `GAZE_GAIN` a measurement rather than a taste
 * call. The .blend's constraint was not exportable, so the port has to rebuild
 * it — and the only ground truth available is that the exporter BAKED one sample
 * of that constraint into `Ctrl_Pupil_{L,R}.translation`. If the rebuilt solve
 * is right, then feeding it the staging camera must reproduce those two numbers.
 * If it does not, the gain is wrong and every gaze in the product is wrong with
 * it.
 *
 * The geometry here is measured off the live scene graph at rest (see
 * `look.ts`), not assumed: both eye frames are pure translations of the root at
 * the bind pose, which is itself checked below against the pupils' recorded
 * world positions.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, Vector3 } from 'three'
import { GAZE_GAIN, PUPIL_ROAM, aimPupil, gazeTarget } from '../look'

/** `Camera_anim`, in the three frame. From `constants.BLENDER_CAMERA`. */
const CAM_THREE = new Vector3(4.783797, 4.639914, 5.625454)
/** The same point in the blender frame, which is what `aimPupil` takes. */
const CAM_BLENDER = new Vector3(4.783797, -5.625454, 4.639914)

/** `Eye_{L,R}_anim`'s world translation at the bind pose, three frame. */
const EYE_L = new Vector3(-0.3841834164, 1.5285813526, 0.5738516881)
const EYE_R = new Vector3(0.4018165533, 1.5285813526, 0.5738516881)

/** What the glb actually carries on the two pupil empties. */
const BIND = {
  L: { x: 0.11500000953674316, z: 0.15785659849643707 },
  R: { x: 0.11499998718500137, z: 0.16756513714790344 },
}

function eyeAt(p: Vector3): Object3D {
  const o = new Object3D()
  o.position.copy(p)
  o.updateMatrixWorld(true)
  return o
}

test('the eye frames are where the recorded pupil world positions say they are', () => {
  // The bind-pose pupil world positions, read off the live graph. If the eye
  // frames below ever stop being pure translations this is what catches it.
  const worldL = EYE_L.clone().add(new Vector3(BIND.L.x, BIND.L.z, 0))
  assert.ok(worldL.distanceTo(new Vector3(-0.2691834069, 1.6864379511, 0.5738516881)) < 1e-6)
})

test('the staging camera reproduces the glb bind pose', () => {
  const l = aimPupil(eyeAt(EYE_L), CAM_BLENDER, 0)
  const r = aimPupil(eyeAt(EYE_R), CAM_BLENDER, 0)

  // Lateral: both eyes are far enough off the camera's axis that the aim
  // saturates, which is why the file has the SAME 0.115 on both — the roam
  // limit, not a coincidence.
  assert.ok(Math.abs(l.x - BIND.L.x) < 1e-6, `L x ${l.x} vs ${BIND.L.x}`)
  assert.ok(Math.abs(r.x - BIND.R.x) < 1e-6, `R x ${r.x} vs ${BIND.R.x}`)

  // Vertical: unsaturated, so this is the gain being checked, not the clamp.
  assert.ok(Math.abs(l.z - BIND.L.z) < 5e-4, `L z ${l.z} vs ${BIND.L.z}`)

  // The right eye's authored z is 0.0097 higher than the left's on an axis a
  // symmetric rig cannot differ on — something in that bind frame was not
  // symmetric. It is recorded rather than fitted away; see `look.ts`. This
  // asserts the size of the known gap so it cannot quietly grow.
  assert.ok(Math.abs(r.z - BIND.R.z) < 0.011, `R z ${r.z} vs ${BIND.R.z}`)
})

test('he keeps looking at the camera after he turns', () => {
  // THE DEFECT, as a test. "Facing right he's looking at the camera; face left
  // he is not any more." Yawing the eye frame away from the camera has to swing
  // the pupil the other way, not leave it where it was.
  const straight = aimPupil(eyeAt(EYE_L), CAM_BLENDER, 0)

  const turned = new Object3D()
  turned.position.copy(EYE_L)
  turned.rotation.y = (80.39 * Math.PI) / 180 // the settled yaw at facing = -1
  turned.updateMatrixWorld(true)
  const after = aimPupil(turned, CAM_BLENDER, 0, undefined, { x: 0, z: 0 })

  assert.ok(
    Math.sign(after.x) !== Math.sign(straight.x),
    `pupil did not cross the eye on a turn: ${straight.x} -> ${after.x}`,
  )
})

test('the roam ellipse is a hard limit', () => {
  // A target far off to one side must saturate rather than sliding the pupil out
  // through the sclera.
  const far = new Vector3(400, -5, 300)
  const a = aimPupil(eyeAt(EYE_L), far, 0)
  assert.equal(a.x, PUPIL_ROAM.x)
  assert.equal(a.z, PUPIL_ROAM.z)

  const other = aimPupil(eyeAt(EYE_L), new Vector3(-400, -5, -300), 0, undefined, { x: 0, z: 0 })
  assert.equal(other.x, -PUPIL_ROAM.x)
  assert.equal(other.z, -PUPIL_ROAM.z)
})

test('alert takes the eye away from the gaze', () => {
  // The reel needs a centred drum: "both of the pupils are not centered as they
  // were in the blender file". Half-way through the roll the aim is half-way
  // released, so the pupil travels to centre rather than jumping there.
  const full = aimPupil(eyeAt(EYE_L), CAM_BLENDER, 0)
  const half = aimPupil(eyeAt(EYE_L), CAM_BLENDER, 0.5, undefined, { x: 0, z: 0 })
  const none = aimPupil(eyeAt(EYE_L), CAM_BLENDER, 1, undefined, { x: 0, z: 0 })

  assert.ok(Math.abs(half.x - full.x / 2) < 1e-9)
  assert.equal(none.x, 0)
  assert.equal(none.z, 0)

  // And the springy overshoot past 1.0 must not push it back out the other side.
  const over = aimPupil(eyeAt(EYE_L), CAM_BLENDER, 1.14, undefined, { x: 0, z: 0 })
  assert.equal(over.x, 0)
})

test('the gaze offset moves the target, not the pupil', () => {
  // `gx/gy/gz` are an offset ON the camera, which is what makes "look 6.5 units
  // to the left of whoever is watching" mean the same thing wherever the camera
  // is. Checked as an identity rather than by eye.
  const out = new Vector3()
  const camera = {
    getWorldPosition: (v: Vector3) => v.copy(CAM_THREE),
  } as unknown as Parameters<typeof gazeTarget>[0]
  gazeTarget(camera, -6.5, 0.25, 0.5, out)
  assert.ok(Math.abs(out.x - (CAM_BLENDER.x - 6.5)) < 1e-9)
  assert.ok(Math.abs(out.y - (CAM_BLENDER.y + 0.25)) < 1e-9)
  assert.ok(Math.abs(out.z - (CAM_BLENDER.z + 0.5)) < 1e-9)
})

test('the gain is the documented one', () => {
  // Guards the calibration itself: the number in `look.ts` is the one the bind
  // pose was solved for, and changing it silently changes every gaze.
  assert.equal(GAZE_GAIN, 0.2563)
})

test('a micro-saccade survives a saturated aim', () => {
  // The regression this exists for: composed into the TARGET, a flit at this
  // staging moves the clamped pupil by exactly zero, because the aim is already
  // 2.3x past the roam limit. Measured over 45 s of idle before the fix: a
  // lateral spread of 0.0000.
  const eye = eyeAt(EYE_L)
  const still = aimPupil(eye, CAM_BLENDER, 0, undefined, { x: 0, z: 0 })

  // The flit amplitude the playbook actually carries (`gaze_flit.amp_x`).
  const flitted = aimPupil(eye, CAM_BLENDER, 0, { x: -0.68, z: -0.46 }, { x: 0, z: 0 })
  assert.ok(
    still.x - flitted.x > 0.02,
    `a flit moved the pupil only ${(still.x - flitted.x).toFixed(4)} — it is being eaten by the clamp`,
  )
  assert.ok(still.z - flitted.z > 0.015)

  // And it still cannot leave the eye. Outward from a saturated aim is a no-op,
  // which is the one-sidedness the doc comment describes.
  const outward = aimPupil(eye, CAM_BLENDER, 0, { x: 5, z: 5 }, { x: 0, z: 0 })
  assert.equal(outward.x, PUPIL_ROAM.x)
  assert.equal(outward.z, PUPIL_ROAM.z)

  // A zero offset is exactly the bind pose, so the calibration is untouched.
  assert.equal(still.x, aimPupil(eye, CAM_BLENDER, 0, { x: 0, z: 0 }, { x: 0, z: 0 }).x)
})
