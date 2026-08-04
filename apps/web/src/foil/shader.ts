// foil/shader.ts — shader assembly + the uniform contract.
//
// The contract (documented for the full 15–20 pattern set in
// .claude/skills/foil-effects/SKILL.md):
//
//   Core (every pattern; owned by the viewer / global sliders)
//     uFace        sampler2D  the card scan (high.webp)
//     uTilt        vec2       card tilt, -1..1 per axis (drives everything)
//     uTime        float      seconds (ambient drift only — tilt is primary)
//     uIntensity   float      overall foil gain (0 = plain scan)
//     uScale       float      global pattern scale multiplier
//     uHueShift    float      base hue offset (0..1 around the ramp)
//     uHueSpread   float      how much hue varies across pattern + tilt
//     uSat         float      foil color saturation (0 = silver, 1 = full rainbow)
//     uArtGate     float      luminance gate: 1 = foil only in DARK areas of the
//                             scan (WOTC holo backgrounds are dark; printed ink
//                             stays readable). Cheap precursor to art-driven masks.
//     uSpecular    float      white sheen band gain (paper/foil gloss)
//     uDarken      float      mirror-substrate attenuation (0 = legacy, opt-in
//                             per recipe): fraction of the diffuse scan absorbed
//                             by the foil layer across the SAME coverage field
//                             (mask x gate) the additive layer uses — real
//                             mirror foil is dark at most angles; the pattern's
//                             flash screen-blends back on top
//     uTint        float      metallic ink tint (0 = legacy, opt-in per recipe):
//                             how much the foil flash carries the printed ink's
//                             OWN color. Mirror-reflected light crosses the ink
//                             layer twice, so over colored art the flash reads
//                             saturated art-colored metal — screen-blending
//                             achromatic light instead grays the art out
//                             (Chey, 2026-08-03, modern reverse holos). Neutral
//                             over silver/white, so blank-card canon renders
//                             are unaffected at any value.
//     uInkGuard    float      scan-composite engagement (R4b 2026-08-04; 0 =
//                             exact pre-R4 legacy composite, default 1): on a
//                             real card scan (uScanBase 1) this fades in the
//                             SCAN-ADDITIVE law — the scan is a photograph of
//                             the real card at rest, so it is already correct;
//                             foil becomes purely additive dynamic light,
//                             tilt-onset-eased (sub-JND at rest, R4c),
//                             chroma-preserving,
//                             and hard-clamped to each pixel's luminance
//                             headroom (dark ink gets almost none — text can
//                             never blow out, by construction). Engagement
//                             saturates by 0.35 so mid-range canon values run
//                             the safe law fully. Inert when uScanBase is 0.
//     uInkPop      float      metallic chroma pop (R4b; 0 = none): under the
//                             flash, colored print gains SATURATION along its
//                             own hue (a pure chroma pump, luminance-neutral
//                             by construction) — bands make colors shimmer
//                             more vivid, never washed. Scan path only.
//     uOnsetRange  float      R4d glow-onset window (scan path only): the
//                             |uTilt| at which added light reaches full
//                             (default 0.5). Chey's dial for "how far do I
//                             tilt before it glows".
//     uOnsetCurve  float      R4d glow-onset curve (scan path only): the
//                             flash-gate exponent over the onset ramp,
//                             eager (1) → lazy (6), default 3.5. Small tilts
//                             read as MOVEMENT of the existing sheen (pattern
//                             phase tracks uTilt directly); brightness joins
//                             late. Specular trails at uOnsetCurve+1 — latest
//                             of all. (0.45 / 1.5 reproduces R4c exactly.)
//     uScanBase    float      1 = uFace is a REAL CARD SCAN (both workbench
//                             card surfaces + the canon-lab card preview):
//                             the R4b scan-additive law applies. 0 = uFace is
//                             a synthetic blank base (canon-lab pattern room):
//                             the classic composite runs UNCHANGED, preserving
//                             every blank-card canon render bit-for-bit.
//                             Surface-owned (ViewerSettings.scanBase), never a
//                             slider, never stored in canon/override files.
//   Mask (layout-driven coarse tier; from era-layouts.json via resolver)
//     uMaskRect    vec4       x,y,w,h in UV (y UP — converted from layout data)
//     uMaskRadius  float      rect corner radius (UV of width)
//     uMaskFeather float      mask edge softness
//     uMaskInvert  float      0 = inside rect, 1 = outside (reverse holo)
//     uMaskView    float      1 = debug-tint the masked zone red
//   Mask (hand-drawn tier; beats the layout tier when present)
//     uMaskTex     sampler2D  hand-drawn mask, ALPHA channel = foil coverage
//     uMaskTexOn   float      1 = sample uMaskTex instead of the layout rect
//   Glyph slot (R3-GLYPH 2026-08-03; driven by CardViewer, never by sliders)
//     uGlyphTex    sampler2D  rasterized atlas of Chey's real glyph artwork
//                             (research/foil-glyphs/<slug>/ via foil/glyphs.ts);
//                             ALPHA = stamp coverage, RGB luminance = optional
//                             interior detail
//     uGlyphOn     float      1 = atlas loaded — recipes branch to glyphTex();
//                             0 (no assets / no dev api) = procedural fallback
//     uGlyphCount  float      number of glyphs in the atlas (1..16)
//     uGlyphCols   float      atlas grid columns (square grid)
//   Pattern params (recipe-owned; labelled sliders in the workbench)
//     uP0..uP5     float      meaning defined per recipe in patterns.ts
//                             (uP4/uP5 added R3-MISC 2026-08-03 for recipes
//                             that outgrew four params — e.g. gold-secret's
//                             per-card burst origin; old canon snapshots
//                             simply lack the keys and inherit code defaults)
//
// Blend model (R4b SCAN-ADDITIVE, 2026-08-04 — Chey's Grubbin ruling): a real
// card scan is a PHOTOGRAPH of the card at rest, so the base is already
// correct — R4's per-pixel ink heuristics repainted it (rest ΔC +32 with a
// green→yellow hue push on me05-002; header ΔL −22 under tilt; glyph contrast
// −26% under the lobe). On scans (uScanBase 1) the composite is now purely
// ADDITIVE dynamic light, three invariants BY CONSTRUCTION:
//   (a) rest parity (perceptual, R4c/R4d) — all added light is scaled by a
//       wide C1 tilt-onset ease (flash s^uOnsetCurve, specular s^(uOnsetCurve
//       +1) of a 0→uOnsetRange ramp, both canon-tunable) whose rest value is
//       a sub-JND floor (REST = 0.006, sheet-mean ≪1 ΔL): at rest the render
//       is visually the scan. R4d made the onset MOTION-FIRST: physical
//       gestures are ~0.005 tilt/px (pointer, 390px) and ~0.036 tilt/deg
//       (gyro), so a tiny drag lands at |tilt| 0.15–0.2 — the defaults
//       (0.5 / 3.5) keep added light near the rest floor there and let the
//       pattern PHASE (which tracks uTilt directly) carry the response;
//       brightness joins from ~0.25 and peaks unchanged (ramp = 1 at 0.5).
//   (b) adds, never subtracts — col = scan + light, light ≥ 0; uDarken is
//       inert on scans (the photograph already carries the substrate).
//   (c) text sacred — light is clamped to a luminance-headroom budget
//       0.75·smoothstep(.05,.40,L)·(1−L) (dark glyphs ≈ 0, whites ≈ 0) AND
//       per-channel to the pixel's distance-to-1 (no clip, no hue rotation).
//   Chroma preservation: light is tinted along the pixel's own hue
//   (dir², strength max(uTint, chroma ramp — pastel-safe, no floor cliff)),
//   and uInkPop pumps chroma along (scan − lum) — luminance-neutral, so
//   bands make colors MORE saturated, never washed.
// uScanBase 0 (canon-lab blank bases) runs the classic composite UNCHANGED —
// blank-card canon renders stay bit-identical; uInkGuard 0 (+ uInkPop 0)
// reproduces the pre-R4 screen-only model exactly on every surface. Card
// corners are rounded via a rounded-rect SDF.

