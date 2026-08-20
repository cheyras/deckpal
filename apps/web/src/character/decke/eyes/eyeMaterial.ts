/**
 * Deck-E's analytic eye — the Blender material `Eye_{L,R}_Face_anim` ported to
 * a `MeshPhysicalMaterial` patched through `onBeforeCompile`.
 *
 * WHY NOT `ShaderMaterial`: the read of the whole eye is "features sitting under
 * a sheet of glass". That sheet is three's physical BRDF — environment
 * reflection, clearcoat, specular tint. Writing the maths as a ShaderMaterial
 * means reimplementing all of it, so instead the node graph only supplies base
 * colour, emission, roughness, coat weight and a bump normal, and three keeps
 * every light.
 *
 * The maths itself is a verbatim transcription of the 209 reachable nodes; the
 * dependency-ordered trace lives in `scratchpad/EYE-GLSL.md` and the CPU parity
 * implementation in `eyeReference.ts`. Do not "tidy" any expression here:
 * algebraically-equal rearrangements are numerically different at the feather
 * widths this thing works at (0.0012 object units).
 *
 * AXES. Every constant in the graph is in the BLENDER frame (Z up, -Y forward),
 * but the glb was exported with the Y-up conversion baked into every node, so a
 * control empty's three.js local space has Blender's Z on Y and Blender's Y on
 * -Z. Rather than sprinkle swizzles through the transcription, the change of
 * basis is folded into the uniform matrices (`BLENDER_FROM_THREE` below) so the
 * shader reads exactly like the node graph.
 */
import {
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Vector3,
  type Object3D,
  type Texture,
} from 'three'
import type { Pose } from '../playbook'

/**
 * three.js local/world -> Blender local/world. `(x, y, z) -> (x, -z, y)`.
 *
 * Composed onto the LEFT of each `inverse(empty.matrixWorld)`, which is exactly
 * `Texture Coordinate -> Object` expressed in Blender's axes. It is the inverse
 * of `blenderToThree` in constants.ts and must stay that way.
 */
const BLENDER_FROM_THREE = /*@__PURE__*/ new Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
)

/**
 * The alert atlas: which cell each symbol occupies, how big it is drawn, and
 * its two colours.
 *
 * Cells are SHADER coordinates — row 1 is the TOP half of the PNG, because
 * Blender addresses images bottom-up. Sizes are `SYMBOL_SIZE` from
 * `decke_states.py` (also mirrored in `playbook.json:symbol_atlas.sizes`); the
 * glyphs differ hugely in aspect, so one shared size makes the wide ones read
 * far too large.
 *
 * The palette is the 08-17 revision recorded in `PORT-SPEC-corrections.md` §2,
 * NOT the older per-cell table on the wiki (which had the star as literal grey
 * — recorded there as a bug). `under` is the atlas RED pass and is drawn
 * UNSHADED; `glyph` is the GREEN pass, is shaded by the iris profile, and is
 * also the colour of the symbol's own underline. They are deliberately deeper
 * and more saturated than the intended screen result because AgX desaturates.
 */
const SYMBOLS: Record<string, { col: number; row: number; size: number; under: number; glyph: number }> = {
  money: { col: 0, row: 1, size: 0.7, under: 0x059669, glyph: 0x34d399 },
  star: { col: 1, row: 1, size: 0.66, under: 0xd97706, glyph: 0xfbbf24 },
  warn: { col: 2, row: 1, size: 0.7, under: 0xea580c, glyph: 0xfb923c },
  error: { col: 3, row: 1, size: 0.54, under: 0xdc2626, glyph: 0xf87171 },
  spinner: { col: 4, row: 1, size: 0.6, under: 0x00323d, glyph: 0x22d3ee },
  dizzy: { col: 0, row: 0, size: 0.57, under: 0x141e3d, glyph: 0x32467f },
  // The three scribble frames sit at columns 1..3 of row 0 and are stepped by
  // the `sym_frame` channel, which is why this entry carries the FIRST of them.
  scribble: { col: 1, row: 0, size: 0.57, under: 0x000f2e, glyph: 0x0f2359 },
}

/** Material constants that come from the Principled node, not from the graph. */
const PRINCIPLED = {
  ior: 1.5199999809265137,
  metalness: 0.0,
  specularIntensity: 0.6200000047683716,
  coatRoughness: 0.029999999329447746,
} as const

