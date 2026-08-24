/**
 * Leaving: the scale that rides the flight, and arrivals that admit an abort.
 *
 * The owner's exit, verbatim: *"he should remain exactly where he was but
 * quickly jump back to his chat bubble and scale down to zero so that it looks
 * like he's jumping into his chat bubble/hiding."* The old host approximated
 * that with a fixed timer against a flight whose duration is SOLVED, not
 * chosen — measured: `entryScale` hit 0.001 at 520 ms of a ~1300 ms trip, so
 * he vanished in mid-air and nobody flew the rest. `scaleTo` moves the
 * contract into the engine: the flight's own progress drives the scale, so
 * "gone" and "landed" are the same frame by construction. These tests pin the
 * state that contract leaves behind; the motion itself is the visual
 * harness's business (`scripts/visual-harness`).
 *
 * The second half pins `fireOnArrive`: a flight replaced before it lands used
 * to drop its `arrived` on the floor — ring, `then` state and callback all
 * silently gone, which is how "scale him away when he lands" could simply
 * never run. Now the displaced caller is TOLD, with `aborted: true`, and the
 * ring/`then` are skipped because he is not there.
 *
 * Driven on `Object.create(DeckE.prototype)` exactly as `arrive.test.ts` does
 * and for the same reason — the properties live in `flyTo`/`launch`/
 * `returnHome` and nowhere else, and a helper extracted to be testable would
 * be a second description of the thing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { DeckE } from '../DeckE'
import { ENTRY_MIN } from '../entry'
import {
  BLENDER_CAMERA,
  blenderCameraQuaternion,
  blenderToThree,
} from '../constants'
import { setViewport } from '../viewport'

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

type Engine = {
  flyTo: DeckE['flyTo']
  returnHome: DeckE['returnHome']
  playEntry: DeckE['playEntry']
  setEntryScale: DeckE['setEntryScale']
  track: unknown
  entryNow: number
  entryTween: unknown
  flightScale: { from: number; to: number } | null
  onArrive: unknown
  enteredState?: string
}

/** The fields the flight and entry layers read or write, and nothing else. */
function engine(opts: { reduced?: boolean } = {}): Engine {
  const d = Object.create(DeckE.prototype) as unknown as Engine & Record<string, unknown>
  Object.assign(d, {
    opts: { canvas: null, baseUrl: '' },
    stage: { camera: stagingCamera(), setViewShift: () => {} },
    reduced: !!opts.reduced,
    cutPending: false,
    entryNow: 1,
    entryTween: null,
    flightScale: null,
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
    ]),
    setState(name: string) {
      ;(this as unknown as Engine).enteredState = name
    },
  })
  return d
}

test('a flown flight with scaleTo arms the ride; nothing else touches the scale yet', () => {
  const d = engine()
  d.flyTo(markAt(700, 400), { centre: true, scaleTo: 0 })
  assert.ok(d.track !== null, 'the control premise: it flies')
  assert.ok(d.flightScale, 'the scale must ride the flight')
  assert.equal(d.flightScale?.from, 1)
  assert.equal(
    d.flightScale?.to,
    ENTRY_MIN,
    'zero is clamped to the smallest invertible scale, like every scale the rig is handed',
  )
  assert.equal(d.entryNow, 1, 'departure frame: still at size — the shrink is the flight’s')
})

test('an instant flight with scaleTo simply arrives at the scale', () => {
  // Reduced motion is a different path, not a disabled animation: he is
  // already gone AND already there, in the same call, with no second branch at
  // the call site.
  const d = engine({ reduced: true })
  d.flyTo(markAt(700, 400), { centre: true, scaleTo: 0 })
  assert.equal(d.track, null, 'reduced motion must not fly')
  assert.equal(d.entryNow, ENTRY_MIN, 'and he arrives at the asked-for scale')
  assert.equal(d.flightScale, null, 'nothing left armed for a flight that never was')
})

test('a flight WITHOUT scaleTo clears a stale ride', () => {
  const d = engine()
  d.flyTo(markAt(700, 400), { centre: true, scaleTo: 0 })
  assert.ok(d.flightScale)
  d.flyTo(markAt(200, 300), { centre: true })
  assert.equal(
    d.flightScale,
    null,
    'the new flight owns the scale story; inheriting the old dive would shrink an ordinary hop',
  )
})

test('setEntryScale and returnHome both disarm the ride', () => {
  const a = engine()
  a.flyTo(markAt(700, 400), { centre: true, scaleTo: 0 })
  a.setEntryScale(1)
  assert.equal(a.flightScale, null, 'an instant pin is a third writer; there may only be one')

  const b = engine()
  b.flyTo(markAt(700, 400), { centre: true, scaleTo: 0 })
  b.returnHome()
  assert.equal(b.flightScale, null, 'the trip home is its own flight, at his own size')
})

test('replacing a flight in the air fires its arrival as an abort, and skips the promises', () => {
  const d = engine()
  const calls: boolean[] = []
  d.flyTo(markAt(700, 400), { centre: true, then: 'point', arrived: (aborted) => calls.push(aborted) })
  assert.ok(d.track !== null)
  assert.equal(calls.length, 0, 'nothing has landed yet')

  d.flyTo(markAt(200, 300), { centre: true })
  assert.deepEqual(calls, [true], 'the displaced caller is told, once, as an abort')
  assert.equal(
    d.enteredState,
    undefined,
    'the `then` state belongs to an arrival that never happened',
  )
})

test('returnHome aborts a pending arrival the same way', () => {
  const d = engine()
  const calls: boolean[] = []
  d.flyTo(markAt(700, 400), { centre: true, arrived: (aborted) => calls.push(aborted) })
  d.returnHome()
  assert.deepEqual(calls, [true], 'silence was the defect; the caller is told')
  assert.equal(d.onArrive, null, 'and nothing is left armed for the home leg to misfire')
})

test('a real (cut) arrival still reports aborted: false and keeps every promise', () => {
  const d = engine()
  const calls: boolean[] = []
  d.flyTo(markAt(700, 400), {
    centre: true,
    instant: true,
    then: 'point',
    arrived: (aborted) => calls.push(aborted),
  })
  assert.deepEqual(calls, [false])
  assert.equal(d.enteredState, 'point', 'the arrival work runs before the callback')
  assert.equal(d.onArrive, null)
})

test('playEntry can run the curve the other way', () => {
  // The exit for the one close that has no chip to dive into (launcher hidden
  // by preference): shrink on the entrance clock while flying home.
  const instant = engine({ reduced: true })
  instant.entryNow = 1
  const ms = instant.playEntry({ from: 1, to: 0 })
  assert.equal(ms, 0, 'reduced motion arrives synchronously')
  assert.equal(instant.entryNow, ENTRY_MIN, 'at the destination scale, clamped invertible')

  const tweened = engine()
  tweened.entryNow = 1
  const dur = tweened.playEntry({ from: 1, to: 0 })
  assert.ok(dur > 0, 'the flown case takes time')
  assert.equal(tweened.entryNow, 1, 'and starts from the asked-for end')
  const t = tweened.entryTween as { from: number; to: number }
  assert.equal(t.from, 1)
  assert.equal(t.to, ENTRY_MIN)
})