import * as THREE from 'three'
import type { FoilPattern } from './patterns'
import layouts from './era-layouts.json'

export const CARD_ASPECT = layouts.cardAspect[1] / layouts.cardAspect[0] // h/w ≈ 1.3755

export const GLOBAL_DEFAULTS = {
  uIntensity: 1.0,
  uScale: 1.0,
  uHueShift: 0.5,
  uHueSpread: 0.5,
  uSat: 0.8,
  uArtGate: 0.0,
  uSpecular: 0.4,
  uDarken: 0.0,
  uTint: 0.0,
  uInkGuard: 1.0,
  uInkPop: 0.5,
  uOnsetRange: 0.5,
  uOnsetCurve: 3.5,
} as const

export type CoreUniform = keyof typeof GLOBAL_DEFAULTS
export type ParamUniform = 'uP0' | 'uP1' | 'uP2' | 'uP3' | 'uP4' | 'uP5'

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Shared preamble: constants, hash/noise, hue ramp, mask + card-corner SDFs.
const PREAMBLE = /* glsl */ `
precision highp float;
#define PI 3.14159265359
#define TAU 6.28318530718
#define CARD_ASPECT ${CARD_ASPECT.toFixed(5)}

varying vec2 vUv;
uniform sampler2D uFace;
uniform vec2 uTilt;
uniform float uTime;
uniform float uIntensity;
uniform float uScale;
uniform float uHueShift;
uniform float uHueSpread;
uniform float uSat;
uniform float uArtGate;
uniform float uSpecular;
uniform float uDarken;
uniform float uTint;
uniform float uInkGuard;
uniform float uInkPop;
uniform float uOnsetRange;
uniform float uOnsetCurve;
uniform float uScanBase;
uniform vec4 uMaskRect;
uniform float uMaskRadius;
uniform float uMaskFeather;
uniform float uMaskInvert;
uniform float uMaskView;
uniform sampler2D uMaskTex;
uniform float uMaskTexOn;
uniform sampler2D uGlyphTex;
uniform float uGlyphOn;
uniform float uGlyphCount;
uniform float uGlyphCols;
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;
uniform float uP5;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 17.17));
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fnoise(vec2 p) { // 3-octave fbm
  return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 5.2) + 0.2 * vnoise(p * 4.7 - 3.1);
}
// Iridescent cosine ramp (rainbow around t in 0..1), desaturated toward
// silver by uSat — real foil reads pastel-metallic, not primary-color.
vec3 hueRamp(float t) {
  vec3 c = 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.333, 0.667)));
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, uSat);
}
vec3 screenBlend(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// Mask from a UV-space rect (y up), radius/feather in width units.
float rectMask(vec2 uv, vec4 rect, float radius, float feather) {
  vec2 asp = vec2(1.0, CARD_ASPECT);
  vec2 c = (rect.xy + rect.zw * 0.5) * asp;
  vec2 hs = rect.zw * 0.5 * asp;
  float d = sdRoundRect(uv * asp - c, hs, radius);
  return smoothstep(feather, -feather, d);
}
// Rounded physical card corners → alpha.
float cardAlpha(vec2 uv) {
  vec2 asp = vec2(1.0, CARD_ASPECT);
  float d = sdRoundRect((uv - 0.5) * asp, 0.5 * asp, ${layouts.cornerRadius.toFixed(4)});
  return smoothstep(0.004, -0.004, d);
}
// Shared gloss: a broad white band sweeping across the face with tilt.
float sheen(vec2 uv, vec2 tilt) {
  float ph = uv.x * 0.9 + uv.y * 0.6 - (tilt.x * 1.1 + tilt.y * 0.8);
  return pow(max(0.0, cos(PI * clamp(ph, -1.0, 1.0))), 5.0);
}
// Glyph-slot sampler (R3-GLYPH): glyph idx (0..uGlyphCount-1) from the atlas
// at glyph-local p (y UP; the glyph box is |p| <= 0.5 — outside returns 0, so
// recipes may jitter/rotate/scale p freely). a = coverage, rgb = raw pixels
// (luminance carries optional interior detail). Guard against uGlyphOn == 0
// in the recipe — with no atlas this samples a 1x1 transparent texture.
// LinearFilter, no mips: safe inside non-uniform flow, no atlas-cell bleed.
vec4 glyphTex(float idx, vec2 p) {
  float inside = step(abs(p.x), 0.5) * step(abs(p.y), 0.5);
  float i = clamp(floor(idx + 0.5), 0.0, max(uGlyphCount - 1.0, 0.0));
  float col = mod(i, uGlyphCols);
  float row = floor(i / uGlyphCols);
  // y-up glyph local -> y-down atlas cell (texture flipY=false: v0 = canvas top)
  vec2 q = vec2(p.x + 0.5, 0.5 - p.y);
  return texture2D(uGlyphTex, (vec2(col, row) + q) / uGlyphCols) * inside;
}
`

