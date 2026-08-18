/**
 * Deck-E's deformation field — a direct port of `wiki/_raw/src/decke_field.py`.
 *
 * This is the single source of truth for everything that deforms with his body:
 * both shells (as morph targets) and every "rider" object (eyes, brows, cards,
 * hinge pins, the hinge pivot itself).
 *
 * WHY IT IS SHAPED LIKE THIS — Invariant P:
 *   The field is a pure function of REST WORLD POSITION, so any two points that
 *   are coincident at rest receive identical displacement. That is what makes it
 *   impossible for the mouth seam to shear. The two shells overlap for 52.7% of
 *   his height with 2,689 vertices a designed 0.12 mm apart; a skinned spine
 *   produces ~0.065u of shear at a 10deg bend, which is 22x that gap. Bones were
 *   measured and rejected for exactly this reason.
 *
 * Everything here is in the BLENDER frame: Z-up, DEGREES in, blender units.
 * Convert at the boundary, not in here.
 *
 * Composition order `twist(lean(bend(p)))` is FIXED AND NORMATIVE.
 */
import { Matrix4, Vector3 } from 'three'
import { BODY_H } from './constants'

const DEG2RAD = Math.PI / 180

/** Finite-difference step for the Jacobian. Normative: the rider rotation is
 *  DEFINED as the orthonormal part of the field Jacobian obtained this way. */
export const FIELD_EPS = 1e-4

/** Below this the rotation is treated as identity. The circular forms divide by
 *  T, so they must be guarded; both correctly limit to identity as T -> 0. */
const T_EPS = 1e-9

/** Circular bend in the YZ plane, about X. +deg = forward (toward camera). */
export function bend(p: Vector3, deg: number, out = new Vector3()): Vector3 {
  const T = deg * DEG2RAD
  if (Math.abs(T) < T_EPS) return out.copy(p)
  const R = BODY_H / T
  const a = (T * p.z) / BODY_H
  const dy = p.y
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  return out.set(p.x, R * (1 - ca) + dy * ca, R * sa - dy * sa)
}

/** The identical formula in the XZ plane, about Y. +deg = lean toward +X.
 *  Because rotation accumulates with height this produces lean WITH AN ARCH,
 *  not a rigid tilt — which is the whole reason it reads as a soft body. */
export function lean(p: Vector3, deg: number, out = new Vector3()): Vector3 {
  const T = deg * DEG2RAD
  if (Math.abs(T) < T_EPS) return out.copy(p)
  const R = BODY_H / T
  const a = (T * p.z) / BODY_H
  const dx = p.x
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  return out.set(R * (1 - ca) + dx * ca, p.y, R * sa - dx * sa)
}

/** Rotation about Z, accumulating linearly with height. */
export function twist(p: Vector3, deg: number, out = new Vector3()): Vector3 {
  const a = (deg * DEG2RAD * p.z) / BODY_H
  const c = Math.cos(a)
  const s = Math.sin(a)
  return out.set(p.x * c - p.y * s, p.x * s + p.y * c, p.z)
}

const _f1 = new Vector3()
const _f2 = new Vector3()

/** The full field. `p` is a REST WORLD position; returns the deformed position. */
export function field(p: Vector3, bendDeg: number, leanDeg: number, twistDeg: number, out = new Vector3()): Vector3 {
  bend(p, bendDeg, _f1)
  lean(_f1, leanDeg, _f2)
  return twist(_f2, twistDeg, out)
}

const _plus = new Vector3()
const _minus = new Vector3()
const _fp = new Vector3()
const _fm = new Vector3()
const _c0 = new Vector3()
const _c1 = new Vector3()
const _c2 = new Vector3()
const _tmp = new Vector3()

/**
 * The rotation a rider at rest position `p` should adopt: the orthonormal part
 * of the field Jacobian at `p`, by central differences plus Gram-Schmidt.
 *
 * This is the NORMATIVE definition, not an approximation of one — the wiki
 * specifies the finite-difference step and the orthonormalisation explicitly so
 * that Blender and the port produce bit-comparable frames.
 *
 * Writes a rotation-only matrix into `out`.
 */
