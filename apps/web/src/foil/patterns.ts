// foil/patterns.ts — the pattern library: the FULL 39-type holofoil taxonomy
// (research/foil-patterns.md — canonical, reconciled from the Sleeve No Card
// Behind video + Bulbapedia + the vision pass), each type rendered by one of
// the implemented shader recipes. Types whose physical process has a faithful
// recipe are `implemented: true`; every other type renders via its NEAREST
// implemented recipe and says so (`approxVia`) — taxonomy leads, honest
// fallback labeling follows. Adding a real recipe = writing its GLSL and
// flipping the types it faithfully models to implemented.
//
// Each recipe supplies a GLSL function body:
//   vec3 foilPattern(vec2 uv, vec2 tilt)
// uv is card UV (0..1, y UP), tilt is uTilt (-1..1). The function may read
// any core uniform (uScale, uHueShift, uHueSpread, uTime) plus the four
// per-pattern params uP0..uP3 — sliders in the workbench take their label,
// range, and default from `params`. Return value is the foil light layer
// (linear-ish RGB, 0..~1.5), later masked, gained by uIntensity, and
// screen-blended over the scan by the shared fragment main().
//
// Implemented recipe families:
//   starlight    — parallax star layers (#1 Starlight; #24 Starlight II at parallax 0)
//   cosmos       — staggered disc "bubbles" (#2 Cosmos; coarse for #15/#16)
//   sheen        — linear-grating band foil, ONE generator at four rotations +
//                  an optional stripe texture (#14 vertical, #21 horizontal =
//                  the TRUE SV default, #19/#20 diagonals, #22 striped/Line).
//                  research/foil-patterns.md: the sheen family is one physical
//                  sheet mounted at different rotations.
//   reverse-sheet— mirror sheet + stamped emblem grid (≈ #30 pokeball-masterball)
//   cracked-ice  — voronoi facet activation (#9; machinery seeds glitter/facet types)

export interface PatternParam {
  /** Which uniform this slider drives: 'uP0' | 'uP1' | 'uP2' | 'uP3'. */
  key: 'uP0' | 'uP1' | 'uP2' | 'uP3'
  label: string
  min: number
  max: number
  step: number
  default: number
}

type CoreDefaults = Partial<
  Record<
    'uIntensity' | 'uScale' | 'uHueShift' | 'uHueSpread' | 'uSat' | 'uArtGate' | 'uSpecular',
    number
  >
>

export interface FoilPattern {
  id: string
  label: string
  /** Canonical taxonomy name (video + Bulbapedia) this entry models. */
  taxonomy: string
  /** Human note: which physical printings use this process. */
  usedOn: string
  /** GLSL body defining `vec3 foilPattern(vec2 uv, vec2 tilt)`. */
  glsl: string
  /** Core-uniform defaults this recipe tunes away from the global defaults. */
  defaults: CoreDefaults
  params: PatternParam[]
  /** True when the recipe faithfully models this physical process. */
  implemented: boolean
  /** For unimplemented types: label of the implemented recipe standing in. */
  approxVia?: string
}

// ── Slug migration (MIGRATION DISCIPLINE — never orphan corpus data) ────────
// Old ids keep resolving forever: saved-mask sidecars, workbench-comment
// context.json files, Copy-recipe JSON snippets, and localStorage prefs may
// all reference them. Never repurpose an old id for a different pattern.
//   sv-holo → vertical-sheen  (2026-08-02: the recipe always rendered vertical
//   bands — that is the Platinum/HGSS→XY default, NOT the SV default; SV's
//   default holo is the HORIZONTAL sheen. See research/foil-patterns.md
//   "Library mislabel corrections".)
export const PATTERN_ALIASES: Record<string, string> = {
  'sv-holo': 'vertical-sheen',
}

export const canonicalPatternId = (id: string): string => PATTERN_ALIASES[id] ?? id

// ── Recipe GLSL bodies ──────────────────────────────────────────────────────

// R0 re-tune 2026-08-02 (Chey's ruling: chase Gemini's notes INTO the
// parallax rework, don't revert it). The 3-layer opposing-parallax
// architecture + glyph/blur population mix are untouched; what changed:
// tighter visibility lobe (pow 5 -> 9, floor 0.18 -> 0.08) so stars POP with
// a narrow activation window instead of breathing lazily; sharper glyph
// cores + narrower flare arms; blobs shrunk so even soft stars stay small;
// star color much more saturated (mix toward hueRamp 0.4 -> 0.72+); the
// galaxy wash default halved — the reference field is near-black between
// stars, the wash was reading as a continuous pastel noise field.
const STARLIGHT_GLSL = `
vec3 starLayer(vec2 uv, float scale, float seed, vec2 par, float softBias, float sweep) {
  vec2 p = (uv + par) * vec2(1.0, CARD_ASPECT) * scale;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  vec2 rnd = hash22(id + seed);
  // not every cell holds a star — culling breaks the grid feel and keeps the
  // field a constellation of individuals, not confetti mottle
  float exists = step(rnd.x, 0.62);
  vec2 sp = f - (rnd - 0.5) * 0.6;
  float d = length(sp);
  float phase = fract(rnd.x * 7.13 + rnd.y * 3.71 + seed * 0.173);
  // tight angular lobe over a small floor: stars pop hard near their phase
  // peak but never binary-blink (the floor keeps a faint presence so the
  // parallax shift stays readable between pops)
  float vis = 0.08 + 0.92 * pow(0.5 + 0.5 * cos(TAU * phase + sweep * 2.6), 9.0);
  // population mix: glyph-crisp vs blurry, biased per layer, varied per star
  float soft = clamp(softBias + (rnd.y - 0.5) * 0.55, 0.0, 1.0);
  float core = smoothstep(0.09, 0.02, d);
  float flare = pow(max(0.0, 1.0 - abs(sp.x) * 12.0), 3.0) * pow(max(0.0, 1.0 - abs(sp.y) * 4.5), 3.0)
              + pow(max(0.0, 1.0 - abs(sp.y) * 12.0), 3.0) * pow(max(0.0, 1.0 - abs(sp.x) * 4.5), 3.0);
  float glyph = core + flare * 0.85;
  float blob = 0.85 * exp(-d * d * 24.0);
  float shape = mix(glyph, blob, soft);
  // saturated discrete flashes — near-full hueRamp color, metallic not pastel
  vec3 col = mix(vec3(1.0), hueRamp(rnd.y + 0.3 * sweep + seed * 0.21), 0.72 + 0.22 * soft);
  return exists * shape * vis * col;
}

vec3 foilPattern(vec2 uv, vec2 tilt) {
  float sweep = tilt.x * 0.8 + tilt.y * 0.55;
  // rainbow wash — large-scale warped hue field under the stars
  vec2 wp = uv * 3.2 * uScale;
  float n = fnoise(wp + tilt * 1.4);
  float n2 = fnoise(wp * 2.3 - tilt * 0.9 + 7.31);
  vec3 wash = hueRamp(uHueShift + uHueSpread * (1.1 * n + 0.35 * (uv.x + 0.7 * uv.y) + 0.45 * sweep));
  wash *= uP2 * (0.10 + 0.28 * n + 0.22 * n2);
  // three star layers at opposing parallax depths (uP1)
  float dens = uP0 * uScale;
  float par = 0.028 * uP1;
  vec3 stars =
      starLayer(uv, dens * 0.75, 11.0, tilt * (-par * 1.6), 0.75, sweep) * 0.70
    + starLayer(uv, dens * 1.00, 23.0, tilt * (par * 0.2), 0.45, sweep) * 0.85
    + starLayer(uv, dens * 1.30, 37.0, tilt * (par * 1.8), 0.05, sweep);
  return wash + stars * uP3 * 0.55;
}`

