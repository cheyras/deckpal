/**
 * The keep-out region — the bands of the viewport he may not stand in.
 *
 * WHY THERE IS A REGION AT ALL. His canvas sits at `z-30`, above the app's own
 * chrome at `--z-chrome: 20`, and that is deliberate: "he has to be able to park
 * beside and point at a nav item." The cost, which nobody had noticed, is that
 * nothing stopped him painting over the app header the chat's scrim now
 * deliberately leaves sharp, or over the PWA "Install" pill, and nothing kept
 * the top of his head out of the strip the viewport clips.
 *
 * EVERY CLAMP TEST IS SATISFIED BY A FUNCTION THAT ALWAYS RETURNS THE MIDDLE OF
 * THE SCREEN, which is why the control below is not a formality: it is the only
 * test here that fails if the clamp stops being a clamp and becomes a placement.
 *
 * MEASURED IN PIXELS, for the reason `park.test.ts` gives — the camera dollies
 * to set his on-screen height, so a world-space threshold means a different
 * thing at every character size. The projection helper is exact rather than
 * approximate: `parkBeside` unprojects a viewport point onto the depth plane and
 * then drops the result by half a body to stand him on his feet, so adding that
 * half body back and re-projecting returns the point it started from.
 */
import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  BLENDER_CAMERA,
  blenderCameraQuaternion,
  blenderToThree,
  BODY_H,
  BODY_W,
} from '../constants'
import { homeCorner, keepOut, parkBeside, parkOn, setKeepOut, solvePark, type RectLike } from '../dom'
import { setViewport } from '../viewport'

const VIEW_W = 390
const VIEW_H = 844

/** What `DeckeHost` asks for on a 390x844 phone with the chat open. */
const CHARACTER_PX = 107

/** `SILHOUETTE` in `dom.ts`: his drawn height as a multiple of `characterPx`. */
const DRAWN_H = CHARACTER_PX * 1.28
const HALF = DRAWN_H / 2
/** `parkBeside`'s long-standing horizontal `margin` — 0.6 of the deck box's
 *  width, which is what it has always used for half of him. */
const HALF_W = (BODY_W / BODY_H) * CHARACTER_PX * 0.6

/** What `AppShell` publishes on a phone, plus a notch. */
const HEADER = 64
const NOTCH = 20
const TOP_BAND = HEADER + NOTCH
/** Enough to clear the home indicator and the PWA pills. */
const BOTTOM_BAND = 66

setViewport(VIEW_W, VIEW_H)

beforeEach(() => {
  // The region is a module singleton, for the reasons `viewport.ts` gives. Two
  // tests in one process therefore share it, and a leaked band would make the
  // control below pass for the wrong reason.
  setKeepOut(null)
})

/** `park.test.ts`'s camera, restated: the staging camera dollied to render him
 *  `characterPx` tall. See the note there for why the dolly is not skippable. */
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

/** Where his CENTRE lands on screen, in viewport CSS pixels. The solve returns
 *  his ROOT, which is at his feet — half a body below the point it was given. */
function centreOnScreen(cam: PerspectiveCamera, root: Vector3): { x: number; y: number } {
  const ndc = blenderToThree(root.x, root.y, root.z + BODY_H / 2).project(cam)
  return { x: (ndc.x * 0.5 + 0.5) * VIEW_W, y: (-ndc.y * 0.5 + 0.5) * VIEW_H }
}

function rectAt(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, width, height, right: left + width }
}

function beside(cam: PerspectiveCamera, rect: RectLike) {
  return parkBeside(cam, rect, {
    depth: 'foreground',
    side: 'auto',
    baseDistance: cam.position.length(),
  })
}

// ─── the control ────────────────────────────────────────────────────────────

