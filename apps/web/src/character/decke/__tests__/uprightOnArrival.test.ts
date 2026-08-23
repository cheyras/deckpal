/**
 * D8 — "visibly tilted / tumbling on close and reopen."
 *
 * ── WHAT WAS ACTUALLY WRONG, AND WHAT WAS NOT ────────────────────────────────
 *
 * The brief called the root cause "probable, not proven" and pointed at the
 * authored flight lean. Two candidates were ruled out by measurement rather
 * than by reading:
 *
 *   LEAD_MAX 34 → 20   did not fix it. The composed pose also takes
 *                      `rig.float.rotation` and `pose.lean * 15` through the
 *                      rider system, both ADDITIVE on top of the flight track,
 *                      so capping one term leaves the sum tilted.
 *
 *   the boxcar bleed   is not the mechanism at the head of a track. `boxcar`
 *                      runs `i = 2 .. len-3`, so samples 0 and 1 are never
 *                      smoothed and never pick up a later value. Sample 0's
 *                      rotation is the RAW launch lean — an object that starts
 *                      accelerating tilts, and that is authored, not a defect.
 *
 * Measured across four leg shapes: first-sample rotation runs 0.2°–9.1° and
 * PEAK mid-flight |rx| reaches 24.8° on a close/reopen-shaped leg. A screenshot
 * taken mid-flight will therefore show a steeply tilted character and be
 * completely correct. That is the trap this file exists under: D8 was
 * "confirmed with pixels" from one frame, and one frame cannot distinguish a
 * defect from the middle of an intended arc.
 *
 * ── SO THIS PINS THE ONE THING THAT IS UNAMBIGUOUS ───────────────────────────
 *
 * However tilted he gets in transit, THE TRACK MUST END UPRIGHT. `solveFlight`
 * already zeroes the last sample's rotation, and the comment that does it —
 * "carrying them over left him holding a pose mid-stretch, tilted, with his lid
 * hanging open — and nothing in the beat data afterwards said so" — describes
 * the D8 symptom exactly. Nothing pinned it. A one-line regression there is
 * invisible in review, produces precisely "tilted on close and reopen", and
 * the file's own history says it has happened once already.
 *
 * `COVERAGE.md` §II.6 asked for an upright check and recorded, correctly, that
 * the honest gap was that nobody had been told to look. This is the half that
 * can be looked at without a browser. The other half — is he upright in the
 * frame a person actually sees — needs the vision judge and is not claimed here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree } from '../constants'
import { sampleTrack, solveFlight, type FlightSample } from '../flight'
import { shapeFor } from '../dom'

function stagingCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(BLENDER_CAMERA.fovDeg, 16 / 9, BLENDER_CAMERA.near, BLENDER_CAMERA.far)
  cam.position.copy(
    blenderToThree(BLENDER_CAMERA.position.x, BLENDER_CAMERA.position.y, BLENDER_CAMERA.position.z),
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
const tanHalfFovY = Math.tan(((cam.fov * Math.PI) / 180) / 2)
const track = (a: Vector3, b: Vector3) =>
  solveFlight(a, b, { camera: cam, tanHalfFovY, ...shapeFor(a, b, 0) })

/** Four shapes, because a cap that holds for a short hop can fail for a haul. */
const LEGS: [string, Vector3, Vector3][] = [
  ['a short hop', new Vector3(0, 0, 0), new Vector3(0.8, 0, 0.3)],
  ['a medium move', new Vector3(-2, 0, 0), new Vector3(2, 0, 1)],
  ['a long haul', new Vector3(-6, 1, -2), new Vector3(6, -1, 2)],
  ['a close/reopen-shaped leg', new Vector3(3.2, 0, 1.1), new Vector3(-1.4, 0.6, -0.4)],
]

for (const [name, a, b] of LEGS) {
  test(`${name} ends perfectly upright`, () => {
    const t = track(a, b)
    const last = t.samples[t.samples.length - 1]
    for (const ch of ['rx', 'ry', 'rz'] as const) {
      assert.equal(last[ch], 0, `the track ends with ${ch} = ${last[ch]}, so he lands tilted`)
    }
  })

  test(`${name} also ends with no residual squash, bend, lean, twist or lid`, () => {
    // Same cleanup, same comment, same failure mode — "a pose mid-stretch, with
    // his lid hanging open". Tilt is the one people notice; it is not the only
    // channel that would be held.
    const last = track(a, b).samples[track(a, b).samples.length - 1]
    for (const ch of ['sq', 'bend', 'lean', 'twist', 'mouth'] as const) {
      assert.equal(last[ch], 0, `the track ends holding ${ch} = ${last[ch]}`)
    }
  })
}

test('SAMPLING past the end of a track stays upright, which is how it is actually read', () => {
  // `sampleTrack` clamps to the last sample for any `tMs >= durationMs`, and the
  // renderer keeps asking after the flight is over. Zeroing the stored sample
  // would be worth nothing if the read path interpolated past it instead.
  const t = track(new Vector3(3.2, 0, 1.1), new Vector3(-1.4, 0.6, -0.4))
  const out = { tMs: 0, pos: new Vector3(), rx: 0, ry: 0, rz: 0, sq: 0, bend: 0, lean: 0, twist: 0, mouth: 0 } as FlightSample
  for (const over of [0, 1, 250, 10_000]) {
    const s = sampleTrack(t, t.durationMs + over, out)
    assert.equal(s.rx, 0, `held rx at +${over}ms past arrival`)
    assert.equal(s.ry, 0, `held ry at +${over}ms past arrival`)
    assert.equal(s.rz, 0, `held rz at +${over}ms past arrival`)
  }
})

test('he really does tilt IN TRANSIT — this is not asserting a motionless flight', () => {
  // Without this, every assertion above would still pass if the lean were
  // deleted outright, and the file would be pinning the absence of the motion
  // rather than its resolution. 24.8° measured on this leg; 8° is a floor well
  // clear of it that does not pin the authored value.
  const t = track(new Vector3(3.2, 0, 1.1), new Vector3(-1.4, 0.6, -0.4))
  const peak = Math.max(...t.samples.map((s) => Math.abs(s.rx)))
  assert.ok(peak > 8, `peak tilt was only ${peak.toFixed(1)}° — the flight lean has gone`)
})
