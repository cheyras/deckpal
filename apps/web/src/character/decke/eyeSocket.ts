/**
 * The eye-in-socket layer — `Eye_Rig_anim`'s VERTEX_3 parenting.
 *
 * THE PROBLEM. The eye recess is LID GEOMETRY: it rides the shape keys. The
 * eyeballs are child objects and only follow object transforms. Left
 * uncompensated they diverge by 0.133 blender units — sixteen times the 0.008
 * bezel width — and, worse, the socket GROWS 11.6% under the body morphs while
 * the eyeball stays rigid. The growth, not the translation, is what actually
 * reads wrong.
 *
 * Four fixes were tried upstream and all failed, each for an instructive reason:
 * driving the eye from morph weights (helped at one frame, hurt at another,
 * because the panel *rotates* 11-13 degrees); adding that rotation as summed
 * Euler angles (Euler angles do not add); zeroing the morphs over the eye region
 * (numerically exact and visually catastrophic — the body morphs ARE the
 * deformation, so the brows sank into the head); and fitting the pocket's rigid
 * motion (extrapolates an 11-degree rotation half a unit from the pivot).
 *
 * > The lesson recorded upstream: a fix applied to a morph target is a fix
 * > applied to the whole character. Compensation belongs on the object that is
 * > wrong — the eye — not on the deformation that is right.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `riders.ts`. The rider system follows the
 * analytic bend/lean/twist field, which knows nothing about the MOUTH morphs. At
 * the full 115-degree gape that left the eye ~0.05 BU proud of the panel — and
 * since the eyeball is a shallow lens sitting only 0.012 BU behind the panel
 * plane, 0.05 is enough to push it through and draw the face on the inside of
 * the open lid. Following the actual morphed vertices fixes that by
 * construction, because it tracks whatever the geometry really did.
 */
import { Matrix4, Mesh, Object3D, Vector3 } from 'three'
import { EYE_SOCKET_SCALE } from './constants'

/** How far a shipped vertex may sit from its authored rest position. Sized for
 *  `KHR_mesh_quantization`, not for float error. */
const VERT_MATCH_TOL = 5e-3

/**
 * The three lid vertices Blender parents `Eye_Rig_anim` to, as REST positions in
 * the lid's local space, already converted to the three.js frame.
 *
 * They are identified by POSITION rather than by index on purpose: Blender's
 * indices are 1975 / 2095 / 1935, but the glTF exporter splits vertices at sharp
 * edges and UV seams (the lid goes 4174 -> more), so those indices do not
 * survive export. Position is stable across the split.
 */
const PARENT_VERTS_REST = [
  // Blender local (-0.384694, -1.116,  0.236766) -> three (x, z, -y)
  new Vector3(-0.384694, 0.236766, 1.116),
  new Vector3(0.384694, 0.236766, 1.116),
  new Vector3(-0.387245, -0.86763, 1.116),
] as const

/** Shape-key order on the lid, as exported. `Mouth_S` (index 2) is deliberately
 *  absent from the scale fit, which is why the coefficients are sparse. */
const LID_KEY_ORDER = [
  'Mouth_Shift',
  'Mouth_Curve',
  'Mouth_S',
  'Mouth_W',
  'Body_Bend_Fwd',
  'Body_Bend_Back',
  'Body_Lean_R',
  'Body_Lean_L',
  'Body_Twist_L',
  'Body_Twist_R',
]

export type EyeSocket = {
  apply(): void
}

/**
 * Build an orthonormal basis from the parent triangle.
 *
 * The CONVENTION DOES NOT MATTER, which is the trick that makes this portable:
 * we only ever use `B_now * B_rest⁻¹`, a delta, so any consistent right-handed
 * basis cancels. That saves reproducing Blender's `tri_to_quat`, which has its
 * own axis-ordering rules we would otherwise have to match exactly.
 */
function triBasis(a: Vector3, b: Vector3, c: Vector3, out: Matrix4): Matrix4 {
  const x = new Vector3().subVectors(b, a).normalize()
  const e2 = new Vector3().subVectors(c, a)
  const z = new Vector3().crossVectors(x, e2).normalize()
  const y = new Vector3().crossVectors(z, x)
  const o = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3)
  return out.set(
    x.x, y.x, z.x, o.x,
    x.y, y.y, z.y, o.y,
    x.z, y.z, z.z, o.z,
    0, 0, 0, 1,
  )
}

