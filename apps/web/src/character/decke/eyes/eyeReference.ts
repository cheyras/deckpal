/**
 * eyeReference.ts — CPU parity harness for the Deck-E eye shader.
 *
 * A literal, node-for-node transcription of the Blender material
 * `Eye_L_Face_anim` (215 nodes / 287 links). It exists so the GLSL port can be
 * diffed numerically against Blender without a GPU.
 *
 * Source of truth: scratchpad/blender/07-materials-eyes.md
 * Companion doc:   scratchpad/EYE-GLSL.md  (sections A and B match this file 1:1)
 *
 * RULES OBSERVED HERE:
 *  - Every float literal is verbatim from the dump. Nothing is rounded.
 *  - No algebraic simplification. Equal-but-different is a defect.
 *  - Blender's per-node quirks (safe_divide, safe_sqrt, per-node use_clamp,
 *    Map Range clamping to the TO range) are reproduced exactly.
 *  - Nodes that are dead or multiplied by zero in the live file are still
 *    evaluated, so the harness can assert they are zero.
 *
 * The R eye is byte-identical to the L eye with the seven control empties
 * swapped for their _R counterparts. One implementation, parameterised.
 */

/* ============================================================================
 * Types
 * ========================================================================== */

export type Vec3 = readonly [number, number, number];
/** three.js column-major 4x4, i.e. `Matrix4.elements`. */
export type Mat4 = readonly number[]; // length 16

/**
 * Atlas fetch callback, in BLENDER CONVENTION.
 *
 * `v` is measured UP FROM THE BOTTOM of the PNG (Blender stores images
 * bottom-up), so `v = 0` is the last pixel row of the PNG and `v = 1` the
 * first. The shader's `SYM_row = 0` therefore selects the BOTTOM half of the
 * PNG and `SYM_row = 1` the TOP half.
 *
 * The callback must return raw, bilinearly-filtered, NON-COLOR-MANAGED RGBA
 * in [0,1]. It is only ever called with (u, v) already inside [0,1]^2 — this
 * module applies the image's `extension = CLIP` rule itself.
 *
 * Atlas: DeckE_SymbolSDF, 2560 x 1024 = 5 x 2 grid of 512 px cells,
 * signed distance field with 0.5 as the edge. RED is the primary glyph,
 * GREEN a second pass.
 */
export type AtlasSampler = (u: number, v: number) => readonly [number, number, number, number];

/** Everything `deckeEye` needs. All positions/directions are WORLD space. */
export interface DeckeEyeInput {
  /** Shading point, world space. */
  worldPos: Vec3;
  /** Interpolated surface normal, world space, used only by the bump node. */
  normal: Vec3;
  /**
   * `ShaderNodeNewGeometry.Incoming` — normalize(cameraPosition - worldPos),
   * WORLD space, pointing toward the viewer. Feeds BOTH `PLX_geo` and
   * `IRIS_geo`; note that only the PLX one is transformed to object space.
   */
  incoming: Vec3;

  /** inverse(empty.matrixWorld) for each control empty, column-major. */
  ctrlPupil: Mat4; // Ctrl_Pupil_{L,R}_anim  -> PLX_add_0 AND PLX_add_7
  ctrlShine: Mat4; // Ctrl_Shine_{L,R}_anim  -> PLX_add_1
  ctrlLine: Mat4; // Ctrl_Line_{L,R}_anim   -> PLX_add_2
  ctrlLidU: Mat4; // Ctrl_LidU_{L,R}_anim   -> PLX_add_3
  ctrlLidL: Mat4; // Ctrl_LidL_{L,R}_anim   -> PLX_add_4
  ctrlSymbol: Mat4; // Ctrl_Symbol_{L,R}      -> PLX_add_5   (no _anim suffix)
  ctrlSymLine: Mat4; // Ctrl_SymLine_{L,R}     -> PLX_add_6   (no _anim suffix)

  /** inverse(eyeMesh.matrixWorld); only the upper 3x3 is used (PLX_toobj). */
  eyeObjectInverse: Mat4;

  /** ShaderNodeValue nodes. Defaults are the dumped values. */
  symAlert?: number; // SYM_alert, default 1.0
  symCol?: number; // SYM_col,   default 2.0   (must be stepped, never lerped)
  symRow?: number; // SYM_row,   default 1.0   (must be stepped, never lerped)
  symSize?: number; // SYM_size,  default 0.699999988079071

  /** ShaderNodeRGB nodes, LINEAR values. */
  symColor?: Vec3; // SYM_color
  symColor2?: Vec3; // SYM_color2

  /**
   * `SYM_line_mix.Factor`. UNLINKED in the dump with default_value = 0.0, so
   * the eye line evaluates to A = EYE_sh_Color_004 (the dark iris colour),
   * NOT to SYM2_shade. See EYE-GLSL.md section D.1 — this may be driven.
   */
  symLineMixFactor?: number; // default 0.0

  atlas: AtlasSampler;
}

/** Optional screen-space derivatives, for reproducing `ShaderNodeBump`. */
export interface BumpDerivatives {
  dPdx: Vec3;
  dPdy: Vec3;
  dHdx: number;
  dHdy: number;
  /** gl_FrontFacing equivalent. Default true. */
  frontFacing?: boolean;
}

