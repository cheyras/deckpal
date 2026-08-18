/**
 * Deck-E — units, axes and the numbers that everything else derives from.
 *
 * EVERY constant the character was authored with is expressed in the BLENDER
 * frame: Z-up, degrees, blender units. three.js is Y-up and radians. The
 * conversion is applied at exactly one boundary (see `blenderToThree` below) and
 * nowhere else, because a rotation sign error here is silent — the motion still
 * looks plausible, it just leans the wrong way.
 *
 * Source of truth, in order: the live .blend > wiki/_raw/src/*.py > wiki prose.
 * Several wiki pages are known stale; see the scratchpad PORT-SPEC-* documents.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

/** 1 blender unit = 40.13 mm. Scale is NEVER converted — the whole model ships
 *  in blender units, so rescaling one channel desynchronises the entire rig. */
export const MM_PER_UNIT = 40.13

/** Deck-E's bounding box in blender units: W x D x H. */
export const BODY_W = 1.75
export const BODY_D = 1.15
/** Full height. The deformation field divides by this, so it is load-bearing. */
export const BODY_H = 2.4

/** Authored at 30 fps. 1 frame = 33.333 ms. Procedural layers take SECONDS. */
export const FPS = 30
export const MS_PER_FRAME = 1000 / FPS

/**
 * The Blender staging camera, measured off `Camera_anim` in the live file.
 * Static: no action, no drivers. Reproducing it exactly is what makes a
 * frame-by-frame visual comparison against Blender meaningful.
 *
 * Render is square 720x720. With `sensor_fit = AUTO` and aspect 1, Blender fits
 * to the LARGER sensor dimension (36mm), so the effective vertical FOV for a
 * square frame is 2*atan(18/52) = 38.1870deg — not the 25.99deg that
 * `angle_y` reports.
 */
export const BLENDER_CAMERA = {
  fovDeg: 38.187,
  position: new Vector3(4.783797, -5.625454, 4.639914), // Blender Z-up
  rotationEuler: new Euler(1.208951, -0.0, 0.703807, 'XYZ'),
  near: 0.1,
  far: 100,
} as const

/** Environment. Both numbers are measured off the world node tree, and both
 *  contradict `wiki/shading/body-materials.md`, which is stale: the rotation is
 *  261deg (not 215) and is DRIVEN by facing, and the Background strength is 0.6
 *  (not 2.6) with no multiply node anywhere between the Environment Texture and
 *  the Background shader. `stage.ts` owns the live values. */
export const ENV_ROTATION_DEG = 261.0
export const ENV_INTENSITY_DEFAULT = 0.6

/**
 * Blender Z-up -> three.js Y-up. Do not re-derive this.
 *
 *   position:  x -> +x,  y -> -z,  z -> +y
 *   rotation: rx -> rx, ry -> -rz, rz -> ry
 *
 * Both the position and the rotation `y` component negate, because Blender's
 * forward is -Y while three.js's is +Z.
 */
export function blenderToThree(x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x, z, -y)
}

/**
 * The same conversion as a 4x4, and its inverse.
 *
 * The deformation field is defined in the Blender frame, so a field MATRIX is
 * carried into the three frame by conjugation, `C * M * C^-1` — the relation the
 * glTF exporter used on every node, verified against the exported file to
 * 1.5e-7. (A point converts with `C` alone; only matrices need the conjugate.)
 */
export const C4 = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
)
export const C4_INV = new Matrix4().copy(C4).invert()

/** Blender XYZ euler (RADIANS) -> a three.js quaternion in the Y-up frame.
 *
 *  Blender composes XYZ as R = Rz*Ry*Rx; three.js's 'XYZ' composes R = Rx*Ry*Rz
 *  — the opposite order — so we must not simply hand the three numbers to
 *  `Euler`. Composing the axis rotations explicitly in Blender's order and then
 *  remapping the axes is unambiguous. */
const _qx = new Quaternion()
const _qy = new Quaternion()
const _qz = new Quaternion()
const _ax = new Vector3(1, 0, 0)
const _ayUp = new Vector3(0, 1, 0)
const _azFwd = new Vector3(0, 0, 1)

export function blenderEulerToThree(rx: number, ry: number, rz: number, out = new Quaternion()): Quaternion {
  // In the three.js frame, Blender's +X stays +X, Blender's +Y becomes -Z, and
  // Blender's +Z becomes +Y. Rotate about the remapped axes, in Blender's order.
  _qx.setFromAxisAngle(_ax, rx)
  _qy.setFromAxisAngle(_azFwd, -ry) // Blender Y axis -> three -Z axis
  _qz.setFromAxisAngle(_ayUp, rz) // Blender Z axis -> three +Y axis
  return out.copy(_qz).multiply(_qy).multiply(_qx)
}