const STARLIGHT_DEFAULTS: CoreDefaults = {
  uIntensity: 1.1,
  uScale: 1.0,
  uHueShift: 0.62,
  uHueSpread: 0.65,
  uSat: 0.9,
  uArtGate: 0.75,
  uSpecular: 0.25,
}

const STARLIGHT_PARAMS: PatternParam[] = [
  { key: 'uP0', label: 'Star density', min: 8, max: 80, step: 1, default: 24 },
  { key: 'uP1', label: 'Parallax depth', min: 0, max: 3, step: 0.05, default: 1.2 },
  { key: 'uP2', label: 'Galaxy wash', min: 0, max: 2, step: 0.05, default: 0.45 },
  { key: 'uP3', label: 'Star gain', min: 0, max: 4, step: 0.05, default: 3.0 },
]

// Re-tuned 2026-08-02 (R0 wave, Gemini verification 1/1/2/1): the old recipe
// lit a dense wall of large saturated orbs at every tilt; the reference
// (Base Set 2 Pidgeot demo) shows a DARK field where sparse orb clusters
// brighten IN PLACE inside a narrow activation window, plus tiny spectral
// pinprick twinkles. Orbs are smaller/denser, mostly near-invisible; cluster
// activation is low-freq noise over cell ids so neighbors pop together.
const COSMOS_GLSL = `
// tiny 4-point cross glyph centered on sp (cell-local coords)
float cosmosCross(vec2 sp, float w) {
  float a = pow(max(0.0, 1.0 - abs(sp.x) / w), 3.0) * pow(max(0.0, 1.0 - abs(sp.y) / (w * 0.28)), 3.0);
  float b = pow(max(0.0, 1.0 - abs(sp.y) / w), 3.0) * pow(max(0.0, 1.0 - abs(sp.x) / (w * 0.28)), 3.0);
  return a + b;
}
vec3 foilPattern(vec2 uv, vec2 tilt) {
  float sweep = tilt.x + tilt.y * 0.6;
  vec3 acc = vec3(0.0);
  // solid orb layers over a dark field — most orbs sit near-invisible; a
  // cluster brightens in place when its facet phase aligns with the tilt.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float sc = (9.0 + fi * 6.5) * uP0 * uScale;
    vec2 g = uv * vec2(1.0, CARD_ASPECT) * sc + hash22(vec2(fi * 3.1, fi + 11.0)) * 17.0;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 rnd = hash22(id + fi * 13.7);
    float r = 0.14 + 0.16 * rnd.x;
    float d = length(f - (rnd - 0.5) * 0.4);
    float disc = smoothstep(r, r - 0.08, d);
    // cluster phase: low-freq spatial noise over cell ids -> neighboring
    // orbs light TOGETHER; per-orb nudge keeps edges ragged
    float phase = vnoise(id * 0.31 + fi * 7.7) * 1.6 + rnd.y * 0.22;
    float win = pow(max(0.0, cos(TAU * (phase + sweep * uP1))), 22.0);
    float hue = uHueShift + uHueSpread * (rnd.y + 0.4 * sweep + fi * 0.13);
    acc += disc * hueRamp(hue) * (0.055 + 1.5 * win);
  }
  acc *= 0.5 * uP3;
  // pinprick twinkles: tiny 4-point crosses flashing individually in very
  // tight windows — the sparse spectral points the reference shows
  vec2 g = uv * vec2(1.0, CARD_ASPECT) * 30.0 * uScale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 rnd = hash22(id + 51.3);
  float exists = step(rnd.x, 0.42);
  vec2 sp = f - (rnd - 0.5) * 0.55;
  float win = pow(max(0.0, cos(TAU * (rnd.y * 3.17 + sweep * uP1 * 1.35))), 34.0);
  vec3 col = mix(vec3(1.0), hueRamp(uHueShift + uHueSpread * (rnd.x * 2.1 + 0.3 * sweep)), 0.55);
  acc += exists * cosmosCross(sp, 0.42) * win * col * uP2;
  return acc;
}`