export interface DeckeEyeOutput {
  /** Principled Base Color  <- LIDE_out */
  baseColor: Vec3;
  /** GLOW_em.Color (constant) */
  emissiveColor: Vec3;
  /** GLOW_em.Strength <- GLOW_alertgate */
  emissiveStrength: number;
  /** Principled Roughness <- LID_rough */
  roughness: number;
  /** Principled Coat Weight <- LID_coat */
  clearcoat: number;
  /** Principled Coat Roughness (constant 0.029999999329447746) */
  clearcoatRoughness: number;
  /**
   * Perturbed normal. Equals the input normal unless `bump` derivatives were
   * supplied, because ShaderNodeBump is a screen-space-derivative node.
   */
  normal: Vec3;
  /** LIDE_soft — the bump node's Height input, exposed for derivative tests. */
  bumpHeight: number;
  /** SYM_em.Color (== symColor2) */
  symEmissiveColor: Vec3;
  /** SYM_em.Strength — SYM_em_str = SYM_mask_clipped * 0.0, always 0. */
  symEmissiveStrength: number;
  /** Every intermediate, keyed by Blender node name, for localised diffing. */
  nodes: Record<string, number | Vec3>;
}

/* ============================================================================
 * Blender primitive semantics
 * ========================================================================== */

/** Blender `safe_divide`: division by zero yields 0, not Inf/NaN. */
export function blSafeDivide(a: number, b: number): number {
  return b !== 0 ? a / b : 0;
}

/** Blender `Math` node SQRT: `safe_sqrt`, negative input yields 0. */
export function blSafeSqrt(a: number): number {
  return a > 0 ? Math.sqrt(a) : 0;
}

/**
 * Blender `Math` node POWER: a negative base returns 0 (JS `Math.pow` returns
 * NaN, GLSL `pow` returns NaN). Not used by this graph; provided so the
 * harness stays a complete Blender-semantics reference.
 */
export function blSafePow(a: number, b: number): number {
  return a < 0 ? 0 : Math.pow(a, b);
}

/** Order-aware clamp used by Map Range's `clamp` flag. */
export function blClampRange(v: number, mn: number, mx: number): number {
  return mn > mx ? Math.min(Math.max(v, mx), mn) : Math.min(Math.max(v, mn), mx);
}

export function blClamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * `ShaderNodeMapRange`, data_type=FLOAT, interpolation_type=LINEAR, clamp=True.
 *
 * THE TRAP: this clamps to the TO range. Everything past `fromMax` pins to
 * `toMax`, which is why a single Map Range used as a "band" returns 1.0 across
 * the whole eye. A band needs a rising AND a falling edge multiplied together
 * (see `LIDE_bUup * LIDE_bUdn`) or two edges subtracted (see `Math.011`).
 */
export function blMapLinearClamped(
  v: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  const f = blSafeDivide(v - fromMin, fromMax - fromMin);
  return blClampRange(toMin + f * (toMax - toMin), toMin, toMax);
}

/**
 * `ShaderNodeMapRange`, interpolation_type=SMOOTHSTEP.
 * The factor is ALWAYS clamped; the node's `clamp` flag is inert here.
 */
export function blMapSmoothstep(
  v: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  let f = blClamp01(blSafeDivide(v - fromMin, fromMax - fromMin));
  f = (3.0 - 2.0 * f) * f * f;
  return toMin + f * (toMax - toMin);
}

