// foil/patterns.ts — the pattern library: one ShaderMaterial recipe per
// physical foil process. Taxonomy per Bulbapedia "Holofoil" + the Collexy
// "Database Insight: Holofoil" series. Adding a pattern = adding one entry
// here; the full contract lives in .claude/skills/foil-effects/SKILL.md.
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
// Starter set v1 = the eras Chey actually owns (collection checked
// 2026-08-01: Base/WOTC 176, Scarlet & Violet 68, Mega Evolution 139):
// Starlight (WOTC holo), Cosmos, SV default holo, SV reverse sheet,
// Cracked Ice. The remaining taxonomy (Tinsel, Sheen, Water Web, Line,
// Crosshatch, Pixel/Confetti, texture-embossed relief last) lands on the
// foil/patterns sub-branch against this same contract.

export interface PatternParam {
  /** Which uniform this slider drives: 'uP0' | 'uP1' | 'uP2' | 'uP3'. */
  key: 'uP0' | 'uP1' | 'uP2' | 'uP3'
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface FoilPattern {
  id: string
  label: string
  /** Bulbapedia/Collexy taxonomy name this recipe models. */
  taxonomy: string
  /** Human note: which physical printings use this process. */
  usedOn: string
  /** GLSL body defining `vec3 foilPattern(vec2 uv, vec2 tilt)`. */
  glsl: string
  /** Core-uniform defaults this recipe tunes away from the global defaults. */
  defaults: Partial<
    Record<
      'uIntensity' | 'uScale' | 'uHueShift' | 'uHueSpread' | 'uSat' | 'uArtGate' | 'uSpecular',
      number
    >
  >
  params: PatternParam[]
}

export const PATTERNS: FoilPattern[] = [
  {
    id: 'none',
    label: 'None (plain card)',
    taxonomy: '—',
    usedOn: 'Non-holo printings; baseline for eyeballing the scan itself.',
    glsl: `vec3 foilPattern(vec2 uv, vec2 tilt) { return vec3(0.0); }`,
    defaults: { uIntensity: 0.0, uSpecular: 0.12 },
    params: [],
  },

  {
    id: 'starlight',
    label: 'Starlight (WOTC)',
    taxonomy: 'Starlight / "cosmos" star-field foil',
    usedOn: 'WOTC holo rares 1999–2003 (Base–Skyridge) — art-window foil.',
    // Reworked 2026-08-01 from Chey's workbench comment (issues/foil/
    // 2026-08-01_22-40-03-629_ftoz71): real WOTC Starlight has a layered
    // parallax 3-D quality — star layers shift left/right AGAINST each other
    // as the card tilts — and the stars are a MIX of crisp glyph-like
    // sparkles and soft blurry ones living on different layers. Brightness
    // breathes smoothly (floor + wide lobe), never binary blink.
    //
    // Three depth layers over the rainbow wash: back layer (soft blurry dots)
    // offsets opposite the tilt, front layer (crisp glyphs) offsets with it,
    // mid layer barely moves — the relative shift is what reads as depth.
    glsl: `
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
  // smooth angular visibility: wide lobe over a floor — stars brighten and
  // dim as the card turns; they never pop in or out. The pow keeps only a
  // few near peak at any one angle.
  float vis = 0.18 + 0.82 * pow(0.5 + 0.5 * cos(TAU * phase + sweep * 2.6), 5.0);
  // population mix: glyph-crisp vs blurry, biased per layer, varied per star
  float soft = clamp(softBias + (rnd.y - 0.5) * 0.55, 0.0, 1.0);
  float core = smoothstep(0.13, 0.03, d);
  float flare = pow(max(0.0, 1.0 - abs(sp.x) * 9.0), 3.0) * pow(max(0.0, 1.0 - abs(sp.y) * 2.8), 3.0)
              + pow(max(0.0, 1.0 - abs(sp.y) * 9.0), 3.0) * pow(max(0.0, 1.0 - abs(sp.x) * 2.8), 3.0);
  float glyph = core + flare * 0.6;
  float blob = 0.9 * exp(-d * d * 13.0);
  float shape = mix(glyph, blob, soft);
  vec3 col = mix(vec3(1.0), hueRamp(rnd.y + 0.3 * sweep + seed * 0.21), 0.4 + 0.2 * soft);
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
      starLayer(uv, dens * 0.75, 11.0, tilt * (-par * 1.6), 0.95, sweep) * 0.70
    + starLayer(uv, dens * 1.00, 23.0, tilt * (par * 0.2), 0.55, sweep) * 0.85
    + starLayer(uv, dens * 1.30, 37.0, tilt * (par * 1.8), 0.10, sweep);
  return wash + stars * uP3 * 0.55;
}`,
    defaults: {
      uIntensity: 1.1,
      uScale: 1.0,
      uHueShift: 0.62,
      uHueSpread: 0.65,
      uSat: 0.7,
      uArtGate: 0.75,
      uSpecular: 0.25,
    },
    params: [
      { key: 'uP0', label: 'Star density', min: 8, max: 80, step: 1, default: 26 },
      { key: 'uP1', label: 'Parallax depth', min: 0, max: 3, step: 0.05, default: 1.2 },
      { key: 'uP2', label: 'Galaxy wash', min: 0, max: 2, step: 0.05, default: 1.0 },
      { key: 'uP3', label: 'Star gain', min: 0, max: 4, step: 0.05, default: 2.2 },
    ],
  },

  {
    id: 'cosmos',
    label: 'Cosmos / Galaxy',
    taxonomy: 'Cosmos ("bubbles") foil',
    usedOn: 'Post-WOTC classic holo sheet: EX–SM era rares, theme decks, many promos.',
    // Three staggered layers of soft discs ("bubbles") at different scales.
    // Each disc carries its own hue and its own tilt phase, so the field
    // shimmers as overlapping circles of shifting color — the classic
    // cosmos look.
    glsl: `
vec3 foilPattern(vec2 uv, vec2 tilt) {
  float sweep = tilt.x + tilt.y * 0.6;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float sc = (5.0 + fi * 4.5) * uP0 * uScale;
    vec2 g = uv * vec2(1.0, CARD_ASPECT) * sc + hash22(vec2(fi * 3.1, fi + 11.0)) * 17.0;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 rnd = hash22(id + fi * 13.7);
    float r = 0.30 + 0.22 * rnd.x;
    float d = length(f - (rnd - 0.5) * 0.30);
    float disc = smoothstep(r, r - 0.16, d);
    float hue = uHueShift + uHueSpread * (rnd.y + 0.75 * sweep + fi * 0.11);
    float lum = 0.30 + 0.70 * pow(max(0.0, cos(TAU * (rnd.x + sweep * uP1))), 6.0);
    acc += disc * hueRamp(hue) * lum;
  }
  return acc * 0.5 * uP3;
}`,
    defaults: { uIntensity: 0.95, uScale: 1.0, uHueShift: 0.0, uHueSpread: 0.5, uSat: 0.75, uArtGate: 0.5, uSpecular: 0.3 },
    params: [
      { key: 'uP0', label: 'Bubble scale', min: 0.4, max: 3, step: 0.05, default: 1.0 },
      { key: 'uP1', label: 'Shimmer rate', min: 0.2, max: 4, step: 0.05, default: 1.1 },
      { key: 'uP2', label: '(unused)', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'uP3', label: 'Bubble gain', min: 0, max: 3, step: 0.05, default: 1.3 },
    ],
  },

  {
    id: 'sv-holo',
    label: 'SV default holo',
    taxonomy: 'Sheen / vertical-beam foil (modern default)',
    usedOn: 'SV + Mega Evolution holo rares and ex full-face foil (coarse tier).',
    // Smooth iridescent vertical bands that drift laterally with tilt, over
    // a broad diagonal light beam. Modern default holo is much smoother than
    // vintage — hue changes are wide and liquid, no discrete sparkle.
    glsl: `
vec3 foilPattern(vec2 uv, vec2 tilt) {
  float sweep = tilt.x * 1.2 + tilt.y * 0.35;
  float x = uv.x * uP0 * uScale + sweep * uP1;
  float wobble = sin(uv.y * 7.0 + sweep * 2.2) * uP2;
  float band = 0.5 + 0.5 * sin(TAU * x + wobble);
  band = pow(band, 1.6);
  vec3 col = hueRamp(uHueShift + uHueSpread * (x * 0.30 + uv.y * 0.18 + 0.25 * sweep));
  // broad moving beam
  float beam = pow(0.5 + 0.5 * cos(PI * (uv.x * 1.4 + uv.y * 0.5 - sweep * 1.1)), 4.0);
  vec3 beamCol = hueRamp(uHueShift + 0.5 * uHueSpread * (uv.y - 0.3 * sweep) + 0.07);
  return (band * 0.55 * col + beam * 0.75 * beamCol) * uP3;
}`,
    defaults: { uIntensity: 0.9, uScale: 1.0, uHueShift: 0.55, uHueSpread: 0.6, uSat: 0.65, uArtGate: 0.35, uSpecular: 0.5 },
    params: [
      { key: 'uP0', label: 'Band count', min: 1, max: 14, step: 0.5, default: 5 },
      { key: 'uP1', label: 'Band drift', min: 0, max: 4, step: 0.05, default: 1.6 },
      { key: 'uP2', label: 'Band wobble', min: 0, max: 3, step: 0.05, default: 0.8 },
      { key: 'uP3', label: 'Gain', min: 0, max: 3, step: 0.05, default: 1.0 },
    ],
  },

  {
    id: 'reverse-sheet',
    label: 'Reverse sheet (SV)',
    taxonomy: 'Mirror / reverse-holo stamped sheet',
    usedOn: 'SV + Mega Evolution reverse holos — foil covers the body, not the art.',
    // Mirror sheet shimmer + a staggered grid of stamped emblems (SV uses
    // Poke Ball stamps; a ring+dot reads right at this tier). Emblems pick
    // up hue individually; the sheet between them does a broad mirror sweep.
    glsl: `
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
}`,
    defaults: { uIntensity: 1.0, uScale: 1.0, uHueShift: 0.1, uHueSpread: 0.45, uSat: 0.6, uArtGate: 0.0, uSpecular: 0.55 },
    params: [
      { key: 'uP0', label: 'Stamp density', min: 3, max: 30, step: 0.5, default: 11 },
      { key: 'uP1', label: '(unused)', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'uP2', label: 'Sheet gain', min: 0, max: 3, step: 0.05, default: 1.0 },
      { key: 'uP3', label: 'Stamp gain', min: 0, max: 3, step: 0.05, default: 1.2 },
    ],
  },

  {
    id: 'cracked-ice',
    label: 'Cracked Ice',
    taxonomy: 'Cracked Ice faceted foil',
    usedOn: 'Theme-deck / League promo holos (BW–SWSH era); great facet stress-test.',
    // Voronoi facets, each with its own pseudo-normal: a facet flashes when
    // the tilt vector aligns with its orientation, so shards ignite one at a
    // time as the card turns. Edges get a thin bright seam.
    glsl: `
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
  // micro-grain inside a flashing facet — a hot shard glitters, it doesn't flood
  glint *= 0.5 + 0.5 * fnoise(uv * 90.0 * uScale + rnd * 7.0);
  float edge = smoothstep(0.09, 0.0, sqrt(second) - sqrt(best));
  float hue = uHueShift + uHueSpread * (rnd.y + 0.5 * (tilt.x + tilt.y));
  // glints whiten toward their peak — a hot facet reads as light, not dye
  vec3 col = mix(hueRamp(hue), vec3(1.0), 0.65 * glint);
  return col * (0.12 + glint * uP3) + edge * vec3(0.9) * uP2 * (0.3 + glint);
}`,
    defaults: { uIntensity: 1.0, uScale: 1.0, uHueShift: 0.5, uHueSpread: 0.7, uSat: 0.65, uArtGate: 0.45, uSpecular: 0.4 },
    params: [
      { key: 'uP0', label: 'Facet density', min: 2, max: 20, step: 0.5, default: 7 },
      { key: 'uP1', label: 'Flash rate', min: 0.2, max: 5, step: 0.05, default: 2.2 },
      { key: 'uP2', label: 'Edge seams', min: 0, max: 1.5, step: 0.05, default: 0.35 },
      { key: 'uP3', label: 'Facet gain', min: 0, max: 3, step: 0.05, default: 1.1 },
    ],
  },
]

export const patternById = (id: string): FoilPattern =>
  PATTERNS.find((p) => p.id === id) ?? PATTERNS[0]