test('a solve already inside the region is left exactly where it was', () => {
  // THE ONE TEST THAT FAILS IF THE CLAMP STOPS BEING A CLAMP. Every other
  // assertion in this file is satisfied by a function that ignores its input and
  // returns the middle of the screen; this one is not.
  const cam = cameraAt(CHARACTER_PX)
  const middle = rectAt(VIEW_W / 2 - 46, VIEW_H / 2 - 64, 93, 128)

  const free = beside(cam, middle).position.clone()
  setKeepOut({ top: TOP_BAND, bottom: BOTTOM_BAND })
  const banded = beside(cam, middle).position.clone()

  assert.deepEqual(banded.toArray(), free.toArray(), 'a mid-screen park moved for a band it is nowhere near')

  // And the answer is genuinely the element's own line rather than a constant.
  const y = centreOnScreen(cam, banded).y
  assert.ok(
    Math.abs(y - (middle.top + middle.height / 2)) < 1e-6,
    `his centre landed at ${y.toFixed(2)}, not on the element's centre line`,
  )
  // Move the element and he moves with it, by exactly as much.
  const lower = { ...middle, top: middle.top + 120 }
  setKeepOut({ top: TOP_BAND, bottom: BOTTOM_BAND })
  const moved = centreOnScreen(cam, beside(cam, lower).position).y
  assert.ok(Math.abs(moved - y - 120) < 1e-6, `he followed the element by ${(moved - y).toFixed(2)}px, not 120`)
})

test('no region at all reproduces the old placement to the bit', () => {
  // The feature is opt-in, and it has to be: `beacon.ts` exists because he CAN
  // leave the viewport vertically while riding a scrolling element, and a bare
  // viewport-edge clamp would make that unreachable for every caller that never
  // declares a region — `/dev/decke` among them.
  const cam = cameraAt(CHARACTER_PX)
  const high = rectAt(300, 8, 44, 44)
  const low = rectAt(300, VIEW_H - 40, 44, 40)

  for (const rect of [high, low]) {
    const y = centreOnScreen(cam, beside(cam, rect).position).y
    assert.ok(
      Math.abs(y - (rect.top + rect.height / 2)) < 1e-6,
      `with no bands his centre should sit on the element's centre line; got ${y.toFixed(2)} for ${rect.top}`,
    )
  }
})

// ─── the two bands ──────────────────────────────────────────────────────────

test('a park that would put his head above the top band is pushed down', () => {
  const cam = cameraAt(CHARACTER_PX)
  // A nav item in the app header, which is exactly the case that motivates the
  // region: chrome he is allowed to point at and not allowed to cover.
  const navItem = rectAt(300, 8, 44, 44)

  const free = centreOnScreen(cam, beside(cam, navItem).position).y
  setKeepOut({ top: TOP_BAND })
  const clamped = centreOnScreen(cam, beside(cam, navItem).position).y

  assert.ok(clamped > free, `the band did not move him: ${free.toFixed(2)} -> ${clamped.toFixed(2)}`)
  // His HEAD on the band's edge, not his centre — what has to clear the header
  // is his silhouette.
  assert.ok(
    Math.abs(clamped - HALF - TOP_BAND) < 0.5,
    `the top of his head landed at ${(clamped - HALF).toFixed(2)}, not on the ${TOP_BAND}px band`,
  )
})

test('a park that would put his feet below the bottom band is pushed up', () => {
  const cam = cameraAt(CHARACTER_PX)
  // The composer's own row, on a phone: the band exists to keep him off it.
  const low = rectAt(180, VIEW_H - 44, 120, 44)

  const free = centreOnScreen(cam, beside(cam, low).position).y
  setKeepOut({ bottom: BOTTOM_BAND })
  const clamped = centreOnScreen(cam, beside(cam, low).position).y

  assert.ok(clamped < free, `the band did not move him: ${free.toFixed(2)} -> ${clamped.toFixed(2)}`)
  assert.ok(
    Math.abs(clamped + HALF - (VIEW_H - BOTTOM_BAND)) < 0.5,
    `his feet landed at ${(clamped + HALF).toFixed(2)}, not on the ${VIEW_H - BOTTOM_BAND} line`,
  )
})

test('a band he cannot fit between splits the overlap rather than picking a side', () => {
  // Landscape on a phone with the chat open is the realistic case. There is no
  // legal spot; centring is the only answer that does not silently prefer one
  // piece of chrome over the other.
  const cam = cameraAt(CHARACTER_PX)
  setKeepOut({ top: 400, bottom: 400 })
  const y = centreOnScreen(cam, beside(cam, rectAt(180, 40, 60, 40)).position).y
  assert.ok(Math.abs(y - VIEW_H / 2) < 0.5, `he landed at ${y.toFixed(2)}, not centred between the bands`)
})

