/**
 * The rig: binds the exported glTF nodes and applies a 47-channel pose to them.
 *
 * This is where the normalised channels the playbook speaks fan out into the
 * things three.js can actually draw — morph influences, node transforms, hinge
 * angles and shader uniforms. Most of the character's non-obvious behaviour
 * lives in this file, and nearly every rule in it was learned from a defect.
 */
import { Euler, Matrix4, Object3D, Quaternion, Vector3, type Mesh } from 'three'
import {
  blenderEulerToThree,
  blenderToThree,
  C4,
  C4_INV,
  CHANNEL_RANGE,
  CTRL,
  DEG,
  EYE_SOCKET_SCALE,
  HINGE_REST,
  MOUTH,
} from './constants'
import { hingeFrame } from './field'
import type { Pose } from './playbook'

/** Meshes that carry the ten body/mouth morph targets. */
const SHELL_MESH_NODES = ['DeckBox_Base_anim', 'DeckBox_Lid_anim'] as const

export type RigNodes = {
  root: Object3D
  facing: Object3D
  tilt: Object3D
  float: Object3D
  roll: Object3D
  squash: Object3D
  rollPivot: Object3D
  body: Object3D
  lidHinge: Object3D
  lid: Object3D
  base: Object3D
  eyeRig: Object3D
  ctrlTarget: Object3D
  ctrlBrows: Object3D
  ctrlBrowL: Object3D
  ctrlBrowR: Object3D
  browSocketL: Object3D
  browSocketR: Object3D
  /** The brow sockets' bind transforms, which the follow-through offsets from. */
  browSocketRest: { y: number; z: number; rx: number }
  ctrlLidUL: Object3D
  ctrlLidUR: Object3D
  ctrlLidLL: Object3D
  ctrlLidLR: Object3D
  ctrlPupilL: Object3D
  ctrlPupilR: Object3D
  ctrlShineL: Object3D
  ctrlShineR: Object3D
  ctrlLineL: Object3D
  ctrlLineR: Object3D
  ctrlSymbolL: Object3D
  ctrlSymbolR: Object3D
  ctrlSymLineL: Object3D
  ctrlSymLineR: Object3D
  /** The reel's authored rest heights, read off the glb. See `captureReel`. */
  reel: ReelRest
  /** Every mesh carrying the 10-target morph set, and its name->index map. */
  morphTargets: { mesh: Mesh; dict: Record<string, number> }[]
}

/**
 * Where the two reel drums sit at `alert = 0`, and how far they travel.
 *
 * The travel is ONE drum height, and the file pins it twice over:
 *
 *   - `Ctrl_Symbol_L` carries no constraints at all, so its glb bind transform
 *     is a pure `alert = 0` sample of its own f-curve: z = -1.30.
 *   - `blender/02-06-objects-rig.md` dumps the .blend at frame 1180, which is
 *     `alert_warn` + 29 frames, i.e. inside the `alert = 1.0` hold. There
 *     `Ctrl_Symbol_L` reads z = 0.0 and `Ctrl_Pupil_L_anim` reads z = 1.30.
 *
 * So the symbol drum runs -1.30 -> 0 and the pupil drum runs one travel up from
 * wherever it rests. The symbol does NOT land on the pupil's rest seat. An
 * earlier reading derived the travel as the gap between the two drums (1.4579)
 * because `Ctrl_Pupil` rests at 0.158, "exactly the height of `Ctrl_Line`" —
 * but that argument is circular: `Ctrl_Line` only sits there because it COPIES
 * the pupil (the `FollowPupil` constraint, reproduced in `applyPose`), so the
 * two agreeing says nothing about where the symbol belongs. Measured against
 * the frame-1052 reference, 1.4579 floats the glyph ~24 px too high; one drum
 * lands it within ~3 px, which is the whole-eye alignment error at that frame.
 *
 * The pupil keeps its authored rest as an OFFSET rather than going absolute,
 * because that rest carries a baked `Gaze` contribution the port does not
 * re-derive, and at rest it matches Blender to within a pixel.
 */
