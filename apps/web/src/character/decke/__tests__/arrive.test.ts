/**
 * Arriving: cut instead of flown, and facing the right way when he lands.
 *
 * ── WHY THE ENGINE IS DRIVEN DIRECTLY ───────────────────────────────────────
 *
 * Both properties here live in `flyTo`/`launch` and nowhere else, and both are
 * about STATE LEFT BEHIND rather than about a value returned. A helper extracted
 * to be testable would be a second description of the thing, agreeing with
 * whatever its author believed — which for "does the flight layer end up in a
 * half-state" is precisely the belief that needs checking.
 *
 * So this builds a `DeckE` on its prototype and hands it the fields those two
 * methods touch, rather than constructing one (which needs a canvas, a WebGL
 * context and a 1.4 MB glb). The set below IS the coupling: if a later change
 * adds a field to the flight layer, this fails loudly and someone reads it,
 * which is the outcome to want from a harness like this.
 *
 * ── WHAT IS BEING PINNED ────────────────────────────────────────────────────
 *
 * 1. `{ instant: true }` (and the instance-wide `reduced` flag behind it) must
 *    ARRIVE, not merely stop travelling. The highlight ring, the `then` state,
 *    the station, the facing and the anchor are the arrival; dropping any of
 *    them makes reduced motion a downgrade rather than a different path.
 * 2. `{ facing }` must be honoured WITH `centre: true`. `solvePark`'s centre
 *    branch returns no facing on purpose (`park.test.ts` pins that), so without
 *    the option `flyTo` re-asserts his current heading — on a fresh page the
 *    boot default of +1, screen-left, i.e. his back to the composer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { DeckE } from '../DeckE'
import {
  BLENDER_CAMERA,
  blenderCameraQuaternion,
  blenderToThree,
} from '../constants'
import { setViewport } from '../../viewport'

const VIEW_W = 1280
const VIEW_H = 900
setViewport(VIEW_W, VIEW_H)

function stagingCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(
    BLENDER_CAMERA.fovDeg,
    VIEW_W / VIEW_H,
    BLENDER_CAMERA.near,
    BLENDER_CAMERA.far,
  )
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

/** A `rect` target rather than an `{x, y}` one: `resolveRect` builds a `DOMRect`
 *  for a bare point and there is no DOM here. Same code path afterwards. */
function markAt(x: number, y: number, w = 120, h = 48) {
  return {
    rect: {
      left: x,
      top: y,
      width: w,
      height: h,
      right: x + w,
      bottom: y + h,
      x,
      y,
    } as DOMRect,
  }
}

/**
 * The engine as this file sees it: the two public methods under test, and the
 * flight-layer state they leave behind.
 *
 * Declared structurally rather than as `DeckE & ...` because the state IS
 * private — TypeScript would refuse to read it through the class type, and that
 * refusal is right everywhere except here.
 */
type Engine = {
  flyTo: DeckE['flyTo']
  returnHome: DeckE['returnHome']
  track: unknown
  legQueue: Vector3[]
  anchor: Vector3
  trackDest: Vector3
  trackShift: Vector3
  station: { kind: string; centre?: boolean }
  onArrive: unknown
  facingTarget: number
  cutPending: boolean
  /** Set by the stub `setState` below, so `then` is observable. */
  enteredState?: string
}

/** The fields `flyTo` and `launch` read or write, and nothing else. */
function engine(opts: { reduced?: boolean } = {}): Engine {
  const d = Object.create(DeckE.prototype) as unknown as Engine & Record<string, unknown>
  Object.assign(d, {
    opts: { canvas: null, baseUrl: '' },
    stage: { camera: stagingCamera(), setViewShift: () => {} },
    reduced: !!opts.reduced,
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
    pendingScroll: null,
    scrollDrive: null,
    onArrive: null,
    facing: 1,
    facingFrom: 1,
    facingTarget: 1,
    facingT: 1,
    modNow: { float_amp: 1, float_rate: 1, blink_rate: 1 },
    modFrom: null,
    modStart: 0,
    modMs: 0,
    states: new Map([
      ['idle', {}],
      ['point', {}],
      ['happy', {}],
    ]),
    // `setState` is the only thing `then` reaches, and what it does with the
    // state is `setState`'s business, tested elsewhere. Record the ask.
    setState(name: string) {
      ;(this as unknown as Engine).enteredState = name
    },
  })
  return d
}

// The highlight ring is not asserted directly — it needs a selector target,
// which needs a document. It is raised inside the SAME `onArrive` closure as
// `then`, so `then` having been entered is the evidence that the closure ran.
test('an instant flight arrives: station, anchor and the arrival callback', () => {
  const d = engine()
  const mark = markAt(700, 400)
  d.flyTo(mark, { centre: true, instant: true, then: 'point' })

  assert.equal(d.track, null, 'nothing should be in the air')
  assert.equal(d.legQueue.length, 0, 'and no leg should be left queued')
  assert.equal(d.enteredState, 'point', '`then` must still be entered')
  assert.deepEqual(
    { kind: d.station.kind, centre: d.station.centre },
    { kind: 'element', centre: true },
    'the station has to be taken, or the first scroll re-solves him somewhere else',
  )
  assert.equal(d.onArrive, null, 'the arrival slot must be cleared, not left armed')

  // He is where the flight would have put him: the same solve, landed.
  const flown = engine()
  flown.flyTo(mark, { centre: true, then: 'point' })
  assert.ok(flown.track !== null, 'the control case really does fly')
  assert.equal(flown.enteredState, undefined, 'and does not arrive on the spot')
  const dest = flown.trackDest.clone()
  assert.ok(
    d.anchor.distanceTo(dest) < 1e-9,
    `cut landed at ${d.anchor.toArray()} instead of ${dest.toArray()}`,
  )
  assert.ok(d.trackDest.distanceTo(dest) < 1e-9, 'trackDest must follow the anchor')
  assert.equal(d.trackShift.lengthSq(), 0, 'no shift may survive a cut')
})