// ---------------------------------------------------------------------------
// The GLSL
// ---------------------------------------------------------------------------

const EYE_GLSL = /* glsl */ `
uniform mat4 uCtrlPupil;
uniform mat4 uCtrlShine;
uniform mat4 uCtrlLine;
uniform mat4 uCtrlLidU;
uniform mat4 uCtrlLidL;
uniform mat4 uCtrlSymbol;
uniform mat4 uCtrlSymLine;
uniform mat4 uEyeObjectInverse;
uniform float uSymAlert;
uniform float uSymCol;
uniform float uSymRow;
uniform float uSymSize;
uniform float uSymLineMixFactor;
uniform float uSymSpin;
uniform vec3 uSymColor;
uniform vec3 uSymColor2;
uniform sampler2D uSymAtlas;
varying vec3 vDeckeWorldPos;

// Blender's Math node semantics. DIVIDE by zero is 0, SQRT of a negative is 0.
float blSafeDivide(float a, float b) { return (b != 0.0) ? (a / b) : 0.0; }
float blSafeSqrt(float a) { return (a > 0.0) ? sqrt(a) : 0.0; }

float blClampRange(float v, float mn, float mx) {
  return (mn > mx) ? clamp(v, mx, mn) : clamp(v, mn, mx);
}

// ShaderNodeMapRange, LINEAR, clamp = True. The clamp is against the TO range
// and is ORDER AWARE — every mask in this graph maps 0.0006 -> -0.0006 onto
// 0 -> 1, so a naive clamp(x, 0, 1) on an unswapped range returns 1.0 across
// the whole eye.
float blMapLinear(float v, float fmin, float fmax, float tmin, float tmax) {
  float f = blSafeDivide(v - fmin, fmax - fmin);
  return blClampRange(tmin + f * (tmax - tmin), tmin, tmax);
}

// The SAME map range, with the band widened to one screen pixel when the
// authored feather is narrower than that.
//
// Every hard mask in this graph is a 0.0012-unit feather on a signal that moves
// several hundredths of a unit across a single pixel, so at one sample per
// pixel the edge is a pure step. Blender renders these with 64+ samples and
// gets a clean edge for free; a rasteriser gets a staircase, and thin features
// — a star's arm, the shine ring — break into dots.
//
// No constant changes: the band's centre and direction are the authored ones,
// and where the authored half-width already exceeds half a pixel footprint this
// is bit-for-bit blMapLinear.
float blMapLinearAA(float v, float fmin, float fmax, float tmin, float tmax) {
  float mid = 0.5 * (fmin + fmax);
  float h = 0.5 * (fmax - fmin);
  float hw = max(abs(h), 0.5 * fwidth(v));
  float f = clamp(0.5 + (v - mid) / (2.0 * (h < 0.0 ? -hw : hw)), 0.0, 1.0);
  return tmin + f * (tmax - tmin);
}

// clamp(boost * blMapLinear(v, fmin, fmax, 0, 1), 0, 1), antialiased.
//
// The three symbol layers all threshold and then multiply by 2.6 with
// use_clamp, and that pair IS a map range in its own right: clamping
// k * mapLinear(v, a, b, 0, 1) is mapLinear(v, a, a + (b - a) / k, 0, 1). So the
// edge the eye actually sees sits at a + (b - a) / (2k), NOT at the midpoint of
// [a, b].
//
// Widening [a, b] to the pixel footprint first and boosting afterwards
// therefore drags the 50%-coverage point 0.6154 of a widened half-width off the
// authored edge, and every boosted feature fattens: on a pointed glyph the
// star's arms grow several pixels along their axis, and the symbol's underline
// renders about 20% too thick. Folding the boost into the range before widening
// leaves the edge exactly where the graph puts it and only the transition band
// grows. In the un-widened limit this is bit-for-bit the clamped product.
float blMapLinearBoostAA(float v, float fmin, float fmax, float boost) {
  return blMapLinearAA(v, fmin, fmin + blSafeDivide(fmax - fmin, boost), 0.0, 1.0);
}

// ShaderNodeMapRange, SMOOTHSTEP. The factor is always clamped; the node's own
// clamp flag is inert for this interpolation.
float blMapSmoothstep(float v, float fmin, float fmax, float tmin, float tmax) {
  float f = clamp(blSafeDivide(v - fmin, fmax - fmin), 0.0, 1.0);
  f = (3.0 - 2.0 * f) * f * f;
  return tmin + f * (tmax - tmin);
}

// ShaderNodeTexImage extension = CLIP: transparent black outside the image.
// The fetch is UNCONDITIONAL and masked afterwards. A texture2D inside divergent
// control flow has undefined screen-space derivatives, and the driver picks a
// junk mip level for the lanes that took the other branch — which shows up as
// a per-pixel hash over the glyph rather than as anything obviously wrong.
vec4 blTexClip(sampler2D img, vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture2D(img, clamp(uv, 0.0, 1.0)) * inside;
}

// ShaderNodeBump, invert = False, Blender's GPU implementation. filterWidth
// (0.10) has no GPU equivalent and is ignored there too.
vec3 blBump(float strength, float dist, float height, vec3 N, vec3 surfPos) {
  N = normalize(N);
  dist *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 dPdx = dFdx(surfPos);
  vec3 dPdy = dFdy(surfPos);
  vec3 Rx = cross(dPdy, N);
  vec3 Ry = cross(N, dPdx);
  float det = dot(dPdx, Rx);
  vec3 surfgrad = dFdx(height) * Rx + dFdy(height) * Ry;
  strength = max(strength, 0.0);
  vec3 r = normalize(abs(det) * N - dist * sign(det) * surfgrad);
  return normalize(mix(N, r, strength));
}

struct DeckeEye {
  vec3 baseColor;
  vec3 emissiveColor;
  float emissiveStrength;
  float roughness;
  float clearcoat;
  float clearcoatRoughness;
  float bumpHeight;
};

// worldPos: shading point, three.js world space.
// incoming: Geometry.Incoming == normalize(cameraPosition - worldPos), three.js
//           world space. Converted to Blender axes where the graph needs it.
DeckeEye deckeEyeEval(vec3 worldPos, vec3 incoming) {
  vec4 wp = vec4(worldPos, 1.0);

  // ---- PLX: the shared parallax offset --------------------------------
  // DEPTH is NEGATIVE by derivation. A positive sign floats every feature
  // above the glass instead of sinking it below.
  vec3 plxToObj = mat3(uEyeObjectInverse) * incoming;   // no re-normalise; the graph has none
  float plxClamp = max(abs(plxToObj.y), 0.3499999940395355);
  float plxScale = blSafeDivide(-0.019999999552965164, plxClamp);
  vec3 PLX_off = vec3(plxToObj.x * plxScale, 0.0, plxToObj.z * plxScale);

  // EIGHT SEPARATE COORDINATE SPACES. Each feature reads the shading point in a
  // DIFFERENT empty's local space, and the offset is added once per coordinate.
  // Routing them all through one shared coordinate collapses every layer onto
  // the pupil and the whole face renders blank.
  vec3 cPupil   = (uCtrlPupil   * wp).xyz + PLX_off;
  vec3 cShine   = (uCtrlShine   * wp).xyz + PLX_off;
  vec3 cLine    = (uCtrlLine    * wp).xyz + PLX_off;
  vec3 cLidU    = (uCtrlLidU    * wp).xyz + PLX_off;
  vec3 cLidL    = (uCtrlLidL    * wp).xyz + PLX_off;
  // NO PARALLAX HERE — see the spin note at LAYERS 5-6. This is the only one of
  // the eight coordinates the offset is not folded into at this point, because
  // it is the only one whose frame rotates.
  vec3 cSymbolRaw = (uCtrlSymbol * wp).xyz;
  vec3 cSymLine = (uCtrlSymLine * wp).xyz + PLX_off;
  vec3 cIris    = (uCtrlPupil   * wp).xyz + PLX_off;   // same empty as cPupil, own ADD node

  // ---- IRIS depth profile ---------------------------------------------
  // The graph reads Incoming in WORLD space here and multiplies it against
  // OBJECT-space iris coordinates. That mixes two spaces and is only correct
  // while the head is near-unrotated; reproduced verbatim (EYE-GLSL D.9).
  vec3 incB = vec3(incoming.x, -incoming.z, incoming.y);

  float irisNx = blSafeDivide(cIris.x, 0.17100000381469727);
  float irisNz = blSafeDivide(cIris.z, 0.30799999833106995);
  float irisR = blSafeSqrt(irisNx * irisNx + irisNz * irisNz);
  // LINEAR in the live file, not the smoothstep the wiki describes.
  float irisRimR = blMapLinear(irisR, 0.9100000262260437, 1.0, 0.0, 1.0);
  float irisProj = irisNx * incB.x + irisNz * incB.z;
  // The 0.18 floor keeps the rim present when the camera is head-on and proj
  // goes to zero; a plain 0..1 range makes the whole effect vanish.
  float irisRimD = blMapLinear(irisProj, 0.05000000074505806, -0.44999998807907104,
                               0.18000000715255737, 1.0);
  float irisS1 = 1.399999976158142 - (irisRimR * irisRimD) * 0.6200000047683716;
  float irisOx = irisNx + incB.x * 0.550000011920929;
  float irisOz = irisNz + incB.z * 0.550000011920929;
  float irisOd = blSafeSqrt(irisOx * irisOx + irisOz * irisOz);
  float irisRad = blMapSmoothstep(irisOd, 0.019999999552965164, 1.1799999475479126, 0.0, 1.0);
  float IRIS_prof = irisS1 - irisRad * 1.1200000047683716;   // [-0.34, 1.40]

  const vec3 kColor001 = vec3(0.00800000037997961, 0.07620000094175339, 0.12479999661445618);
  vec3 irisShade = kColor001 * IRIS_prof;
  float symProfn = IRIS_prof * 0.5 + 0.44999998807907104;
  vec3 SYM2_shade = uSymColor2 * symProfn;

  // SUBTRACT with use_clamp = False, so this legally goes negative while the
  // reel spring overshoots. Not clamped — that overshoot is the bounce.
  float SYM_inv = 1.0 - uSymAlert;

  // ---- LAYER 1: pupil / iris -------------------------------------------
  float pNx = blSafeDivide(cPupil.x, 0.17100000381469727);
  float pNz = blSafeDivide(cPupil.z, 0.30799999833106995);
  float pL = length(vec3(pNx, 0.0, pNz));
  float pM5 = (pL - 1.0) * pL;
  float pGx = blSafeDivide(cPupil.x, 0.02924099937081337);
  float pGz = blSafeDivide(cPupil.z, 0.09486400336027145);
  float pG = length(vec3(pGx, 0.0, pGz));
  float pSd = blSafeDivide(pM5, pG + 9.999999747378752e-06);
  float pupilMask = blMapLinearAA(pSd, 0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);

  const vec3 kWhite = vec3(1.0);
  vec3 L1 = kWhite + (irisShade - kWhite) * pupilMask;

  // ---- LAYER 2: the eye line -------------------------------------------
  // BELOW the shine, confirmed from the link graph. The mix factor is unlinked
  // at 0.0 in the dump, which resolves to the iris colour; kept as a uniform
  // because the correction note claims it should read SYM2_shade.
  float lineMask = blMapLinearAA(abs(cLine.z) - 0.008999999612569809,
                               0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);
  vec3 lineColor = mix(irisShade, SYM2_shade, clamp(uSymLineMixFactor, 0.0, 1.0));
  vec3 L2 = L1 + (lineColor - L1) * lineMask;

  // ---- LAYERS 3-4: shine core and ring ---------------------------------
  float sR = length(vec3(cShine.x, 0.0, cShine.z));
  float shineCore = blMapLinearAA(sR - 0.04800000041723251,
                                0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);
  float sOuter = blMapLinearAA(sR - 0.07900000363588333,
                             0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);
  float sInner = blMapLinearAA(sR - 0.061000000685453415,
                             0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);
  float shineRing = sOuter - sInner;

  float supCore = shineCore * SYM_inv;
  float supRing = shineRing * SYM_inv;

  vec3 L3 = L2 + (kWhite - L2) * supCore;
  const vec3 kColor003 = vec3(0.13563333451747894, 0.8069522380828857, 0.9473065137863159);
  vec3 L4 = L3 + (kColor003 - L3) * supRing;

  // ---- LAYERS 5-6: the atlas glyph -------------------------------------
  // THE SPIN TURNS THE LOOKUP, NOT THE EMPTY, AND IT TURNS THE PARALLAX WITH IT.
  //
  // A glyph is a rigid image that should turn about ITS OWN CENTRE and be
  // shifted bodily by the view parallax. Written out, the lookup wants to be
  // atlas(R(theta) * (p - s)) for a sample point p and a fixed centre offset s.
  // The centre is then at p = s for every theta, which is the whole point.
  //
  // Neither of the two obvious spellings does that, and both were tried:
  //
  //   rotate the empty, add PLX after   ->  R(-theta)*p + PLX  ->  centre at
  //                                        R(theta)*(-PLX): a circle.
  //   rotate the lookup, add PLX after  ->  R(theta)*p + PLX   ->  centre at
  //                                        R(-theta)*(-PLX): the same circle,
  //                                        going the other way.
  //
  // PLX_off is a view offset computed in the EYE object's frame and added inside
  // each control's own frame. For the six controls that never turn, either
  // spelling is a fixed shift. For the one control that turns a revolution a
  // second it is a fixed shift living on the wrong side of a rotation, and the
  // glyph's centre walks a circle of that radius -- about 3 px at the staging
  // framing -- once per revolution.
  //
  // Reported as: "the loading wheels are rotating, like the pivot point on the
  // rotate is not centered, so they're kind of like moving around... they have
  // like a little bit of travel around in a circle." Measured with the character
  // completely frozen and only sym_spin moving: the whole annulus translates
  // through a closed loop as the angle advances. Faithful to the .blend, and
  // wrong; this is a PRODUCT fix, not a correction to the transcription -- the
  // same call sustain.ts makes for CLIP_PATCH.
  //
  // So the offset goes INSIDE the rotation, which is the s in the expression
  // above, and uSymSpin carries the per-eye half turn of phase.
  float symSin = sin(uSymSpin);
  float symCos = cos(uSymSpin);
  vec2 symP = vec2(cSymbolRaw.x + PLX_off.x, cSymbolRaw.z + PLX_off.z);
  vec2 symG = vec2(symCos * symP.x - symSin * symP.y, symSin * symP.x + symCos * symP.y);
  float symAx = blSafeDivide(symG.x, uSymSize) + 0.5;
  float symAz = blSafeDivide(symG.y, uSymSize) + 0.5;
  float symDu = blSafeDivide(symAx + uSymCol, 5.0);
  float symDv = blSafeDivide(symAz + uSymRow, 2.0);
  vec4 symTex = blTexClip(uSymAtlas, vec2(symDu, symDv));

  // In-cell clipping is REQUIRED. The image-level CLIP only guards the whole
  // atlas; without this test, points outside the glyph sample the neighbouring
  // cell and bleed the wrong symbol into the eye.
  float symInCell =
    (symAx > 0.0 ? 1.0 : 0.0) * (symAx < 1.0 ? 1.0 : 0.0) *
    (symAz > 0.0 ? 1.0 : 0.0) * (symAz < 1.0 ? 1.0 : 0.0);

  // The in-cell clip is a 0/1 gate, so hoisting it out of the clamped product
  // is exact: clamp(2.6 * thr * gate) == clamp(2.6 * thr) * gate.
  float symBoost = blMapLinearBoostAA(symTex.r, 0.4984999895095825, 0.5019999742507935,
                                      2.5999999046325684) * symInCell;
  vec3 L5 = L4 + (uSymColor - L4) * symBoost;

  float sym2Boost = blMapLinearBoostAA(symTex.g, 0.4984999895095825, 0.5019999742507935,
                                       2.5999999046325684) * symInCell;
  vec3 L6 = L5 + (SYM2_shade - L5) * sym2Boost;

  // ---- LAYER 7: the symbol's own underline -----------------------------
  float slBoost = blMapLinearBoostAA(abs(cSymLine.z) - 0.008999999612569809,
                                     0.0006000000284984708, -0.0006000000284984708,
                                     2.5999999046325684);
  vec3 L7 = L6 + (SYM2_shade - L6) * slBoost;

  // ---- LAYERS 8-9: the lids --------------------------------------------
  // THE SIGN TRAP: the upper lid signal passes through Math.014 (x -1); the
  // lower one is raw. Anything derived from a lid must read these, not the raw
  // component, or the upper lid alone comes out inverted.
  float lidUSig = cLidU.z * -1.0;
  float lidLSig = cLidL.z;
  float lidUMask = blMapLinearAA(lidUSig, 0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);
  float lidLMask = blMapLinearAA(lidLSig, 0.0006000000284984708, -0.0006000000284984708, 0.0, 1.0);

  const vec3 kLidColor = vec3(0.01599629409611225, 0.6514056324958801, 0.8549926280975342);
  vec3 L8 = L7 + (kLidColor - L7) * lidUMask;
  vec3 L9 = L8 + (kLidColor - L8) * lidLMask;

  // ---- LAYER 10: the lid's cast shadow ---------------------------------
  float lidClamp = clamp(lidUMask + lidLMask, 0.0, 1.0);
  float lideShadow = max(blMapLinear(lidUSig, 0.07500000298023224, 0.0, 0.0, 1.0),
                         blMapLinear(lidLSig, 0.07500000298023224, 0.0, 0.0, 1.0));
  vec3 lideShaded = L9 * (1.0 - (lideShadow * (1.0 - lidClamp)) * 0.41999998688697815);

  // ---- LAYER 11: the painted lip band ----------------------------------
  // A rising edge times a falling edge is a true band. Its strength is 0.0 in
  // the live file, so this is currently dead weight — kept because that
  // multiplier is the knob, and because removing it hides the knob.
  float lideBUb = blMapLinear(lidUSig, -0.03400000184774399, -0.02199999988079071, 0.0, 1.0)
                * blMapLinear(lidUSig, -0.0020000000949949026, -0.014000000432133675, 0.0, 1.0);
  float lideBLb = blMapLinear(lidLSig, -0.03400000184774399, -0.02199999988079071, 0.0, 1.0)
                * blMapLinear(lidLSig, -0.0020000000949949026, -0.014000000432133675, 0.0, 1.0);
  const vec3 kLipColor = vec3(0.6200000047683716, 0.9300000071525574, 1.0);
  vec3 LIDE_out = lideShaded + kLipColor * (max(lideBUb, lideBLb) * 0.0);

  // ---- relief: roughness, coat and bump all read the SAME soft step -----
  float lideSoft = max(blMapLinear(lidUSig, 0.029999999329447746, -0.029999999329447746, 0.0, 1.0),
                       blMapLinear(lidLSig, 0.029999999329447746, -0.029999999329447746, 0.0, 1.0));

  // ---- GLOW -------------------------------------------------------------
  // The core term entering the sum is UNGATED and the ring term is GATED, so
  // the ring ends up gated twice once alertgate multiplies again. Looks like an
  // oversight upstream; reproduced verbatim.
  float glowStr = clamp(shineCore + supRing, 0.0, 1.0) * 0.550000011920929;
  float glowWhite = (1.0 - pupilMask) * 0.12999999523162842;
  float glowOcc = (glowStr + glowWhite) * (1.0 - lidClamp);
  // THE SYM_inv GATE. Without it the bloom lays a ~0.37 white floor over the
  // glyph and every palette renders identically washed out.
  float glowAlertGate = clamp(glowOcc * SYM_inv, 0.0, 1.0);

  DeckeEye o;
  o.baseColor = LIDE_out;
  o.emissiveColor = vec3(0.6200000047683716, 0.9300000071525574, 1.0);
  o.emissiveStrength = glowAlertGate;
  o.roughness = blMapLinear(lideSoft, 0.0, 1.0, 0.05999999865889549, 0.30000001192092896);
  o.clearcoat = blMapLinear(lideSoft, 0.0, 1.0, 0.699999988079071, 0.699999988079071);
  o.clearcoatRoughness = 0.029999999329447746;
  o.bumpHeight = lideSoft;
  return o;
}
`

