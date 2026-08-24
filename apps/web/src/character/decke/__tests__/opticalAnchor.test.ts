/**
 * Where the composer's baseline crosses his body.
 *
 * ── THE NUMBER PINNED HERE IS AN OPTICAL JUDGEMENT, NOT A GEOMETRIC ONE ──────
 *
 * `OPTICAL_OVERLAP` is not zero, and a future reader who notices that his base
 * and the composer's baseline no longer line up exactly has not found a bug.
 * They lined up exactly once, deliberately, and it was reported as a defect:
 *
 *   "When I have seen him a lot of times it's like strictly aligned with his
 *    very bottom corner, which makes him look like he's kind of above the
 *    thing. Optically it's like he's kind of above it. So really the baseline
 *    of this should be aligned with like this corner... And then optically
 *    he'll look like he's alongside the chat box."
 *
 * He is drawn in three-quarter view, so the bottom of his silhouette is the
 * near point of a wedge rather than a line — measured off his own canvas at
 * 1440x900, his outline holds full width to y = 826 and tapers to a point at
 * y = 880 over a 214 px silhouette. A baseline aligned to that point reads as
 * sitting ON the card. This overlaps it instead.
 *
 * The exact fraction is bounded by the composer's own 20 px of bottom padding —
 * `dom.ts` has the arithmetic. Changing it is a design decision; changing it by
 * accident is what this file exists to prevent.
 *
 * ── AND IT HAS TO SURVIVE THE RE-SOLVE ───────────────────────────────────────
 *
 * `dom.ts`'s header is about a vertical intent honoured on launch and forgotten
 * by the station re-solve, which is worse than never honouring it because it
 * looks like the flight aimed wrong. `anchor` is threaded through `FlyOptions`,
 * the `Station` and `solvePark`; the last two tests here are what keeps a third
 * value from being dropped from one of them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree, BODY_H } from '../constants'
import { OPTICAL_OVERLAP, SILHOUETTE, solvePark, type RectLike } from '../dom'
import { setViewport } from '../../viewport'
import { DeckE } from '../DeckE'

const VIEW_W = 1440
const VIEW_H = 900

/** What `DeckeHost` sizes him to beside a 58 px composer: 58 * 2.9. */
const CHARACTER_PX = 168

setViewport(VIEW_W, VIEW_H)

/** The staging camera, dollied so he renders `characterPx` tall. */
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

/** The composer, where it lives once a conversation has started at 1440x900. */
const COMPOSER: RectLike = { left: 493.5, top: 822, width: 728, height: 58, right: 1221.5 }

const cam = cameraAt(CHARACTER_PX)
const base = cam.position.length()
const opts = { depth: 'foreground' as const, side: 'left' as const, baseDistance: base }

/**
 * How far below the target's bottom edge a solve puts his base, in px.
 *
 * MEASURED AS A DISTANCE ON THE PARK PLANE, not as a difference in world Z, and
 * that is not pedantry: the staging camera looks DOWN at him, so the plane the
 * unprojection lands on is tilted and a screen-vertical move changes both Z and
 * the depth axis. Reading Z alone under-reports every offset by the cosine of
 * the camera's elevation — measured, 18.10 px for a 19.35 px move. Both solves
 * differ only in screen Y, so the 3D distance between them IS the pixel offset,
 * and Z only supplies the sign.
 */
function baseBelowBottomPx(anchor: 'centre' | 'bottom' | 'optical' | undefined): number {
  // `position` is the rig ORIGIN, which sits at his feet, and Blender Z is up.
  const got = solvePark(cam, COMPOSER, { ...opts, anchor })
  const flush = solvePark(cam, COMPOSER, { ...opts, anchor: 'bottom' })
  const sign = flush.position.z >= got.position.z ? 1 : -1
  return (sign * got.position.distanceTo(flush.position)) / worldPerPx(cam)
}

test('the optical anchor is exactly OPTICAL_OVERLAP of his drawn height below flush', () => {
  const drawnH = (BODY_H / worldPerPx(cam)) * SILHOUETTE
  const want = drawnH * OPTICAL_OVERLAP
  const got = baseBelowBottomPx('optical')
  assert.ok(
    Math.abs(got - want) < 0.01,
    `optical put his base ${got.toFixed(2)} px below the composer's baseline, wanted ${want.toFixed(2)}`,
  )
})

test('OPTICAL_OVERLAP is 0.09 — an optical judgement, changed only on purpose', () => {
  // Pinned as a literal so that raising or lowering it is a deliberate edit with
  // a failing test attached, not a number that drifted. The reasoning, the
  // measurements and the ceiling are on the constant in `dom.ts`.
  assert.equal(OPTICAL_OVERLAP, 0.09)
  // And it is a real overlap: at the shipped desktop size that is 19 px, which
  // is more than his idle float's 6 px swing and less than the composer's 20 px
  // of bottom padding. Both bounds are what make the number safe.
  const px = (BODY_H / worldPerPx(cam)) * SILHOUETTE * OPTICAL_OVERLAP
  assert.ok(px > 6, `an overlap of ${px.toFixed(1)} px would be lost inside the idle float`)
  assert.ok(px <= 20, `an overlap of ${px.toFixed(1)} px would hang him past the bottom of the canvas`)
})