test('a cut journey lands at the END of the journey, not on the waypoint', () => {
  // `via: 'background'` queues the destination and launches a waypoint out on
  // the far plane. Cutting the first leg would strand him there with a queue
  // nothing will ever shift, because no leg is going to finish.
  const cut = engine()
  const mark = markAt(300, 620)
  cut.flyTo(mark, { via: 'background', instant: true })

  const flown = engine()
  flown.flyTo(mark, {})
  const direct = flown.trackDest.clone()

  assert.equal(cut.track, null)
  assert.equal(cut.legQueue.length, 0)
  assert.ok(
    cut.anchor.distanceTo(direct) < 1e-9,
    'a cut journey must land where the last leg would have',
  )
  // The waypoint is out on the background plane, which is three times the camera
  // distance — so landing on it is not a subtle miss.
  assert.ok(direct.length() < 12, 'sanity: the real destination is a foreground point')
})

test('the reduced-motion flag makes every flight a cut, and the option overrides it', () => {
  const reduced = engine({ reduced: true })
  reduced.flyTo(markAt(500, 300), { centre: true })
  assert.equal(reduced.track, null, 'reduced motion must not fly')

  // ...and a caller who explicitly asks to fly, flies. The flag is a default,
  // not a lock — `{ instant: false }` is how a caller that has already earned
  // the motion keeps it.
  const forced = engine({ reduced: true })
  forced.flyTo(markAt(500, 300), { centre: true, instant: false })
  assert.ok(forced.track !== null, '{ instant: false } must still fly')

  // The other direction: no flag, no option, still flies.
  const normal = engine()
  normal.flyTo(markAt(500, 300), { centre: true })
  assert.ok(normal.track !== null)
})

test('flyTo honours an explicit facing even with centre: true', () => {
  // The bug, restated: a centre park returns no facing, so his heading is
  // re-asserted — which for a fresh page is the boot default of +1, screen-left,
  // with the composer behind him.
  const without = engine()
  without.flyTo(markAt(600, 700), { centre: true })
  assert.equal(without.facingTarget, 1, 'the premise: without the option he keeps +1')

  const with_ = engine()
  with_.flyTo(markAt(600, 700), { centre: true, facing: -1 })
  assert.equal(with_.facingTarget, -1, 'the option must win over the re-assertion')

  // Continuous over [-1, +1] and clamped, like every other facing input.
  const partial = engine()
  partial.flyTo(markAt(600, 700), { centre: true, facing: -0.4 })
  assert.equal(partial.facingTarget, -0.4)
  const over = engine()
  over.flyTo(markAt(600, 700), { centre: true, facing: -3 })
  assert.equal(over.facingTarget, -1)

  // It must not override a park that DID solve a facing... unless asked. A
  // presentation park (no `centre`) has an inward, and the caller can still
  // insist.
  const beside = engine()
  beside.flyTo(markAt(60, 300), {})
  const solved = beside.facingTarget
  assert.ok(solved === 1 || solved === -1, 'a park beside an element solves a facing')
  const insisted = engine()
  insisted.flyTo(markAt(60, 300), { facing: -solved })
  assert.equal(insisted.facingTarget, -solved, 'the caller still wins')
})

test('the trip home cuts too, and leaves nothing armed', () => {
  // `returnHome` is the other public flight, and it is the one the route watcher
  // and the chat-close path both use — so a reduced-motion reader meets it more
  // often than `flyTo`.
  const d = engine({ reduced: true })
  d.flyTo(markAt(500, 300), { centre: true })
  d.returnHome()
  assert.equal(d.track, null, 'reduced motion must not fly home either')
  assert.equal(d.station.kind, 'home')
  assert.equal(d.cutPending, false, 'the cut flag must not survive into the next flight')
  assert.ok(d.anchor.length() > 0, 'and he is actually at the home corner')

  const flown = engine()
  flown.returnHome()
  assert.ok(flown.track !== null, 'the control case flies home')
  assert.ok(
    d.anchor.distanceTo(flown.trackDest) < 1e-9,
    'the cut lands exactly where the flight was aimed',
  )
})

test('an instant flight still turns him', () => {
  // Facing is set outside the launch, so it is the piece most easily lost when a
  // cut short-circuits the path.
  const d = engine()
  d.flyTo(markAt(600, 700), { centre: true, facing: -1, instant: true })
  assert.equal(d.facingTarget, -1)
})