export type ReelRest = { pupilY: number; symbolY: number; travel: number }

function captureReel(pupil: Object3D, symbol: Object3D): ReelRest {
  return {
    pupilY: pupil.position.y,
    symbolY: symbol.position.y,
    // The symbol drum's authored rest IS one negative travel: it is parked a
    // full drum below the z = 0 seat it lands on at alert = 1.
    travel: -symbol.position.y,
  }
}

function req(scene: Object3D, name: string): Object3D {
  const o = scene.getObjectByName(name)
  if (!o) throw new Error(`decke rig: node "${name}" missing from the glb`)
  return o
}

export function bindRig(scene: Object3D): RigNodes {
  const morphTargets: RigNodes['morphTargets'] = []
  scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && m.morphTargetInfluences && m.morphTargetDictionary) {
      morphTargets.push({ mesh: m, dict: m.morphTargetDictionary })
    }
  })

  return {
    root: req(scene, 'DeckE_Root'),
    facing: req(scene, 'DeckE_Facing'),
    tilt: req(scene, 'DeckE_Tilt'),
    float: req(scene, 'DeckE_Float'),
    roll: req(scene, 'DeckE_Roll'),
    squash: req(scene, 'DeckE_Squash'),
    rollPivot: req(scene, 'DeckE_RollPivot'),
    body: req(scene, 'DeckE_Body'),
    lidHinge: req(scene, 'Lid_Hinge_anim'),
    lid: req(scene, 'DeckBox_Lid_anim'),
    base: req(scene, 'DeckBox_Base_anim'),
    eyeRig: req(scene, 'Eye_Rig_anim'),
    ctrlTarget: req(scene, 'Ctrl_Target_anim'),
    ctrlBrows: req(scene, 'Ctrl_Brows_anim'),
    ctrlBrowL: req(scene, 'Ctrl_Brow_L_anim'),
    ctrlBrowR: req(scene, 'Ctrl_Brow_R_anim'),
    browSocketL: req(scene, 'Brow_L_Socket_anim'),
    browSocketR: req(scene, 'Brow_R_Socket_anim'),
    browSocketRest: (() => {
      const n = req(scene, 'Brow_L_Socket_anim')
      return { y: n.position.y, z: n.position.z, rx: n.rotation.x }
    })(),
    ctrlLidUL: req(scene, 'Ctrl_LidU_L_anim'),
    ctrlLidUR: req(scene, 'Ctrl_LidU_R_anim'),
    ctrlLidLL: req(scene, 'Ctrl_LidL_L_anim'),
    ctrlLidLR: req(scene, 'Ctrl_LidL_R_anim'),
    ctrlPupilL: req(scene, 'Ctrl_Pupil_L_anim'),
    ctrlPupilR: req(scene, 'Ctrl_Pupil_R_anim'),
    // Shine and line carry no pose channel of their own — they ride the pupil
    // and the eye — but the eye shader reads the world matrix of each, so they
    // have to be bound like any other control.
    ctrlShineL: req(scene, 'Ctrl_Shine_L_anim'),
    ctrlShineR: req(scene, 'Ctrl_Shine_R_anim'),
    ctrlLineL: req(scene, 'Ctrl_Line_L_anim'),
    ctrlLineR: req(scene, 'Ctrl_Line_R_anim'),
    ctrlSymbolL: req(scene, 'Ctrl_Symbol_L'),
    ctrlSymbolR: req(scene, 'Ctrl_Symbol_R'),
    ctrlSymLineL: req(scene, 'Ctrl_SymLine_L'),
    ctrlSymLineR: req(scene, 'Ctrl_SymLine_R'),
    reel: captureReel(req(scene, 'Ctrl_Pupil_L_anim'), req(scene, 'Ctrl_Symbol_L')),
    morphTargets,
  }
}

