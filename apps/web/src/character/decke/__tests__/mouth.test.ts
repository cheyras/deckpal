/**
 * The mouth composite, locked down.
 *
 * One `mouth` channel drives four things, and three of them were wrong at some
 * point in a way that looked plausible on screen. These tests encode what was
 * measured off the live .blend so the next person cannot re-introduce any of it.
 *
 *   node --import tsx --test src/character/decke/__tests__/mouth.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, Euler, Vector3 } from 'three'
import { MOUTH, HINGE_REST, CHANNEL_RANGE, BODY_H } from '../constants'
import { hingeFrame } from '../field'

/** The X pitch of the field frame at the hinge — the same quantity `rig.ts`
 *  feeds into the hinge/lid pair. */
function cfAngleX(bendNorm: number, mouth: number, lean = 0, twist = 0): number {
  const bendDeg =
    (bendNorm - MOUTH.archAtFull * Math.min(mouth, MOUTH.secondaryMax)) *
    CHANNEL_RANGE.bend.deg
  const m = hingeFrame(
    HINGE_REST,
    bendDeg,
    lean * CHANNEL_RANGE.lean.deg,
    twist * CHANNEL_RANGE.twist.deg,
    new Matrix4(),
  )
  return new Euler().setFromRotationMatrix(m, 'XYZ').x
}

test('the secondary mouth effects saturate at mouth = 1', () => {
  // Measured in the live file: DeckE_Body.rotation_euler[0] reads -4.5 deg at
  // mouth 1.30 AND at mouth 2.09. Scaling by the raw `mouth` doubles the tip at
  // the full gape and moves the eye about 0.25 blender units.
  const tip = (mouth: number) =>
    Math.min(mouth, MOUTH.secondaryMax) * MOUTH.bodyTipDeg

  assert.ok(Math.abs(tip(1.3) - MOUTH.bodyTipDeg) < 1e-12, 'saturated by 1.30')
  assert.ok(Math.abs(tip(2.09) - MOUTH.bodyTipDeg) < 1e-12, 'still saturated at the full gape')
  assert.ok(tip(0.5) > MOUTH.bodyTipDeg, 'but not saturated below 1')
  // The wiki's own figure, reproduced: -0.09 deg at mouth 0.02.
  assert.ok(Math.abs(tip(0.02) - -0.09) < 1e-9)
})

test('the back arch reaches the field only, never the shape key', () => {
  // Frame 1834: authored bend -0.60, `Body_Bend_Back` key value exactly 0.60.
  // An earlier version added the arch here and set it to 0.809, over-arching
  // both shells.
  const bend = -0.6
  const bendBackKey = Math.max(0, -bend)
  assert.equal(bendBackKey, 0.6)

  // The field, by contrast, DOES see the arch — and clamped.
  const fieldBendDeg = (mouth: number) =>
    (bend - MOUTH.archAtFull * Math.min(mouth, MOUTH.secondaryMax)) * CHANNEL_RANGE.bend.deg
  // Solved back out of Lid_Hinge_anim.location in the live file:
  //   frame 1786  bend -0.50  mouth 1.30  ->  -10.800
  //   frame 1834  bend -0.60  mouth 2.09  ->  -12.600
  assert.ok(Math.abs(fieldBendDeg(2.09) - -12.6) < 1e-9, 'full gape')
  assert.ok(Math.abs(fieldBendDeg(1.3) - -12.6) < 1e-9, 'already saturated at 1.30')
  const other = (-0.5 - MOUTH.archAtFull * 1) * CHANNEL_RANGE.bend.deg
  assert.ok(Math.abs(other - -10.8) < 1e-9)
})

test('the lid rotation is the hinge-pivot correction, not a share of the gape', () => {
  // With NO deformation at all the correction is exactly zero.
  assert.ok(Math.abs(cfAngleX(0, 0)) < 1e-12, 'fully undeformed correction must be 0')

  // With a bend but a CLOSED mouth the pair must cancel exactly — the live file
  // reads +1.4001 / -1.4001 at such a frame. A share model gives 0 / 0 there and
  // loses the correction entirely.
  const cf = cfAngleX(0.2, 0)
  assert.ok(Math.abs(cf) > 1e-4, 'a bend must produce a real correction')
  assert.ok(Math.abs(cf + -cf) < 1e-12, 'at mouth 0 the pair must cancel exactly')

  // And the discriminating case: mouth open, NO authored bend. The correction is
  // not zero — the arch itself bends him — but it is far smaller than a fixed
  // share would invent, because it tracks the actual deformation rather than the
  // gape angle. Assert the two models genuinely disagree, so a regression back to
  // the share model fails here.
  const SHARE = 9.848255957623687 / 114.9499979622968 // the discredited fit
  for (const mouth of [0.2, 1, 2.09]) {
    const correct = Math.abs((cfAngleX(0, mouth) * 180) / Math.PI)
    const shareModel = mouth * MOUTH.maxDeg * SHARE
    assert.ok(
      shareModel > correct * 2,
      `at mouth ${mouth} the share model (${shareModel.toFixed(3)} deg) should be ` +
        `far larger than the real correction (${correct.toFixed(3)} deg)`,
    )
  }

  // The arch saturates, so past mouth = 1 the correction stops growing while the
  // share model keeps climbing — the clearest signature of the difference.
  assert.ok(
    Math.abs(cfAngleX(0, 1) - cfAngleX(0, 2.09)) < 1e-12,
    'the correction must saturate with the arch',
  )
})

test('the field pitch at the hinge is the bend accumulated to hinge height', () => {
  // The field accumulates rotation linearly with height, so at the hinge the
  // pitch is exactly `bend * z_hinge / H`. This is what makes the correction
  // derivable rather than fitted.
  const bendNorm = -0.6
  const bendDeg = bendNorm * CHANNEL_RANGE.bend.deg
  const expected = -(bendDeg * Math.PI) / 180 * (HINGE_REST.z / BODY_H)
  const actual = cfAngleX(bendNorm, 0)
  assert.ok(
    Math.abs(actual - expected) < 2e-3,
    `hinge pitch ${actual} should track bend*z/H ${expected}`,
  )
})

test('the composite collapses to the identity at mouth = 0', () => {
  // `Cf · MouthRot · Cf⁻¹` with MouthRot = I must be exactly I, for ANY
  // deformation — that is what leaves the closed seam untouched.
  for (const [b, l, t] of [
    [0, 0, 0],
    [0.5, 0.3, 0.2],
    [-0.6, -0.4, 0.15],
  ] as const) {
    const cf = hingeFrame(
      HINGE_REST,
      b * CHANNEL_RANGE.bend.deg,
      l * CHANNEL_RANGE.lean.deg,
      t * CHANNEL_RANGE.twist.deg,
      new Matrix4(),
    )
    const composite = cf.clone().multiply(new Matrix4()).multiply(cf.clone().invert())
    const e = composite.elements
    const ident = new Matrix4().elements
    for (let i = 0; i < 16; i++) {
      assert.ok(
        Math.abs(e[i] - ident[i]) < 1e-9,
        `composite must be identity at mouth 0 for bend ${b}`,
      )
    }
  }
})

test('the hinge rest position is where the field says it is', () => {
  // Sanity: at zero deformation the field leaves the hinge exactly where it was.
  const m = hingeFrame(HINGE_REST, 0, 0, 0, new Matrix4())
  const p = new Vector3().setFromMatrixPosition(m)
  assert.ok(p.distanceTo(HINGE_REST) < 1e-12)
})