const COSMOS_DEFAULTS: CoreDefaults = {
  uIntensity: 0.95,
  uScale: 1.0,
  uHueShift: 0.0,
  uHueSpread: 0.5,
  uSat: 0.85,
  uArtGate: 0.5,
  uSpecular: 0.3,
}

const COSMOS_PARAMS: PatternParam[] = [
  { key: 'uP0', label: 'Bubble scale', min: 0.4, max: 3, step: 0.05, default: 1.0 },
  { key: 'uP1', label: 'Shimmer rate', min: 0.2, max: 4, step: 0.05, default: 1.1 },
  { key: 'uP2', label: 'Twinkle gain', min: 0, max: 3, step: 0.05, default: 1.2 },
  { key: 'uP3', label: 'Bubble gain', min: 0, max: 3, step: 0.05, default: 1.1 },
]

/**
 * The sheen family — ONE generator, rotated per slug. Per the research the
 * physical product is the same smooth linear-grating sheet mounted at four
 * rotations; `nrm` is the band NORMAL (the direction the bands travel) in
 * aspect-corrected card space, and the band sweep is driven by the component
 * of tilt along that normal. `stripes` multiplies in the fine continuous
 * stripe texture of the SWSH "Line" foil.
 */
function sheenGlsl(o: {
  nx: number
  ny: number
  stripes?: boolean
  /** Band exponent — higher = sharper, more CD-like lines (default 1.6). */
  sharp?: number
  /** Broad-beam gain (default 0.75; diagonals tamed to fight center blow-out). */
  beam?: number
  /** Barcode field: thin sharp spectral lines of varying width (vertical sheet). */
  barcode?: boolean
}): string {
  return `
vec3 foilPattern(vec2 uv, vec2 tilt) {
  vec2 nrm = vec2(${o.nx.toFixed(4)}, ${o.ny.toFixed(4)}); // band normal (rotation of the sheet)
  vec2 tng = vec2(-nrm.y, nrm.x);                          // along the bands
  vec2 p = (uv - 0.5) * vec2(1.0, CARD_ASPECT);
  float across = dot(p, nrm) + 0.5;
  float along = dot(p, tng) + 0.5;
  float sweep = dot(tilt, nrm) * 1.2 + dot(tilt, tng) * 0.35;
  float x = across * uP0 * uScale + sweep * uP1;
  float wobble = sin(along * 7.0 + sweep * 2.2) * uP2;
  float band = pow(0.5 + 0.5 * sin(TAU * x + wobble), ${(o.sharp ?? 1.6).toFixed(2)});
  vec3 col = hueRamp(uHueShift + uHueSpread * (x * 0.30 + along * 0.18 + 0.25 * sweep));
  // broad moving beam
  float beam = pow(0.5 + 0.5 * cos(PI * (across * 1.4 + along * 0.5 - sweep * 1.1)), 4.0);
  vec3 beamCol = hueRamp(uHueShift + 0.5 * uHueSpread * (along - 0.3 * sweep) + 0.07);
  ${
    o.stripes
      ? // R0: finer + more blended than the original 90.0/0.30 (verdict: stripes
        // slightly too thick/distinct vs the reference's fine texture)
        'float stripe = 0.40 + 0.60 * pow(0.5 + 0.5 * sin(TAU * across * 130.0 * uScale), 0.8);'
      : 'float stripe = 1.0;'
  }
  ${
    o.barcode
      ? `
  // barcode (R0, verdict "multiple sharp vertical lines of varying widths"):
  // thin spectral lines with per-line random width/offset/brightness riding
  // the same grating coordinate — several visible at once, sliding with the
  // sweep like CD grooves; a floor keeps most lines faintly present.
  float gx = across * uP0 * 3.0 * uScale + sweep * uP1 * 1.35;
  vec2 brnd = hash22(vec2(floor(gx), 7.0));
  float bw = mix(0.03, 0.16, brnd.y * brnd.y);
  float lf = fract(gx) - 0.5 - (brnd.x - 0.5) * 0.5;
  float bline = smoothstep(bw, bw * 0.35, abs(lf));
  float bon = 0.25 + 0.75 * pow(0.5 + 0.5 * cos(TAU * (brnd.x * 5.7 + sweep * 1.9)), 3.0);
  float bc = bline * bon;
  vec3 bcCol = hueRamp(uHueShift + uHueSpread * (lf * 2.2 + brnd.y + 0.35 * sweep));`
      : 'float bc = 0.0; vec3 bcCol = vec3(0.0);'
  }
  return (band * 0.55 * col + beam * ${(o.beam ?? 0.75).toFixed(2)} * beamCol + bc * 0.9 * bcCol) * uP3 * stripe;
}`
}

const SHEEN_V = sheenGlsl({ nx: 1, ny: 0 }) // plain vertical sheet — kept smooth for the mirror/rainbow-mirror fallbacks
// beam 0.3: the HGSS-era exemplar scans are light watercolor art — the broad
// beam floods them to white; the barcode lines + band carry the travel.
const SHEEN_V_BARCODE = sheenGlsl({ nx: 1, ny: 0, barcode: true, beam: 0.3 }) // the HGSS–XY vertical "barcode" sheet
const SHEEN_H = sheenGlsl({ nx: 0, ny: 1 }) // horizontal band, travels with tilt.y — 20/20 verified, untouched
const SHEEN_DR = sheenGlsl({ nx: 0.7071, ny: -0.7071, sharp: 3.0, beam: 0.55 }) // band rises "/" (verified frame-02)
const SHEEN_DL = sheenGlsl({ nx: 0.7071, ny: 0.7071, sharp: 3.0, beam: 0.55 }) // band falls "\" (verified frame-03)
const SHEEN_V_STRIPED = sheenGlsl({ nx: 1, ny: 0, stripes: true })

