/**
 * The rider system — the most portability-sensitive part of the rig.
 *
 * Shape keys deform the two shells and NOTHING ELSE. Every other object — the
 * eyes, the brows, the interior cards, the hinge pins, the hinge pivot itself —
 * is a separate object and will DETACH on the first bent pose unless it is
 * explicitly moved. Bend 12 degrees and the face surface travels ~0.15u at eye
 * height while the eyes stay exactly where they were.
 *
 * A rider is placed at `field_matrix(rest_position)`: the field position, with
 * the orthonormal Jacobian rotation. Riders are synced at the level where
 * everything below can ride rigidly — syncing `Eye_Rig` carries its eyeballs AND
 * all their shader control empties, so the pupil stays glued to the eye by
 * construction rather than by extra bookkeeping.
 *
 * THE FIELD IS A BODY-SPACE OPERATION, NOT A WORLD-SPACE ONE.
 * This is the mistake the first version made, and the symptom was spectacular:
 * `field_matrix` was applied as an absolute world transform, so when the root
 * flew to a DOM element the parent-inverse cancelled the motion and every rider
 * stayed behind at the origin. On screen it read as TWO characters — the cyan
 * shells at the destination and a pale cluster of disembodied eyes and brows
 * back at the start. The field describes displacement WITHIN the body, so it has
 * to be composed inside the body's frame and then carried by the node chain like
 * everything else.
 */
import { Matrix4, Object3D, Vector3 } from 'three'
import { fieldMatrix } from './field'
import { C4, C4_INV, CHANNEL_RANGE, HINGE_REST, MOUTH } from './constants'

/**
 * Riders split by which shell they belong to, and getting this wrong is not
 * subtle: placing lid riders absolutely causes `parent_world^-1` to cancel the
 * mouth rotation, and the eyes stop rising when he opens his mouth.
 */
const BASE_RIDERS = [
  'Card_Deck_anim',
  'Card_Single_anim',
  'Hinge_Pin_L_anim',
  'Hinge_Pin_R_anim',
] as const

const LID_RIDERS = [
  // NOTE: `Eye_Rig_anim` is deliberately NOT here. It is VERTEX_3-parented to the
  // lid in Blender and follows the MORPHED surface, which the analytic field
  // cannot represent — `eyeSocket.ts` owns it.
  //
  // The BROW SOCKETS are not here either, and that is the same fact twice. In the
  // live file `Brow_{L,R}_Socket` are children of `Eye_Rig`, NOT of the lid, so
  // they inherit the morph tracking for free. Riding them on the analytic field
  // instead cost 0.26 BU at the full gape — measured, and exactly equal to
  // `Eye_Rig`'s own morph displacement there, which is the giveaway.
  'Hinge_Pin_C_anim',
] as const

type Rider = {
  node: Object3D
  /** Rest transform in BODY space (three frame). */
  restInBody: Matrix4
  /** Its translation re-expressed in the Blender frame, which is what the field
   *  takes as input. */
  restBlender: Vector3
  isLid: boolean
}

export type RiderSystem = {
  riders: Rider[]
  apply(bendDeg: number, leanDeg: number, twistDeg: number, mouth: number): void
}

const C = C4
const C_INV = C4_INV

const _fieldM = new Matrix4()
const _targetInBody = new Matrix4()
const _world = new Matrix4()
const _parentInv = new Matrix4()
const _hingeNow = new Matrix4()
const _hingeInv = new Matrix4()
const _mouthRot = new Matrix4()
const _hMouth = new Matrix4()
const _bodyInv = new Matrix4()
const _p = new Vector3()

export function createRiderSystem(scene: Object3D): RiderSystem {
  scene.updateWorldMatrix(true, true)

  const body = scene.getObjectByName('DeckE_Body')
  if (!body) throw new Error('decke riders: DeckE_Body missing from the glb')

  const bodyRestInv = body.matrixWorld.clone().invert()

  const riders: Rider[] = []
  const collect = (names: readonly string[], isLid: boolean) => {
    for (const name of names) {
      const node = scene.getObjectByName(name)
      if (!node) continue
      const restInBody = bodyRestInv.clone().multiply(node.matrixWorld)
      _p.setFromMatrixPosition(restInBody)
      riders.push({
        node,
        restInBody,
        // three (x, y, z) -> blender (x, -z, y)
        restBlender: new Vector3(_p.x, -_p.z, _p.y),
        isLid,
      })
    }
  }
  collect(BASE_RIDERS, false)
  collect(LID_RIDERS, true)

  function apply(bendDeg: number, leanDeg: number, twistDeg: number, mouth: number) {
    body!.updateWorldMatrix(true, false)
    _bodyInv.copy(body!.matrixWorld).invert()
    // `bendDeg` arrives with the mouth's back-arch already folded in and CLAMPED
    // by the caller (see MOUTH.secondaryMax). Do not re-derive it here — the
    // hinge frame and the riders must be evaluated from the identical input or
    // the lid pivot and the things riding it disagree.
    const b = bendDeg

    // The hinge composite: H_mouth = Cf * MouthRot * Cf^-1 rotates about the
    // DEFORMED hinge. At mouth = 0 it is EXACTLY the identity, which leaves the
    // closed seam untouched at every deformation value.
    //
    // This IS the two-pivot composition, not an approximation of it. Blender's
    // two nodes carry `Lid_Hinge = Cf * MouthRot` and `DeckBox_Lid = Cf^-1 * T(H)`,
    // whose product is `Cf * MouthRot * Cf^-1 * T(H)` — the second "pivot" is the
    // counter-transform that makes the composite exactly T(H) at mouth = 0, not a
    // second share of the gape. Verified against the live file in body space at
    // six poses spanning mouth 0..2.09: the hinge pins and the interior cards land
    // to 0.0000 BU and `Eye_Rig` to 0.013 BU, the residual being its VERTEX_3
    // parenting to the morphed lid, which is present at rest too.
    fieldMatrix(HINGE_REST, b, leanDeg, twistDeg, _hingeNow)
    _hingeNow.premultiply(C).multiply(C_INV) // into the three frame
    _hingeInv.copy(_hingeNow).invert()
    _mouthRot.makeRotationX(-mouth * MOUTH.maxDeg * (Math.PI / 180))
    _hMouth.copy(_hingeNow).multiply(_mouthRot).multiply(_hingeInv)

    for (const r of riders) {
      fieldMatrix(r.restBlender, b, leanDeg, twistDeg, _fieldM)
      // Blender frame -> three frame, still expressed in BODY space.
      _targetInBody.copy(C).multiply(_fieldM).multiply(C_INV)

      if (r.isLid) _targetInBody.premultiply(_hMouth)

      // Carry it out through the live body transform, so the whole node chain —
      // root travel, facing yaw, tilt, float, squash — is inherited rather than
      // cancelled.
      _world.multiplyMatrices(body!.matrixWorld, _targetInBody)

      const parent = r.node.parent
      if (parent) {
        parent.updateWorldMatrix(true, false)
        _parentInv.copy(parent.matrixWorld).invert()
        _world.premultiply(_parentInv)
      }
      _world.decompose(r.node.position, r.node.quaternion, r.node.scale)
    }
  }

  return { riders, apply }
}