/**
 * Set one morph target by NAME across every mesh that has it.
 *
 * `DeckBox_Base` exports as TWO primitives split by material, and each carries
 * its own full copy of all ten targets. In three.js they become separate Mesh
 * objects with independent `morphTargetInfluences`, and if they are not driven
 * in lockstep the shell TEARS along the material boundary — a visible split
 * right down the mouth. Driving by name across all meshes is what guarantees
 * lockstep; never index into a single mesh.
 */
function setMorph(rig: RigNodes, name: string, value: number) {
  for (const { mesh, dict } of rig.morphTargets) {
    const i = dict[name]
    if (i !== undefined) mesh.morphTargetInfluences![i] = value
  }
}

const _q = new Quaternion()
const _v = new Vector3()
const _m = new Matrix4()

export type RigOptions = {
  /** Blender's `facing` in [-1, +1]. Sided channels are resolved against it. */
  facing: number
}

/**
 * Apply a resolved pose to the rig.
 *
 * The pose arriving here must ALREADY have had facing resolution and the
 * procedural layers composed into it — this function is the last step, and it
 * assumes `pose` is what should appear on screen.
 */
export function applyPose(rig: RigNodes, pose: Pose, opts: RigOptions) {
  // ---- node chain -------------------------------------------------------
  // Position lives on the root and the root is NEVER yawed: with the facing
  // node above it, the yaw rotates his flight PATH, and travel_far measured
  // 14 of 19 sampled frames entirely off-screen.
  rig.root.position.copy(blenderToThree(pose.px, pose.py, pose.pz, _v))

  // Body rotation lives BELOW the facing node. Above it, rocking about world Y
  // reads as side-to-side only while he faces -Y; turned 80 degrees it becomes
  // pitch. Three attempts to fix that with sign-flipping drivers all failed —
  // the channel never needed a sign, it needed a different parent.
  rig.tilt.quaternion.copy(
    blenderEulerToThree(pose.rx * DEG, pose.ry * DEG, pose.rz * DEG, _q),
  )

  // Squash is volume-preserving along his long axis.
  const sq = pose.sq
  const sz = 1 + sq
  const sxy = 1 / Math.sqrt(Math.max(1e-6, 1 + sq))
  // Blender Z (up) maps to three Y.
  rig.squash.scale.set(sxy, sz, sxy)

  // ---- the mouth composite ---------------------------------------------
  // One `mouth` parameter drives three things, because the top shell must not
  // be the only thing that moves.
  //
  // `DeckBox_Lid`'s rotation is NOT a share of the gape — an earlier reading of
  // this rig said so, fitted from a single frame, and it was wrong. It is the
  // HINGE PIVOT CORRECTION:
  //
  //     Lid_Hinge.basis   = Cf * MouthRot
  //     DeckBox_Lid.basis = Cf^-1 * Translate(H_rest)
  //
  // where Cf is the deformation field's frame at the hinge. The composite is
  // therefore exactly `Cf * MouthRot * Cf^-1 * T`, i.e. a rotation about the
  // DEFORMED hinge, and at mouth = 0 it collapses to `T` so the closed seam is
  // untouched at every deformation value. The giveaway in the live file: at a
  // bent, mouth-0 frame the two rotations read +1.4001 and -1.4001 — they
  // cancel. A fixed share cannot do that, and would also invent a lid rotation
  // on every mouth-open pose that has no bend at all.
  //
  // Both nodes are driven as FULL LOCAL MATRICES, not as a rotation each. In the
  // live file `DeckBox_Lid_anim.location` is keyed and reaches (0, 0.152263,
  // -0.117046) at the full gape; `Lid_Hinge_anim.location` is keyed too and
  // tracks the field-deformed hinge. Setting only `rotation.x` and leaving both
  // positions at their rest values put the lid 0.313 BU out of place at frame
  // 1834 — which is why `card_stash` was the worst-scoring frame in the sweep,
  // and why parenting the eye to the lid regressed it. The rest transforms make
  // the pair collapse correctly: `Cf = T(H_rest)` and `MouthRot = I` at rest, so
  // the hinge lands on its exported `T(H_rest)` and the lid on the identity.
  applyHingePair(rig, pose)
  applyBrowFollow(rig, pose)

  // The whole-body tip SATURATES at mouth = 1 — measured -4.5deg at mouth 1.30
  // AND at 2.09. Only the hinge angle keeps opening past 1. Scaling it by the
  // raw `mouth` doubles it at the full gape and is worth ~0.25 BU at the eye.
  rig.body.rotation.x =
    Math.min(pose.mouth, MOUTH.secondaryMax) * MOUTH.bodyTipDeg * DEG

  // ---- body deformation morphs -----------------------------------------
  // One key per DIRECTION, not one bipolar key: a rotation field's negative is
  // not the negation of its displacement (they differ at second order), and
  // glTF morph influences are conventionally 0..1.
  const bend = pose.bend
  const lean = pose.lean
  const twist = pose.twist

  // The mouth's back-arch reaches the deformation FIELD only — it is NOT added
  // to the shape key. Measured at the full gape (frame 1834): authored bend
  // -0.60, `Body_Bend_Back` key value exactly 0.60. Adding the arch here as an
  // earlier version did set it to 0.809 and over-arched both shells.
  setMorph(rig, 'Body_Bend_Fwd', Math.max(0, bend))
  setMorph(rig, 'Body_Bend_Back', Math.max(0, -bend))
  setMorph(rig, 'Body_Lean_R', Math.max(0, lean))
  setMorph(rig, 'Body_Lean_L', Math.max(0, -lean))
  setMorph(rig, 'Body_Twist_L', Math.max(0, twist))
  setMorph(rig, 'Body_Twist_R', Math.max(0, -twist))

  setMorph(rig, 'Mouth_Curve', pose.m_curve)
  setMorph(rig, 'Mouth_S', pose.m_s)
  setMorph(rig, 'Mouth_W', pose.m_w)
  setMorph(rig, 'Mouth_Shift', pose.m_shift)

  // ---- eyelids ----------------------------------------------------------
  // Measured control conventions. The per-eye offsets ride on top of the shared
  // amount, which is how "one lower lid raised" (confused) is authored.
  const lidU = (l: number) => CTRL.lidUOpenZ - l * CTRL.lidTravel
  const lidL = (l: number) => CTRL.lidLOpenZ + l * CTRL.lidTravel
  rig.ctrlLidUL.position.y = lidU(pose.lid_u + pose.lid_u_l)
  rig.ctrlLidUR.position.y = lidU(pose.lid_u + pose.lid_u_r)
  rig.ctrlLidLL.position.y = lidL(pose.lid_l + pose.lid_l_l)
  rig.ctrlLidLR.position.y = lidL(pose.lid_l + pose.lid_l_r)

  // Lid slant: + = inner edge DOWN (angry), - = inner edge UP (sad). The two
  // eyes mirror, so the sign flips between them.
  const slantU = pose.lid_slant * 28 * DEG
  rig.ctrlLidUL.rotation.z = -slantU
  rig.ctrlLidUR.rotation.z = slantU
  const slantL = pose.lid_slant * 16 * DEG
  rig.ctrlLidLL.rotation.z = -slantL
  rig.ctrlLidLR.rotation.z = slantL

  // ---- brows ------------------------------------------------------------
  // WRITE TO THE PER-SIDE CONTROLS, NOT `Ctrl_Brows`.
  //
  // `Ctrl_Brows_anim` looks like the shared brow parent and is not one — it sits
  // under `Brows_Root_anim`, a SIBLING of the two brow sockets:
  //
  //   Eye_Rig
  //     |- Brow_L_Socket -> Ctrl_Brow_L -> Brow_L   (the mesh)
  //     |- Brow_R_Socket -> Ctrl_Brow_R -> Brow_R
  //     `- Brows_Root    -> Ctrl_Brows              (a control, drives the above)
  //
  // In Blender `Ctrl_Brows` reaches the brows through DRIVERS, and drivers do not
  // export. Writing the height there moves a node with no children: the brows
  // only appeared to animate because the socket rider was carrying them, and the
  // measured travel came out 4.5x short on `sad`.
  //
  // The /0.35 normalisation is measured and appears on no wiki page; the live
  // limit constraint on Ctrl_Brow_L/R is +/-0.35 exactly, which corroborates it.
  rig.ctrlBrowL.position.y =
    pose.brow * CTRL.browSharedScale + pose.brow_l * CTRL.browSideScale
  rig.ctrlBrowR.position.y =
    pose.brow * CTRL.browSharedScale + pose.brow_r * CTRL.browSideScale
  // Brow rotation mirrors between the sides, so a positive `brow_rot` drops both
  // INNER edges (angry) rather than rotating both brows the same way.
  const browRot = pose.brow_rot * 40 * DEG
  rig.ctrlBrowL.rotation.z = -browRot
  rig.ctrlBrowR.rotation.z = browRot

  // ---- gaze -------------------------------------------------------------
  // `Ctrl_Target` carries a Copy Location from the camera with use_offset, so
  // (0,0,0) means "looking exactly at the camera" wherever the camera is, and
  // every gaze behaviour is just an offset on top.
  rig.ctrlTarget.position.copy(blenderToThree(pose.gx, pose.gy, pose.gz, _v))

  // ---- the alert reel ---------------------------------------------------
  // `alert` is a REEL POSITION, not an opacity: the old pupil rolls up and out
  // of the top while the new symbol rolls in from below, both visible at once
  // like a slot machine. Values outside [0,1] are legal and are what produce
  // the springy bounce, so this must NOT be clamped.
  const reel = pose.alert
  // Offsets from the authored rest, sharing one travel — see `ReelRest`.
  const pupilY = rig.reel.pupilY + reel * rig.reel.travel
  const symbolY = rig.reel.symbolY + reel * rig.reel.travel
  rig.ctrlPupilL.position.y = pupilY
  rig.ctrlPupilR.position.y = pupilY
  rig.ctrlSymbolL.position.y = symbolY
  rig.ctrlSymbolR.position.y = symbolY
  // The symbol's line is a NON-ROTATING twin: rotating Ctrl_Symbol to spin the
  // spiral also rotated its line, and the line must stay horizontal.
  rig.ctrlSymLineL.position.y = symbolY
  rig.ctrlSymLineR.position.y = symbolY
  // `FollowPupil`: `Ctrl_Line_{L,R}_anim` carry a COPY_LOCATION off
  // `Ctrl_Pupil_{L,R}_anim`, LOCAL/LOCAL, Z ONLY (blender/02-06-objects-rig.md).
  // The eye line is part of the pupil drum and rides it off the top of the eye,
  // which is why an alert frame shows ONE thin gold line — the symbol's own —
  // and not the pupil's dark one. Leaving the line behind strands a hard dark
  // bar across the glyph.
  rig.ctrlLineL.position.y = pupilY
  rig.ctrlLineR.position.y = pupilY

  const spin = pose.sym_spin * DEG
  rig.ctrlSymbolL.rotation.y = spin
  // The two eyes are offset 180 degrees so the spinner arcs sit on opposite
  // sides. Deliberate visual interest, not a bug.
  rig.ctrlSymbolR.rotation.y = spin + Math.PI

  void opts
}

