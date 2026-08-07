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
//                             METALLIC law (R5) — chroma-preserving light,
//                             hard-clamped to each pixel's luminance headroom
//                             (dark ink gets almost none — text can never
//                             blow out, by construction). Engagement
//                             saturates by 0.35 so mid-range canon values run
//                             the safe law fully. Inert when uScanBase is 0.
//     uInkPop      float      metallic chroma pop (R4b; 0 = none): under the
//                             flash, colored print gains SATURATION along its
//                             own hue (a pure chroma pump, luminance-neutral
//                             by construction) — bands make colors shimmer
//                             more vivid, never washed. Scan path only.
//   Scan-path compositing dials (R5 2026-08-05, made PER-RECIPE in R5b
//   2026-08-07 — Chey: "You applied the metallic treatment to EVERY HOLO
//   PATTERN when I only wanted it for mirror". No tilt gate on either law:
//   the R4c/R4d onset machinery is REMOVED; uOnsetRange/uOnsetCurve keys in
//   old canon/override files are inert — CardViewer skips unknown keys.)
//     uMetal       float      THE LAW SELECTOR, and the master print→metal
//                             conversion. 0 (the global default, so nothing
//                             inherits metalness) = the ADDITIVE law: the
//                             pattern's own colored light over its own
//                             substrate. >0 = the R5 METALNESS law: the scan
//                             is the ALBEDO and the foil trades diffuse print
//                             for tinted specular, scaling highlight AND
//                             depth. Opted into per recipe — mirror only.
//     uSheen       float      pattern-light gain in BOTH laws: how much of the
//                             pattern layer's caught light shows (0..2).
//                             1 = the pattern at its authored strength.
//     uSheenTint   float      how far the flash takes the INK's color rather
//                             than the foil's own. Additive law: 0 = the
//                             recipe's declared uTint only (a rainbow pattern
//                             stays rainbow over any art), 1 = the R4
//                             automatic law max(uTint, ink chroma). Metalness
//                             law: 0 = foil's own color, 0.5 = that R4 law
//                             exactly, 1 = fully ink-colored highlights.
//     uDepth       float      how dark the foil substrate reads ON A CARD
//                             SCAN (uDarken stays the blank-canon substrate
//                             and is untouched). Metalness: energy-conserving
//                             darkening where the pattern turns AWAY from the
//                             light — contrast, not luminance lift, is what
//                             makes metal read as metal. Additive: a flat
//                             attenuation of the foiled, ink-free field
//                             (0 = pure R4b additive, nothing darkens).
//     uGrain       float      metalness only — how much of the pattern's
//                             spatial structure perturbs the surface:
//                             1 = full structure, 0 = a uniform sheen at the
//                             neutral-metal level.
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
// Blend model (R5b PER-RECIPE, 2026-08-07). R5 (2026-08-05) answered Chey's
// always-on ruling with a metalness law — and shipped its dials as GLOBAL
// defaults, so every recipe got it. His correction: "You applied the metallic
// treatment to EVERY HOLO PATTERN when I only wanted it for mirror. So now,
// every single holo pattern looks like mirror and you can barely see the
// pattern at all, it's like every single one is being applied in a way that it
// adds no rainbow color or anything to the card."
// So the scan-path law is now chosen PER RECIPE by uMetal, defaulting OFF:
//   uMetal > 0  METALNESS (mirror family only, opted in from patterns.ts):
//     the scan is the ALBEDO of a printed sheet and uMetal converts printed
//     ink into colored metal — diffuse energy trades into tinted specular.
//     The pattern layer decides WHERE the metal catches light: above its
//     neutral level it flashes (uSheen, coloured by uSheenTint along the
//     pixel's own hue); below it the mirror substrate turns away and reads
//     DARKER than diffuse paper (uDepth). The metallic read is contrast +
//     chroma, not luminance lift.
//   uMetal == 0  ADDITIVE (everything else): the pattern's OWN colored light,
//     at full authored strength (uSheen gain), added over the recipe's own
//     mirror substrate (uDarken × uDepth). Tinted toward the ink only as far
//     as the recipe's declared uTint asks — rainbow patterns stay rainbow over
//     colored artwork, which is exactly the character R5 erased.
// On scans the R4c/R4d tilt-onset gate is GONE under both laws — the foil
// layer exists at rest and tilt moves the pattern PHASE (recipes read uTilt
// directly), so the resting sheen sweeps continuously; nothing gates its
// existence.
// Invariants BY CONSTRUCTION:
//   (a) plain print recoverable — uIntensity 0 (or uInkGuard 0 → the legacy
//       composite, or uMetal 0 with an empty pattern) renders exactly the scan.
//   (b) text sacred — added light is clamped to a luminance-headroom budget
//       max(1.6·L⁴·(1−L), art-gate channel) AND per-channel to the pixel's
//       distance-to-1 (no clip, no hue rotation); glyph-dark pixels (inkDark)
//       are exempt from the flash and from every substrate term — printed
//       glyph ink sits on top of the foil and stays matte-dark and crisp.
//   (c) chroma preserved — light rides its own hue (the pattern's under the
//       additive law; the pixel's, dir² and uSheenTint-blended, under
//       metalness), uInkPop pumps chroma luminance-neutrally, and every
//       substrate darkening is multiplicative (hue-safe, saturation-raising).
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
  // R5b: the ADDITIVE-law baseline every non-mirror recipe runs on.
  //   uMetal 0     load-bearing — metalness is opt-in per recipe
  //                (patterns.ts), so nothing can silently inherit the mirror
  //                treatment again.
  //   uSheen 1.4   on-card gain for the pattern's own light. 1.0 is the
  //                authored (blank-canon) strength; the soft-knee text budget
  //                costs roughly a third of it on a real scan, so 1.4 lands
  //                the pattern back where its canon was tuned.
  //   uSheenTint   how far the flash takes the printed ink's colour. 0.5 =
  //     0.5        half the R4 automatic law: inert on neutral/pale areas so
  //                the pattern keeps its own spectrum where it shows, engaged
  //                over saturated print so a coloured wash brightens the ink
  //                instead of repainting its hue.
  //   uDepth 0.22  the SCAN substrate — how much darker the foiled field reads
  //                than plain cardstock. Independent of uDarken (that one is
  //                the blank-canon substrate and is frozen by saved canon).
  uMetal: 0.0,
  uSheen: 1.4,
  uSheenTint: 0.5,
  uDepth: 0.22,
  uGrain: 1.0,
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
uniform float uMetal;
uniform float uSheen;
uniform float uSheenTint;
uniform float uDepth;
uniform float uGrain;
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
  // ── Scan-path foil composite (uScanBase 1: uFace is a real card scan) ───
  // R5b 2026-08-07 — Chey, after R5 shipped its metalness dials as GLOBAL
  // defaults: "You applied the metallic treatment to EVERY HOLO PATTERN when
  // I only wanted it for mirror. So now, every single holo pattern looks like
  // mirror and you can barely see the pattern at all, it's like every single
  // one is being applied in a way that it adds no rainbow color or anything
  // to the card." The law is now chosen PER RECIPE by uMetal, and metalness
  // is OFF by default (GLOBAL_DEFAULTS.uMetal = 0) so no recipe can inherit
  // it — only the mirror family opts in, in its own patterns.ts defaults.
  //
  //   uMetal > 0  — R5 METALNESS (mirror family only). The scan is the
  //     ALBEDO of a printed sheet and the foil converts printed ink into
  //     colored metal. The pattern field (the exact layer the blank-card
  //     canon lab locks) says where the metal catches light, split around a
  //     neutral level PIVOT:
  //       above → HIGHLIGHT: tinted specular (metal reflects its own color),
  //               uSheen gain, uSheenTint color, headroom-clamped;
  //       below → DEPTH: the mirror substrate turns away and reflects a dark
  //               room — multiplicatively darker than diffuse paper. Energy
  //               redistributes; contrast and chroma carry the metallic read,
  //               not luminance lift.
  //     uMetal is the master diffuse→metal conversion scaling BOTH directions.
  //
  //   uMetal == 0 — ADDITIVE FOIL LIGHT, the pattern's OWN color (every other
  //     recipe; the pre-R5 chroma character restored). The pattern's emission
  //     is added as dynamic light over the recipe's own mirror substrate
  //     (uDarken × uDepth — saturated foil over a bright card body is
  //     unrenderable purely additively; that is the R2/R3 legibility finding,
  //     five separate data points). The flash is tinted toward the ink ONLY as
  //     far as the recipe's own uTint asks, so cosmos stays rainbow, cracked
  //     ice stays spectral, glitter stays full-spectrum over any artwork.
  //
  // Both laws share: always-on (the R4c/R4d onset ramp is gone — tilt moves
  // the pattern PHASE, nothing gates the layer's existence), the soft-knee
  // luminance-headroom budget, the per-channel no-clip cap, and glyph-ink
  // exemption. uMetal 0 + uIntensity 0, or uInkGuard 0 (→ legacy composite),
  // still yield exactly the plain scan. Engagement fades in with uInkGuard
  // (saturating by 0.35 so canon values like 0.81 run it fully).
  if (uScanBase > 0.5 && uInkGuard > 0.001) {
    float cov = m * gate;              // the card's foil coverage field
    float inkFree = 1.0 - inkDark;     // glyph ink is ON TOP of the foil: matte, sacred
    float inkChroma = smoothstep(0.02, 0.45, chroma);
    float darkFoil = smoothstep(0.82, 0.22, faceLum);
    vec3 body;
    vec3 rawLight;
    float tintW;
    float popDrive;
    float allowOverride = -1.0;   // >= 0: the additive law's own budget
    if (uMetal > 0.001) {
    // The pattern field, gained by canon intensity. uGrain: full spatial
    // structure (1) … a uniform sheen at the neutral-metal level (0).
    const float PIVOT = 0.40;
    vec3 patC = clamp(foilPattern(uv, uTilt), 0.0, 1.5) * uIntensity;
    patC = mix(vec3(PIVOT), patC, clamp(uGrain, 0.0, 1.0));
    float patLum = dot(patC, vec3(0.299, 0.587, 0.114));

    // DEPTH — energy-conserving darkening where the pattern turns away from
    // the light. Bounded (≤32% at full sliders), multiplicative (hue-safe),
    // starved on already-dark art (nothing to trade) and on glyph ink.
    // CONCAVE in turn (sqrt): partial turns — the shoulders of a structured
    // field — dig almost as deep as a fully-dark field, so recipes that rest
    // near zero (SV emblem sheets) don't read "uniformly dimmed" relative to
    // recipes with broad rest lobes (mirror) reading balanced.
    // Gated on uIntensity: "uIntensity 0 = plain scan" is a contract (the
    // none-pattern emits nothing — an all-zero field must not read as
    // "all turned away" and darken the card).
    float turn = sqrt(clamp((PIVOT - patLum) / PIVOT, 0.0, 1.0));
    float shade = uMetal * uDepth * cov * inkFree * turn
                * smoothstep(0.10, 0.45, faceLum) * smoothstep(0.0, 0.25, uIntensity);
    body = face.rgb * (1.0 - 0.32 * shade);

    // HIGHLIGHT — the traded energy returns as tinted specular where the
    // metal catches light (vector positive part: rainbow patterns keep their
    // own color), plus the shared specular sweep (0.12 base = whole-card
    // paper gloss). Both scaled by the master conversion.
    vec3 hiRaw = max(patC - PIVOT, 0.0) * (1.0 / (1.0 - PIVOT)) * uSheen * cov * inkFree;
    rawLight = (hiRaw + vec3(uSpecular * sheen(uv, uTilt) * (0.12 + 0.88 * m))) * uMetal;
    // SHEEN TINT — metal reflects its own color (double ink pass ⇒ dir²).
    // 0 = the foil's own color; 0.5 = the R4 chroma-preserving law
    // max(uTint, ink chroma) exactly; 1 = fully ink-colored highlights.
    tintW = clamp(max(uTint, inkChroma) * 2.0 * uSheenTint, 0.0, 1.0);
    popDrive = clamp(2.0 * dot(hiRaw * uMetal, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    } else {
      // ── ADDITIVE FOIL LIGHT (uMetal 0 — every non-mirror recipe) ────────
      // The pattern's own emission, at full strength, over the recipe's own
      // substrate. No PIVOT subtraction (which ate the field), no metalness
      // conversion factor, no automatic ink-chroma hijack of the flash color.
      vec3 pat = clamp(foilPattern(uv, uTilt), 0.0, 1.0) * uIntensity;
      // SUBSTRATE. A holo sheet reads DARKER between flashes than plain
      // cardstock, and only a dark base lets a saturated flash read saturated
      // rather than pastel (R2/R3's five legibility data points). uDepth is
      // the SCAN substrate, deliberately INDEPENDENT of uDarken: uDarken is
      // the blank-canon substrate, frozen by 30 saved canon files, and it is
      // exactly 0 on the recipes that need this most — the pale modern reverse
      // sheets (energy-symbols-ii is the catalog's single biggest bucket at
      // 5413 printings and measured 0.7% coloured pixels with no substrate).
      // Ink is exempt: "holofoils add pop, they shouldn't ever diminish the
      // colors of the actual ink" (Chey 19mo4l).
      // The substrate follows the pattern's OWN dark half — it deepens BETWEEN
      // the flashes and stays put under them. A flat attenuation instead reads
      // as "someone dimmed this card" and, worse, compresses the text box
      // toward its ink: measured on the xy1-85 reverse (foil covers the body,
      // text included) a flat 0.34 cost mean ΔL −21.7 and 29% of the text
      // region's contrast. Following the pattern turns the same budget into
      // CONTRAST, which is what makes a sheet read as foil in the first place.
      // Gated on uIntensity for the same reason the metalness depth is:
      // "uIntensity 0 = plain scan" is a contract, and the none-pattern must
      // never darken the card just by being selected.
      float darkHalf = 1.0 - smoothstep(0.0, 0.38, dot(pat, vec3(0.299, 0.587, 0.114)));
      body = face.rgb * (1.0 - uDepth * cov * (1.0 - inkBody) * darkHalf
                              * smoothstep(0.0, 0.25, uIntensity));
      vec3 hi = pat * uSheen * cov * inkFree;
      rawLight = hi + vec3(uSpecular * sheen(uv, uTilt) * (0.12 + 0.88 * m));
      // FLASH COLOR. uSheenTint blends the recipe's declared uTint (0 = the
      // pattern's OWN colour, whatever the art underneath) toward the R4
      // automatic law max(uTint, ink chroma). The automatic term is inert on
      // neutral and pale areas — where inkChroma ≈ 0 — so a rainbow recipe
      // keeps its full spectrum exactly where Chey looks for it, and engages
      // only over SATURATED print, where an untinted coloured wash does not
      // read as foil at all but as a repaint (measured: rainbow-glitter turned
      // Shaymin's red petal magenta at rest and brown under tilt; prism
      // checkerboarded a blue Team Aqua full-art). Half-strength by default is
      // the honest middle: the flash brightens the ink along the ink's own hue
      // while still carrying its own colour.
      tintW = clamp(mix(uTint, max(uTint, inkChroma), clamp(uSheenTint, 0.0, 1.0)), 0.0, 1.0);
      popDrive = clamp(2.0 * dot(hi, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
      // HEADROOM, additive law. The metalness budget below is shaped
      // 1.6·L⁴·(1−L) — a curve designed to starve MID-DARK glyph ink (L
      // 0.35–0.45) as a second line of defence behind inkFree. Applied to a
      // structured pattern it starves the card instead: at L 0.5 (ordinary
      // artwork, ordinary card body) it allows ΔL ≈ 13/255 against the classic
      // composite's ~128, which is precisely "you can barely see the pattern
      // at all". Here inkFree has ALREADY zeroed the flash on glyph ink, so
      // the budget's only remaining job is no-blowout: spend a fixed fraction
      // of each pixel's distance to white (0.62 ≈ a little under the screen
      // blend's own limit, so every recipe keeps its authored relative
      // strength and nothing clips), still starved on ink as a backstop.
      // Scaled by uSheen so the dial stays MONOTONE. The knee saturates: once
      // the raw light passes the budget the output is the budget, and halving
      // uSheen changed prism by 8% and ex-starfoil by 1% (measured). Tying the
      // ceiling to the gain makes "Sheen strength" mean what its label says
      // across the whole range instead of only at the quiet end. 1.6 is the
      // PARTICLE_FOIL reference, so that family is unscaled.
      allowOverride = 0.62 * (1.0 - faceLum) * (0.25 + 0.75 * inkFree)
                    * clamp(uSheen / 1.6, 0.0, 1.25);
    }
    vec3 lightCol = rawLight * mix(vec3(1.0), tint * tint, tintW);
    // Hard luminance-headroom clamp, two channels (unchanged from R4b — the
    // proven text guarantee):
    //   ink model — shape L⁴·(1−L): peaks at light paper tones (L≈0.8)
    //   where foil physically shows, and starves ink. Glyphs on modern
    //   cards are MID-dark (L 0.35–0.45); the quartic keeps a 4–6×
    //   paper/glyph ratio at every angle. Whites get (1−L)≈0 — never blown.
    //   art-gated foil — recipes with uArtGate declare that DARK scan areas
    //   ARE the foil (WOTC holo backgrounds): those pixels are
    //   dark-because-mirror, not dark-because-ink, and they flash.
    // The budget is applied as a COMPRESSIVE soft knee, not a hard min —
    // a hard clamp plateaus every strong-light pixel at the same value and
    // flattens the pattern's structure into a uniform wash (measured on the
    // Grubbin mirror rest field: text-box ΔL pinned at the budget at every
    // tilt = "someone brightened this area"). The knee compresses
    // monotonically toward the budget instead, so relative structure — the
    // metallic texture — survives arbitrarily strong fields. Then a
    // per-channel hard cap so no channel clips (clipping is what rotated
    // green toward yellow in R4). One scalar scale keeps the light's hue.
    // Headroom is measured against the SUBSTRATE-darkened body — the darks
    // the sheet digs are headroom the flashes may spend (redistribution).
    float allow = max(1.6 * pow(faceLum, 4.0) * (1.0 - faceLum),
                      1.4 * uArtGate * darkFoil * (1.0 - faceLum));
    if (allowOverride >= 0.0) allow = max(allow, allowOverride);
    float ll = dot(lightCol, vec3(0.299, 0.587, 0.114));
    float s = ll > 1e-4 ? min(1.0, allow * (1.0 - exp(-ll / max(allow, 1e-4))) / ll) : 1.0;
    vec3 scanCol;
    if (allowOverride >= 0.0) {
      // ADDITIVE LAW — per-channel screen headroom. The scalar no-clip cap
      // (metalness branch below) scales ALL three channels by the tightest
      // single-channel ratio, so whichever channel of the ARTWORK happens to
      // be brightest throttles the entire flash: over saturated art a rainbow
      // pattern collapses to a whisper. That is the mechanism behind "you can
      // barely see the pattern at all ... it adds no rainbow color". Screen
      // combines per channel, cannot clip by construction, and is the exact
      // composite every non-mirror recipe was authored and judged against.
      // The soft knee above still applies first, so the text budget holds.
      scanCol = screenBlend(body, clamp(lightCol * s, 0.0, 1.0));
    } else {
      s = min(s, (1.0 - body.r) / max(lightCol.r, 1e-4));
      s = min(s, (1.0 - body.g) / max(lightCol.g, 1e-4));
      s = min(s, (1.0 - body.b) / max(lightCol.b, 1e-4));
      scanCol = body + lightCol * s;
    }
    // Saturation shimmer: the highlight pumps colored print along its own
    // hue — a pure chroma term (Rec.601-neutral), m-scoped (the unfoiled
    // window never shifts) and gated by the steep luminance curve so glyph
    // ink never re-hues toward the paper.
    scanCol += (face.rgb - vec3(faceLum)) * (uInkPop * 0.5 * inkChroma * popDrive * faceLum * faceLum);
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
    uMetal: { value: GLOBAL_DEFAULTS.uMetal },
    uSheen: { value: GLOBAL_DEFAULTS.uSheen },
    uSheenTint: { value: GLOBAL_DEFAULTS.uSheenTint },
    uDepth: { value: GLOBAL_DEFAULTS.uDepth },
    uGrain: { value: GLOBAL_DEFAULTS.uGrain },
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