// ─── the constraint the region must not break ───────────────────────────────

test('he can still present a nav item he is no longer allowed to cover', () => {
  // THE WHOLE REASON HIS CANVAS IS ABOVE THE CHROME. A clamp that makes this
  // impossible has broken the feature in order to fix a symptom, so it is
  // asserted rather than assumed: he ends up BELOW the header, in the item's
  // column, turned back across it. "Beside" gains a vertical component exactly
  // when the horizontal one is forbidden.
  const cam = cameraAt(CHARACTER_PX)
  setKeepOut({ top: TOP_BAND })

  for (const navItem of [rectAt(300, 10, 44, 44), rectAt(46, 10, 44, 44)]) {
    const park = beside(cam, navItem)
    const at = centreOnScreen(cam, park.position)
    const itemX = navItem.left + navItem.width / 2

    assert.ok(at.y - HALF >= TOP_BAND - 0.5, `his head is still in the header: ${(at.y - HALF).toFixed(2)}`)
    // Beside, not underneath: he is off the item's own column by at least half
    // his width, so the item is presented rather than sat on.
    assert.ok(
      Math.abs(at.x - itemX) > 20,
      `he stood in the item's own column (${at.x.toFixed(1)} vs ${itemX})`,
    )
    // FACING IS IN HIS FRAME: `+1` turns him to HIS right, which the viewer sees
    // as screen left. So `+1` requires the item to be to screen-left of him.
    assert.equal(
      park.facing,
      at.x > itemX ? 1 : -1,
      `he turned away from the nav item (facing ${park.facing}, him at ${at.x.toFixed(1)}, it at ${itemX})`,
    )
    // And he is close enough for the turn to read as presenting it rather than
    // gesturing across the room.
    assert.ok(
      Math.abs(at.x - itemX) < DRAWN_H,
      `he parked ${Math.abs(at.x - itemX).toFixed(1)}px from the item he is presenting`,
    )
  }
})

test('the horizontal edge exception still flips him to the far side', () => {
  // `dom.ts:192`'s clamp and the flip above it are one rule, and the bands widen
  // that rule rather than adding a second one that could disagree with it. The
  // mark against the left edge is the case `park.test.ts` pins from the other
  // direction; here it has to survive a region as well.
  const cam = cameraAt(CHARACTER_PX)
  const edge = rectAt(14, VIEW_H - 138, 93, 128)
  const centreX = edge.left + edge.width / 2

  for (const bands of [null, { top: TOP_BAND, bottom: BOTTOM_BAND }]) {
    setKeepOut(bands)
    const park = beside(cam, edge)
    const at = centreOnScreen(cam, park.position)
    assert.ok(
      at.x > centreX,
      `with bands ${JSON.stringify(bands)} he landed LEFT of a left-edge mark, off screen`,
    )
    assert.equal(park.facing, 1, 'standing to the viewer-right of it, he turns to HIS right to look back')
    // Still on screen, which is what the exception is for.
    assert.ok(at.x > 0 && at.x < VIEW_W, `he is off the side at ${at.x.toFixed(1)}`)
  }

  // A left BAND makes the strip he must not stand in wider, and the flip and the
  // clamp both have to be tested against the strip that is actually forbidden
  // rather than against the bare viewport edge. The fixture is chosen so the two
  // give different answers: flipped to the item's right he lands at 90, which
  // clears the viewport edge and does not clear a collapsed sidebar.
  const SIDEBAR = 82
  const tucked = rectAt(0, 300, 20, 44)

  setKeepOut(null)
  const unbanded = centreOnScreen(cam, beside(cam, tucked).position).x
  setKeepOut({ left: SIDEBAR })
  const banded = centreOnScreen(cam, beside(cam, tucked).position)

  assert.ok(banded.x > unbanded, `the left band did not move him: ${unbanded.toFixed(1)} -> ${banded.x.toFixed(1)}`)
  assert.ok(
    banded.x - HALF_W >= SIDEBAR - 0.5,
    `his shoulder is still inside the ${SIDEBAR}px band, at ${(banded.x - HALF_W).toFixed(1)}`,
  )
  assert.equal(beside(cam, tucked).facing, 1, 'flipped to its right, he still turns back across it')
})

