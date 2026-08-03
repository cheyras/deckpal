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
//     uP0..uP3     float      meaning defined per recipe in patterns.ts
//
// Blend model: body = scan * (1 - uDarken * mask * gate) — the substrate seen
// through the mirror layer — then foil = foilPattern(uv, tilt) * mask * gate *
// uIntensity screen-blended over it, plus a shared specular sweep. uDarken
// defaults to 0, which reproduces the original screen-only model exactly.
// Card corners are rounded via alpha from a rounded-rect SDF.

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
} as const

export type CoreUniform = keyof typeof GLOBAL_DEFAULTS
export type ParamUniform = 'uP0' | 'uP1' | 'uP2' | 'uP3'

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
  // Mirror-substrate darkening (uDarken, default 0 = exact legacy render):
  // real mirror foil is DARK at most angles — the layer reflects the (mostly
  // dark) environment instead of diffusing light, so the printed body seen
  // through the foil is attenuated across the SAME coverage field (m * gate)
  // the additive layer uses. The pattern's flash screen-blends back on top.
  vec3 body = face.rgb * (1.0 - uDarken * m * gate);
  vec3 foil = foilPattern(uv, uTilt) * uIntensity * m * gate;
  vec3 col = screenBlend(body, clamp(foil, 0.0, 1.0));
  col += uSpecular * sheen(uv, uTilt) * (0.12 + 0.88 * m);
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
