/**
 * How long a trip takes.
 *
 * The flight solver has no duration input — it integrates a velocity profile
 * until it arrives — so the pace of every move in the product is an EMERGENT
 * property of controller constants, and nothing was pinning it. What shipped
 * was slow enough to be the loudest note of a review round:
 *
 *   "We need to make the travel a lot quicker from foreground to background.
 *    Right now it takes way too long. I would make it take like less than half
 *    of the time that it currently takes for him to get from foreground to
 *    background and vice versa. Just more snappy."
 *
 * These are assertions about the CLOCK, not the path. The path is the reviewed
 * one and this pass deliberately did not touch it; what changed is how fast the
 * finished track is played, and that is a number worth being unable to drift.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree } from '../constants'
import { FPS, TRAVEL_RATE, sampleTrack, solveFlight, type FlightSample } from '../flight'
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

/** A leg, the way `DeckE.launch` builds one. */
function leg(a: Vector3, b: Vector3, legIndex = 0) {
  return solveFlight(a, b, { camera: cam, tanHalfFovY, ...shapeFor(a, b, legIndex) })
}

/** The legs the reviewer was actually watching: he is parked at one corner and
 *  flies to an element, at the foreground plane and at the background plane —
 *  which is three times further away, and so the longest ordinary trip. */
const LEGS: [string, Vector3, Vector3][] = [
  ['short hop', new Vector3(2.8, -1.7, -2.3), new Vector3(1.2, -1.0, -2.0)],
  ['across the page', new Vector3(2.8, -1.7, -2.3), new Vector3(-3.2, 1.4, -1.0)],
  ['out to the background', new Vector3(2.8, -1.7, -2.3), new Vector3(-2.0, 2.0, -9.0)],
  ['back home from the background', new Vector3(-2.0, 2.0, -9.0), new Vector3(2.8, -1.7, -2.3)],
]

test('a solved leg is played more than twice as fast as it was solved', () => {
  // The pace change, pinned where it lives. `durationMs` is the solved frame
  // count divided by the playback rate, so this both fixes the arithmetic and
  // states the promise: whatever the controller decides a leg is, it reaches the
  // screen in under half the time it used to.
  assert.ok(TRAVEL_RATE >= 2, `travel is only ${TRAVEL_RATE}x — "less than half" was the ask`)
  for (const [name, a, b] of LEGS) {
    const t = leg(a, b)
    const solvedMs = ((t.samples.length - 1) * 1000) / FPS
    assert.ok(
      Math.abs(t.durationMs - solvedMs / TRAVEL_RATE) < 1e-6,
      `${name}: duration is not the solved track scaled`,
    )
    assert.ok(t.durationMs < solvedMs / 2, `${name} is not more than twice as fast`)
  }
})

test('the pace is set once, for every leg, rather than per destination', () => {
  // A rate rather than a per-leg duration is the point: nothing here knows or
  // cares whether a destination is at the foreground or the background plane, so
  // the two cannot drift apart the way they would if each were tuned by hand.
  // Same solved track, same scale factor, every time.
  const rates = LEGS.map(([, a, b]) => {
    const t = leg(a, b)
    return (((t.samples.length - 1) * 1000) / FPS) / t.durationMs
  })
  for (const r of rates) assert.ok(Math.abs(r - rates[0]) < 1e-9, `legs play at different rates: ${rates}`)
})

test('the solver arrives rather than running out of iterations', () => {
  // THE REGRESSION THIS FILE WAS WRITTEN FOR, and it is why the pace is set by
  // scaling the finished track instead of by the cruise speed that looks like
  // the obvious knob. The controller brakes on a stopping-distance law that
  // assumes a continuous velocity; past roughly twice the shipped cruise the
  // discrete step overshoots the settle window every frame, the leg limit-cycles
  // and the loop runs to its 600-frame guard instead of landing. Measured on the
  // way to this change: a 3067 ms leg became 20167 ms — the guard exactly, and
  // 20167 ms is what the guard is worth at 30 fps.
  //
  // 600 frames is the guard, so any leg at or above it never converged.
  for (const [name, a, b] of LEGS) {
    const t = leg(a, b)
    assert.ok(
      t.samples.length < 600,
      `${name} used ${t.samples.length} frames — the solver hit its iteration guard`,
    )
  }
})