export type EyeUniforms = {
  uCtrlPupil: { value: Matrix4 }
  uCtrlShine: { value: Matrix4 }
  uCtrlLine: { value: Matrix4 }
  uCtrlLidU: { value: Matrix4 }
  uCtrlLidL: { value: Matrix4 }
  uCtrlSymbol: { value: Matrix4 }
  uCtrlSymLine: { value: Matrix4 }
  uEyeObjectInverse: { value: Matrix4 }
  uSymAlert: { value: number }
  uSymCol: { value: number }
  uSymRow: { value: number }
  uSymSize: { value: number }
  uSymLineMixFactor: { value: number }
  uSymSpin: { value: number }
  uSymColor: { value: Vector3 }
  uSymColor2: { value: Vector3 }
  uSymAtlas: { value: Texture }
}

export type EyeMaterial = MeshPhysicalMaterial & {
  userData: {
    deckeEye: EyeUniforms
    /** This eye's share of the spin phase, in radians. The two eyes are half a
     *  turn apart (`symbol_atlas.spin_phase_deg`), which only reads on a glyph
     *  that is actually turning — on a static one it is a horizontal mirror,
     *  which is how the money symbol once came out backwards. */
    deckeSpinPhase: number
  }
}

/** The seven control empties plus the eyeball itself, for one eye. */
export type EyeControls = {
  /** The eyeball mesh. Only its world matrix is read, for the parallax basis. */
  eye: Object3D
  pupil: Object3D
  shine: Object3D
  line: Object3D
  lidU: Object3D
  lidL: Object3D
  symbol: Object3D
  symLine: Object3D
}