/**
 * A Blender CAMERA's rotation, converted to three.
 *
 * This is NOT the same conversion as `blenderEulerToThree`, and the difference
 * is a silent 90 degrees.
 *
 * For an object, both the world axes AND the object's own local frame are
 * remapped by the exporter, so the rotation conjugates: `C * R * C^-1`. That is
 * verified against the exported glb to 1.5e-7.
 *
 * A camera is different. Blender and glTF cameras BOTH look down local -Z with
 * +Y up — the local convention is already identical — so only the world side
 * remaps: `C * R`. Applying the object conversion instead aims the camera along
 * what should be its up axis, which renders an empty frame.
 *
 * `C` is a -90 degree rotation about X (blender +Z up -> three +Y up).
 */
const _blenderToThreeAxes = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
const _camEuler = new Euler()

export function blenderCameraQuaternion(rx: number, ry: number, rz: number, out = new Quaternion()): Quaternion {
  // Blender XYZ euler composes as R = Rz*Ry*Rx; three's 'ZYX' order is exactly
  // that composition, so the same three angles reproduce it directly.
  _camEuler.set(rx, ry, rz, 'ZYX')
  out.setFromEuler(_camEuler)
  return out.premultiply(_blenderToThreeAxes)
}

export const DEG = Math.PI / 180

/**
 * Normalised pose channels and the physical ranges they map onto.
 * `mouth` exceeding 1.0 is legal and intended — 2.09 is the full gape.
 */
export const CHANNEL_RANGE = {
  bend: { min: -1, max: 1, deg: 18 },
  lean: { min: -1, max: 1, deg: 15 },
  twist: { min: -1, max: 1, deg: 12 },
  mouth: { min: 0, max: 2.09 },
  m_curve: { min: -1, max: 2 },
  lid_u: { min: 0, max: 1 },
  lid_l: { min: 0, max: 1 },
  sq: { min: -0.3, max: 0.6 },
  alert: { min: -0.2, max: 1.2 },
} as const

/** Control-empty conventions, measured. These are NOT all on the wiki — the
 *  brow /0.35 normalisation in particular appears nowhere in it. */
export const CTRL = {
  /** z 0.58 = open; lower z closes. lid_u = (0.58 - z) / 0.64 */
  lidUOpenZ: 0.58,
  /** z -0.58 = open; higher z raises. lid_l = (z + 0.58) / 0.64 */
  lidLOpenZ: -0.58,
  lidTravel: 0.64,
  /** The SHARED brow height. `Ctrl_Brows.location.z` measures -0.225..0.25
   *  against a `brow` channel of -0.9..1.0, i.e. a scale of 0.25. */
  browSharedScale: 0.25,
  /** The PER-SIDE offset. `Ctrl_Brow_L.location.z` measures 0..0.24 against a
   *  `brow_l` reaching 0.69, and the live limit constraint is +/-0.35 exactly.
   *  Using the per-side 0.35 for the shared channel overshoots `happy` (which
   *  drives `brow` to 1.0) by 40%. */
  browSideScale: 0.35,
} as const

/** The hinge's rest position on the base, in blender units. The lid rotates
 *  about the DEFORMED hinge, which is why the field is evaluated here too. */
export const HINGE_REST = new Vector3(0, 0.575, 1.88)

/**
 * The mouth composite. One `mouth` parameter drives THREE things, by design —
 * the top shell must not be the only thing that moves.
 *
 * VERIFIED against the live file, and it resolves an apparent contradiction:
 * the wiki says the hinge reaches 55deg per unit (so 114.95deg at mouth=2.09),
 * but `Lid_Hinge_anim.rotation_euler[0]` only ever reaches 105.10deg. Both are
 * right — the gape is SPLIT ACROSS TWO OBJECTS. Measured at frame 1834, the
 * peak of `card_stash`:
 *
 *     Lid_Hinge_anim.rx   = -105.10174200467311 deg
 *     DeckBox_Lid_anim.rx =   -9.848255957623687 deg
 *     -------------------------------------------------
 *     total               = -114.94999796229680 deg  ==  55 * 2.09  exactly
 *
 * So driving the hinge alone with `mouth * 55` opens him ~9.85deg too far.
 *
 * BUT THE SPLIT IS NOT A FIXED RATIO — re-measured across the whole `card_stash`
 * gape, and this is the correction the rider derivation turned up. What the two
 * nodes actually carry is the wiki's hinge-pivot correction:
 *
 *     Cf                    = field frame at HINGE_REST (rotation + position)
 *     Lid_Hinge.basis       = Cf * MouthRot        (local, in base space)
 *     DeckBox_Lid.basis     = Cf^-1 * T(HINGE_REST)
 *
 * so `DeckBox_Lid.rx` is MINUS the field Jacobian angle at the hinge and has
 * nothing to do with `mouth`. At frame 1834 the field bend is -12.6deg, whose
 * Jacobian at z = 1.88 is Rx(+9.8483deg) — that is the entire -9.8483 the ratio
 * was fitted to. Two independent checks: at frame 1840 (mouth 0, bend -0.1) the
 * pair reads +1.4001 / -1.4001, summing to ZERO rather than splitting a gape;
 * and `Lid_Hinge.location` tracks `field(HINGE_REST)`, not HINGE_REST.
 *
 * `hingeShare`/`lidShare` therefore only reproduce frame 1834 and drift
 * elsewhere; they are kept because `rig.ts` still consumes them. `riders.ts`
 * composes `Cf * MouthRot * Cf^-1` directly and does not use them.
 */
