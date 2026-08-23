/**
 * The entrance beat: growing from nothing, without moving.
 *
 * C3 asks for absent -> grows at the launcher's rect -> travels to his stand
 * point. The middle third is a scale, and there are exactly two ways to get a
 * scale wrong that a screenshot will not catch:
 *
 *   1. SCALING THE WRONG THING. `setCharacterHeight` is the obvious knob and it
 *      dollies the camera, so "grow from nothing" sends the camera to infinity.
 *      That one is settled by construction — the scale is on the rig root — but
 *      the test below still checks the property that makes root scale usable at
 *      all: that it is a similarity applied above the whole character, so the
 *      point every other part of the runtime treats as "him" does not move.
 *
 *   2. SCALING ABOUT THE FEET. The rig origin is at his base, so the naive
 *      `root.scale.setScalar(s)` shrinks him toward the floor: at s = 0 he is a
 *      point half a body BELOW the mark he was placed on, and the grow reads as
 *      a rise as well as an expansion. `parkOn` drops the root by half a body
 *      precisely so a centre park lands his CENTRE on the mark, so the centre is
 *      the pivot the rest of the system already agrees on.
 *
 * These assert against the real `applyPose`, not against a re-derivation of it,
 * because the pivot correction is applied there and its whole job is to compose
 * with the framing quaternion that arrives in the same call.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, Quaternion, Vector3 } from 'three'
import { BODY_H } from '../constants'
import { CENTRE_OFFSET, makeFraming } from '../framing'
import {
  ENTRY_MIN,
  ENTRY_MS,
  bodySpan,
  clampEntryScale,
  entryEase,
  entryPivotOffset,
  entryScaleAt,
} from '../entry'
import { applyPose, type RigNodes } from '../rig'
import type { PlaybookDoc, Pose } from '../playbook'

/** His centre in the root's own frame — the point everything pivots about. */
const CENTRE_LOCAL = new Vector3(0, CENTRE_OFFSET, 0)

const doc: PlaybookDoc = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../public/models/decke/playbook.json'),
    'utf8',
  ),
)

/**
 * A rig of bare nodes.
 *
 * `applyPose` only ever writes transforms onto the bound nodes and morph
 * influences onto whatever meshes were collected, so an empty morph list and a
 * plain `Object3D` per name exercise every line of it — including the pivot
 * correction, which is the point. It does mean this helper has to be kept in
 * step with `RigNodes`; the cast is deliberate and a missing node fails loudly
 * rather than silently skipping the assertion.
 */
function fakeRig(): RigNodes {
  const names = [
    'root', 'facing', 'tilt', 'float', 'roll', 'squash', 'rollPivot', 'body',
    'lidHinge', 'lid', 'base', 'eyeRig', 'eyeL', 'eyeR', 'ctrlTarget',
    'ctrlBrows', 'ctrlBrowL', 'ctrlBrowR', 'browSocketL', 'browSocketR',
    'ctrlLidUL', 'ctrlLidUR', 'ctrlLidLL', 'ctrlLidLR', 'ctrlPupilL',
    'ctrlPupilR', 'ctrlShineL', 'ctrlShineR', 'ctrlLineL', 'ctrlLineR',
    'ctrlSymbolL', 'ctrlSymbolR', 'ctrlSymLineL', 'ctrlSymLineR',
  ] as const
  const rig: Record<string, unknown> = {}
  for (const n of names) rig[n] = new Object3D()
  rig.browSocketRest = { y: 0, z: 0, rx: 0 }
  rig.reel = { pupilY: 0, symbolY: 0, travel: 0 }
  rig.morphTargets = []
  return rig as unknown as RigNodes
}

function restPose(): Pose {
  const p: Pose = {}
  for (const k in doc.rest_pose) p[k] = doc.rest_pose[k]
  return p
}

/**
 * Where his centre ends up, given a root that has been positioned, rotated and
 * scaled. This is `root.localToWorld` and nothing else: if the pivot correction
 * is right, this answer does not depend on the scale.
 */
function centreOf(root: Object3D): Vector3 {
  root.updateMatrixWorld(true)
  return root.localToWorld(CENTRE_LOCAL.clone())
}

/** The root as `applyPose` leaves it, for a given framing and entrance scale. */
function rootAt(framing: ReturnType<typeof makeFraming>, scale: number): Object3D {
  const rig = fakeRig()
  applyPose(rig, restPose(), { facing: 1, framing, scale })
  return rig.root
}