/**
 * The two-node lid pivot, driven exactly as Blender drives it.
 *
 *     Lid_Hinge.basis   = Cf * MouthRot
 *     DeckBox_Lid.basis = Cf^-1 * T(H_rest)
 *
 * `Cf` is the deformation field's full frame at the hinge, in the three.js
 * frame. Their product is `Cf * MouthRot * Cf^-1 * T(H_rest)`: a rotation about
 * the DEFORMED hinge that collapses to `T(H_rest)` at mouth = 0, leaving the
 * closed seam untouched at every deformation value.
 *
 * Two things here were learned the expensive way.
 *
 * The pair is a MATRIX pair, not an angle pair. `DeckBox_Lid.location` is keyed
 * in the live file and is emphatically not zero — it is `R(-Cf) * (H_rest - F)`,
 * the counter-translation that keeps the lid's origin on the hinge as the field
 * moves the hinge to `F`. Verified at frame 1834: this expression gives
 * (0, 0.152264, -0.117048) against the file's (0, 0.152263, -0.117046).
 *
 * And `Cf` must be used WHOLE. An earlier version took only its X euler and
 * assigned `rotation.x`, which silently discards the lean/twist components of
 * the hinge frame and all of the translation.
 *
 * This uses the same `HINGE_REST`, the same conjugation and the same clamped
 * bend as `riders.ts`, so the lid pivot and everything riding it cannot
 * disagree.
 */