test('the three anchors are ordered: bottom is highest, then optical, then centre', () => {
  // `centre` is what shipped first and hangs most of him below a short card;
  // `bottom` is what replaced it and sits him flush; `optical` is between them,
  // and much nearer `bottom`. Asserting the ORDER catches a sign error that the
  // arithmetic test above would not, because it would still be "exact".
  const flush = baseBelowBottomPx('bottom')
  const optical = baseBelowBottomPx('optical')
  const centred = baseBelowBottomPx('centre')
  assert.equal(flush, 0)
  assert.ok(optical > flush, `optical (${optical.toFixed(1)}) must sink him below flush`)
  assert.ok(centred > optical, `centre (${centred.toFixed(1)}) must still be the lowest of the three`)
  assert.ok(
    optical < centred / 2,
    'optical must be a nudge off flush, not most of the way back to the centred solve',
  )
})

test('an absent anchor still means centre — the default cannot become optical', () => {
  assert.equal(baseBelowBottomPx(undefined), baseBelowBottomPx('centre'))
})

test('the station re-solve reproduces an optical park exactly', () => {
  // THE BUG THIS FILE'S HEADER IS ABOUT. `solvePark` is the one function both
  // `flyTo` and the station re-solve call, so the same description twice has to
  // give the same answer to the bit — and a description that has LOST its anchor
  // has to give a visibly different one, or the loss would be silent.
  const station = { ...opts, centre: false, anchor: 'optical' as const }
  const first = solvePark(cam, COMPOSER, station)
  const again = solvePark(cam, COMPOSER, station)
  assert.deepEqual(again.position.toArray(), first.position.toArray())
  assert.equal(again.facing, first.facing)

  const forgotten = solvePark(cam, COMPOSER, { ...station, anchor: undefined })
  const driftPx = forgotten.position.distanceTo(first.position) / worldPerPx(cam)
  assert.ok(
    driftPx > 50,
    `a re-solve that dropped the anchor moved him only ${driftPx.toFixed(1)} px, which would hide the regression`,
  )
})

/**
 * ── AND THE OTHER TWO PLACES IT HAS TO SURVIVE ───────────────────────────────
 *
 * The tests above are about `solvePark`, which is one function and therefore
 * cannot disagree with itself. The failure `dom.ts`'s header describes happens
 * one level up: `flyTo` honours a vertical intent, does not RECORD it on the
 * station, and the first re-solve then answers the same question differently.
 *
 * So this drives the real `flyTo` and the real `solveStation` on a structural
 * stub of the engine — the technique `arrive.test.ts` established, and for the
 * same reason: the state under test is private, and that is right everywhere
 * except here.
 */
type Engine = {
  flyTo: DeckE['flyTo']
  solveStation: (known?: RectLike) => { position: Vector3; facing?: number } | null
  station: { kind: string; anchor?: 'centre' | 'bottom' | 'optical' }
  anchor: Vector3
}

function engine(): Engine {
  const d = Object.create(DeckE.prototype) as unknown as Engine & Record<string, unknown>
  Object.assign(d, {
    opts: { canvas: null, baseUrl: '' },
    stage: { camera: cam, setViewShift: () => {} },
    reduced: false,
    cutPending: false,
    entryNow: 1,
    entryTween: null,
    elapsed: 0,
    track: null,
    trackStart: 0,
    legIndex: 0,
    legQueue: [],
    anchor: new Vector3(0, 0, 0),
    trackDest: new Vector3(0, 0, 0),
    trackShift: new Vector3(0, 0, 0),
    flightSample: { tMs: 0, pos: new Vector3() },
    station: { kind: 'home' },
    stationDirty: false,
    pinnedAt: null,
    driftPx: 0,
    pendingScroll: null,
    scrollDrive: null,
    onArrive: null,
    facing: 1,
    facingFrom: 1,
    facingTarget: 1,
    facingT: 1,
    states: new Map([['idle', {}]]),
    setState() {},
  })
  return d
}

/** The composer as a `DOMRect`-shaped target `flyTo` can resolve. */
const composerTarget = {
  rect: {
    left: COMPOSER.left,
    top: COMPOSER.top,
    right: COMPOSER.right,
    width: COMPOSER.width,
    height: COMPOSER.height,
  } as DOMRect,
}

test('flyTo RECORDS the optical anchor on the station', () => {
  const d = engine()
  d.flyTo(composerTarget, { depth: 'foreground', side: 'left', anchor: 'optical', instant: true })
  assert.equal(d.station.anchor, 'optical')
})

test('and the station re-solve puts him back in exactly the same place', () => {
  // THE LONG-FUSE BUG, reproduced as an assertion. A station that has forgotten
  // its anchor re-solves to the flush park, and the first resize, scroll or
  // keep-out change would then slide him up the composer's face with nothing
  // failing to say so.
  const d = engine()
  d.flyTo(composerTarget, { depth: 'foreground', side: 'left', anchor: 'optical', instant: true })
  const landed = d.anchor.clone()
  const resolved = d.solveStation()
  assert.ok(resolved, 'the station must still resolve')
  assert.ok(
    resolved.position.distanceTo(landed) < 1e-9,
    `the re-solve moved him ${(resolved.position.distanceTo(landed) / worldPerPx(cam)).toFixed(1)} px`,
  )

  // And the same station with the anchor stripped must land somewhere else, or
  // the assertion above would pass for a re-solve that ignores the field.
  d.station.anchor = undefined
  const forgotten = d.solveStation()
  assert.ok(forgotten, 'the station must still resolve')
  assert.ok(
    forgotten.position.distanceTo(landed) / worldPerPx(cam) > 50,
    'a station that lost its anchor must be visibly wrong, or this test proves nothing',
  )
})