test('the grow pivots about his centre, not his feet', () => {
  // A framing that is NOT the identity: at the staging origin the solve returns
  // the identity quaternion, which would let a pivot bug through unseen.
  const q = new Quaternion().setFromAxisAngle(new Vector3(0.2, 0.9, 0.1).normalize(), 0.42)
  const framing = makeFraming()
  framing.quaternion.copy(q)
  // `solveFraming` returns `C - R*f` for a centre `C`; reproduce that shape so
  // the correction is being checked against the thing it corrects.
  const centre = new Vector3(1.4, 0.9, -2.1)
  framing.position.copy(CENTRE_LOCAL).applyQuaternion(q).negate().add(centre)

  const full = rootAt(framing, 1)
  assert.ok(
    centreOf(full).distanceTo(centre) < 1e-9,
    `scale 1 moved his centre: ${centreOf(full).toArray()}`,
  )
  assert.equal(full.scale.x, 1, 'and left the root unscaled')

  for (const s of [0.001, 0.25, 0.5, 0.9, 1.05]) {
    const root = rootAt(framing, s)
    assert.ok(Math.abs(root.scale.x - s) < 1e-12, 'the scale goes on the ROOT node')
    assert.equal(root.scale.x, root.scale.y, 'and is uniform — see the riders')
    assert.equal(root.scale.y, root.scale.z)
    const got = centreOf(root)
    assert.ok(
      got.distanceTo(centre) < 1e-9,
      `scale ${s} moved his centre by ${got.distanceTo(centre).toFixed(6)}`,
    )
  }

  // Default is 1: every frame that is not an entrance gets exactly the shipped
  // transform, and the option being absent must mean that too.
  const rig = fakeRig()
  applyPose(rig, restPose(), { facing: 1, framing })
  assert.equal(rig.root.scale.x, 1)
  assert.ok(rig.root.position.distanceTo(framing.position) < 1e-12)

  // And the naive version — scale with no pivot correction — really does move
  // it, by half a body. Without this the test above could pass on a no-op.
  const naive = new Object3D()
  naive.position.copy(framing.position)
  naive.quaternion.copy(q)
  naive.scale.setScalar(0)
  const off = centreOf(naive).distanceTo(centre)
  assert.ok(
    Math.abs(off - CENTRE_OFFSET) < 1e-9,
    `expected the uncorrected pivot to be out by half a body, got ${off}`,
  )
})

test('the pivot correction is exactly nothing at full size', () => {
  // The shipped transform must be untouched on every frame that is not an
  // entrance, and "untouched" means bit-for-bit rather than nearly.
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
  const d = entryPivotOffset(q, 1)
  assert.equal(d.x, 0)
  assert.equal(d.y, 0)
  assert.equal(d.z, 0)
})

test('the scale curve starts at nothing and ends at full size', () => {
  assert.equal(entryEase(0), 0)
  assert.equal(entryEase(1), 1)
  assert.equal(entryScaleAt(0, 0), 0)
  assert.equal(entryScaleAt(1, 0), 1)
  // Clamped rather than extrapolated: a frame that lands past the end must not
  // hand the rig a scale of 1.4.
  assert.equal(entryScaleAt(1.7, 0), 1)
  assert.equal(entryScaleAt(-0.2, 0), 0)

  // Monotone up to the overshoot, and the overshoot is small enough to read as
  // weight rather than as a bounce.
  let peak = 0
  let prev = -1
  let rising = true
  for (let u = 0; u <= 1.0001; u += 0.01) {
    const v = entryScaleAt(u, 0)
    peak = Math.max(peak, v)
    if (rising && v < prev) rising = false
    else if (!rising) assert.ok(v <= prev + 1e-9, `the curve rose again after its peak at u=${u}`)
    prev = v
  }
  assert.ok(peak > 1, 'the entrance should overshoot a little')
  assert.ok(peak < 1.08, `overshoot too large: ${peak}`)

  // Half way through he is already most of the way there — an eased-out
  // entrance, not a linear inflation.
  assert.ok(entryScaleAt(0.5, 0) > 0.75, `too slow at the midpoint: ${entryScaleAt(0.5, 0)}`)
  assert.ok(ENTRY_MS > 200 && ENTRY_MS < 600)
})

test('the rig is never handed a singular scale', () => {
  // `riders.ts` and `eyeSocket.ts` both invert their parent's world matrix every
  // frame. A scale of exactly 0 makes that singular — three answers with an
  // all-zero matrix rather than NaN, so it recovers, but a frame of meaningless
  // socket solve is not worth a number nobody can see.
  assert.ok(clampEntryScale(0) >= ENTRY_MIN)
  assert.ok(clampEntryScale(-5) >= ENTRY_MIN)
  assert.equal(clampEntryScale(Number.NaN), 1, 'a NaN scale must fall back to present, not absent')
  assert.equal(clampEntryScale(0.5), 0.5, 'and anything legal passes straight through')

  // Small enough to be absent: a third of a pixel at a 300 px character.
  assert.ok(ENTRY_MIN * 300 < 1)

  const root = rootAt(makeFraming(), clampEntryScale(0))
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  assert.ok(
    inv.elements.every((v) => Number.isFinite(v)) && inv.elements.some((v) => v !== 0),
    'the root transform has to stay invertible at the smallest entrance scale',
  )
})

test('the screen span shrinks about his centre too', () => {
  // `screenRect` places the speech bubble. If the span kept his full height
  // while he was a quarter of the way grown, the bubble would sit against a box
  // three times too tall — and against the WRONG END of it, because the extra
  // height would all be above his head.
  const base = new Vector3(2.1, -0.4, -1.3) // the rig origin, blender frame
  const feet = new Vector3()
  const head = new Vector3()

  bodySpan(base, 1, feet, head)
  assert.ok(feet.distanceTo(base) < 1e-9, 'at full size the span starts at his feet')
  assert.ok(Math.abs(head.z - (base.z + BODY_H)) < 1e-9, 'and ends a body up')

  bodySpan(base, 0.25, feet, head)
  assert.ok(Math.abs(head.z - feet.z - BODY_H * 0.25) < 1e-9, 'the span scales')
  const mid = (head.z + feet.z) / 2
  assert.ok(
    Math.abs(mid - (base.z + BODY_H / 2)) < 1e-9,
    'the span must stay centred on the same point the rig pivots about',
  )
  assert.equal(feet.x, base.x)
  assert.equal(head.y, base.y)
})