const _cf = new Matrix4()
const _mouthRot = new Matrix4()
const _pairM = new Matrix4()
const _hRestT = new Matrix4().makeTranslation(
  blenderToThree(HINGE_REST.x, HINGE_REST.y, HINGE_REST.z),
)

function applyHingePair(rig: RigNodes, pose: Pose): void {
  // The field's bend input includes the mouth's back-arch, which SATURATES at
  // mouth = 1 (see MOUTH.secondaryMax). Same input the rider pass uses.
  const bendDeg =
    (pose.bend - MOUTH.archAtFull * Math.min(pose.mouth, MOUTH.secondaryMax)) *
    CHANNEL_RANGE.bend.deg
  hingeFrame(
    HINGE_REST,
    bendDeg,
    pose.lean * CHANNEL_RANGE.lean.deg,
    pose.twist * CHANNEL_RANGE.twist.deg,
    _cf,
  )
  _cf.premultiply(C4).multiply(C4_INV) // into the three frame

  _mouthRot.makeRotationX(-pose.mouth * MOUTH.maxDeg * DEG)
  _pairM.multiplyMatrices(_cf, _mouthRot)
  _pairM.decompose(rig.lidHinge.position, rig.lidHinge.quaternion, rig.lidHinge.scale)

  _pairM.copy(_cf).invert().multiply(_hRestT)
  _pairM.decompose(rig.lid.position, rig.lid.quaternion, rig.lid.scale)
}