test('every leg lands exactly on its mark', () => {
  // Playing the track faster must not leave him short of, or past, the spot the
  // parking solve chose — he is meant to end up BESIDE the element he is
  // presenting, and a near miss there is the whole complaint that parking exists
  // to answer.
  for (const [name, a, b] of LEGS) {
    const t = leg(a, b)
    const last = t.samples[t.samples.length - 1]
    const end = new Vector3(last.pos.x, last.pos.y, last.pos.z)
    assert.ok(end.distanceTo(b) < 1e-6, `${name} ended ${end.distanceTo(b).toFixed(4)} from the mark`)
  }
})

test('he flies the whole path, rather than most of it and then a jump', () => {
  // THE BUG THE PACE CHANGE INTRODUCED, and the one the duration tests above
  // could not see. `sampleTrack` indexed the track with `(tMs / 1000) * FPS` —
  // correct only while the track is played at the rate it was solved at. Scaling
  // `durationMs` broke that pairing: the "past the end" guard fired while the
  // index was still less than halfway down the samples, so he flew 47% of the leg
  // and TELEPORTED onto the mark on the final frame. Every duration assertion
  // passed throughout, because the duration was right; it was the POSITION that
  // was wrong, and nothing was looking at it.
  //
  // Stated as where he has got to rather than as a step size. A step-size test is
  // the obvious shape and it does not work here: the profile decelerates into a
  // long settle tail, so the typical frame is tiny and the honest cruise peak is
  // already 50x it — a leg that arrives correctly looks like an outlier and a leg
  // that teleports does not stand out for the right reason.
  const out: FlightSample = {
    tMs: 0, pos: new Vector3(), rx: 0, ry: 0, rz: 0,
    sq: 0, bend: 0, lean: 0, twist: 0, mouth: 0,
  }
  for (const [name, a, b] of LEGS) {
    const t = leg(a, b)
    const total = a.distanceTo(b)
    // Nine tenths of the way through the trip he should be essentially there —
    // the profile brakes hard and late, so the last tenth of the clock is the
    // settle. With the bug this read 0.47 of the way at 99%.
    sampleTrack(t, t.durationMs * 0.9, out)
    const covered = 1 - out.pos.distanceTo(b) / total
    assert.ok(covered > 0.85, `${name}: only ${(covered * 100).toFixed(0)}% of the way at 90% of the clock`)
    // And progress never goes backwards by more than the authored overshoot.
    let prevCovered = -Infinity
    let worstBack = 0
    for (let ms = 0; ms <= t.durationMs; ms += 1000 / 60) {
      sampleTrack(t, ms, out)
      const c = 1 - out.pos.distanceTo(b) / total
      if (prevCovered > -Infinity) worstBack = Math.max(worstBack, prevCovered - c)
      prevCovered = c
    }
    assert.ok(worstBack < 0.1, `${name}: progress went backwards by ${(worstBack * 100).toFixed(0)}%`)
  }
})

test('the sampler is indexed by progress, not by wall-clock frames', () => {
  // Stated directly, because the two agree exactly when TRAVEL_RATE is 1 and a
  // future edit could quietly restore the frame-based index without any duration
  // test noticing. Halfway through the playback must be halfway down the samples,
  // whatever the rate.
  const out: FlightSample = {
    tMs: 0, pos: new Vector3(), rx: 0, ry: 0, rz: 0,
    sq: 0, bend: 0, lean: 0, twist: 0, mouth: 0,
  }
  const [, a, b] = LEGS[2]
  const t = leg(a, b)
  const mid = t.samples[Math.floor((t.samples.length - 1) / 2)]
  sampleTrack(t, t.durationMs / 2, out)
  assert.ok(
    out.pos.distanceTo(mid.pos) < a.distanceTo(b) * 0.02,
    `half the playback is not half the track`,
  )
})