const SHEEN_DEFAULTS: CoreDefaults = {
  uIntensity: 0.9,
  uScale: 1.0,
  uHueShift: 0.55,
  uHueSpread: 0.6,
  uSat: 0.65,
  uArtGate: 0.35,
  uSpecular: 0.5,
}

const SHEEN_PARAMS: PatternParam[] = [
  { key: 'uP0', label: 'Band count', min: 1, max: 14, step: 0.5, default: 5 },
  { key: 'uP1', label: 'Band drift', min: 0, max: 4, step: 0.05, default: 1.6 },
  { key: 'uP2', label: 'Band wobble', min: 0, max: 3, step: 0.05, default: 0.8 },
  { key: 'uP3', label: 'Gain', min: 0, max: 3, step: 0.05, default: 1.0 },
]

const REVERSE_SHEET_GLSL = `
vec3 foilPattern(vec2 uv, vec2 tilt) {
  float sweep = tilt.x + tilt.y * 0.8;
  vec2 g = uv * vec2(1.0, CARD_ASPECT) * uP0 * uScale;
  g.x += mod(floor(g.y), 2.0) * 0.5;   // stagger rows
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float d = length(f);
  float ring = smoothstep(0.335, 0.295, d) - smoothstep(0.235, 0.195, d);
  float dotc = smoothstep(0.10, 0.05, d);
  float emb = clamp(ring + dotc, 0.0, 1.0);
  float embHue = uHueShift + uHueSpread * (hash21(id) * 0.30 + uv.x * 0.35 + uv.y * 0.25 + 0.85 * sweep);
  float embLum = 0.45 + 0.55 * pow(max(0.0, cos(TAU * (hash21(id + 3.7) + sweep * 0.9))), 4.0);
  // mirror sheet between stamps — smooth metallic sweep
  float sheetPh = uv.x * 0.55 + uv.y * 0.35 + sweep * 0.9;
  vec3 sheet = hueRamp(uHueShift + uHueSpread * sheetPh) * (0.22 + 0.18 * pow(0.5 + 0.5 * cos(TAU * sheetPh), 2.0));
  return sheet * uP2 + emb * hueRamp(embHue) * embLum * uP3;
}`

const REVERSE_SHEET_DEFAULTS: CoreDefaults = {
  uIntensity: 1.0,
  uScale: 1.0,
  uHueShift: 0.1,
  uHueSpread: 0.45,
  uSat: 0.6,
  uArtGate: 0.0,
  uSpecular: 0.55,
}

const REVERSE_SHEET_PARAMS: PatternParam[] = [
  { key: 'uP0', label: 'Stamp density', min: 3, max: 30, step: 0.5, default: 11 },
  { key: 'uP1', label: '(unused)', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'uP2', label: 'Sheet gain', min: 0, max: 3, step: 0.05, default: 1.0 },
  { key: 'uP3', label: 'Stamp gain', min: 0, max: 3, step: 0.05, default: 1.2 },
]

const CRACKED_ICE_GLSL = `
vec3 foilPattern(vec2 uv, vec2 tilt) {
  vec2 g = uv * vec2(1.0, CARD_ASPECT) * uP0 * uScale;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float best = 8.0; float second = 8.0; vec2 bid = id;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = hash22(id + o);
    vec2 dp = o + r - f;
    float d = dot(dp, dp);
    if (d < best) { second = best; best = d; bid = id + o; }
    else if (d < second) { second = d; }
  }
  vec2 rnd = hash22(bid);
  vec2 facetN = normalize(rnd - 0.5 + 1e-4);
  float align = dot(facetN, tilt) * uP1 - (rnd.x - 0.5) * 1.3;
  float glint = pow(max(0.0, 1.0 - abs(align)), 7.0);
  // R0 re-tune 2026-08-02: the authored intra-shard micro-grain
  // (glint *= fnoise) was flagged by verification and removed per Chey's
  // accuracy ruling — reference facets are SMOOTH clean mirrors; a hot
  // shard flashes as one solid saturated plane, edge to edge.
  float edge = smoothstep(0.09, 0.0, sqrt(second) - sqrt(best));
  float hue = uHueShift + uHueSpread * (rnd.y + 0.5 * (tilt.x + tilt.y));
  // whiten only mildly at peak — the flash should stay a COLOR, not blow out
  vec3 col = mix(hueRamp(hue), vec3(1.0), 0.35 * glint);
  return col * (0.12 + glint * uP3) + edge * vec3(0.9) * uP2 * (0.3 + glint);
}`

const CRACKED_ICE_DEFAULTS: CoreDefaults = {
  uIntensity: 1.0,
  uScale: 1.0,
  uHueShift: 0.5,
  uHueSpread: 0.7,
  uSat: 0.75,
  uArtGate: 0.45,
  uSpecular: 0.4,
}

const CRACKED_ICE_PARAMS: PatternParam[] = [
  { key: 'uP0', label: 'Facet density', min: 2, max: 20, step: 0.5, default: 7 },
  { key: 'uP1', label: 'Flash rate', min: 0.2, max: 5, step: 0.05, default: 2.2 },
  { key: 'uP2', label: 'Edge seams', min: 0, max: 1.5, step: 0.05, default: 0.35 },
  { key: 'uP3', label: 'Facet gain', min: 0, max: 3, step: 0.05, default: 1.1 },
]

// ── Helpers to derive per-slug variants of a recipe ─────────────────────────

const tuneParams = (
  params: PatternParam[],
  o: Partial<Record<'uP0' | 'uP1' | 'uP2' | 'uP3', number>>,
): PatternParam[] => params.map((p) => (o[p.key] !== undefined ? { ...p, default: o[p.key]! } : p))

// ── The library: none + implemented recipes + the rest of the 39 types ──────
// Order: `none`, implemented (video number in comment), then approximations
// in video order. The dropdown groups by `implemented`.