/**
 * The brow sockets' follow-through.
 *
 * `Brow_{L,R}_Socket` are children of `Eye_Rig`, and they carry a small KEYED
 * motion of their own on top of it: as the body bends forward the sockets
 * counter-rotate, which is what keeps the brows reading as brows instead of
 * sliding around the face. Nothing in the character wiki describes this — that
 * page still lists the sockets as lid riders placed at `H_mouth * field(P)`,
 * which the file contradicts twice over (they hang off `Eye_Rig`, and their
 * world position is not `field(P)`).
 *
 * SO THIS IS A FIT, and it is labelled as one. Measured across all 27 states at
 * a hold frame:
 *
 *     rot.x = -0.10395 * effective_bend        R^2 = 0.941
 *     dy    = -0.42276 * rot.x                 R^2 = 0.999   (blender axes)
 *     dz    = -0.60428 * rot.x                 R^2 = 0.944
 *
 * Three things make it trustworthy rather than a curve through noise. The six
 * states with zero bend AND zero mouth all read EXACTLY 0.0 in the file, so the
 * model's zero is confirmed six times independently. The translation fit is a
 * rigid rotation about a fixed pivot — dy and dz are both proportional to the
 * same angle — which is a structural prediction the data did not have to
 * satisfy and does. And it is driven by the SAME clamped effective bend the
 * deformation field and the hinge pair use, so the three cannot disagree.
 *
 * It is also bounded: `bend` is a normalised channel, so the extrapolation
 * beyond the measured range (-0.72 .. +0.47) is at most a few degrees. That
 * matters, because the upstream log records a previous socket fix that failed
 * precisely by extrapolating a fitted rotation far from its pivot.
 *
 * The two states that fit worst, `curious` and `point`, both carry a `rot.y`
 * spread this model does not include — an asymmetric brow effect, not a
 * pitch one. Their residual is under 0.02 BU and is left alone.
 */