// ─── the pin ────────────────────────────────────────────────────────────────

test('a canvas slid off the viewport is still clamped against the VIEWPORT', () => {
  // The trap, and it is silent and scroll-dependent. Pinned, the rect handed to
  // the solve is in CANVAS coordinates and the camera carries a compensating
  // frustum offset; `pageAnchor.test.ts` pins that the pinned and tracked solves
  // then agree exactly. Everything in the solve is linear and cancels — except a
  // clamp, which does not. So the clamp is handed the offset explicitly.
  const cam = cameraAt(CHARACTER_PX)
  setKeepOut({ top: TOP_BAND, bottom: BOTTOM_BAND })
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  const viewportRect = rectAt(120, 10, 380, 90)

  cam.clearViewOffset()
  const tracked = parkBeside(cam, viewportRect, opts).position.clone()
  // It has to actually bite, or this test proves nothing.
  assert.ok(
    centreOnScreen(cam, tracked).y - HALF >= TOP_BAND - 0.5,
    'the fixture no longer exercises the clamp',
  )

  for (const shift of [0, -240, 240, -60, 380]) {
    const canvasRect: RectLike = { ...viewportRect, top: viewportRect.top - shift }
    const drift = -shift
    cam.setViewOffset(VIEW_W, VIEW_H, 0, -drift, VIEW_W, VIEW_H)
    const pinned = parkBeside(cam, canvasRect, { ...opts, shift }).position.clone()
    cam.clearViewOffset()
    assert.ok(
      pinned.distanceTo(tracked) < 1e-6,
      `shift ${shift}: pinned ${pinned.toArray()} vs tracked ${tracked.toArray()}`,
    )
  }
})

// ─── the other two solves ───────────────────────────────────────────────────

test('the centre park and the home corner honour the bands too', () => {
  const cam = cameraAt(CHARACTER_PX)
  const base = cam.position.length()

  const freeHome = centreOnScreen(cam, homeCorner(cam, base)).y
  setKeepOut({ bottom: 200 })
  const bandedHome = centreOnScreen(cam, homeCorner(cam, base)).y
  assert.ok(bandedHome < freeHome, `home ignored the band: ${freeHome.toFixed(2)} -> ${bandedHome.toFixed(2)}`)
  assert.ok(Math.abs(bandedHome + HALF - (VIEW_H - 200)) < 0.5)

  // `solvePark`'s centre branch is `parkOn`, and both have to answer the same —
  // that is the property `solvePark` exists to hold. See `park.test.ts`.
  setKeepOut({ top: TOP_BAND })
  const mark = rectAt(140, 4, 100, 130)
  const viaSolve = solvePark(cam, mark, { depth: 'foreground', side: 'auto', baseDistance: base, centre: true })
  const viaLaunch = parkOn(cam, mark.left + mark.width / 2, mark.top + mark.height / 2, {
    depth: 'foreground',
    baseDistance: base,
  })
  assert.deepEqual(viaSolve.position.toArray(), viaLaunch.toArray())
  assert.equal(viaSolve.facing, undefined, 'a centre park must still leave facing to the caller')
  assert.ok(centreOnScreen(cam, viaLaunch).y - HALF >= TOP_BAND - 0.5)
})

// ─── the setter ─────────────────────────────────────────────────────────────

test('setting the same region back reports no change', () => {
  // The host calls this from the `ResizeObserver`'s `measure`, which fires for
  // every toolbar slide on a phone. A re-park per fire is the defect
  // `DeckE.resize` already has a guard for; this is the same guard.
  assert.equal(setKeepOut({ top: TOP_BAND }), true)
  assert.equal(setKeepOut({ top: TOP_BAND }), false)
  assert.equal(setKeepOut({ top: TOP_BAND, bottom: 0 }), false)
  assert.equal(setKeepOut({ top: TOP_BAND, bottom: 1 }), true)
  assert.equal(setKeepOut(null), true)
  assert.equal(setKeepOut(null), false)
  assert.deepEqual({ ...keepOut() }, { top: 0, right: 0, bottom: 0, left: 0 })
  // A negative band is a measurement error, not an instruction to move him
  // further out.
  assert.equal(setKeepOut({ top: -40 }), false)
})