const MAIN = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float a = cardAlpha(uv);
  if (a <= 0.001) discard;
  vec4 face = texture2D(uFace, uv);
  float m;
  if (uMaskTexOn > 0.5) {
    // Hand-drawn mask: alpha = coverage, absolute (no invert). The canvas is
    // drawn in image space (y down), so flip V.
    m = texture2D(uMaskTex, vec2(uv.x, 1.0 - uv.y)).a;
  } else {
    m = rectMask(uv, uMaskRect, uMaskRadius, uMaskFeather);
    m = mix(m, 1.0 - m, uMaskInvert);
  }
  // Luminance gate: holo sheet shows where the scan is dark (foil background),
  // printed ink stays readable. uArtGate = 0 disables (reverse sheets are light).
  float faceLum = dot(face.rgb, vec3(0.299, 0.587, 0.114));
  float gate = mix(1.0, smoothstep(0.82, 0.22, faceLum), uArtGate);
  // ── Ink-density estimate (R4-COMPOSITE 2026-08-03, Chey 7rtnzx + 19mo4l) ──
  // On a real card the printed ink sits ON TOP of / interleaved with the foil
  // layer: ink-dense pixels show the foil weakly and keep their own diffuse
  // color; the mirror/flash owns only the low-ink field. Two estimates, both
  // EXACTLY zero on any flat blank base (the canon lab's tones — including the
  // dark and slightly-tinted grays — measure 0 by construction):
  //   inkDark  — darker than the LOCAL 8-tap field average (text, linework,
  //              dark art detail). Relative: flat tone ⇒ avg == face ⇒ 0.
  //   inkColor — saturated printed color. Absolute chroma with a 0.12 floor
  //              (the lab's tinted grays peak at ~0.06).
  // uInkGuard scales both; 0 = the exact legacy composite.
  vec3 nb;
  {
    vec2 r1 = vec2(0.011, 0.011 / CARD_ASPECT);           // inner ring (diagonals)
    vec2 r2 = vec2(0.028, 0.028 / CARD_ASPECT);           // outer ring (cross)
    nb  = texture2D(uFace, uv + r1).rgb + texture2D(uFace, uv - r1).rgb
        + texture2D(uFace, uv + vec2(r1.x, -r1.y)).rgb + texture2D(uFace, uv - vec2(r1.x, -r1.y)).rgb;
    nb += texture2D(uFace, uv + vec2(r2.x, 0.0)).rgb + texture2D(uFace, uv - vec2(r2.x, 0.0)).rgb
        + texture2D(uFace, uv + vec2(0.0, r2.y)).rgb + texture2D(uFace, uv - vec2(0.0, r2.y)).rgb;
    nb *= 0.125;
  }
  float nbLum = dot(nb, vec3(0.299, 0.587, 0.114));
  float chroma = max(face.r, max(face.g, face.b)) - min(face.r, min(face.g, face.b));
  float inkDark = uInkGuard * smoothstep(0.045, 0.30, nbLum - faceLum);
  float inkColor = uInkGuard * smoothstep(0.12, 0.55, chroma) * (1.0 - inkDark);
  float inkBody = clamp(inkDark + 0.85 * inkColor, 0.0, 1.0);
  // Mirror-substrate darkening (uDarken, default 0 = exact legacy render):
  // real mirror foil is DARK at most angles — the layer reflects the (mostly
  // dark) environment instead of diffusing light, so the printed body seen
  // through the foil is attenuated across the SAME coverage field (m * gate)
  // the additive layer uses. R4: attenuation lives on the LOW-INK field only —
  // ink on top of the mirror diffuses normally, so printed color and text are
  // never muted by the substrate (Chey 19mo4l: "holofoils add pop, they
  // shouldn't ever diminish the colors of the actual ink").
  vec3 body = face.rgb * (1.0 - uDarken * m * gate * (1.0 - inkBody));
  // Foil flash: dark ink blocks it — screen-blending a bright flash over dark
  // text lifts it toward illegibility (Chey 7rtnzx: mirror "blows out the
  // darks/text"). Colored ink transmits it, tinted below.
  vec3 foil = foilPattern(uv, uTilt) * uIntensity * m * gate * (1.0 - inkDark);
  // Metallic ink tint (uTint, default 0 = exact legacy render): a mirror
  // foil's flash crosses the printed ink twice, so over colored art it takes
  // the ink's OWN color — screen-blending achromatic light instead compresses
  // chroma and reads dull/grayish (Chey, 2026-08-03, modern reverses). The
  // tint is the luminance-normalized scan chroma, squared for the double
  // pass; it is neutral (1,1,1) over silver/white, so blank-card canon-lab
  // appearance is untouched at ANY uTint. R4 generalizes the strength to
  // max(uTint, inkColor): saturated print always colors its own flash, even
  // in recipes that never opted into uTint. Applied over the same coverage
  // field (m * gate) as the foil layer, and to the shared specular within
  // the mask so the gloss goes art-metallic too instead of washing white.
  vec3 tint = face.rgb / max(faceLum, 0.06);
  tint /= max(max(tint.r, max(tint.g, tint.b)), 1.0); // chroma direction only, no gain
  vec3 inkTint = mix(vec3(1.0), tint * tint, max(uTint, inkColor) * m * gate);
  vec3 flash = clamp(foil, 0.0, 1.0) * inkTint;
  vec3 col = screenBlend(body, flash);
  // Metallic chroma pop (uInkPop): over colored ink the flash also pumps the
  // ink's own chroma — background colors read MORE saturated and metallic
  // under the flash, never washed out (the R4 invariant, both comments).
  float flashLum = dot(flash, vec3(0.299, 0.587, 0.114));
  col += (face.rgb - vec3(faceLum)) * (uInkPop * 1.25 * inkColor * flashLum);
  // Shared specular: shielded by dark ink (text stays crisp at every tilt
  // angle — a white sweep over a text box was the other half of 7rtnzx) and
  // ink-tinted like the flash.
  col += uSpecular * sheen(uv, uTilt) * (0.12 + 0.88 * m) * (1.0 - 0.85 * inkDark)
       * mix(vec3(1.0), tint * tint, max(uTint, inkColor) * m);
  // ── R4b scan-additive law (uScanBase 1: uFace is a real card scan) ──────
  // The scan already shows the card at rest; foil is additive dynamic light
  // ONLY. Engagement fades in with uInkGuard (saturating by 0.35 so canon
  // values like 0.81 run it fully); 0 keeps the legacy composite above.
  if (uScanBase > 0.5 && uInkGuard > 0.001) {
    // Tilt onset (R4c ease → R4d motion-first, 2026-08-04). R4c smoothed the
    // curve in SHADER-tilt units, but Chey gestures in PHYSICAL units: the
    // pointer map is ±1 across the viewer (0.0051 tilt/px on a 390px phone)
    // and gyro is Δ°/28 (0.036 tilt/deg), so a 30px thumb drag or a 5° wrist
    // tip lands at |tilt| 0.15–0.18 — where R4c's s^1.5 already delivered
    // HALF its full glow (measured 9.0 of 17.9 ΔL; Chey: "It still lights up
    // pretty noticeably when I tilt the card a tiny bit"). R4d: a tiny tilt
    // reads as MOVEMENT of the existing sheen — the pattern phase and the
    // specular band position track uTilt directly and proportionally, as
    // they always did — while added BRIGHTNESS arrives much later, as a
    // steeper power of the same wide C1 ramp. Both knobs are canon-stored
    // sliders on both workbench surfaces:
    //   uOnsetRange — |tilt| at which glow reaches full (default 0.5, so
    //                 every tilt-0.5 peak metric is unchanged: ramp = 1);
    //   uOnsetCurve — flash exponent, eager (1) → lazy (6), default 3.5;
    //                 the broad specular gloss trails at +1, latest of all.
    //   (0.45 / 1.5 reproduces R4c exactly; R4b was ~a step at 0.03–0.12.)
    // REST: the faint living sheen floor (sub-JND, blended not max'd so the
    // curve stays smooth) — the foil exists at rest, so a tiny tilt shows
    // its phase MOVING instead of a brightness step. Rest render stays
    // visually the scan (R4b's vibrancy win; the clamp still starves glyphs
    // at any gate).
    const float REST = 0.006;
    // (pow guard: GLSL pow(0, y) is driver-dependent — clamp the base away
    // from 0 so the rest frame can never go NaN on the V3D driver.)
    float ramp = max(smoothstep(0.0, max(uOnsetRange, 0.05), length(uTilt)), 1e-4);
    float flashGate = REST + (1.0 - REST) * pow(ramp, uOnsetCurve);
    float specGate = REST + (1.0 - REST) * pow(ramp, uOnsetCurve + 1.0);
    // Raw dynamic light: the pattern's emission over its coverage field plus
    // the shared specular sweep (0.12 base = whole-card paper gloss).
    vec3 rawFlash = clamp(foilPattern(uv, uTilt), 0.0, 1.0) * uIntensity * m * gate * flashGate;
    vec3 rawLight = rawFlash + vec3(uSpecular * sheen(uv, uTilt) * (0.12 + 0.88 * m)) * specGate;
    // Chroma-preserving tint: light rides the pixel's own hue direction
    // (double ink pass ⇒ dir²). Pastel-safe ramp — no 0.12 chroma cliff.
    float inkChroma = smoothstep(0.02, 0.45, chroma);
    vec3 lightCol = rawLight * mix(vec3(1.0), tint * tint, clamp(max(uTint, inkChroma), 0.0, 1.0));
    // Hard luminance-headroom clamp, two channels:
    //   ink model — shape L⁴·(1−L): peaks at light paper tones (L≈0.8)
    //   where foil physically shows, and starves ink. Glyphs on modern
    //   cards are MID-dark (L 0.35–0.45), so a gentle ramp lights them
    //   (measured: text contrast 55→15 with smoothstep(.05,.40)); the
    //   quartic keeps a 4–6× paper/glyph ratio at every angle. Whites get
    //   (1−L)≈0 — never blown out.
    //   art-gated foil — recipes with uArtGate declare that DARK scan
    //   areas ARE the foil (WOTC holo backgrounds): those pixels are
    //   dark-because-mirror, not dark-because-ink, and they flash. Uses
    //   the gate's own dark-smoothstep; 0 for every non-gated recipe, and
    //   text sits outside the window mask on gated cards anyway.
    // Then a per-channel cap so no channel clips (clipping is what rotated
    // green toward yellow in R4). One scalar scale keeps the light's hue.
    float darkFoil = smoothstep(0.82, 0.22, faceLum);
    float allow = max(1.6 * pow(faceLum, 4.0) * (1.0 - faceLum),
                      1.4 * uArtGate * darkFoil * (1.0 - faceLum));
    float s = min(1.0, allow / max(dot(lightCol, vec3(0.299, 0.587, 0.114)), 1e-4));
    s = min(s, (1.0 - face.r) / max(lightCol.r, 1e-4));
    s = min(s, (1.0 - face.g) / max(lightCol.g, 1e-4));
    s = min(s, (1.0 - face.b) / max(lightCol.b, 1e-4));
    vec3 scanCol = face.rgb + lightCol * s;
    // Saturation shimmer: bands pump colored print along its own hue — a
    // pure chroma term (Rec.601-neutral), driven by the pattern flash only
    // (m-scoped: the unfoiled window never shifts) and gated by the same
    // steep luminance curve so glyph ink never re-hues toward the paper.
    float drive = clamp(2.0 * dot(rawFlash, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    scanCol += (face.rgb - vec3(faceLum)) * (uInkPop * 0.5 * inkChroma * drive * faceLum * faceLum);
    col = mix(col, clamp(scanCol, 0.0, 1.0), smoothstep(0.0, 0.35, clamp(uInkGuard, 0.0, 1.0)));
  }
  if (uMaskView > 0.5) col = mix(col, vec3(1.0, 0.15, 0.2), 0.40 * m);
  gl_FragColor = vec4(col, a);
}
`

// 1×1 opaque white fallback so uMaskTex is always a valid sampler.
let white: THREE.DataTexture | null = null
function whiteTexture(): THREE.DataTexture {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    white.needsUpdate = true
  }
  return white
}

// 1×1 transparent fallback so uGlyphTex is always a valid sampler (uGlyphOn=0).
let transparent: THREE.DataTexture | null = null
export function transparentTexture(): THREE.DataTexture {
  if (!transparent) {
    transparent = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
    transparent.needsUpdate = true
  }
  return transparent
}

export function buildFoilMaterial(pattern: FoilPattern): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    uFace: { value: null },
    uTilt: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uIntensity: { value: GLOBAL_DEFAULTS.uIntensity },
    uScale: { value: GLOBAL_DEFAULTS.uScale },
    uHueShift: { value: GLOBAL_DEFAULTS.uHueShift },
    uHueSpread: { value: GLOBAL_DEFAULTS.uHueSpread },
    uSat: { value: GLOBAL_DEFAULTS.uSat },
    uArtGate: { value: GLOBAL_DEFAULTS.uArtGate },
    uSpecular: { value: GLOBAL_DEFAULTS.uSpecular },
    uDarken: { value: GLOBAL_DEFAULTS.uDarken },
    uTint: { value: GLOBAL_DEFAULTS.uTint },
    uInkGuard: { value: GLOBAL_DEFAULTS.uInkGuard },
    uInkPop: { value: GLOBAL_DEFAULTS.uInkPop },
    uOnsetRange: { value: GLOBAL_DEFAULTS.uOnsetRange },
    uOnsetCurve: { value: GLOBAL_DEFAULTS.uOnsetCurve },
    uScanBase: { value: 1 }, // surface-owned: CanonLab's blank render sets 0

    uMaskRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMaskRadius: { value: 0.01 },
    uMaskFeather: { value: 0.008 },
    uMaskInvert: { value: 0 },
    uMaskView: { value: 0 },
    uMaskTex: { value: whiteTexture() },
    uMaskTexOn: { value: 0 },
    uGlyphTex: { value: transparentTexture() },
    uGlyphOn: { value: 0 },
    uGlyphCount: { value: 0 },
    uGlyphCols: { value: 1 },
    uP0: { value: 0 },
    uP1: { value: 0 },
    uP2: { value: 0 },
    uP3: { value: 0 },
    uP4: { value: 0 },
    uP5: { value: 0 },
  }
  for (const [k, v] of Object.entries(pattern.defaults)) uniforms[k].value = v
  for (const p of pattern.params) uniforms[p.key].value = p.default

  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: PREAMBLE + pattern.glsl + MAIN,
    uniforms,
    transparent: true,
  })
}
