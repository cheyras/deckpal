/**
 * The thinking gaze — asserted where it is SEEN, not where it is authored.
 *
 * C24: *"on his thinking animation, he shouldn't be looking at the camera. He
 * should be looking upward and away from the camera."* The offset he was looking
 * at was `gx: -1.7, gz: 1.05`, which at the staging camera is 12.0 degrees
 * lateral and 7.5 degrees up — and, far more importantly, produced NO LATERAL
 * PUPIL MOVEMENT AT ALL. The aim is camera-relative, the staging puts the camera
 * 45.6 degrees off each eye's axis, and the eye saturates at 24.2, so both
 * pupils sit pinned at the roam limit whatever the lateral offset says. A
 * "bigger number" that stays inside that saturation changes literally nothing on
 * screen, which is exactly the kind of fix that reviews as done and ships as
 * broken.
 *
 * So these tests do not assert on `gx`/`gz`. They run the real `aimPupil`
 * against the real playbook data and assert on WHERE THE PUPIL ENDS UP, at both
 * facings. A regeneration of `playbook.json` that reverts the hand edit (see
 * `playbook.ts` — the generator has been broken since 2026-08-16) fails here,
 * and so does any future change to the staging that quietly re-saturates the
 * aim.
 *
 * D14 — *"his iris is clipped by the rim of the sclera during the thinking
 * state"* — is the same measurement read the other way, and the audit's guess at
 * the cause was close but not quite: the rim contact is not something the
 * thinking gaze CAUSES. `PUPIL_ROAM.x` is where the pupil sits in EVERY state at
 * this staging, thinking included, because the clamp is what the camera-relative
 * aim runs into. Which means the direction of travel is settled: the fix cannot
 * make the clipping worse (the pupil is already at the limit and cannot go
 * further out), and a thinking gaze that reads as "away" is precisely a thinking
 * gaze that comes OFF the limit. That is the property pinned below.
 *
 * NOT VERIFIED HERE: whether the remaining contact at 84% of the limit is
 * visible. That needs a render — `/dev/decke?parity=1`, as D14 itself
 * prescribes — and no unit test can settle it.
 *
 * The eye geometry is the same measured bind-pose frame `look.test.ts` uses; see
 * the note there. The facing yaw is `FACING_YAW_DEG` applied to the eye frames,
 * which is what `rig.facing` does to them on a real frame.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, Vector3 } from 'three'
import { PUPIL_ROAM, aimPupil } from '../look'
import { compilePlaybook, evalState, type PlaybookDoc, type Pose } from '../playbook'
import { resolveFacing } from '../rig'
import { SUSTAIN } from '../sustain'

const doc: PlaybookDoc = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../public/models/decke/playbook.json'),
    'utf8',
  ),
)
const compiled = compilePlaybook(doc)

/** `Camera_anim` in the blender frame, and the two eye frames at the bind pose.
 *  Identical to `look.test.ts`. */
const CAM_BLENDER = new Vector3(4.783797, -5.625454, 4.639914)
const EYE = {
  L: new Vector3(-0.3841834164, 1.5285813526, 0.5738516881),
  R: new Vector3(0.4018165533, 1.5285813526, 0.5738516881),
}
/** `FACING_YAW_DEG`, restated rather than imported: `DeckE.ts` pulls in the
 *  whole engine, and this is a geometry test. */
const FACING_YAW_DEG = 80.39

/** One eye's frame, yawed as `rig.facing` yaws it at this facing. */
function eyeAt(side: 'L' | 'R', facing: number): Object3D {
  const o = new Object3D()
  o.position.copy(EYE[side])
  const parent = new Object3D()
  parent.rotation.y = (((1 - facing) / 2) * FACING_YAW_DEG * Math.PI) / 180
  parent.add(o)
  parent.updateMatrixWorld(true)
  return o
}

/** Where both pupils sit for a pose, at a facing — the whole live path: resolve
 *  the sided channels, offset the camera, solve the aim. */
function pupils(pose: Pose, facing: number) {
  const p: Pose = {}
  for (const k in pose) p[k] = pose[k]
  resolveFacing(p, facing)
  const target = new Vector3(
    CAM_BLENDER.x + p.gx,
    CAM_BLENDER.y + p.gy,
    CAM_BLENDER.z + p.gz,
  )
  return {
    L: aimPupil(eyeAt('L', facing), target, p.alert, { x: 0, z: 0 }),
    R: aimPupil(eyeAt('R', facing), target, p.alert, { x: 0, z: 0 }),
  }
}

/** The pose in the middle of the thinking LOOP — the only part of the clip the
 *  chat ever shows. See `SUSTAIN.thinking` and `DeckE.clipTime`. */
function thinkingLoopPose(): Pose {
  const { fromMs, toMs } = SUSTAIN.thinking
  const out: Pose = {}
  evalState(compiled.get('thinking')!, (fromMs + toMs) / 2, doc.rest_pose, out)
  return out
}