function linearRGB(hex: number, out: Vector3): Vector3 {
  // ColorManagement is on, so setHex with SRGBColorSpace lands in the linear
  // working space — which is what a Blender RGB node value already is.
  const c = new Color().setHex(hex, SRGBColorSpace)
  return out.set(c.r, c.g, c.b)
}

export function createEyeMaterial(opts: {
  side: 'L' | 'R'
  atlas: Texture
  /** From `symbol_atlas.spin_phase_deg`. */
  spinPhaseDeg: number
}): EyeMaterial {
  // A 512 px cell lands on roughly 60 screen pixels, so the atlas is MINIFIED
  // about 8x and needs a mip chain. Averaging an SDF is well behaved (that is
  // the point of an SDF), and the in-cell clip still guards against a
  // neighbouring symbol bleeding in through the mask, so the usual objection to
  // mipmapping an atlas does not apply.
  const atlas = opts.atlas
  atlas.minFilter = LinearMipmapLinearFilter
  atlas.magFilter = LinearFilter
  atlas.generateMipmaps = true
  atlas.anisotropy = 8

  const warn = SYMBOLS.warn
  const uniforms: EyeUniforms = {
    uCtrlPupil: { value: new Matrix4() },
    uCtrlShine: { value: new Matrix4() },
    uCtrlLine: { value: new Matrix4() },
    uCtrlLidU: { value: new Matrix4() },
    uCtrlLidL: { value: new Matrix4() },
    uCtrlSymbol: { value: new Matrix4() },
    uCtrlSymLine: { value: new Matrix4() },
    uEyeObjectInverse: { value: new Matrix4() },
    uSymAlert: { value: 0 },
    uSymCol: { value: warn.col },
    uSymRow: { value: warn.row },
    uSymSize: { value: warn.size },
    // Unlinked at 0.0 in the dump. See EYE-GLSL.md D.1.
    uSymLineMixFactor: { value: 0 },
    uSymSpin: { value: 0 },
    uSymColor: { value: linearRGB(warn.under, new Vector3()) },
    uSymColor2: { value: linearRGB(warn.glyph, new Vector3()) },
    uSymAtlas: { value: atlas },
  }

  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: PRINCIPLED.metalness,
    // Both are overwritten per fragment; these are the compile-time seeds, and
    // clearcoat MUST be non-zero here or USE_CLEARCOAT is never defined and the
    // per-fragment coat writes have nothing to write to.
    roughness: 0.06,
    clearcoat: 0.7,
    clearcoatRoughness: PRINCIPLED.coatRoughness,
    ior: PRINCIPLED.ior,
    specularIntensity: PRINCIPLED.specularIntensity,
    specularColor: 0xffffff,
    sheen: 0,
    transmission: 0,
  }) as EyeMaterial

  mat.name = `Eye_${opts.side}_Face_anim`
  mat.userData.deckeEye = uniforms
  mat.userData.deckeSpinPhase = (opts.spinPhaseDeg * Math.PI) / 180

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDeckeWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n\tvDeckeWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + EYE_GLSL)
      // The whole graph is evaluated once, here, because every later injection
      // reads some part of it.
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  DeckeEye deckeEye = deckeEyeEval( vDeckeWorldPos, normalize( cameraPosition - vDeckeWorldPos ) );
  diffuseColor.rgb = deckeEye.baseColor;`,
      )
      // The bump is evaluated in VIEW space, because that is the space three's
      // own `normal` lives in. The height field itself is space-independent.
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  normal = blBump( 0.30000001192092896, 0.009999999776482582, deckeEye.bumpHeight, normal, -vViewPosition );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance = deckeEye.emissiveColor * deckeEye.emissiveStrength;`,
      )
      // Roughness and coat go in AFTER the physical chunk has built `material`,
      // so the chunk's own two guards have to be re-applied by hand: the 0.0525
      // floor (the base mip of a 256 cubemap) and `geometryRoughness`, which
      // widens the lobe where the interpolated normal turns fast. Dropping
      // either one sharpens the environment reflection past what one sample per
      // pixel can carry, and the eye picks up a moire off the HDRI.
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
  material.roughness = min( max( deckeEye.roughness, 0.0525 ) + geometryRoughness, 1.0 );
  material.clearcoat = clamp( deckeEye.clearcoat, 0.0, 1.0 );
  material.clearcoatRoughness = min( max( deckeEye.clearcoatRoughness, 0.0525 ) + geometryRoughness, 1.0 );`,
      )
  }

  // `needsUpdate` does NOT re-run onBeforeCompile in r185, and the old
  // `material.type` cache-buster was removed in r170 — a distinct cache key per
  // variant is the only thing that keeps the two eyes on separate programs.
  mat.customProgramCacheKey = () => `deckeEye:${opts.side}`

  return mat
}

const _inv = /*@__PURE__*/ new Matrix4()

function setCtrl(target: Matrix4, o: Object3D) {
  _inv.copy(o.matrixWorld).invert()
  target.multiplyMatrices(BLENDER_FROM_THREE, _inv)
}

/**
 * Push one frame of rig state into the shader.
 *
 * Call this AFTER the world matrices have been refreshed — the empties move
 * every frame and a stale `matrixWorld` shows up as the pupil lagging the reel
 * by exactly one frame.
 */
export function syncEyeUniforms(
  mat: EyeMaterial,
  ctrls: EyeControls,
  pose: Pose,
  symbol: string | null,
): void {
  const u = mat.userData.deckeEye
  // The phase only applies to a glyph that TURNS. On a static one the same half
  // turn is a pure horizontal mirror — invisible on the symmetric glyphs, a
  // reversed dollar sign on `money`.
  const spinning = Math.abs(pose.sym_spin ?? 0) > 1e-6
  u.uSymSpin.value =
    ((pose.sym_spin ?? 0) * Math.PI) / 180 + (spinning ? mat.userData.deckeSpinPhase : 0)

  setCtrl(u.uCtrlPupil.value, ctrls.pupil)
  setCtrl(u.uCtrlShine.value, ctrls.shine)
  setCtrl(u.uCtrlLine.value, ctrls.line)
  setCtrl(u.uCtrlLidU.value, ctrls.lidU)
  setCtrl(u.uCtrlLidL.value, ctrls.lidL)
  setCtrl(u.uCtrlSymbol.value, ctrls.symbol)
  setCtrl(u.uCtrlSymLine.value, ctrls.symLine)
  setCtrl(u.uEyeObjectInverse.value, ctrls.eye)

  // `alert` is a REEL POSITION, not an opacity, and it legally overshoots
  // [0, 1] — clamping it here would flatten the spring bounce.
  u.uSymAlert.value = pose.alert ?? 0

  // A null symbol means the current state has none; the previous glyph is left
  // in place so an alert rolling back out keeps the symbol it rolled in with.
  const spec = symbol ? SYMBOLS[symbol] : undefined
  if (spec) {
    // The scribble is three cells stepped by `sym_frame`. Cell indices must be
    // whole numbers or the shader samples between two glyphs, which is why the
    // channel is authored with STEP interpolation and rounded here as well.
    const frame = symbol === 'scribble' ? Math.round(pose.sym_frame ?? 0) : 0
    u.uSymCol.value = spec.col + Math.min(2, Math.max(0, frame))
    u.uSymRow.value = spec.row
    u.uSymSize.value = spec.size
    linearRGB(spec.under, u.uSymColor.value)
    linearRGB(spec.glyph, u.uSymColor2.value)
  }
}
