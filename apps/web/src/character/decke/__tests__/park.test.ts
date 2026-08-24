/**
 * Standing ON a mark, and staying there.
 *
 * `flyTo(..., { centre: true })` exists for a place he is meant to OCCUPY — the
 * park box the phone chat lays out for him in its bottom-left corner — as
 * against `parkBeside`, which is the solve for presenting something and puts him
 * outboard of it with a gap.
 *
 * The bug this file pins was that only the LAUNCH honoured that. The station he
 * was left holding recorded the target, the depth and the side but not the
 * intent, so the first re-solve — a resize, a scroll, the dirty-station poll —
 * answered the same question with `parkBeside` and moved him. It shipped, and it
 * looked like the flight was aiming wrong rather than like the flight being
 * overruled a moment after it landed.
 *
 * `solvePark` is the fix — one function, both callers — so what is checked here
 * is the property that makes it one: the same station description always yields
 * the same place, and with `centre` that place is the middle of the mark.
 *
 * MEASURED IN PIXELS, not world units. The camera dollies to set his on-screen
 * height, so a world-space distance means a different thing at every character
 * size and asserting on one would be a threshold nobody could read. The
 * conversion below is the same one `parkBeside` uses to size its own gap.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree, BODY_H, BODY_W } from '../constants'
import { parkOn, solvePark, viewportToBlender, type RectLike } from '../dom'
import { setViewport } from '../../viewport'

const VIEW_W = 390
const VIEW_H = 844

/** What `DeckeHost` asks for on a 390x844 phone with the chat open. */
const CHARACTER_PX = 107

setViewport(VIEW_W, VIEW_H)

/**
 * The staging camera, dollied to render him `CHARACTER_PX` tall.
 *
 * The dolly is not a detail to skip: at the raw staging distance he fills a
 * third of a phone, `parkBeside`'s gap and margin are correspondingly enormous,
 * and its viewport clamp dominates every answer — so a test run there would be
 * measuring the clamp rather than the geometry the product ships. This is
 * `Stage.applyDolly` restated: slide along the view axis, which for a camera
 * aimed at the origin is exactly setting the length of its position.
 */
function cameraAt(characterPx: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(
    BLENDER_CAMERA.fovDeg,
    VIEW_W / VIEW_H,
    BLENDER_CAMERA.near,
    BLENDER_CAMERA.far,
  )
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
  const vFov = (cam.fov * Math.PI) / 180
  cam.position.setLength((BODY_H * VIEW_H) / (2 * characterPx * Math.tan(vFov / 2)))
  cam.updateMatrixWorld(true)
  return cam
}

/** World units per CSS pixel on the plane he parks in. */
function worldPerPx(cam: PerspectiveCamera): number {
  const vFov = (cam.fov * Math.PI) / 180
  return (2 * Math.tan(vFov / 2) * cam.position.length()) / VIEW_H
}

function rectAt(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, width, height, right: left + width }
}

/** The phone chat's park box, to scale: 107 px x the 1.2 silhouette. */
const PARK = rectAt(14, VIEW_H - 10 - 128, 93, 128)

test('a centre park puts his CENTRE on the middle of the mark', () => {
  const cam = cameraAt(CHARACTER_PX)
  const base = cam.position.length()
  const got = solvePark(cam, PARK, {
    depth: 'foreground',
    side: 'auto',
    baseDistance: base,
    centre: true,
  })

  // `parkOn` returns the rig ORIGIN, which sits at his feet, so his centre is
  // half a body up the Z axis of the Blender frame. That is what has to land on
  // the mark — not his feet, which is what dropping the offset would give.
  const centre = new Vector3(got.position.x, got.position.y, got.position.z + BODY_H / 2)
  const want = viewportToBlender(cam, PARK.left + PARK.width / 2, PARK.top + PARK.height / 2, base)
  assert.ok(centre.distanceTo(want) < 1e-9, `his centre landed ${centre.distanceTo(want)} away`)
})

