/**
 * The brow sockets' follow-through.
 *
 * This one is a FIT, not a transcription — nothing upstream describes it, and
 * the character wiki actively says something else (it lists the brow sockets as
 * lid riders placed at `H_mouth * field(P)`, which the .blend contradicts: they
 * are children of `Eye_Rig` and carry a keyed motion of their own). So the
 * numbers measured off the live file are pinned here, along with the two
 * structural properties that make the fit more than a curve through points.
 *
 *   node --import tsx --test src/character/decke/__tests__/brows.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BROW_FOLLOW } from '../rig'
import { MOUTH } from '../constants'

/** The angle the sockets take, from the same clamped effective bend the
 *  deformation field and the hinge pair are driven by. */
function socketAngle(bend: number, mouth: number): number {
  return (
    BROW_FOLLOW.rotPerBend *
    (bend - MOUTH.archAtFull * Math.min(mouth, MOUTH.secondaryMax))
  )
}

test('an undeformed body leaves the sockets exactly at rest', () => {
  // This is the strongest evidence the model has. SIX states in the live file
  // (boot, thinking, confused, embarrassed, nod_yes, shake_no) have zero bend
  // and zero mouth, and all six read Brow_L_Socket.rotation_euler.x == 0.0
  // EXACTLY. A fit that missed the zero would have shown up six times over.
  // Compared with `===`, not `assert.equal`: the product of a negative
  // coefficient and zero is `-0`, and strict equality treats that as distinct
  // from `0`. This exact trap has already cost this project one bogus test.
  assert.ok(socketAngle(0, 0) === 0)
  assert.ok(socketAngle(0, 0) * BROW_FOLLOW.dyPerRad === 0)
  assert.ok(socketAngle(0, 0) * BROW_FOLLOW.dzPerRad === 0)
})

test('the fitted angle reproduces the live file across the measured range', () => {
  // (state, authored bend, authored mouth, Brow_L_Socket.rotation_euler.x)
  // read at each state's marker + 20 frames. The range spans -0.72 .. +0.47 of
  // effective bend, which is what bounds the extrapolation.
  const CASES: [string, number, number, number][] = [
    ['card_stash', -0.617, 2.09, 0.0822],
    ['card_show', -0.34, 0.95, 0.05032],
    ['proud', -0.421, 0.0, 0.04763],
    ['card_present', -0.14, 0.08, 0.01669],
    ['alert_star', 0.0, 0.48, 0.00596],
    ['listening', 0.154, 0.0, -0.01813],
    ['sleep', 0.192, 0.06, -0.02017],
    ['curious', 0.262, 0.0, -0.03219],
    ['sad', 0.348, 0.04, -0.03921],
  ]
  let worst = 0
  for (const [name, bend, mouth, measured] of CASES) {
    const err = Math.abs(socketAngle(bend, mouth) - measured)
    worst = Math.max(worst, err)
    assert.ok(err < 0.009, `${name}: predicted vs file off by ${err.toFixed(5)} rad`)
  }
  // 0.009 rad is half a degree; at the socket's ~0.6 BU lever that is ~0.005 BU,
  // which is under a hundredth of the bezel width.
  assert.ok(worst < 0.009, `worst residual ${worst.toFixed(5)} rad`)
})

test('the sign is a COUNTER-rotation, and a sign flip is not survivable', () => {
  // Bending forward (+bend) rotates the sockets negatively and vice versa. The
  // canary: at the two extremes of the measured range the predictions must
  // straddle zero, so an inverted coefficient cannot pass the case table above.
  assert.ok(socketAngle(-0.617, 2.09) > 0.07, 'a back arch lifts the sockets')
  assert.ok(socketAngle(0.348, 0.04) < -0.03, 'a forward bend drops them')
  assert.ok(BROW_FOLLOW.rotPerBend < 0)
})

test('the translation is a rigid rotation about a FIXED pivot', () => {
  // dy and dz are both proportional to the same angle, so their ratio must not
  // depend on the pose. That is a structural prediction the data did not have to
  // satisfy — a sloppier "brows drift with bend" model would not produce it —
  // and it is why two coefficients suffice instead of a per-state table.
  const ratios = [
    [-0.7, 2.09],
    [-0.2, 0],
    [0, 0.5],
    [0.35, 0.04],
  ].map(([b, m]) => {
    const t = socketAngle(b, m)
    return (BROW_FOLLOW.dyPerRad * t) / (BROW_FOLLOW.dzPerRad * t)
  })
  for (const r of ratios) {
    assert.ok(Math.abs(r - ratios[0]) < 1e-12, 'the dy:dz ratio must be pose-independent')
  }
  // And that fixed ratio places the pivot where it was measured: the socket
  // rests at blender (y -0.0148, z 0.87446), so the pivot is (0.590, 0.452).
  const pivotY = -0.0148 - BROW_FOLLOW.dzPerRad
  const pivotZ = 0.87446 + BROW_FOLLOW.dyPerRad
  assert.ok(Math.abs(pivotY - 0.5895) < 1e-3, `pivot y ${pivotY}`)
  assert.ok(Math.abs(pivotZ - 0.4517) < 1e-3, `pivot z ${pivotZ}`)
})

test('the mouth arch saturates here exactly as it does at the hinge', () => {
  // The follow-through takes the SAME clamped effective bend as the field and
  // the hinge pair. If it ever stopped saturating, the sockets and the lid pivot
  // would disagree past mouth = 1 and the brows would drift off the shell during
  // every full gape.
  assert.equal(socketAngle(0, 1), socketAngle(0, 2.09))
  // The arch bends him BACKWARD, so opening the mouth drives the same
  // counter-rotation a back arch does: the angle grows with mouth, up to 1.
  assert.ok(socketAngle(0, 0.5) < socketAngle(0, 1), 'but it still moves below 1')
  assert.ok(socketAngle(0, 0.5) > 0, 'and in the back-arch direction')
})