export const MOUTH = {
  /** Degrees of total lid rotation per unit of `mouth`. */
  maxDeg: 55,
  /** Fraction of the total carried by `Lid_Hinge_anim`. */
  hingeShare: 105.10174200467311 / 114.9499979622968,
  /** Fraction carried by `DeckBox_Lid_anim` itself. */
  lidShare: 9.848255957623687 / 114.9499979622968,
  /** Whole-body tip back on `DeckE_Body` rot X at mouth = 1. */
  bodyTipDeg: -4.5,
  /** Back arch folded into the FIELD's bend input at mouth = 1. Without it every
   *  rider drifts off the shells during talk and through the whole gape.
   *
   *  Measured: in the live file this arch reaches the deformation field ONLY —
   *  the `Body_Bend_Back` shape key is exactly `max(0, -bend)` with no arch
   *  added (frame 1834: authored bend -0.60, key value 0.60, field bend -12.6). */
  archAtFull: 0.1,
  /**
   * The mouth's SECONDARY effects SATURATE at mouth = 1; only the hinge angle
   * keeps going to the 2.09 gape. Verified frame by frame in the live file, by
   * solving the field bend back out of `Lid_Hinge_anim.location`:
   *
   *   frame 1781  bend  0.24  mouth 0.00  ->  field bend   4.320 = 18*(0.24-0.000)
   *   frame 1837  bend  0.30  mouth 0.02  ->  field bend   5.364 = 18*(0.30-0.002)
   *   frame 1845  bend  0.04  mouth 0.06  ->  field bend   0.612 = 18*(0.04-0.006)
   *   frame 1786  bend -0.50  mouth 1.30  ->  field bend -10.800 = 18*(-0.50-0.1)
   *   frame 1834  bend -0.60  mouth 2.09  ->  field bend -12.600 = 18*(-0.60-0.1)
   *
   * i.e. `arch = archAtFull * min(mouth, secondaryMax)`, NOT `* mouth`. The same
   * saturation applies to `bodyTipDeg`: `DeckE_Body.rotation_euler[0]` measures
   * -4.5deg at mouth 1.30 AND at mouth 2.09, and -0.09deg at mouth 0.02.
   */
  secondaryMax: 1,
  /** Conversational range. Talk never leaves the low end. */
  talkRange: [0.11, 0.22] as const,
  /** Full 115deg gape, used by `card_stash`. */
  gapeFull: 2.09,
} as const

/**
 * The eye-in-socket compensation, read off the live `delta_scale` drivers on
 * `Eye_Rig_anim` (three identical drivers, one per axis).
 *
 * The recess is lid GEOMETRY and rides the shape keys; the eyeballs are child
 * objects and only follow object transforms. Left uncompensated they diverge by
 * 0.133 — sixteen times the 0.008 bezel width — and the socket also grows 11.6%
 * while the eyeball stays rigid, which is the part that actually reads wrong.
 *
 * `k0..k7` are shape-key values on `Key_lid_LIVE`; note `k2` (Mouth_S) is
 * deliberately absent from the fit. The divisor normalises the expression to
 * exactly 1.0 at rest, since sqrt(0.348310) = 0.590178.
 */
export const EYE_SOCKET_SCALE = {
  a0: 0.34831,
  linear: { k0: -0.031631, k1: 0.01049, k3: 0.014812, k4: 0.013013, k5: -0.023322 },
  cross: { k4k5: -0.011115, k6k7: -0.019487 },
  divisor: 0.590178,
} as const

/** `Eye_Rig_anim` is VERTEX_3-parented to these three lid vertices. three.js has
 *  no vertex parenting, so the basis is rebuilt each frame from the morphed lid
 *  positions via `Mesh.getVertexPosition()`. */
export const EYE_RIG_PARENT_VERTS = [1975, 2095, 1935] as const

/** Morph target order, identical on both shells. `Basis` is not exported, so
 *  the exported indices are 0..9 for the ten keys after it. */
export const MORPH_ORDER = [
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
] as const

export type MorphName = (typeof MORPH_ORDER)[number]