export const PATTERNS: FoilPattern[] = [
  {
    id: 'none',
    label: 'None (plain card)',
    taxonomy: '—',
    usedOn: 'Non-holo printings; baseline for eyeballing the scan itself.',
    // uSpecular 0: "none" is the pixel-comparable baseline against the flat
    // scan (issue ls9u0y) — even a 0.12 sheen adds a corner glow at rest.
    glsl: `vec3 foilPattern(vec2 uv, vec2 tilt) { return vec3(0.0); }`,
    defaults: { uIntensity: 0.0, uSpecular: 0.0 },
    params: [],
    implemented: true,
  },

  // #1 — reworked 2026-08-01 from Chey's workbench comment (issues/foil/
  // 2026-08-01_22-40-03-629_ftoz71): layered parallax, glyph/blur star mix,
  // smooth breathing. See foil-effects SKILL field notes.
  {
    id: 'starlight',
    label: 'Starlight (WOTC)',
    taxonomy: 'Starlight (syn. Galaxy) — WOTC multi-depth star hologram',
    usedOn: 'Base Set, Jungle, Fossil holo rares — international printings only (JP Base-era used cosmos).',
    glsl: STARLIGHT_GLSL,
    defaults: STARLIGHT_DEFAULTS,
    params: STARLIGHT_PARAMS,
    implemented: true,
  },

  // #24 — the XY Evolutions Base homage: same star field, flat single-plane
  // foil (NO parallax), bolder pops. Starlight recipe at parallax 0.
  {
    id: 'starlight-ii',
    label: 'Starlight II (Evolutions)',
    taxonomy: 'Starlight II — flat single-plane star foil (no parallax)',
    usedOn: 'XY Evolutions (2016, 20th-anniversary Base Set homage).',
    // R0 re-tune: verdict 2/3/5/3 asked for sharper starbursts + saturation
    // up + tighter activation — the shared GLSL re-tune delivers all three;
    // uSat/uP3 pushed slightly past base (Evolutions pops bolder).
    // uArtGate lowered vs base starlight: the Evolutions holo field is
    // mid-orange, not WOTC-dark — at 0.75 the gate halved every star.
    glsl: STARLIGHT_GLSL,
    defaults: { ...STARLIGHT_DEFAULTS, uSat: 0.95, uArtGate: 0.45 },
    params: tuneParams(STARLIGHT_PARAMS, { uP1: 0, uP3: 3.2 }),
    implemented: true,
  },

  // #2 — label fixed 2026-08-02: "Galaxy" is Bulbapedia's synonym for
  // STARLIGHT, not cosmos (see research/foil-patterns.md mislabels).
  {
    id: 'cosmos',
    label: 'Cosmos',
    taxonomy: 'Cosmos ("bubbles") foil',
    usedOn:
      'The most-used pattern in TCG history: English Base Set 2 → Call of Legends standard holos, JP Base-era holos, decades of promos.',
    glsl: COSMOS_GLSL,
    defaults: COSMOS_DEFAULTS,
    params: COSMOS_PARAMS,
    implemented: true,
  },

  // #14 — renamed from `sv-holo` 2026-08-02 (alias kept): these vertical
  // bands are the Platinum/HGSS→XY default, not SV's.
  {
    id: 'vertical-sheen',
    label: 'Vertical sheen (HGSS–XY)',
    taxonomy: 'Sheen — vertical linear-grating sheet',
    usedOn:
      'The long-running default holo: HGSS era through Platinum, Call of Legends, BW, into XY; also the raw sheet under many reverse designs.',
    glsl: SHEEN_V_BARCODE,
    defaults: { ...SHEEN_DEFAULTS, uArtGate: 0.5 },
    params: SHEEN_PARAMS,
    implemented: true,
  },

  // #21 — the TRUE SV-era default (Bulbapedia "Mirage"): horizontal band
  // traveling vertically with pitch.
  {
    id: 'horizontal-sheen',
    label: 'Horizontal sheen (SV default)',
    taxonomy: 'Sheen — horizontal rotation (Bulbapedia "Mirage")',
    usedOn: 'The default holo of Scarlet & Violet AND the Mega-era standard holos.',
    glsl: SHEEN_H,
    defaults: SHEEN_DEFAULTS,
    params: tuneParams(SHEEN_PARAMS, { uP0: 2, uP1: 2.2 }),
    implemented: true,
  },

  // #19 — band rises "/" (verified from corpus frames; Gemini's slope claim
  // was wrong — research/foil-patterns.md conflicts).
  {
    id: 'diagonal-sheen-right',
    label: 'Diagonal sheen right (XY)',
    taxonomy: 'Sheen — diagonal rotation, band rises "/"',
    usedOn: 'Battle Arena deck secret variants, then the XY-era default holo.',
    glsl: SHEEN_DR,
    // specular tamed with the diffuse fix landed: the center was blowing out
    // to white over bright full-art scans (verdict color_travel note).
    defaults: { ...SHEEN_DEFAULTS, uSpecular: 0.35 },
    // uP0 2 -> 7 (2026-08-02 R0): same physical sheet as the fixed left
    // diagonal — several narrow parallel bands, not one broad wash.
    params: tuneParams(SHEEN_PARAMS, { uP0: 7, uP1: 2.0 }),
    implemented: true,
  },

  // #20 — mirror rotation, band falls "\".
  {
    id: 'diagonal-sheen-left',
    label: 'Diagonal sheen left (SM reverses)',
    taxonomy: 'Sheen — diagonal rotation, band falls "\\"',
    usedOn: 'Sun & Moon series reverse holos, heavily.',
    glsl: SHEEN_DL,
    defaults: { ...SHEEN_DEFAULTS, uSpecular: 0.35 },
    // uP0 2 → 7 after Gemini verification (2026-08-02): the reference sheet
    // shows several narrow parallel bands; at 2 the render read as one broad
    // diffuse wash. R0 added sharp: 3.0 to the generator for both diagonals —
    // the residual "bands softer than the sheet's CD lines" note.
    params: tuneParams(SHEEN_PARAMS, { uP0: 7, uP1: 2.0 }),
    implemented: true,
  },

  // #22 — SWSH "Line": fine continuous vertical stripes under a sweeping band.
  {
    id: 'striped-vertical-sheen',
    label: 'Striped vertical sheen (SWSH)',
    taxonomy: 'Sheen + stripe texture (Bulbapedia "Line")',
    usedOn: 'Sword & Shield series regular holos; some Trick or Trade.',
    glsl: SHEEN_V_STRIPED,
    defaults: SHEEN_DEFAULTS,
    params: tuneParams(SHEEN_PARAMS, { uP0: 3, uP1: 1.8 }),
    implemented: true,
  },

  // Coarse-tier reverse sheet. NOTE: the ring+dot stamp grid most closely
  // matches #30 pokeball-masterball (Black Bolt/White Flare) / the SV pokeball
  // reverse stamps; most PRE-SV reverses are actually un-stamped sheen or
  // rainbow-mirror sheets with different ink masks (see the research
  // interlude) — this recipe is the stamped-sheet look specifically.
  {
    id: 'reverse-sheet',
    label: 'Reverse sheet (stamped)',
    taxonomy: 'Mirror sheet + stamped emblem grid (≈ pokeball-masterball)',
    usedOn: 'SV + Mega Evolution reverse holos — foil covers the body, not the art.',
    glsl: REVERSE_SHEET_GLSL,
    defaults: REVERSE_SHEET_DEFAULTS,
    params: REVERSE_SHEET_PARAMS,
    implemented: true,
  },

  // #9
  {
    id: 'cracked-ice',
    label: 'Cracked Ice',
    taxonomy: 'Cracked Ice (syn. Broken Glass, Shards) faceted foil',
    usedOn: 'Skyridge box toppers, FRLG bird promos, POP series; THE theme-deck holo DP→SWSH.',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: CRACKED_ICE_PARAMS,
    implemented: true,
  },

  // ── Unimplemented types — honest nearest-recipe fallbacks (video order) ──
  // Each renders via the named implemented recipe with tuned defaults; the
  // dropdown labels them "approx via …". Recipe waves flip these to real
  // implementations (research/foil-patterns.md "Implementation gap summary").

  // #3
  {
    id: 'fireworks',
    label: 'Fireworks',
    taxonomy: 'Radial-grating burst foil (full face, art included)',
    usedOn: "Legendary Collection (2002) parallel set only — the TCG's first reverse set.",
    glsl: COSMOS_GLSL,
    defaults: { ...COSMOS_DEFAULTS, uArtGate: 0.0, uHueSpread: 0.8 },
    params: tuneParams(COSMOS_PARAMS, { uP0: 0.5, uP3: 2.0 }),
    implemented: false,
    approxVia: 'Cosmos',
  },
  // #4
  {
    id: 'mirror',
    label: 'Mirror',
    taxonomy: 'Plain aluminum mirror foil — no pattern, no hue shift',
    usedOn: 'Neo Shining subjects; the raw base stock under many later patterns.',
    glsl: SHEEN_V,
    defaults: { ...SHEEN_DEFAULTS, uSat: 0.05, uSpecular: 1.0, uArtGate: 0.0 },
    params: tuneParams(SHEEN_PARAMS, { uP0: 1, uP2: 0, uP3: 0.5 }),
    implemented: false,
    approxVia: 'Vertical sheen',
  },
  // #5
  {
    id: 'rainbow-mirror',
    label: 'Rainbow mirror',
    taxonomy: 'Smooth unembossed holographic film — broad continuous bands',
    usedOn: 'e-series (Expedition→Skyridge) reverses; staple base sheet ever since.',
    glsl: SHEEN_V,
    defaults: { ...SHEEN_DEFAULTS, uHueSpread: 0.9, uSpecular: 0.8, uArtGate: 0.0 },
    params: tuneParams(SHEEN_PARAMS, { uP0: 1, uP1: 2.4, uP2: 0 }),
    implemented: false,
    approxVia: 'Vertical sheen',
  },
  // #6
  {
    id: 'big-glitter',
    label: 'Big glitter',
    taxonomy: 'Dense embossed dot-facet glitter foil',
    usedOn: 'Once: e-series oversized box toppers (manufacturer stock).',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 18, uP1: 3.2, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #7
  {
    id: 'energy-symbols',
    label: 'Energy symbols',
    taxonomy: 'Energy-glyph foil field (needs an icon atlas — gap)',
    usedOn: 'EX Hidden Legends — the first bespoke Pokémon-designed pattern.',
    glsl: COSMOS_GLSL,
    defaults: { ...COSMOS_DEFAULTS, uArtGate: 0.6 },
    params: tuneParams(COSMOS_PARAMS, { uP0: 1.8 }),
    implemented: false,
    approxVia: 'Cosmos',
  },
  // #8
  {
    id: 'energy-symbols-ii',
    label: 'Energy symbols II',
    taxonomy: 'Scattered multi-size energy glyphs + sparkle dots (gap)',
    usedOn: 'EX FireRed & LeafGreen.',
    glsl: COSMOS_GLSL,
    defaults: { ...COSMOS_DEFAULTS, uArtGate: 0.6 },
    params: tuneParams(COSMOS_PARAMS, { uP0: 1.4 }),
    implemented: false,
    approxVia: 'Cosmos',
  },
  // #10
  {
    id: 'pinwheel',
    label: 'Pinwheel',
    taxonomy: 'Square grid of radial-wedge pinwheel cells (gap)',
    usedOn: 'EX Deoxys reverses; revived on simplified-Chinese sets.',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 10, uP2: 0.2 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #11
  {
    id: 'ex-emerald',
    label: 'EX Emerald',
    taxonomy: 'Poké Ball / starburst icons + vertical rainbow band (gap)',
    usedOn: 'EX Emerald reverses only.',
    glsl: SHEEN_V,
    defaults: SHEEN_DEFAULTS,
    params: tuneParams(SHEEN_PARAMS, { uP0: 1, uP1: 2.2 }),
    implemented: false,
    approxVia: 'Vertical sheen',
  },
  // #12
  {
    id: 'pokeball-hologram',
    label: 'Pokeball hologram',
    taxonomy: 'TRUE multi-depth Poké Ball hologram (parallax; gap)',
    usedOn: 'EX Unseen Forces.',
    glsl: STARLIGHT_GLSL,
    defaults: STARLIGHT_DEFAULTS,
    params: tuneParams(STARLIGHT_PARAMS, { uP0: 12, uP1: 2.4 }),
    implemented: false,
    approxVia: 'Starlight',
  },
  // #13
  {
    id: 'vertical-sheen-rainbow',
    label: 'Vertical sheen rainbow',
    taxonomy: 'Mirror foil + ONE soft vertical rainbow band (the sheen debut)',
    usedOn: 'A few EX-era sets after Unseen Forces (e.g. EX Crystal Guardians).',
    glsl: SHEEN_V,
    defaults: { ...SHEEN_DEFAULTS, uSpecular: 0.7 },
    params: tuneParams(SHEEN_PARAMS, { uP0: 1, uP2: 0 }),
    implemented: false,
    approxVia: 'Vertical sheen',
  },
  // #15
  {
    id: 'cosmos-ii-pixel',
    label: 'Cosmos II (pixel)',
    taxonomy: 'Denser silvery cosmos + pixel-speck twinkle field (partial gap)',
    usedOn: 'Platinum onward; THE default promo pattern (tins, blisters); SV cosmos borders.',
    glsl: COSMOS_GLSL,
    defaults: { ...COSMOS_DEFAULTS, uSat: 0.55 },
    params: tuneParams(COSMOS_PARAMS, { uP0: 2.2 }),
    implemented: false,
    approxVia: 'Cosmos',
  },
  // #16
  {
    id: 'cosmos-iii-smooth',
    label: 'Cosmos III (smooth/HD)',
    taxonomy: 'Smooth-disc cosmos + sweeping specular band (partial gap)',
    usedOn: 'Legendary Treasures onward; modern promos ship pixel OR smooth.',
    glsl: COSMOS_GLSL,
    defaults: { ...COSMOS_DEFAULTS, uSpecular: 0.5 },
    params: tuneParams(COSMOS_PARAMS, { uP0: 1.6, uP1: 0.8 }),
    implemented: false,
    approxVia: 'Cosmos',
  },
  // #17
  {
    id: 'tinsel',
    label: 'Tinsel',
    taxonomy: 'Fine horizontal striations with sliding bright dashes (gap)',
    usedOn: 'BW (2011) regular holos through Legendary Treasures; BW ACE SPECs.',
    glsl: SHEEN_H,
    defaults: SHEEN_DEFAULTS,
    params: tuneParams(SHEEN_PARAMS, { uP0: 12, uP1: 2.4, uP2: 1.6 }),
    implemented: false,
    approxVia: 'Horizontal sheen',
  },
  // #18
  {
    id: 'tinsel-ii',
    label: 'Tinsel II',
    taxonomy: 'Denser darker chaotic tinsel, full face (gap)',
    usedOn: 'Black Bolt & White Flare (2025) only.',
    glsl: SHEEN_H,
    defaults: { ...SHEEN_DEFAULTS, uSat: 0.5, uArtGate: 0.0 },
    params: tuneParams(SHEEN_PARAMS, { uP0: 14, uP1: 2.0, uP2: 2.0 }),
    implemented: false,
    approxVia: 'Horizontal sheen',
  },
  // #23
  {
    id: 'prism',
    label: 'Prism',
    taxonomy: 'Rigid micro-grid of hue-cycling square cells (gap)',
    usedOn: 'Carddass prism stickers (1996, pre-TCG); XY BREAK cards only in the TCG.',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 20, uP1: 3.5, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #25
  {
    id: 'water-web',
    label: 'Water web',
    taxonomy: 'Organic rippling-liquid contours, colors flow along ridges (gap)',
    usedOn: 'Sun & Moon standard holos + GX cards (through Cosmic Eclipse).',
    glsl: SHEEN_V,
    defaults: { ...SHEEN_DEFAULTS, uHueSpread: 0.8 },
    params: tuneParams(SHEEN_PARAMS, { uP0: 2, uP2: 3 }),
    implemented: false,
    approxVia: 'Vertical sheen',
  },
  // #26
  {
    id: 'radiant',
    label: 'Radiant',
    taxonomy: 'Diagonal criss-cross diamond grid, segmented lines (gap)',
    usedOn: 'Radiant-rarity cards, SWSH Astral Radiance onward; full face.',
    glsl: CRACKED_ICE_GLSL,
    defaults: { ...CRACKED_ICE_DEFAULTS, uArtGate: 0.0 },
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 9, uP2: 1.5, uP3: 0.4 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #27
  {
    id: 'rainbow-glitter',
    label: 'Rainbow glitter',
    taxonomy: 'Fine glitter over a rainbow-mirror base (gap)',
    usedOn: 'SWSH VMAX / rainbow ("hyper") rares and more.',
    glsl: CRACKED_ICE_GLSL,
    defaults: { ...CRACKED_ICE_DEFAULTS, uHueSpread: 0.9, uArtGate: 0.0 },
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 20, uP1: 4, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #28
  {
    id: 'rainbow-glitter-sheen',
    label: 'Rainbow glitter sheen',
    taxonomy: 'Glitter + shaped directional band base (gap)',
    usedOn: 'Mega-era Mega EX cards and others.',
    glsl: CRACKED_ICE_GLSL,
    defaults: { ...CRACKED_ICE_DEFAULTS, uHueSpread: 0.9, uSpecular: 0.8, uArtGate: 0.0 },
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 20, uP1: 4, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #29
  {
    id: 'ace-spec',
    label: 'Ace spec (SV)',
    taxonomy: 'Bold diagonal diamond grid with cross motifs (gap)',
    usedOn: 'SV-era ACE SPEC cards only (BW ACE SPECs used tinsel).',
    glsl: CRACKED_ICE_GLSL,
    defaults: { ...CRACKED_ICE_DEFAULTS, uArtGate: 0.0 },
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 9, uP2: 1.2, uP3: 0.6 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #30 — the implemented reverse-sheet recipe IS this look, coarse-tier
  // (ring+dot stamps, not a true ball SDF — that upgrade is a recipe-wave item).
  {
    id: 'pokeball-masterball',
    label: 'Pokeball / masterball',
    taxonomy: 'Staggered Poké/Master Ball stamp grid on mirror sheet',
    usedOn: "Black Bolt & White Flare (2025) brought JP's ball reverses to English.",
    glsl: REVERSE_SHEET_GLSL,
    defaults: REVERSE_SHEET_DEFAULTS,
    params: REVERSE_SHEET_PARAMS,
    implemented: false,
    approxVia: 'Reverse sheet',
  },
  // #31
  {
    id: 'prismatic-pokeball',
    label: 'Prismatic pokeball',
    taxonomy: 'Polygon mosaic + ball watermark OVER rainbow-mirror (overprint; gap)',
    usedOn: 'Prismatic Evolutions poke-ball reverses.',
    glsl: CRACKED_ICE_GLSL,
    defaults: { ...CRACKED_ICE_DEFAULTS, uHueSpread: 1.0, uArtGate: 0.0 },
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 12, uP1: 3 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #32
  {
    id: 'radiant-collection-dots',
    label: 'Radiant Collection dots',
    taxonomy: 'Dot overprint ABOVE ink + white-ink windows on mirror (gap)',
    usedOn: 'Radiant Collection subsets (Legendary Treasures, Generations).',
    glsl: COSMOS_GLSL,
    defaults: { ...COSMOS_DEFAULTS, uArtGate: 0.0 },
    params: tuneParams(COSMOS_PARAMS, { uP0: 2.5 }),
    implemented: false,
    approxVia: 'Cosmos',
  },
  // #33
  {
    id: 'ex-starfoil',
    label: 'ex starfoil (SV ex)',
    taxonomy: 'Dense star overprint over a diagonal-sheen base (gap)',
    usedOn: 'SV-era ex cards (full face, "almost triple printed").',
    glsl: STARLIGHT_GLSL,
    defaults: { ...STARLIGHT_DEFAULTS, uArtGate: 0.0 },
    params: tuneParams(STARLIGHT_PARAMS, { uP0: 60, uP1: 0, uP2: 0.4 }),
    implemented: false,
    approxVia: 'Starlight',
  },
  // #34
  {
    id: 'sequin',
    label: 'Sequin',
    taxonomy: 'Densely packed snapping sequin discs (gap)',
    usedOn: 'General Mills cereal-box promos only (SM + SWSH waves).',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 20, uP1: 4.5, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #35
  {
    id: 'crosshatch',
    label: 'Crosshatch',
    taxonomy: 'Fine woven diagonal line grid under a sweeping band (gap)',
    usedOn: 'Play! Pokémon / League promos exclusively.',
    glsl: SHEEN_V_STRIPED,
    defaults: SHEEN_DEFAULTS,
    params: tuneParams(SHEEN_PARAMS, { uP0: 2, uP1: 1.8 }),
    implemented: false,
    approxVia: 'Striped vertical sheen',
  },
  // #36
  {
    id: 'tcg-classic',
    label: 'TCG Classic',
    taxonomy: 'Micro-glitter grain + scattered stars under a rainbow band (gap)',
    usedOn: 'Pokémon TCG Classic (2023 premium decks) only — every card holo.',
    glsl: CRACKED_ICE_GLSL,
    defaults: { ...CRACKED_ICE_DEFAULTS, uHueSpread: 0.85 },
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 20, uP1: 3.5, uP2: 0, uP3: 1.4 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #37
  {
    id: 'confetti',
    label: 'Confetti',
    taxonomy: 'Irregular small flakes, chaotic pops (Bulbapedia "Pixel"; gap)',
    usedOn: 'Celebrations (25th anniv.) and EVERY English McDonald\'s promo set.',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 16, uP1: 3.8, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
  // #38
  {
    id: 'acid-wash',
    label: 'Acid wash',
    taxonomy: 'Mottled etched-metal texture with soft iridescent washes (gap)',
    usedOn: 'Pokémon League promos ~2006, energy cards only.',
    glsl: SHEEN_H,
    defaults: { ...SHEEN_DEFAULTS, uSat: 0.5 },
    params: tuneParams(SHEEN_PARAMS, { uP0: 2, uP2: 3, uP3: 0.8 }),
    implemented: false,
    approxVia: 'Horizontal sheen',
  },
  // #39
  {
    id: 'disco',
    label: 'Disco (prototype)',
    taxonomy: 'Strict square mosaic, per-cell hue cycling (gap)',
    usedOn: 'Never released — late-90s factory test pattern (authenticated prototypes).',
    glsl: CRACKED_ICE_GLSL,
    defaults: CRACKED_ICE_DEFAULTS,
    params: tuneParams(CRACKED_ICE_PARAMS, { uP0: 14, uP1: 3, uP2: 0 }),
    implemented: false,
    approxVia: 'Cracked Ice',
  },
]

export const patternById = (id: string): FoilPattern => {
  const canonical = canonicalPatternId(id)
  return PATTERNS.find((p) => p.id === canonical) ?? PATTERNS[0]
}