export function createEyeSocket(scene: Object3D): EyeSocket | null {
  const lid = scene.getObjectByName('DeckBox_Lid_anim')
  const eyeRig = scene.getObjectByName('Eye_Rig_anim')
  if (!lid || !eyeRig) return null

  // The lid object may hold the mesh directly or carry it as a child.
  let mesh: Mesh | null = null
  lid.traverse((o) => {
    const m = o as Mesh
    if (!mesh && m.isMesh && m.geometry?.getAttribute('position')) mesh = m
  })
  if (!mesh) return null
  const lidMesh: Mesh = mesh

  // Resolve the three parent vertices by nearest rest position.
  //
  // The tolerance is deliberately loose. The shipped glb is quantized
  // (`KHR_mesh_quantization`), which moves every position by up to a
  // half-quantum — comparable to a tight epsilon, so a 1e-4 test would reject
  // the correct vertex and silently switch the whole layer off. What actually
  // proves we found the right triangle is its SHAPE: the three verts sit
  // 0.769 and 1.104 apart, distances no neighbouring triple comes close to. So
  // accept the nearest vertex generously and then verify the triangle.
  const pos = lidMesh.geometry.getAttribute('position')
  const indices: number[] = []
  const probe = new Vector3()
  for (const target of PARENT_VERTS_REST) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < pos.count; i++) {
      probe.fromBufferAttribute(pos, i)
      const d = probe.distanceToSquared(target)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0 || bestD > VERT_MATCH_TOL * VERT_MATCH_TOL) return null
    indices.push(best)
  }

  // Shape check: every edge of the found triangle must match the rest triangle.
  // This is what makes the loose tolerance above safe — a wrong triple fails it.
  {
    const a = new Vector3().fromBufferAttribute(pos, indices[0])
    const b = new Vector3().fromBufferAttribute(pos, indices[1])
    const c = new Vector3().fromBufferAttribute(pos, indices[2])
    const got = [a.distanceTo(b), a.distanceTo(c), b.distanceTo(c)]
    const want = [
      PARENT_VERTS_REST[0].distanceTo(PARENT_VERTS_REST[1]),
      PARENT_VERTS_REST[0].distanceTo(PARENT_VERTS_REST[2]),
      PARENT_VERTS_REST[1].distanceTo(PARENT_VERTS_REST[2]),
    ]
    for (let i = 0; i < 3; i++) {
      if (Math.abs(got[i] - want[i]) > VERT_MATCH_TOL) return null
    }
  }

  const morphNames = lidMesh.morphTargetDictionary ?? {}

  scene.updateWorldMatrix(true, true)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const restBasis = new Matrix4()
  lidMesh.getVertexPosition(indices[0], a)
  lidMesh.getVertexPosition(indices[1], b)
  lidMesh.getVertexPosition(indices[2], c)
  triBasis(a, b, c, restBasis)
  const restBasisInv = restBasis.clone().invert()

  // `Eye_Rig`'s rest transform in the LID's space — what the delta is applied to.
  const eyeRestInLid = lid.matrixWorld.clone().invert().multiply(eyeRig.matrixWorld)

  const nowBasis = new Matrix4()
  const world = new Matrix4()
  const parentInv = new Matrix4()

  /**
   * The `delta_scale` driver, read off the live rig (three identical drivers,
   * one per axis). It compensates the socket's 11.6% growth, and the divisor
   * normalises it to exactly 1.0 at rest since sqrt(0.348310) = 0.590178.
   */
  function socketScale(): number {
    const k = (name: string) => {
      const i = morphNames[name]
      return i === undefined ? 0 : (lidMesh.morphTargetInfluences?.[i] ?? 0)
    }
    const v = LID_KEY_ORDER.map(k)
    const { a0, linear, cross, divisor } = EYE_SOCKET_SCALE
    const s =
      a0 +
      linear.k0 * v[0] +
      linear.k1 * v[1] +
      linear.k3 * v[3] +
      linear.k4 * v[4] +
      linear.k5 * v[5] +
      cross.k4k5 * v[4] * v[5] +
      cross.k6k7 * v[6] * v[7]
    return Math.sqrt(Math.max(0, s)) / divisor
  }

  function apply() {
    // `getVertexPosition` applies morph targets on the CPU, which is exactly the
    // deformed surface Blender's vertex parent follows.
    lidMesh.getVertexPosition(indices[0], a)
    lidMesh.getVertexPosition(indices[1], b)
    lidMesh.getVertexPosition(indices[2], c)
    triBasis(a, b, c, nowBasis)

    lid!.updateWorldMatrix(true, false)
    // world = lid * (B_now * B_rest^-1) * eyeRestInLid
    world
      .copy(lid!.matrixWorld)
      .multiply(nowBasis)
      .multiply(restBasisInv)
      .multiply(eyeRestInLid)

    const parent = eyeRig!.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      parentInv.copy(parent.matrixWorld).invert()
      world.premultiply(parentInv)
    }
    world.decompose(eyeRig!.position, eyeRig!.quaternion, eyeRig!.scale)

    const s = socketScale()
    eyeRig!.scale.multiplyScalar(s)
  }

  return { apply }
}