/** `ShaderNodeTexCoord -> Object`: a POINT transform (translation included). */
export function blTexCoordObject(invEmptyWorld: Mat4, p: Vec3): Vec3 {
  const m = invEmptyWorld;
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * `ShaderNodeVectorTransform`, vector_type=VECTOR, WORLD -> OBJECT.
 * Upper 3x3 only: no translation, and NO re-normalisation (the graph has none,
 * contrary to the wiki's porting snippet).
 */
export function blVectorTransformWorldToObject(invObjWorld: Mat4, v: Vec3): Vec3 {
  const m = invObjWorld;
  const [x, y, z] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a: Vec3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * `ShaderNodeBump`, invert=False, transcribed from Blender's GPU
 * implementation. `Filter Width` (0.10 in the dump) has no GPU equivalent and
 * is ignored, as it is in EEVEE.
 */
export function blBump(
  strength: number,
  dist: number,
  N: Vec3,
  d: BumpDerivatives,
  invert = 1.0,
): Vec3 {
  const n = norm3(N);
  const frontFacing = d.frontFacing ?? true;
  const distSigned = dist * (frontFacing ? invert : -invert);

  const Rx = cross3(d.dPdy, n);
  const Ry = cross3(n, d.dPdx);
  const det = dot3(d.dPdx, Rx);

  const surfgrad = add3(scale3(Rx, d.dHdx), scale3(Ry, d.dHdy));

  const s = Math.max(strength, 0.0);
  const sgn = det < 0 ? -1 : det > 0 ? 1 : 0;
  const r = norm3(sub3(scale3(n, Math.abs(det)), scale3(surfgrad, distSigned * sgn)));
  return norm3(mix3(n, r, s));
}

/* ============================================================================
 * Constants, verbatim from the node dump. Do not round any of these.
 * ========================================================================== */

export const EYE_CONST = {
  // --- PLX ---------------------------------------------------------------
  PLX_scale_depth: -0.019999999552965164, // PLX_scale in[0]  (NEGATIVE)
  PLX_clamp_min: 0.3499999940395355, // PLX_clamp in[1]  MAXIMUM

  // --- pupil ellipse ------------------------------------------------------
  pupil_a: 0.17100000381469727, // Math   / IRIS_nx divisor
  pupil_b: 0.30799999833106995, // Math.001 / IRIS_nz divisor
  pupil_a2: 0.02924099937081337, // Math.002 divisor (== a^2)
  pupil_b2: 0.09486400336027145, // Math.003 divisor (== b^2)
  pupil_eps: 9.999999747378752e-6, // Math.006 addend

  // --- the shared 0.0012 feather ------------------------------------------
  feather_from_min: 0.0006000000284984708,
  feather_from_max: -0.0006000000284984708,

  // --- shine radii --------------------------------------------------------
  shine_core_r: 0.04800000041723251, // Math.008
  shine_outer_r: 0.07900000363588333, // Math.009
  shine_inner_r: 0.061000000685453415, // Math.010

  // --- eye line / symbol line --------------------------------------------
  line_half: 0.008999999612569809, // Math.013 and SYMLINE_sub_t

  // --- IRIS ---------------------------------------------------------------
  IRIS_rimR_from_min: 0.9100000262260437,
  IRIS_rimR_from_max: 1.0,
  IRIS_rimD_from_min: 0.05000000074505806,
  IRIS_rimD_from_max: -0.44999998807907104,
  IRIS_rimD_to_min: 0.18000000715255737,
  IRIS_rimD_to_max: 1.0,
  IRIS_m1_strength: 0.6200000047683716,
  IRIS_s1_base: 1.399999976158142,
  IRIS_k_offset: 0.550000011920929, // IRIS_kx / IRIS_kz
  IRIS_rad_from_min: 0.019999999552965164,
  IRIS_rad_from_max: 1.1799999475479126,
  IRIS_m2_strength: 1.1200000047683716,
  // SYM_profn: MULTIPLY_ADD, remaps IRIS_prof [-0.34, 1.40] -> [0.28, 1.15]
  SYM_profn_mul: 0.5,
  SYM_profn_add: 0.44999998807907104,

  // --- SYM atlas ----------------------------------------------------------
  SYM_center: 0.5, // SYM_ax / SYM_az addend
  SYM_cols: 5.0, // SYM_du divisor
  SYM_rows: 2.0, // SYM_dv divisor
  SYM_thr_from_min: 0.4984999895095825,
  SYM_thr_from_max: 0.5019999742507935,
  SYM_boost: 2.5999999046325684, // *_mask_boost, use_clamp = True
  SYM_mask_mul: 1.0, // SYM_mask / SYMLINE_mask in[1]
  SYM_em_str_mul: 0.0, // SYM_em_str in[1]  <<< ZERO

  // --- LIDE / LID ---------------------------------------------------------
  LIDE_soft_from_min: 0.029999999329447746, // +/- 0.030
  LIDE_soft_from_max: -0.029999999329447746,
  LIDE_sh_from_min: 0.07500000298023224, // cast shadow band
  LIDE_sh_from_max: 0.0,
  LIDE_smul_strength: 0.41999998688697815,
  LIDE_bup_from_min: -0.03400000184774399, // lip band, rising edge
  LIDE_bup_from_max: -0.02199999988079071,
  LIDE_bdn_from_min: -0.0020000000949949026, // lip band, falling edge
  LIDE_bdn_from_max: -0.014000000432133675,
  LIDE_lmul_strength: 0.0, // <<< ZERO (painted lip highlight is OFF)
  LID_rough_to_min: 0.05999999865889549,
  LID_rough_to_max: 0.30000001192092896,
  LID_coat_to_min: 0.699999988079071, // CONSTANT 0.70
  LID_coat_to_max: 0.699999988079071,
  LID_bump_strength: 0.30000001192092896,
  LID_bump_distance: 0.009999999776482582,
  LID_bump_filter_width: 0.10000000149011612, // ignored on GPU
  Math_014_mul: -1.0, // <<< THE SIGN TRAP (upper lid only)

  // --- GLOW ---------------------------------------------------------------
  GLOW_str_mul: 0.550000011920929,
  GLOW_white_mul: 0.12999999523162842, // 0.13 — the wiki's table says 0.24

  // --- Principled ---------------------------------------------------------
  principled_ior: 1.5199999809265137,
  principled_metallic: 0.0,
  principled_specular_ior_level: 0.6200000047683716,
  principled_coat_roughness: 0.029999999329447746,
  principled_coat_ior: 1.5,
} as const;

export const EYE_COLOR = {
  /** `Color` — the white base. */
  Color: [1.0, 1.0, 1.0] as Vec3,
  /** `Color.001` — iris body, multiplied by IRIS_prof. */
  Color001: [0.00800000037997961, 0.07620000094175339, 0.12479999661445618] as Vec3,
  /** `Color.002` — shine core. */
  Color002: [1.0, 1.0, 1.0] as Vec3,
  /** `Color.003` — shine ring, cyan. */
  Color003: [0.13563333451747894, 0.8069522380828857, 0.9473065137863159] as Vec3,
  /** `Color.004` — eye-line A input, multiplied by IRIS_prof. */
  Color004: [0.00800000037997961, 0.07620000094175339, 0.12479999661445618] as Vec3,
  /** `Color.005` — upper lid. */
  Color005: [0.01599629409611225, 0.6514056324958801, 0.8549926280975342] as Vec3,
  /** `Color.006` — lower lid (identical to Color.005). */
  Color006: [0.01599629409611225, 0.6514056324958801, 0.8549926280975342] as Vec3,
  /** `LIDE_lipcol` — painted lip highlight (strength 0). */
  LIDE_lipcol: [0.6200000047683716, 0.9300000071525574, 1.0] as Vec3,
  /** `GLOW_em.Color`. */
  GLOW_em: [0.6200000047683716, 0.9300000071525574, 1.0] as Vec3,
  /** `SYM_color` — glyph pass 1 (atlas RED). NOT shaded by IRIS_prof. */
  SYM_color: [0.8227857351303101, 0.09758734703063965, 0.0036765073891729116] as Vec3,
  /** `SYM_color2` — glyph pass 2 (atlas GREEN) + the symbol line. IS shaded. */
  SYM_color2: [0.9646862745285034, 0.28744083642959595, 0.045186202973127365] as Vec3,
} as const;

export const EYE_VALUE_DEFAULTS = {
  SYM_alert: 1.0,
  SYM_col: 2.0,
  SYM_row: 1.0,
  SYM_size: 0.699999988079071,
  /** SYM_line_mix.Factor — UNLINKED, 0.0. See EYE-GLSL.md D.1. */
  SYM_line_mix_factor: 0.0,
} as const;

/* ============================================================================
 * The evaluator
 * ========================================================================== */

export function deckeEye(input: DeckeEyeInput, bump?: BumpDerivatives): DeckeEyeOutput {
  const K = EYE_CONST;
  const C = EYE_COLOR;
  const nodes: Record<string, number | Vec3> = {};

  const symAlert = input.symAlert ?? EYE_VALUE_DEFAULTS.SYM_alert;
  const symCol = input.symCol ?? EYE_VALUE_DEFAULTS.SYM_col;
  const symRow = input.symRow ?? EYE_VALUE_DEFAULTS.SYM_row;
  const symSize = input.symSize ?? EYE_VALUE_DEFAULTS.SYM_size;
  const symColor = input.symColor ?? C.SYM_color;
  const symColor2 = input.symColor2 ?? C.SYM_color2;
  const lineMixFactor = input.symLineMixFactor ?? EYE_VALUE_DEFAULTS.SYM_line_mix_factor;

  const P = input.worldPos;

  /* ---------------------------------------------------------------- PLX ---
   * PLX_geo -> PLX_toobj -> PLX_sep -> PLX_absy -> PLX_clamp -> PLX_scale
   *         -> PLX_mx / PLX_mz -> PLX_off
   * No normalize after the WORLD->OBJECT transform: the graph has none.
   */
  const PLX_toobj = blVectorTransformWorldToObject(input.eyeObjectInverse, input.incoming);
  const PLX_absy = Math.abs(PLX_toobj[1]);
  const PLX_clamp = Math.max(PLX_absy, K.PLX_clamp_min);
  const PLX_scale = blSafeDivide(K.PLX_scale_depth, PLX_clamp);
  const PLX_mx = PLX_toobj[0] * PLX_scale;
  const PLX_mz = PLX_toobj[2] * PLX_scale;
  const PLX_off: Vec3 = [PLX_mx, 0.0, PLX_mz];
  nodes.PLX_toobj = PLX_toobj;
  nodes.PLX_absy = PLX_absy;
  nodes.PLX_clamp = PLX_clamp;
  nodes.PLX_scale = PLX_scale;
  nodes.PLX_off = PLX_off;

  /* --- PLX_add_0 .. PLX_add_7: one ADD per coordinate node.
   * Routing these through one shared node collapses every layer onto the
   * pupil's space and the whole face renders blank. Eight adds, one offset. */
  const PLX_add_0 = add3(blTexCoordObject(input.ctrlPupil, P), PLX_off);
  const PLX_add_1 = add3(blTexCoordObject(input.ctrlShine, P), PLX_off);
  const PLX_add_2 = add3(blTexCoordObject(input.ctrlLine, P), PLX_off);
  const PLX_add_3 = add3(blTexCoordObject(input.ctrlLidU, P), PLX_off);
  const PLX_add_4 = add3(blTexCoordObject(input.ctrlLidL, P), PLX_off);
  const PLX_add_5 = add3(blTexCoordObject(input.ctrlSymbol, P), PLX_off);
  const PLX_add_6 = add3(blTexCoordObject(input.ctrlSymLine, P), PLX_off);
  const PLX_add_7 = add3(blTexCoordObject(input.ctrlPupil, P), PLX_off);
  nodes.PLX_add_0 = PLX_add_0;
  nodes.PLX_add_1 = PLX_add_1;
  nodes.PLX_add_2 = PLX_add_2;
  nodes.PLX_add_3 = PLX_add_3;
  nodes.PLX_add_4 = PLX_add_4;
  nodes.PLX_add_5 = PLX_add_5;
  nodes.PLX_add_6 = PLX_add_6;
  nodes.PLX_add_7 = PLX_add_7;

  /* --------------------------------------------------------------- IRIS ---
   * IRIS_sep / nx / nz / x2 / z2 / r2 / r / rimR / gsep / px / pz / proj /
   * rimD / rim / m1 / s1 / kx / kz / ox / oz / ox2 / oz2 / osum / od / rad /
   * m2 / prof
   */
  const IRIS_nx = blSafeDivide(PLX_add_7[0], K.pupil_a);
  const IRIS_nz = blSafeDivide(PLX_add_7[2], K.pupil_b);
  const IRIS_x2 = IRIS_nx * IRIS_nx;
  const IRIS_z2 = IRIS_nz * IRIS_nz;
  const IRIS_r2 = IRIS_x2 + IRIS_z2;
  const IRIS_r = blSafeSqrt(IRIS_r2);
  // LINEAR in the live file. The wiki says smoothstep — see EYE-GLSL.md D.2.
  const IRIS_rimR = blMapLinearClamped(
    IRIS_r,
    K.IRIS_rimR_from_min,
    K.IRIS_rimR_from_max,
    0.0,
    1.0,
  );

  // IRIS_geo reads Geometry.Incoming in WORLD space; it is NOT routed through
  // PLX_toobj. See EYE-GLSL.md D.9 — reproduced verbatim.
  const IRIS_gsep = input.incoming;
  const IRIS_px = IRIS_nx * IRIS_gsep[0];
  const IRIS_pz = IRIS_nz * IRIS_gsep[2];
  const IRIS_proj = IRIS_px + IRIS_pz;
  const IRIS_rimD = blMapLinearClamped(
    IRIS_proj,
    K.IRIS_rimD_from_min,
    K.IRIS_rimD_from_max,
    K.IRIS_rimD_to_min,
    K.IRIS_rimD_to_max,
  );
  const IRIS_rim = IRIS_rimR * IRIS_rimD;
  const IRIS_m1 = IRIS_rim * K.IRIS_m1_strength;
  const IRIS_s1 = K.IRIS_s1_base - IRIS_m1;

  const IRIS_kx = IRIS_gsep[0] * K.IRIS_k_offset;
  const IRIS_kz = IRIS_gsep[2] * K.IRIS_k_offset;
  const IRIS_ox = IRIS_nx + IRIS_kx;
  const IRIS_oz = IRIS_nz + IRIS_kz;
  const IRIS_osum = IRIS_ox * IRIS_ox + IRIS_oz * IRIS_oz;
  const IRIS_od = blSafeSqrt(IRIS_osum);
  const IRIS_rad = blMapSmoothstep(IRIS_od, K.IRIS_rad_from_min, K.IRIS_rad_from_max, 0.0, 1.0);
  const IRIS_m2 = IRIS_rad * K.IRIS_m2_strength;
  const IRIS_prof = IRIS_s1 - IRIS_m2; // range [-0.34, 1.40]

  nodes.IRIS_nx = IRIS_nx;
  nodes.IRIS_nz = IRIS_nz;
  nodes.IRIS_r = IRIS_r;
  nodes.IRIS_rimR = IRIS_rimR;
  nodes.IRIS_proj = IRIS_proj;
  nodes.IRIS_rimD = IRIS_rimD;
  nodes.IRIS_rim = IRIS_rim;
  nodes.IRIS_s1 = IRIS_s1;
  nodes.IRIS_od = IRIS_od;
  nodes.IRIS_rad = IRIS_rad;
  nodes.IRIS_prof = IRIS_prof;

  /* DEAD NODES, evaluated so a Blender diff can confirm they are unreachable.
   * IRIS_near / IRIS_nearR are disconnected in the live file even though the
   * wiki devotes a paragraph to them. See EYE-GLSL.md D.8. */
  const IRIS_near_DEAD = blMapLinearClamped(
    IRIS_proj,
    -0.2800000011920929,
    0.41999998688697815,
    0.3499999940395355,
    1.0,
  );
  nodes.IRIS_near_DEAD = IRIS_near_DEAD;
  nodes.IRIS_nearR_DEAD = IRIS_near_DEAD * IRIS_r;

  const EYE_sh_Color_001 = scale3(C.Color001, IRIS_prof);
  const EYE_sh_Color_004 = scale3(C.Color004, IRIS_prof);
  // SYM_profn: MULTIPLY_ADD, use_clamp=False. IRIS_prof clamps to -0.34 at the
  // outer radius, hence the remap before the profile touches the glyphs.
  const SYM_profn = IRIS_prof * K.SYM_profn_mul + K.SYM_profn_add;
  const SYM2_shade = scale3(symColor2, SYM_profn);
  nodes.EYE_sh_Color_001 = EYE_sh_Color_001;
  nodes.EYE_sh_Color_004 = EYE_sh_Color_004;
  nodes.SYM_profn = SYM_profn;
  nodes.SYM2_shade = SYM2_shade;

  /* -------------------------------------------------------- SYM_inv ------
   * SUBTRACT with use_clamp = False, so this goes NEGATIVE whenever the reel
   * spring overshoots past alert = 1. Reproduced unclamped. See D.7. */
  const SYM_inv = 1.0 - symAlert;
  nodes.SYM_alert = symAlert;
  nodes.SYM_inv = SYM_inv;

  /* ------------------------------------------------ LAYER 1: PUPIL/IRIS ---
   * Math / Math.001 / Combine XYZ / Vector Math / Math.004 / Math.005 /
   * Math.002 / Math.003 / Combine XYZ.001 / Vector Math.001 / Math.006 /
   * Math.007 / Map Range / Vector Math.003 / .004 / .005
   */
  const Math_ = blSafeDivide(PLX_add_0[0], K.pupil_a);
  const Math_001 = blSafeDivide(PLX_add_0[2], K.pupil_b);
  const VectorMath = len3([Math_, 0.0, Math_001]); // LENGTH -> Value socket
  const Math_004 = VectorMath - 1.0;
  const Math_005 = Math_004 * VectorMath;
  const Math_002 = blSafeDivide(PLX_add_0[0], K.pupil_a2);
  const Math_003 = blSafeDivide(PLX_add_0[2], K.pupil_b2);
  const VectorMath_001 = len3([Math_002, 0.0, Math_003]); // LENGTH -> Value
  const Math_006 = VectorMath_001 + K.pupil_eps;
  const Math_007 = blSafeDivide(Math_005, Math_006);
  const MapRange = blMapLinearClamped(
    Math_007,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  ); // PUPIL MASK
  const VectorMath_005 = add3(C.Color, scale3(sub3(EYE_sh_Color_001, C.Color), MapRange));
  nodes['Vector Math'] = VectorMath;
  nodes['Vector Math.001'] = VectorMath_001;
  nodes['Math.007'] = Math_007;
  nodes['Map Range'] = MapRange;
  nodes['Vector Math.005'] = VectorMath_005;

  /* -------------------------------------------------- LAYER 2: EYE LINE ---
   * Separate XYZ.002 / Math.012 / Math.013 / Map Range.004 / SYM_line_mix /
   * Vector Math.012 / .013 / .014
   * The eye line sits BELOW the shine. This order is load-bearing.
   */
  const Math_012 = Math.abs(PLX_add_2[2]);
  const Math_013 = Math_012 - K.line_half;
  const MapRange_004 = blMapLinearClamped(
    Math_013,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  // SYM_line_mix: RGBA, blend=MIX, clamp_factor=True. Factor default 0.0 -> A.
  const SYM_line_mix = mix3(EYE_sh_Color_004, SYM2_shade, blClamp01(lineMixFactor));
  const VectorMath_014 = add3(
    VectorMath_005,
    scale3(sub3(SYM_line_mix, VectorMath_005), MapRange_004),
  );
  nodes['Map Range.004'] = MapRange_004;
  nodes.SYM_line_mix = SYM_line_mix;
  nodes['Vector Math.014'] = VectorMath_014;

  /* ------------------------------------------- LAYERS 3-4: SHINE CORE/RING */
  const VectorMath_002 = len3([PLX_add_1[0], 0.0, PLX_add_1[2]]); // LENGTH -> Value
  const MapRange_001 = blMapLinearClamped(
    VectorMath_002 - K.shine_core_r,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  const MapRange_002 = blMapLinearClamped(
    VectorMath_002 - K.shine_outer_r,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  const MapRange_003 = blMapLinearClamped(
    VectorMath_002 - K.shine_inner_r,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  const Math_011 = MapRange_002 - MapRange_003; // RING band 0.061..0.079
  const SYM_sup_MapRange_001 = MapRange_001 * SYM_inv;
  const SYM_sup_Math_011 = Math_011 * SYM_inv;
  const VectorMath_008 = add3(
    VectorMath_014,
    scale3(sub3(C.Color002, VectorMath_014), SYM_sup_MapRange_001),
  );
  const VectorMath_011 = add3(
    VectorMath_008,
    scale3(sub3(C.Color003, VectorMath_008), SYM_sup_Math_011),
  );
  nodes['Vector Math.002'] = VectorMath_002;
  nodes['Map Range.001'] = MapRange_001;
  nodes['Map Range.002'] = MapRange_002;
  nodes['Map Range.003'] = MapRange_003;
  nodes['Math.011'] = Math_011;
  nodes['SYM_sup_Map Range_001'] = SYM_sup_MapRange_001;
  nodes.SYM_sup_Math_011 = SYM_sup_Math_011;
  nodes['Vector Math.008'] = VectorMath_008;
  nodes['Vector Math.011'] = VectorMath_011;

  /* ------------------------------------------------ LAYERS 5-6: SYM GLYPH */
  const SYM_ux = blSafeDivide(PLX_add_5[0], symSize);
  const SYM_uz = blSafeDivide(PLX_add_5[2], symSize);
  const SYM_ax = SYM_ux + K.SYM_center;
  const SYM_az = SYM_uz + K.SYM_center;
  const SYM_du = blSafeDivide(SYM_ax + symCol, K.SYM_cols);
  const SYM_dv = blSafeDivide(SYM_az + symRow, K.SYM_rows);

  // ShaderNodeTexImage extension = CLIP: transparent black outside [0,1]^2.
  let texR = 0,
    texG = 0;
  if (SYM_du >= 0 && SYM_du <= 1 && SYM_dv >= 0 && SYM_dv <= 1) {
    const t = input.atlas(SYM_du, SYM_dv);
    texR = t[0];
    texG = t[1];
  }

  // IN-CELL CLIPPING. Required: image-level CLIP only guards the whole atlas,
  // not the individual 512 px cell, so without this the glyph bleeds into its
  // neighbour.
  const SYM_t0 = SYM_ax > 0.0 ? 1 : 0;
  const SYM_t1 = SYM_ax < 1.0 ? 1 : 0;
  const SYM_c1 = SYM_t0 * SYM_t1;
  const SYM_t2 = SYM_az > 0.0 ? 1 : 0;
  const SYM_t3 = SYM_az < 1.0 ? 1 : 0;
  const SYM_c2 = SYM_t2 * SYM_t3;
  const SYM_incell = SYM_c1 * SYM_c2;

  const SYM_thr = blMapLinearClamped(texR, K.SYM_thr_from_min, K.SYM_thr_from_max, 0.0, 1.0);
  const SYM_mask = SYM_thr * K.SYM_mask_mul;
  const SYM_mask_clipped = SYM_mask * SYM_incell;
  const SYM_mask_clipped_boost = blClamp01(SYM_mask_clipped * K.SYM_boost); // use_clamp
  // SYM_color is NOT shaded by IRIS_prof.
  const SYM_layer_add = add3(
    VectorMath_011,
    scale3(sub3(symColor, VectorMath_011), SYM_mask_clipped_boost),
  );

  const SYM2_thr = blMapLinearClamped(texG, K.SYM_thr_from_min, K.SYM_thr_from_max, 0.0, 1.0);
  const SYM2_mask = SYM2_thr * SYM_incell;
  const SYM2_mask_boost = blClamp01(SYM2_mask * K.SYM_boost); // use_clamp
  // SYM2_shade IS shaded by IRIS_prof (via SYM_profn).
  const SYM2_layer_add = add3(
    SYM_layer_add,
    scale3(sub3(SYM2_shade, SYM_layer_add), SYM2_mask_boost),
  );

  nodes.SYM_ax = SYM_ax;
  nodes.SYM_az = SYM_az;
  nodes.SYM_du = SYM_du;
  nodes.SYM_dv = SYM_dv;
  nodes.SYM_tex_R = texR;
  nodes.SYM_tex_G = texG;
  nodes.SYM_incell = SYM_incell;
  nodes.SYM_thr = SYM_thr;
  nodes.SYM_mask_clipped = SYM_mask_clipped;
  nodes.SYM_mask_clipped_boost = SYM_mask_clipped_boost;
  nodes.SYM_layer_add = SYM_layer_add;
  nodes.SYM2_thr = SYM2_thr;
  nodes.SYM2_mask_boost = SYM2_mask_boost;
  nodes.SYM2_layer_add = SYM2_layer_add;

  /* --------------------------------------------------- LAYER 7: SYM LINE */
  const SYMLINE_abs = Math.abs(PLX_add_6[2]);
  const SYMLINE_sub_t = SYMLINE_abs - K.line_half;
  const SYMLINE_thr = blMapLinearClamped(
    SYMLINE_sub_t,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  const SYMLINE_mask = SYMLINE_thr * K.SYM_mask_mul;
  const SYMLINE_mask_boost = blClamp01(SYMLINE_mask * K.SYM_boost); // use_clamp
  const SYMLINE_add = add3(
    SYM2_layer_add,
    scale3(sub3(SYM2_shade, SYM2_layer_add), SYMLINE_mask_boost),
  );
  nodes.SYMLINE_thr = SYMLINE_thr;
  nodes.SYMLINE_mask_boost = SYMLINE_mask_boost;
  nodes.SYMLINE_add = SYMLINE_add;

  /* ------------------------------------------------- LAYERS 8-9: THE LIDS
   * THE SIGN TRAP: the UPPER lid signal passes through Math.014 (* -1); the
   * LOWER lid signal is the raw Separate XYZ.004.Z. Every consumer below —
   * Map Range.005, LIDE_shU, LIDE_softU, LIDE_bUup, LIDE_bUdn (and the dead
   * LIDE_lpU) — reads the NEGATED value.
   */
  const Math_014 = PLX_add_3[2] * K.Math_014_mul; // upper lid signal (NEGATED)
  const lidL_sig = PLX_add_4[2]; // lower lid signal (RAW)
  const MapRange_005 = blMapLinearClamped(
    Math_014,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  const MapRange_006 = blMapLinearClamped(
    lidL_sig,
    K.feather_from_min,
    K.feather_from_max,
    0.0,
    1.0,
  );
  const VectorMath_017 = add3(SYMLINE_add, scale3(sub3(C.Color005, SYMLINE_add), MapRange_005));
  const VectorMath_020 = add3(
    VectorMath_017,
    scale3(sub3(C.Color006, VectorMath_017), MapRange_006),
  );
  nodes['Math.014'] = Math_014;
  nodes['Separate XYZ.004.Z'] = lidL_sig;
  nodes['Map Range.005'] = MapRange_005;
  nodes['Map Range.006'] = MapRange_006;
  nodes['Vector Math.017'] = VectorMath_017;
  nodes['Vector Math.020'] = VectorMath_020;

  /* -------------------------------------------- LAYER 10: LID CAST SHADOW */
  const LID_mask = MapRange_005 + MapRange_006;
  const LID_clamp = Math.min(Math.max(LID_mask, 0.0), 1.0);
  const LIDE_notlid = 1.0 - LID_clamp;
  const LIDE_shU = blMapLinearClamped(
    Math_014,
    K.LIDE_sh_from_min,
    K.LIDE_sh_from_max,
    0.0,
    1.0,
  );
  const LIDE_shL = blMapLinearClamped(
    lidL_sig,
    K.LIDE_sh_from_min,
    K.LIDE_sh_from_max,
    0.0,
    1.0,
  );
  const LIDE_shadow = Math.max(LIDE_shU, LIDE_shL);
  const LIDE_shx = LIDE_shadow * LIDE_notlid;
  const LIDE_smul = LIDE_shx * K.LIDE_smul_strength;
  const LIDE_sinv = 1.0 - LIDE_smul;
  const LIDE_shaded = scale3(VectorMath_020, LIDE_sinv);
  nodes.LID_mask = LID_mask;
  nodes.LID_clamp = LID_clamp;
  nodes.LIDE_shadow = LIDE_shadow;
  nodes.LIDE_sinv = LIDE_sinv;
  nodes.LIDE_shaded = LIDE_shaded;

  /* ------------------------------------------ LAYER 11: PAINTED LIP (OFF)
   * A band needs a rising AND a falling edge multiplied together — which is
   * exactly what bUup * bUdn is. Strength is 0.0 in the live file. */
  const LIDE_bUup = blMapLinearClamped(
    Math_014,
    K.LIDE_bup_from_min,
    K.LIDE_bup_from_max,
    0.0,
    1.0,
  );
  const LIDE_bUdn = blMapLinearClamped(
    Math_014,
    K.LIDE_bdn_from_min,
    K.LIDE_bdn_from_max,
    0.0,
    1.0,
  );
  const LIDE_bUb = LIDE_bUup * LIDE_bUdn;
  const LIDE_bLup = blMapLinearClamped(
    lidL_sig,
    K.LIDE_bup_from_min,
    K.LIDE_bup_from_max,
    0.0,
    1.0,
  );
  const LIDE_bLdn = blMapLinearClamped(
    lidL_sig,
    K.LIDE_bdn_from_min,
    K.LIDE_bdn_from_max,
    0.0,
    1.0,
  );
  const LIDE_bLb = LIDE_bLup * LIDE_bLdn;
  const LIDE_lipband = Math.max(LIDE_bUb, LIDE_bLb);
  const LIDE_lmul = LIDE_lipband * K.LIDE_lmul_strength; // <<< 0.0
  const LIDE_lipsc = scale3(C.LIDE_lipcol, LIDE_lmul);
  const LIDE_out = add3(LIDE_shaded, LIDE_lipsc);
  nodes.LIDE_lipband = LIDE_lipband;
  nodes.LIDE_lmul = LIDE_lmul;
  nodes.LIDE_out = LIDE_out;

  /* ------------------------------------- RELIEF: roughness / coat / bump --
   * All three read the SAME soft step (+/- 0.030). Load-bearing: driving the
   * material switch off the hard mask while the bump slope is soft leaves a
   * polished tilted band, i.e. a hot specular line. */
  const LIDE_softU = blMapLinearClamped(
    Math_014,
    K.LIDE_soft_from_min,
    K.LIDE_soft_from_max,
    0.0,
    1.0,
  );
  const LIDE_softL = blMapLinearClamped(
    lidL_sig,
    K.LIDE_soft_from_min,
    K.LIDE_soft_from_max,
    0.0,
    1.0,
  );
  const LIDE_soft = Math.max(LIDE_softU, LIDE_softL);
  const LID_rough = blMapLinearClamped(LIDE_soft, 0.0, 1.0, K.LID_rough_to_min, K.LID_rough_to_max);
  const LID_coat = blMapLinearClamped(LIDE_soft, 0.0, 1.0, K.LID_coat_to_min, K.LID_coat_to_max);
  nodes.LIDE_soft = LIDE_soft;
  nodes.LID_rough = LID_rough;
  nodes.LID_coat = LID_coat;

  const normal = bump
    ? blBump(K.LID_bump_strength, K.LID_bump_distance, input.normal, bump, 1.0)
    : norm3(input.normal);

  /* --------------------------------------------------------------- GLOW ---
   * NOTE the asymmetry, reproduced verbatim: the CORE term entering GLOW_sum
   * is the UNGATED Map Range.001, while the RING term is the GATED
   * SYM_sup_Math_011. See EYE-GLSL.md D.6. */
  const GLOW_sum = MapRange_001 + SYM_sup_Math_011;
  const GLOW_clamp = Math.min(Math.max(GLOW_sum, 0.0), 1.0);
  const GLOW_str = GLOW_clamp * K.GLOW_str_mul;
  const GLOW_notpupil = 1.0 - MapRange;
  const GLOW_white = GLOW_notpupil * K.GLOW_white_mul; // 0.13, not 0.24
  const GLOW_tot = GLOW_str + GLOW_white;
  const GLOW_inv = 1.0 - LID_clamp;
  const GLOW_occ = GLOW_tot * GLOW_inv;
  // <<< THE SYM_inv GATE. Without it the bloom lays a ~0.37 white floor over
  // the glyph and every palette renders identically washed out.
  const GLOW_alertgate = blClamp01(GLOW_occ * SYM_inv); // use_clamp = True
  nodes.GLOW_sum = GLOW_sum;
  nodes.GLOW_str = GLOW_str;
  nodes.GLOW_white = GLOW_white;
  nodes.GLOW_tot = GLOW_tot;
  nodes.GLOW_occ = GLOW_occ;
  nodes.GLOW_alertgate = GLOW_alertgate;

  /* ---------------------------------------------------------- SYM emission
   * SYM_em_str = SYM_mask_clipped * 0.0 — identically zero in the live file. */
  const SYM_em_str = SYM_mask_clipped * K.SYM_em_str_mul;
  nodes.SYM_em_str = SYM_em_str;

  return {
    baseColor: LIDE_out,
    emissiveColor: C.GLOW_em,
    emissiveStrength: GLOW_alertgate,
    roughness: LID_rough,
    clearcoat: LID_coat,
    clearcoatRoughness: K.principled_coat_roughness,
    normal,
    bumpHeight: LIDE_soft,
    symEmissiveColor: symColor2,
    symEmissiveStrength: SYM_em_str,
    nodes,
  };
}

/**
 * Blender's `AddShader(Principled, Emission)` is a plain additive sum, so the
 * radiance the eye contributes on top of the lit BSDF is exactly this.
 * `SYM_em` is omitted because its strength is identically zero; pass
 * `includeSymEm` to assert that.
 */
export function deckeEyeEmissiveRadiance(o: DeckeEyeOutput, includeSymEm = false): Vec3 {
  const glow = scale3(o.emissiveColor, o.emissiveStrength);
  if (!includeSymEm) return glow;
  return add3(glow, scale3(o.symEmissiveColor, o.symEmissiveStrength));
}

/**
 * The layer stack, bottom to top, as read out of the link graph. The eye line
 * is strictly BELOW both shine layers — it was above once, which drew the line
 * across the front of the highlight.
 */
export const EYE_LAYER_ORDER = [
  'Color (white base)',
  'Vector Math.005  — pupil / iris   (EYE_sh_Color_001, mask = Map Range)',
  'Vector Math.014  — EYE LINE       (SYM_line_mix,     mask = Map Range.004)',
  'Vector Math.008  — shine core     (Color.002 white,  mask = SYM_sup_Map Range_001)',
  'Vector Math.011  — shine ring     (Color.003 cyan,   mask = SYM_sup_Math_011)',
  'SYM_layer_add    — glyph RED      (SYM_color,        mask = SYM_mask_clipped_boost)',
  'SYM2_layer_add   — glyph GREEN    (SYM2_shade,       mask = SYM2_mask_boost)',
  'SYMLINE_add      — symbol line    (SYM2_shade,       mask = SYMLINE_mask_boost)',
  'Vector Math.017  — UPPER lid      (Color.005,        mask = Map Range.005)',
  'Vector Math.020  — LOWER lid      (Color.006,        mask = Map Range.006)',
  'LIDE_shaded      — cast shadow    (x LIDE_sinv)',
  'LIDE_out         — painted lip    (+ LIDE_lipsc, strength 0)',
] as const;

/** Nodes present in the material but unreachable from Material Output. */
export const EYE_DEAD_NODES = [
  'IRIS_near',
  'IRIS_nearR',
  'LIDE_bh',
  'LIDE_lip',
  'LIDE_lpL',
  'LIDE_lpU',
] as const;