export const BROW_FOLLOW = {
  rotPerBend: -0.10395,
  /** Blender-frame translation per radian. Applied as three (y, z) = (dz, -dy). */
  dyPerRad: -0.42276,
  dzPerRad: -0.60428,
} as const

function applyBrowFollow(rig: RigNodes, pose: Pose): void {
  const bendDeg =
    pose.bend - MOUTH.archAtFull * Math.min(pose.mouth, MOUTH.secondaryMax)
  const t = BROW_FOLLOW.rotPerBend * bendDeg
  const rest = rig.browSocketRest
  // Blender X maps to three X, so the angle carries over unchanged; the
  // translation does not — blender (y, z) becomes three (z, -y).
  const y = rest.y + BROW_FOLLOW.dzPerRad * t
  const z = rest.z - BROW_FOLLOW.dyPerRad * t
  for (const n of [rig.browSocketL, rig.browSocketR]) {
    n.position.y = y
    n.position.z = z
    n.rotation.x = rest.rx + t
  }
}

/**
 * The eye-in-socket scale compensation, read off the live `delta_scale` drivers.
 *
 * The recess is LID GEOMETRY and rides the shape keys; the eyeballs are child
 * objects that only follow object transforms. Uncompensated they diverge by
 * 0.133 — sixteen times the 0.008 bezel width — and the socket also grows 11.6%
 * while the eyeball stays rigid, which is the part that actually reads wrong.
 *
 * `k` is indexed in the lid's shape-key order. Note k2 (Mouth_S) is deliberately
 * absent from the fit, and the divisor normalises the result to 1.0 at rest.
 */
export function eyeSocketScale(k: number[]): number {
  const { a0, linear, cross, divisor } = EYE_SOCKET_SCALE
  const s =
    a0 +
    linear.k0 * (k[0] ?? 0) +
    linear.k1 * (k[1] ?? 0) +
    linear.k3 * (k[3] ?? 0) +
    linear.k4 * (k[4] ?? 0) +
    linear.k5 * (k[5] ?? 0) +
    cross.k4k5 * (k[4] ?? 0) * (k[5] ?? 0) +
    cross.k6k7 * (k[6] ?? 0) * (k[7] ?? 0)
  return Math.sqrt(Math.max(0, s)) / divisor
}

/**
 * Resolve sided channels for a given facing.
 *
 * ASYMMETRY IS NEVER LEFT/RIGHT — IT IS ALWAYS NEAR-CAMERA / FAR-CAMERA. Every
 * state is authored once at facing = +1, and turning resolves the sided
 * channels automatically. Author "the near side squints", never "the right eye
 * squints", or after the turn the expression composes backwards for the camera.
 *
 * Nothing pops mid-turn by construction: the paired channels cross-fade and the
 * asymmetry washes through zero as he passes face-on.
 *
 * This mutates `pose` in place and MUST run after the procedural layers have
 * been composed, not before — otherwise flits and glance-aways bypass the `gx`
 * negation and every glance goes the wrong way at facing = -1.
 */
export function resolveFacing(pose: Pose, facing: number): Pose {
  const w = (1 + facing) / 2
  const swap = (a: string, b: string) => {
    const va = pose[a]
    const vb = pose[b]
    pose[a] = w * va + (1 - w) * vb
    pose[b] = w * vb + (1 - w) * va
  }
  swap('brow_l', 'brow_r')
  swap('lid_u_l', 'lid_u_r')
  swap('lid_l_l', 'lid_l_r')
  // Mouth_S and the lateral gaze negate rather than swap.
  pose.m_s *= facing
  pose.gx *= facing
  return pose
}