/** Looking straight at the camera: the rest gaze, same geometry. */
function restPose(): Pose {
  const out: Pose = {}
  for (const k in doc.rest_pose) out[k] = doc.rest_pose[k]
  return out
}

test('the thinking gaze takes both pupils off the lateral roam limit', () => {
  // THE ONE THAT MATTERS. At rest the aim saturates and the pupil is jammed
  // against the rim; if thinking does that too, "look away" is not being drawn
  // at all, whatever the authored numbers say.
  for (const facing of [1, -1]) {
    const rest = pupils(restPose(), facing)
    assert.equal(
      Math.abs(rest.L.x),
      PUPIL_ROAM.x,
      'the premise: looking at the camera IS the roam limit at this staging',
    )

    const think = pupils(thinkingLoopPose(), facing)
    for (const side of ['L', 'R'] as const) {
      const at = Math.abs(think[side].x)
      assert.ok(
        at < PUPIL_ROAM.x - 1e-6,
        `facing ${facing} ${side}: still saturated at ${at} — the offset is being eaten by the clamp`,
      )
      // And meaningfully off it, not off it by a rounding error. 90% of the
      // limit is the loosest reading of "his eyes are not pinned to the rim"
      // that is still worth asserting.
      assert.ok(
        at <= PUPIL_ROAM.x * 0.9,
        `facing ${facing} ${side}: only ${((at / PUPIL_ROAM.x) * 100).toFixed(0)}% off the limit`,
      )
    }
  }
})

test('the thinking gaze moves the pupil a visible distance from the camera aim', () => {
  // "Away" is a MOVE, and the move has to be large enough to read. A full roam
  // width is 0.23; half of that is unmistakable at any character size.
  for (const facing of [1, -1]) {
    const rest = pupils(restPose(), facing)
    const think = pupils(thinkingLoopPose(), facing)
    for (const side of ['L', 'R'] as const) {
      const moved = Math.abs(think[side].x - rest[side].x)
      assert.ok(
        moved > PUPIL_ROAM.x * 0.15,
        `facing ${facing} ${side}: the gaze only moved ${moved.toFixed(4)} from the camera aim`,
      )
    }
  }
})

test('the thinking gaze is UP relative to looking at the camera', () => {
  // The camera sits above him, so looking AT it is already looking up — which is
  // why "he looks slightly up" was never the complaint. Up has to mean higher
  // than the camera aim, at both facings.
  for (const facing of [1, -1]) {
    const rest = pupils(restPose(), facing)
    const think = pupils(thinkingLoopPose(), facing)
    // By a margin, not by a hair: the offset it replaced cleared the camera aim
    // by 0.0009 at facing -1, which is a difference no one could see and would
    // pass a bare `>`.
    const margin = PUPIL_ROAM.z * 0.1
    for (const side of ['L', 'R'] as const) {
      assert.ok(
        think[side].z > rest[side].z + margin,
        `facing ${facing} ${side}: thinking (${think[side].z.toFixed(4)}) is not meaningfully above the camera aim (${rest[side].z.toFixed(4)})`,
      )
    }
    // Inside the vertical limit or exactly on it, never outside: the clamp is
    // the sclera's business and this test is not licensed to leave it.
    assert.ok(Math.abs(think.L.z) <= PUPIL_ROAM.z + 1e-12)
  }
})

test('the gaze holds still across the whole thinking loop', () => {
  // The loop is built by sampling the window's head and copying it as the tail,
  // so a gaze that varies inside the window would wrap with a jump on every
  // pass — and this clip loops for as long as a model is thinking.
  const { fromMs, toMs } = SUSTAIN.thinking
  const at = (t: number) => {
    const out: Pose = {}
    evalState(compiled.get('thinking')!, t, doc.rest_pose, out)
    return out
  }
  const head = at(fromMs)
  for (let t = fromMs; t <= toMs; t += 25) {
    const p = at(t)
    assert.ok(Math.abs(p.gx - head.gx) < 1e-9, `gx drifts inside the loop at ${t}ms`)
    assert.ok(Math.abs(p.gz - head.gz) < 1e-9, `gz drifts inside the loop at ${t}ms`)
  }
})

test('the thinking clip still begins and ends at the rest gaze', () => {
  // The hand edit must not have turned `thinking` into a state that leaves the
  // gaze parked away from rest — `playbook.test.ts` checks the declared
  // non-resting lists for every state, and this says the same thing about the
  // two channels that were edited, where a failure is readable.
  const first: Pose = {}
  const last: Pose = {}
  const st = compiled.get('thinking')!
  evalState(st, 0, doc.rest_pose, first)
  evalState(st, st.clip.duration_ms, doc.rest_pose, last)
  for (const ch of ['gx', 'gz'] as const) {
    assert.equal(first[ch], doc.rest_pose[ch], `thinking starts with ${ch} away from rest`)
    assert.equal(last[ch], doc.rest_pose[ch], `thinking ends with ${ch} away from rest`)
  }
})