test('the beside solve does not leave him on the mark at all', () => {
  const cam = cameraAt(CHARACTER_PX)
  const base = cam.position.length()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: base }
  const on = solvePark(cam, PARK, { ...opts, centre: true })
  const beside = solvePark(cam, PARK, { ...opts, centre: false })

  const driftPx = on.position.distanceTo(beside.position) / worldPerPx(cam)
  const bodyPx = BODY_W / worldPerPx(cam)
  assert.ok(
    driftPx > bodyPx / 2,
    `the re-solve moved him ${driftPx.toFixed(1)} px, less than the half-body (${(bodyPx / 2).toFixed(1)}) that would still leave him over the mark`,
  )

  // And it turns him, which a stand point must not do.
  assert.equal(on.facing, undefined, 'a centre park must leave facing to the caller')
  assert.notEqual(beside.facing, undefined)
})

test('the drift is INTO the conversation, not out of it', () => {
  // A mark against the left edge is the case that shipped, and the direction is
  // what made it bad rather than merely wrong: `parkBeside` has an edge
  // exception that flips him to the far side of anything he would otherwise hang
  // off the screen for, so the one place guaranteed to be clear of him — his own
  // corner — is the one place it will not leave him.
  //
  // Direction without a projection: solve two centre parks either side of the
  // mark and see which one the beside solve is nearer to.
  const cam = cameraAt(CHARACTER_PX)
  const base = cam.position.length()
  const cx = PARK.left + PARK.width / 2
  const cy = PARK.top + PARK.height / 2
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: base }
  const beside = solvePark(cam, PARK, { ...opts, centre: false })
  const toTheLeft = parkOn(cam, cx - 100, cy, { depth: 'foreground', baseDistance: base })
  const toTheRight = parkOn(cam, cx + 100, cy, { depth: 'foreground', baseDistance: base })
  assert.ok(
    beside.position.distanceTo(toTheRight) < beside.position.distanceTo(toTheLeft),
    'the beside solve should land to the RIGHT of a left-edge mark',
  )
})

test('a re-solve of the same station lands in the same place', () => {
  // The actual regression. `flyTo` and the station re-solve are now one
  // function, so asking twice with the same description cannot drift — which is
  // exactly what the two separate implementations did.
  const cam = cameraAt(CHARACTER_PX)
  const base = cam.position.length()
  const station = { depth: 'foreground' as const, side: 'auto' as const, centre: true }
  const first = solvePark(cam, PARK, { ...station, baseDistance: base })
  const again = solvePark(cam, PARK, { ...station, baseDistance: base })
  assert.deepEqual(again.position.toArray(), first.position.toArray())

  // Same question through the launch path's own helper, to catch a future edit
  // that changes one and not the other.
  const viaLaunch = parkOn(cam, PARK.left + PARK.width / 2, PARK.top + PARK.height / 2, {
    depth: 'foreground',
    baseDistance: base,
  })
  assert.deepEqual(first.position.toArray(), viaLaunch.toArray())
})

test('centre still means centre away from the edges', () => {
  // The edge exception is what made the bug spectacular, not what caused it. A
  // mark in the middle of the screen is mis-solved too — so the flag has to be
  // carried everywhere, not special-cased near an edge.
  const cam = cameraAt(CHARACTER_PX)
  const base = cam.position.length()
  const middle = rectAt(VIEW_W / 2 - 46, VIEW_H / 2 - 64, 93, 128)
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: base }
  const on = solvePark(cam, middle, { ...opts, centre: true })
  const beside = solvePark(cam, middle, { ...opts, centre: false })
  const driftPx = on.position.distanceTo(beside.position) / worldPerPx(cam)
  assert.ok(driftPx > (BODY_W / worldPerPx(cam)) / 2, `mid-screen drift was only ${driftPx.toFixed(1)} px`)
})