export function fieldRot(
  p: Vector3,
  bendDeg: number,
  leanDeg: number,
  twistDeg: number,
  out = new Matrix4(),
): Matrix4 {
  const cols = [_c0, _c1, _c2]
  for (let axis = 0; axis < 3; axis++) {
    _plus.copy(p)
    _minus.copy(p)
    if (axis === 0) {
      _plus.x += FIELD_EPS
      _minus.x -= FIELD_EPS
    } else if (axis === 1) {
      _plus.y += FIELD_EPS
      _minus.y -= FIELD_EPS
    } else {
      _plus.z += FIELD_EPS
      _minus.z -= FIELD_EPS
    }
    field(_plus, bendDeg, leanDeg, twistDeg, _fp)
    field(_minus, bendDeg, leanDeg, twistDeg, _fm)
    cols[axis].subVectors(_fp, _fm).divideScalar(2 * FIELD_EPS)
  }

  // Gram-Schmidt. Equivalent to polar decomposition here because the field is
  // near-isometric.
  const u0 = _c0.normalize()
  const u1 = _c1.sub(_tmp.copy(u0).multiplyScalar(_c1.dot(u0))).normalize()
  const u2 = _c2.copy(u0).cross(u1)

  // three.js Matrix4.set takes ROW-major arguments; the basis vectors are the
  // columns, exactly as decke_field.py builds them.
  return out.set(
    u0.x, u1.x, u2.x, 0,
    u0.y, u1.y, u2.y, 0,
    u0.z, u1.z, u2.z, 0,
    0, 0, 0, 1,
  )
}

const _pos = new Vector3()

/**
 * The full 4x4 a rider should end up with, in Blender-frame WORLD space.
 *
 * Riders split by which shell they belong to, and getting this wrong is not
 * subtle:
 *   base riders (Card_Deck, Card_Single, Hinge_Pin_L/R) -> fieldMatrix(P)
 *   lid riders  (Eye_Rig, Eye_L/R, Brow_*_Socket, Hinge_Pin_C)
 *                                                -> H_mouth * fieldMatrix(P)
 * where H_mouth rotates about the DEFORMED hinge. Placing lid riders absolutely
 * makes `parent_world^-1` cancel the mouth rotation, and the eyes stop rising
 * when he opens his mouth.
 */
export function fieldMatrix(
  p: Vector3,
  bendDeg: number,
  leanDeg: number,
  twistDeg: number,
  out = new Matrix4(),
): Matrix4 {
  fieldRot(p, bendDeg, leanDeg, twistDeg, out)
  field(p, bendDeg, leanDeg, twistDeg, _pos)
  out.setPosition(_pos)
  return out
}

/**
 * The hinge correction. Under deformation the base's material at the hinge moves
 * to `field(H)`, but the pivot is an object transform and does not follow it —
 * so without this the lid rotates about the wrong point (~0.15u error at a 12deg
 * bend).
 *
 *   Cf                = the field frame at the hinge
 *   Lid_Hinge.basis   = Cf * MouthRot
 *   DeckBox_Lid.basis = Cf^-1 * Translate(H_rest)
 *
 * The counter-transform makes the composite EXACTLY `Translate(H_rest)` at
 * mouth = 0, so the closed seam is untouched at every deformation value. Putting
 * the correction into the shape key instead reintroduces a gap mid-blend,
 * because `field` is not linear in the angle.
 */
export function hingeFrame(
  hingeRest: Vector3,
  bendDeg: number,
  leanDeg: number,
  twistDeg: number,
  out = new Matrix4(),
): Matrix4 {
  return fieldMatrix(hingeRest, bendDeg, leanDeg, twistDeg, out)
}

/**
 * Authored maxima. Value 1.0 of each shape key equals these angles.
 *
 * One key per DIRECTION rather than one bipolar key, for two reasons: a rotation
 * field's negative is NOT the negation of its displacement (they differ at
 * second order in the angle), and glTF morph influences are conventionally 0..1.
 *
 * These are an AESTHETIC limit, not a geometric one — the seam was measured safe
 * well past 30/25/20 deg.
 */
export const FIELD_MAX = {
  Body_Bend_Fwd: { channel: 'bend', deg: 18 },
  Body_Bend_Back: { channel: 'bend', deg: -18 },
  Body_Lean_R: { channel: 'lean', deg: 15 },
  Body_Lean_L: { channel: 'lean', deg: -15 },
  Body_Twist_L: { channel: 'twist', deg: 12 },
  Body_Twist_R: { channel: 'twist', deg: -12 },
} as const
