---
name: foil-effects
description: Author, tune, and extend holofoil shader patterns for the quarantined foil renderer (foil/main track). Covers the ShaderMaterial uniform contract, the GLSL helper environment, the era-layout mask tier, and the exact steps to add a new pattern recipe (e.g. Crosshatch) and tune it on the /pokedex/foil-lab workbench. Use when adding or adjusting a foil pattern, changing the shader contract, or working on the foil workbench page.
---

# foil-effects

Variant-accurate 3D holofoil rendering of real card scans. Everything lives in
`apps/web/src/foil/` on branch `foil/main` (worktree `~/pokedex-worktrees/foil`) and is
**quarantined**: no imports to/from collection views; the only wiring outside `foil/` is
the lazy route in `main.tsx` and a pathname check in `AppShell.tsx`. Read
`roadmap/plans/foil-main.md` for the track rules before touching anything.

## Map

| File | What |
|---|---|
| `foil/patterns.ts` | **The pattern library.** The FULL 39-type taxonomy from `research/foil-patterns.md`: implemented recipes (`implemented: true`) plus every remaining type rendering via its nearest recipe with an honest `approxVia` label. Also `PATTERN_ALIASES` — old slugs (e.g. `sv-holo` → `vertical-sheen`) resolve forever; never orphan corpus data (sidecars, comment context.json, Copy-recipe JSON). You will usually only touch this. |
| `foil/shader.ts` | Uniform contract, GLSL preamble (helpers), fragment `main()`, material builder. Contract changes happen here — rarely, and update this doc when they do. |
| `foil/era-layouts.json` | Era layout spec — art-window rects per frame generation. **Data, not code.** Top-left-origin fractions measured on 600×825 cache scans. |
| `foil/resolver.ts` | v4: `(series, set, card, rarity, variant kind) → { patternId, scope, eraId, guess }`. Tiers: cited per-card/facet/set ASSIGNMENT rows (`foil/assignments-index.json` from `research/foil-card-assignments.json` via `tools/foil/build-assignments-index.mjs`) > the v2 usage table (`foil/usage-index.json` from `research/foil-pattern-usage.json` via `build-usage-index.mjs`) > era heuristics — regenerate indexes after editing the research files, never hand-edit them. v4 addition: card-level `cls: 'normal'` rows are consulted before the scope-none early return, so subset cards the catalog declares plain but which physically carry foil (RC commons' dot overprint) resolve scope `full`. `guess` carries match level + confidence + citation hosts for the UI. |
| `foil/CardViewer.tsx` | three.js scene; rAF loop pushes uniforms from a settings ref (no React re-renders per frame). Also exports `cardScreenRect` — the exact on-screen card rect used to align overlays. |
| `foil/useTilt.ts` | pointer / gyro (iOS permission) / manual tilt; reduced-motion → manual. |
| `foil/MaskEditor.tsx` | Apple-Pencil hand-mask drawing overlay (see mask-pipeline SKILL.md). |
| `foil/CanonLab.tsx` | **Surface A — canon pattern lab** (`/pokedex/foil-lab/canon`, 2026-08-02 split): bare pattern on a blank card (no ink) beside the real reference clip + keyframes (`research/foil-video-reference/`, streamed by the branch api), full 39-slug picker, sliders, tilt, **Save canon** → `data/foil-canon/<patternId>.json` (full uniform snapshot; replaces code defaults as the baseline everywhere). **Card preview** (R4b 2026-08-04): a blank/on-card toggle in the viewer slot renders the live slider state on a RANDOM catalog card the resolver assigns the pattern to, with a re-randomize chip — sampled server-side from the baked inversion `data/foil-pattern-cards.json` (gitignored; regenerate with `pnpm --filter pokedex-api exec tsx ../../tools/foil/build-pattern-cards.mts` after catalog syncs or resolver changes). Preview honors saved hand masks + adjusted windows (artwork-keyed) but deliberately NOT per-card uniform overrides — the lab edits canon, and a card's sparse override layered over the sliders would misreport what Save canon produces. Patterns with an empty pool show "no catalog cards" and a disabled toggle. |
| `foil/FoilLab.tsx` | **Surface B — card adjustment** (`/pokedex/foil-lab`): era-grouped card picker over the **whole catalog** (Owned-only is a filter toggle; unowned cards list their catalog variants and resolve a base-guess pattern like any other), full-catalog name search, pattern/scope overrides, mask overlay + hand-mask editing, uniform sliders baselined on canon with **per-card sparse overrides** → `data/foil-overrides/<cardId>/<variantId>.json`, comment queue, Copy-recipe-JSON. Single column at 390px; two columns (viewer \| controls) from 700px (iPad-mini portrait) up. |
| `foil/canon.ts` | The canon-vs-override layering model: code defaults < canon file < per-card sparse override < live sliders. Also `seedUniforms` and the pattern-id → reference-dir mapping. |
| `foil/ui.tsx` | Shared UI atoms for both surfaces + the surface tab switcher. |
| `foil/api.ts` | Self-contained read client (series → sets → paged set cards → card detail, plus `/search`; each browse tier takes an ownedOnly flag) + the foil-lab dev surface (masks, comments). Do NOT import `lib/api.ts`. |
| `apps/api/src/routes/foil-lab.ts` | Branch-instance-only routes (mask save/load with sidecar v2 prior+diff artifacts, artwork-keyed alias lookup, comments → working tree, `GET /pattern-cards/:patternId` random samples from the baked resolver inversion — DB-free by design). Mounted only when `POKEDEX_FOIL_LAB=1`; inert in prod. Artifact generation: `apps/api/src/foil/mask-artifacts.ts` + pure-JS `png.ts`. |

## The uniform contract

A pattern is a GLSL function `vec3 foilPattern(vec2 uv, vec2 tilt)` returning the foil
light layer (linear-ish RGB, 0..~1.5). It is compiled between the shared preamble and the
shared `main()`. `uv` is card UV, **y UP**; `tilt` is `uTilt` (−1..1 per axis).

Core uniforms (global sliders; every pattern may read them):

| Uniform | Meaning |
|---|---|
| `uFace` | the scan texture (only `main()` samples it) |
| `uTilt` | tilt vector — **the primary animator; never animate from `uTime` alone** |
| `uTime` | seconds, ambient drift only |
| `uIntensity` | overall foil gain, applied by `main()` — don't self-apply |
| `uScale` | global pattern scale — multiply your spatial frequencies by it |
| `uHueShift` / `uHueSpread` | base hue offset / hue variation width — feed `hueRamp()` |
| `uSat` | rainbow saturation, applied **inside** `hueRamp()` (0 = silver) |
| `uArtGate` | luminance gate applied by `main()`: foil shows in dark scan areas, printed ink stays readable. The cheap precursor to art-driven masks. |
| `uSpecular` | shared white sheen band, applied by `main()` |
| `uDarken` | mirror-substrate attenuation, applied by `main()` (2026-08-02 R2 blend-model term, default **0 = exact legacy render**). **Blank-base path only** (R4b): on the canon lab's tone bases it darkens the substrate as before (dark-mirror moods live here); on REAL CARD SCANS (`uScanBase 1` with `uInkGuard > 0`) it is INERT — the scan is a photograph that already carries the substrate's rest appearance, and Chey's Grubbin ruling is that foil on a scan never darkens anything. Opt in per recipe via `defaults`; recipes may also read it. Absent key in canon/override/sidecar JSON = 0 = no effect. |
| `uTint` | **metallic ink tint** (2026-08-03 R3-MISC, default **0 = exact legacy render**). Physically: a mirror foil's flash crosses the printed ink twice, so over colored art the flash carries the ink's OWN color — achromatic light instead compresses chroma and reads dull/grayish (Chey's modern-reverse complaint). On scans the R4b law tints the additive light by `mix(1, tint², max(uTint, chromaRamp))` where `tint` = luminance-normalized scan chroma (direction only, no gain) and `chromaRamp` = `smoothstep(0.02, 0.45, chroma)` — saturated print always colors its own light even at uTint 0; uTint is the floor for neutral paper. Neutral over silver/white, so blank-card canon renders are IDENTICAL at any value. Opted in by the reverse-family recipes (mirror 0.7→0.81 canon, rainbow-mirror 0.7, reverse-sheet 0.7, pokeball-masterball 0.7, energy-symbols 0.6, energy-symbols-ii 0.6, pinwheel 0.6, fireworks 0.5, prism 0.4, disco 0.5). |
| `uInkGuard` | **scan-composite engagement** (R4b 2026-08-04, default **1**; **0 = exact pre-R4 legacy composite**). On a real card scan (`uScanBase 1`) this fades in the SCAN-ADDITIVE law (`smoothstep(0, 0.35, uInkGuard)` — saturates by 0.35 so mid-range canon values run the safe law fully). The law itself is parameter-free protection: additive-only light, tilt-gated to zero at rest, luminance-headroom clamped (see the Blend model section). Inert on the canon lab's blank bases (`uScanBase 0`), where the classic composite runs unchanged — blank-card canon renders are pixel-identical at ANY value (R4b CDP frame-stepped zero-delta harness, AE 0). |
| `uInkPop` | **metallic chroma pop** (default **0.5**; **0 = none**): under the flash, colored print gains SATURATION along its own hue — `+ (scan − lum) · uInkPop · 0.5 · chromaRamp · drive · L²` — a Rec.601-luminance-neutral chroma pump (bands make colors shimmer more vivid, never washed), gated by `L²` so glyph ink never re-hues toward the paper. Scan path only; inert on blank bases and at `uInkGuard` 0. |
| `uScanBase` | **surface-owned mode switch** (R4b): `1` = `uFace` is a real card scan (both card surfaces + the canon-lab card preview) — the scan-additive law applies; `0` = synthetic blank base (canon-lab pattern room) — classic composite, bit-identical canon renders. Set via `ViewerSettings.scanBase` (default true; CanonLab's blank render passes false). NEVER a slider, never stored in canon/override files. |
| `uMask*` | layout mask uniforms — handled entirely by `main()`; patterns never mask themselves |
| `uMaskTex` / `uMaskTexOn` | hand-mask tier: when on, `main()` samples the mask canvas's ALPHA (shader flips V; the CanvasTexture sets `flipY=false` — exactly one flip, ever) instead of the layout rect |
| `uGlyphTex` / `uGlyphOn` / `uGlyphCount` / `uGlyphCols` | **glyph slot** (R3-GLYPH 2026-08-03): rasterized atlas of Chey's real glyph artwork from `research/foil-glyphs/<slug>/` (see its README for the drop contract). Driven by CardViewer's auto-pickup poll via `foil/glyphs.ts`, never by sliders or canon files. Recipes with a slot branch on `uGlyphOn` and sample via the preamble helper `glyphTex(idx, p)` (p glyph-local, y up, box \|p\| ≤ 0.5, returns rgba·inside; a = coverage, rgb luminance = optional interior detail). `uGlyphOn = 0` (no assets / prod) = the recipe's procedural fallback glyphs, bit-for-bit the shipped look. Slot registry: `GLYPH_SLOTS` in glyphs.ts (reverse-sheet, energy-symbols, energy-symbols-ii — shares energy-symbols' atlas, prismatic-pokeball). |
| `uP0..uP5` | **yours** — per-recipe params, surfaced as labelled sliders (uP4/uP5 added R3-MISC 2026-08-03 for recipes that outgrow four params — first user: gold-secret's per-card burst origin. Old canon snapshots simply lack the keys and inherit code defaults.) |

Preamble helpers available to every recipe: `hash21`, `hash22`, `vnoise`, `fnoise`
(3-octave fbm), `hueRamp(t)` (uSat-aware cosine rainbow), `screenBlend`, `sdRoundRect`,
plus constants `PI`, `TAU`, `CARD_ASPECT` (h/w ≈ 1.3755). For isotropic patterns multiply
uv by `vec2(1.0, CARD_ASPECT)` so cells aren't stretched.

Blend model (in `main()`, R4b SCAN-ADDITIVE 2026-08-04 — supersedes R4's
ink-density heuristics, which Chey's Grubbin review refuted: the stacked
per-pixel estimates repainted the card at rest, rest ΔC +32 with a
green→yellow hue push, header −22 L under tilt, glyph contrast −26% under the
lobe). **The composite contract, three invariants BY CONSTRUCTION on real
card scans (`uScanBase 1`, `uInkGuard > 0`):**

1. **Rest parity.** The scan is a PHOTOGRAPH of the real card at rest — it is
   already correct. All foil light is scaled by `smoothstep(0.02, 0.28,
   |uTilt|)`: at neutral tilt the render IS the scan, exactly (measured ΔL =
   ΔC = 0.00 in every region on the whole R4b sample set).
2. **Flash adds, never subtracts.** `col = scan + light, light ≥ 0`. No
   uDarken on scans, no screen-blend, nothing multiplies the base down.
3. **Text sacred at every angle.** The light (pattern flash AND the shared
   specular — one clamp covers both) is bounded by a per-pixel luminance
   headroom `allow = max(1.6·L⁴·(1−L), 1.4·uArtGate·darkSmooth·(1−L))` and a
   per-channel distance-to-1 cap. The quartic starves glyph ink (modern glyphs
   are MID-dark, L 0.35–0.45 — a gentle ramp lights them; measured) and gives
   paper tones (L≈0.8) the sheen; whites have no headroom, so nothing ever
   blows out, and the per-channel cap means no channel clips (clipping is what
   hue-rotated green→yellow in R4). The `uArtGate` channel is the one licensed
   exception: gated recipes declare dark scan areas ARE the foil (WOTC holo
   backgrounds), so those pixels flash — text sits outside the window mask on
   gated cards.

Light is chroma-preserving (`inkTint` — see the `uTint` row) and `uInkPop`
pumps saturation along the pixel's own hue (luminance-neutral). Consequence to
know: **dark stamp features (masterball silhouettes) render as light stamps**
on scans — adds-only cannot darken; that is invariant 2's price.

On the canon lab's blank bases (`uScanBase 0`) the CLASSIC composite runs
textually unchanged — screen-blend + uDarken substrate + R4's (self-zeroing on
flat tones) ink estimates — so dark-mirror canon moods still exist in the
pattern room and every saved canon renders bit-identically (AE-0 proven per
change via the CDP frame-stepped harness; see DECISIONS 2026-08-04). Zero
knobs = legacy: `uInkGuard 0` (+ `uInkPop 0`) reproduces the pre-R4
screen-only composite exactly on EVERY surface.

## Adding a pattern (worked example: Crosshatch)

1. **Research the physical process.** Bulbapedia "Holofoil" is canonical; the Collexy
   "Database Insight: Holofoil" series has close-up photos. Crosshatch = fine diagonal
   line grid in two directions, used on certain SWSH-era promos. Find reference
   photos/video showing how it moves with tilt before writing GLSL.
2. **Append a recipe to `PATTERNS` in `foil/patterns.ts`:**
   ```ts
   {
     id: 'crosshatch',
     label: 'Crosshatch',
     taxonomy: 'Crosshatch line foil',
     usedOn: 'SWSH-era promos …',
     glsl: `
   vec3 foilPattern(vec2 uv, vec2 tilt) {
     float sweep = tilt.x + tilt.y * 0.6;
     vec2 p = uv * vec2(1.0, CARD_ASPECT) * uP0 * uScale;
     float a = 0.5 + 0.5 * sin(TAU * (p.x + p.y) + sweep * uP1);
     float b = 0.5 + 0.5 * sin(TAU * (p.x - p.y) - sweep * uP1);
     float lines = pow(a, 8.0) + pow(b, 8.0);
     vec3 col = hueRamp(uHueShift + uHueSpread * (uv.x * 0.4 + uv.y * 0.3 + 0.7 * sweep));
     return lines * col * uP3;
   }`,
     defaults: { uIntensity: 1.0, uSat: 0.7, uArtGate: 0.4, uSpecular: 0.4 },
     params: [
       { key: 'uP0', label: 'Line density', min: 5, max: 60, step: 1, default: 24 },
       { key: 'uP1', label: 'Drift rate', min: 0, max: 4, step: 0.05, default: 1.2 },
       { key: 'uP2', label: '(unused)', min: 0, max: 1, step: 0.01, default: 0 },
       { key: 'uP3', label: 'Gain', min: 0, max: 3, step: 0.05, default: 1.0 },
     ],
   },
   ```
   Conventions: params ≤ 4, every param gets a real label/range/default; unused slots are
   marked `(unused)`; set `uArtGate` per how the physical foil interacts with ink
   (window/full foils ≥ 0.3; mirror/reverse sheets 0 — the sheet is on light card body).
3. **Wire the resolver if a real printing uses it** — add/adjust a branch in
   `resolver.ts` so `Auto` picks it for the right `(era, rarity, kind)`. A recipe that's
   only reachable via the override dropdown is fine while tuning.
4. **Tune on the workbench.** Two dev servers (ports are assigned — `roadmap/ORCHESTRATION.md`):
   `POKEDEX_API_PORT=3712 POKEDEX_FOIL_LAB=1 PGPOOL_MAX=1 rtk pnpm --filter pokedex-api
   exec tsx src/index.ts` (the branch api — masks/comments write into the worktree; keep
   PGPOOL_MAX=1, the connection budget is a hard house rule) and
   `POKEDEX_DEV_API_PORT=3712 rtk pnpm --filter pokedex-web exec vite --host --port 5182`.
   Open `/pokedex/foil-lab`, pick an owned card of the target printing, select your
   pattern, drag sliders until it matches the reference photos, then **Copy recipe JSON**
   and bake the tuned values back into `defaults`/`params` defaults. Chey's workbench
   comments land in `issues/foil/<id>/` (report.md + context.json with the full slider
   state) — read them before tuning a pattern he has already commented on.
5. **Verify like the house rules demand:** Playwright screenshots at 390px and desktop
   with tilt applied (simulate pointer with `page.mouse.move` over the canvas); actually
   look at them. Two known verification traps: (a) a hot vite server that received edits
   to `main.tsx` can double-mount the page on fresh loads — restart the dev server before
   judging screenshots (a guard in `main.tsx` also protects this); (b) judge masks with
   the **mask overlay toggle** + pattern *None*, not by eyeballing a busy foil.
6. Typecheck + build (`rtk pnpm --filter pokedex-web exec tsc --noEmit && rtk pnpm
   --filter pokedex-web build`), commit on a `foil/*` sub-branch, merge to `foil/main`
   only. Append a DECISIONS.md entry if you learned something non-obvious.

## Taxonomy status (research/foil-patterns.md — 43 canonical types: 39 video + §40–43 vocab)

The dropdown carries ALL 43 taxonomy types plus `none` and `reverse-sheet`.
Implemented recipes after the R1 wave (2026-08-02): **Starlight** (#1; #24 Starlight II at
parallax 0), **Cosmos** (#2 — label is Cosmos only; "Galaxy" is Bulbapedia's synonym for
*Starlight*), the **sheen family** — ONE generator (`sheenGlsl`) at four rotations + stripe
option: `vertical-sheen` (#14, ex-`sv-holo`), `horizontal-sheen` (#21, the TRUE SV default /
Bulbapedia "Mirage"), `diagonal-sheen-right` (#19, "\\"), `diagonal-sheen-left` (#20, "/" — slopes CORRECTED 2026-08-02 R3, see field notes),
`striped-vertical-sheen` (#22, "Line") — **Reverse sheet** (coarse ring+dot tier, kept),
**Cracked Ice** (#9, now with the anisotropic shattered-glass metric), the **twelve R1
recipes**: `fireworks` (#3), `energy-symbols-ii` (#8), `cosmos-iii-smooth` (#16),
`tinsel-ii` (#18), `radiant` (#26), `rainbow-glitter` (#27), `rainbow-glitter-sheen` (#28),
`ace-spec` (#29), `pokeball-masterball` (#30, true ball SDF + Master Ball toggle on uP1),
`prismatic-pokeball` (#31), `ex-starfoil` (#33), `confetti` (#37), and the **thirteen R2
recipes** (2026-08-02): `mirror` (#4), `rainbow-mirror` (#5), `vertical-sheen-rainbow`
(#13) — the dark-mirror family on uDarken — `energy-symbols` (#7), `pinwheel` (#10),
`ex-emerald` (#11), `pokeball-hologram` (#12), `cosmos-ii-pixel` (#15), `tinsel` (#17),
`prism` (#23), `water-web` (#25), `radiant-collection-dots` (#32), `crosshatch` (#35) —
and the **four R2b vocabulary recipes** (2026-08-02): `gold-secret` (§40),
`vstar-pearl` (§41), `shiny-vault` (§42), `detective-pikachu` (§43) —
**38 of the 43 taxonomy types are real** (34 hold match verdicts — all four R2b
recipes match; standing nays: starlight, energy-symbols, pokeball-hologram,
radiant-collection-dots — see verification doc R2 + R2b sections). The 5 remaining
approx types have no catalog exemplar (big-glitter, sequin, tcg-classic, acid-wash,
disco — the R3 list). To ship a real recipe: write the GLSL, flip the entry to
`implemented: true`, drop `approxVia`.

## Per-pattern field notes (distilled from resolved workbench comments)

Chey's workbench comments (`issues/foil/<id>/`) are corpus: when one is resolved, its
insight is distilled here (mask-pipeline SKILL, "Codify" step 6) so the next agent
tunes from his eye, not from scratch. Read the full comment before touching a pattern
that has one.

- **Starlight** (`issues/foil/2026-08-01_22-40-03-629_ftoz71`, resolved): real WOTC
  Starlight is LAYERED — star layers shift left/right *against each other* with tilt (a
  parallax 3-D quality), star shapes are a MIX of crisp glyph-like sparkles and soft
  blurry ones living on different depth layers, and star brightness breathes smoothly —
  binary appear/disappear reads wrong. Implemented as three `starLayer()` passes at
  opposing parallax offsets (back = soft blobs moving against tilt, front = crisp
  glyphs moving with it), per-cell existence culling so the field reads as
  constellation not confetti, and a floor+wide-lobe visibility curve (`0.18 + 0.82 *
  pow(cos, 5)`) instead of a `pow(cos, 28)` blink. `uP1` is parallax depth.

### R0 re-tune wave (2026-08-02) — what moved each Gemini score

Chey's ruling ("chase Gemini's notes on everything") unlocked GLSL changes; full
score table in `research/foil-verification.md` (R0 section). Distilled lessons:

- **Fix the compositing base before trusting ANY visual judgment.** The scan texture
  was sRGB-decoded by the GPU (`SRGBColorSpace` upload) but the ShaderMaterial never
  re-encoded — every card's artwork rendered in linear values (flat 184 → render 123,
  the exact sRGB→linear curve). three.js only appends `colorspace_fragment` to
  BUILT-IN materials; a ShaderMaterial writing `gl_FragColor` raw must either
  re-encode or sample undecoded. This renderer's whole blend model (screenBlend,
  hueRamp, art-gate thresholds) is authored in DISPLAY space, so the fix is
  `tex.colorSpace = NoColorSpace` (CardViewer.tsx) — pattern `none` at rest is now
  pixel-comparable to the flat `<img>` (mean |Δluma| 2.16, resampling noise). Every
  recipe tuned before this fix was tuned against a darker base.
- **Cosmos (5/20 → 19/20): activation window beats element styling.** The wall-of-orbs
  failure wasn't orb art, it was every orb being lit at once. Dark field + narrow
  window (`pow(cos, 22)`) + tiny floor (0.055) + CLUSTER activation (low-freq `vnoise`
  over cell ids so neighbors pop together, per-orb nudge for ragged edges) is what
  made it read real. Pinprick 4-point twinkles on a separate high-freq grid sell the
  "spectral points" the video shows.
- **Sheen family: the generator now takes per-slug options** (`sharp` band exponent,
  `beam` gain, `barcode`). vertical-sheen (13→20) is the `barcode` variant: thin
  spectral lines with per-line random width/offset/brightness. Keep `SHEEN_V` (plain)
  separate — mirror/rainbow-mirror fallbacks are explicitly smooth sheets. Over LIGHT
  scans (HGSS watercolor) the broad beam floods to white: beam 0.3 + art gate 0.5
  there. Diagonals: sharp 3.0, beam 0.55, specular 0.35 killed the center blow-out;
  uP0 7 on BOTH diagonals (same physical sheet).
- **Cracked-ice (10→15 yay, via a 6 detour): amplitude IS opacity.** Removing the
  intra-shard grain at full flash amplitude turned facets into "flat pastel stickers
  obscuring the artwork" — screen-blend clamping reads as opacity. Facet gain 0.55
  keeps the art visible THROUGH a flash, which is what makes it read as foil, not
  overlay. Residual: uniform Voronoi cells vs the reference's long-thin + tiny-triangle
  shatter mix (R1 geometry item).
- **Starlight (8 → 11, still nay after 3 rounds): stills can't score parallax.** The
  judge's two asks — tighter pop windows AND visible layer parallax — fight each other
  in an 8-frame sweep: tight windows mean no star survives frame-to-frame, so nothing
  can be tracked shifting. The parallax is real in motion (verify by eye in the
  browser). If R1 needs the yay, judge from a video clip; don't revert the pop
  tightening to game the stills. Glyph craft that DID score: long THIN arms
  (along-axis reach ~0.29 of cell, across ~0.07 — `1-|sp|*3.5` × `1-|sp|*14`), an
  8-point subset via 45°-rotated arms on `step(0.6, hash)`, near-full hueRamp color
  (mix 0.85+). Note the first sharpening pass made arms NARROWER but also SHORTER
  (both k factors up) and Gemini called the stars "too small and uniform" — arm LENGTH
  and arm WIDTH are separate dials; shrink only width.
- **Judge-noise discipline: geometry precedes verdicts.** diagonal-sheen-left dropped
  20/20 → 15/20 purely on a mirrored-slope claim — the DOCUMENTED Gemini failure mode.
  The band normal in the GLSL had not changed; re-judging the identical frames returned
  19/20 with the slope called "correct". When the only discrepancy contradicts code
  geometry you can prove, re-judge before re-tuning — and never "fix" a slope on a
  verdict's word alone.
- **Banked verdicts pin shared code.** starlight-ii's 20/20 rides `STARLIGHT_GLSL` +
  inherited defaults. After banking it, base-starlight tuning had to stay in
  starlight-only defaults (uP1/uP2/uP3/uSat), and II's uP2 was pinned explicitly.
  Before touching a SHARED GLSL body, list which patterns' verdicts it would
  invalidate and either re-judge them too or don't touch it.

### R1 recipe wave (2026-08-02) — twelve new recipes, what the judge rewarded

Full verdict table in `research/foil-verification.md` (R1 section). Distilled lessons
for the next recipe author:

- **Structure first, styling second — again.** 8 of 12 recipes passed on round 1
  because the MACRO structure was right (burst field, square lattice, ball stamps,
  segmented criss-cross, glitter-over-mirror). Every round-1 failure was a macro-
  structure miss, not a styling miss: the chevron band had left the card at sweep
  extremes ("straight diagonal band"), the watermark was invisible, scanlines too
  regular, flakes 5-10x too big. Eyeball the BLANK-CARD canon lab render against the
  clip before ever burning a Gemini round — three of the four round-1 failures were
  visible there in hindsight.
- **Shaped features must survive the WHOLE sweep.** A moving feature tuned to look
  right at rest can exit the card at |tilt| ≥ 0.7 and the 8-frame judge then never
  sees it (rainbow-glitter-sheen round 1). Check the extreme frames, not the pretty
  middle ones.
- **Screen blend over a bright card body eats color.** Reverse-sheet patterns
  (prismatic-pokeball) need gain ~1.8, uSat 1.0, and gamma-deepened ramp colors
  (`pow(hueRamp(h), vec3(1.7))`) before they read as saturated foil rather than a
  pastel tint — the same amplitude that would blow out a dark WOTC window is barely
  visible over a light silver body.
- **"Uniform" is the judge's favorite complaint.** Grids and scanlines need jitter on
  EVERY axis they repeat on: per-line position jitter + cubic thickness variance +
  noise-wavered line coordinates (tinsel-ii needed all three plus a third density
  octave before the static read as chaotic). Per-seed anisotropic voronoi metrics
  (random axis + elongation, euclidean/L1 blend for angular corners) fixed the same
  complaint for cracked-ice shard geometry.
- **Procedural SDF glyphs pass for icon fields at video resolution.** energy-symbols-ii
  went 15/20 yay with crescent/flame/star/leaf SDFs — no icon atlas needed at 480p
  reference fidelity. The honest residual (colors too neon vs the reference's muted
  blend) is a tuning note, not an architecture gap.
- **The 16-frame fine-sweep variant exists for motion cues** (`capture-sweep16.js` in
  the session scratchpad pattern, `jobs/starlight-r1-fine.json`): 16 consecutive
  frames at x = −0.45…+0.45 so adjacent frames differ by 0.06 tilt, with the prompt
  telling the judge to TRACK stars across adjacent frames. Reuse it for any pattern
  whose signature is parallax/motion rather than texture.

### R2 blend-model wave (2026-08-02) — the uDarken term, and how to use it

Full results in `research/foil-verification.md` (R2 section). Canonical guidance for
recipe authors:

- **What it is.** `uDarken` (core uniform, global default 0) attenuates the scan by
  `1 - uDarken * mask * gate` BEFORE the additive foil screen-blends. Physical reading:
  the foil layer is a mirror between the printed body and the viewer — at non-flash
  angles it reflects the (dark) environment instead of diffusing, so the substrate seen
  through it is darkened across exactly the coverage field the additive layer lights.
  It is ONE shared term in `main()`; patterns opt in via `defaults`, never by darkening
  inside `foilPattern()`.
- **When to use it: the reference substrate is dark at most angles.** Rainbow-mirror
  family (dark mirror between flashes), dark broken static (tinsel-ii), ink-overprint
  watermarks. When the reference substrate stays LIGHT silver (pokeball-masterball,
  confetti), uDarken is physically wrong even though it would "add saturation" — don't
  reach for it as a color-grading knob.
- **What it unlocked.** prismatic-pokeball nay → 17/20 yay: dark-mirror base
  (uDarken 0.6) + broad flash lobe + facet quantization + the ball watermark as
  ink-overprint SUPPRESSION (`base *= 1 - wm * k`) — an overprint absorbs, so it reads
  darker inside the flash and vanishes at dark angles. Suppression-over-darkened-base is
  the general recipe for anything printed ON TOP of foil. tinsel-ii nay → 16/20 yay from
  the one-line opt-in (uDarken 0.4): the dark half of "static" is the darkened gaps
  between additive lines.
- **Saturation physics.** Screen-blending saturated color over a mid-gray body washes
  pastel; over a properly dark base the same additive layer reads vivid. If a
  dark-substrate pattern reads pastel, raise uDarken before raising gain (prismatic
  went 0.5 → 0.6 for exactly this).
- **Tint.** A tinted dark substrate = uDarken + the pattern adding a dim flat tinted
  floor (e.g. `vec3(0.055) * (1.0 - lobe)` keeps prismatic's dark state metallic-silver
  rather than void-black).
- **Compatibility is absolute.** uDarken=0 is bit-identical to the pre-R2 composite;
  absent keys in canon/override/sidecar JSON mean 0. The 21-pattern regression sweep
  (provably identical renders) measured judge noise at ±3–6 points per roll and ran
  colder than earlier batches — before believing any future "regression", check the
  render is actually different (frames diff, GLSL diff) and re-judge; two patterns
  (diagonal-sheen-right slope claim AGAIN, pokeball-masterball) failed twice on
  pixel-identical renders and keep their banked verdicts on geometry-proof grounds.

### R2 recipe wave (2026-08-02) — thirteen recipes, unowned eras + RC dots

Full verdict table in `research/foil-verification.md` (R2 recipe-wave section).
Distilled lessons:

- **GLSL glyph scaling: `p = f / k` renders the glyph at size ∝ k, not 1/k.** The
  energy-symbols "make them bigger" tune DIVIDED by a smaller k twice and shrank the
  icons both times — the judge's "3-4x too small" was geometric truth across two
  rounds. When resizing SDF glyphs, sanity-check the rendered size against the cell
  in the canon lab before re-judging.
- **uDarken over a WINDOW mask is visible as a rectangle when the art bleeds past
  the era rect.** Cyclone Energy's vortex runs nearly full-card; window-scoped
  uDarken 0.3 read as "a dark rectangular mask over the top half" (verified on
  frames). Strong uDarken needs the mask to match the FOIL's true extent — a
  per-card art-extent mask (mask-pipeline item), not an era rect. Until then keep
  uDarken mild on window-scope patterns whose exemplar art overflows the rect.
- **Art gate vs dark-gap references: use uDarken, not uArtGate.** Three EX-era
  window foils (energy-symbols, ex-emerald, pokeball-hologram) have references with
  DARK gaps/fields, but gating the pattern to dark scan areas erased it over light
  exemplar scans — the dark gaps are the darkened SUBSTRATE (uDarken 0.25-0.35 +
  gate ≤ 0.15), not scan luminance.
- **Ball glyphs need circle + thin belt + BUTTON.** A disc with a belt reads as
  "⊖"/an e-reader "e" (judge, correctly). The center button at ~1.2 gain is what
  makes a small SDF read as a Poké Ball.
- **Judge-consistency ≠ judge-correctness.** radiant-collection-dots' "dots are
  completely static" note survived a re-roll on identical frames, yet is pixel-false
  (30%+ of bright pixels toggle every adjacent frame; population swells 20k→29k→21k
  through the flash). A consistent wrong note usually means the judge anchored on a
  different failure (here: soft snow-like dot styling + shape windows swamped by the
  busy RC29 full-art scan) — read the WHOLE verdict before spending a round on the
  loudest claim. Exemplar choice matters: a sparser RC card may judge better.
- **Parallax stills-blindness now has two data points** (starlight, and
  pokeball-hologram — the same layered machinery with ball glyphs). Expect any
  true-hologram pattern to cap at nay under still-frame judging; the layers
  verifiably shift in the live renderer.
- **Round-1 eyeballing keeps paying**: cosmos-ii-pixel and radiant-collection-dots
  both left the first GLSL pass as sparse night skies (tight windows + low floors)
  and were fixed from blank-card renders before any Gemini spend; cosmos-ii-pixel
  then scored a clean 20/20 on round 1.

### R2b vocabulary wave (2026-08-02) — the four §40–43 recipes

Full verdict table in `research/foil-verification.md` (R2b section). Distilled:

- **A warm-locked field means NOT calling hueRamp for the field.** gold-secret's
  gold body uses a private 2-stop `goldRamp()`; `hueRamp`/`uSat` only paint the
  chromatic glitter pops. Pinning hue via uniforms (uHueSpread 0) would still let
  canon/override sliders re-rainbow the field — structural locks belong in GLSL,
  slider-reachable styling in uniforms.
- **`uFace` in a pattern is legal exactly once: detective-pikachu.** The recipe's
  identity is beam × photo LUMINANCE (bright smoke/fire volumes catch the sheen
  first) — the inverse of `uArtGate`, which gates on darkness. It samples
  `texture2D(uFace, uv)` inside `foilPattern()` as a documented contract
  exception. It scored a clean 20/20 first try. Corollary: photo-coupled patterns
  render near-BLACK on the canon lab's blank dark base by design — eyeball them on
  the real scan, not the blank card.
- **Near-white substrates need uDarken even when the reference "stays light".**
  The R2 rule (don't darken a light-silver substrate) has a boundary case: vstar
  pearl (uDarken 0.3) and shiny-vault (0.15) are near-WHITE interference foils
  whose fields visibly dim/tint off-flash — without the term, the entire treatment
  is illegible over a bright scan (shiny-vault round 0 rendered as the plain
  card). Distinguish "light silver metallic" (pokeball-masterball — leave at 0)
  from "white interference pearl" (darken mildly).
- **Legibility fixes overshoot; expect a two-step.** shiny-vault's band gain went
  0.45 (invisible) → 0.95 (judged "overly intense") → 0.62 + a WHITE lift riding
  the band. When a pastel treatment needs more presence, add whiteness with the
  color, not more chroma.
- **Amplifier glyphs ≠ glitter pops.** The shiny-vault sparkle glyphs are keyed to
  the band position at the glyph (`bandEnv` at that uv), NOT to per-cell random
  alignment windows — the reference glyphs never pop independently, they catch
  the passing sheen. The judge still wants their peak whiteness lower (residual).
- **Scope now travels with assignment rows (resolver v5).** A winning row's
  `scope` field overrides the kind/rarity-computed scope; the cls-'normal' tier
  honors it too (default 'full'). This is how baby shinies render window-scope
  despite 'Shiny rare' being a FULL_FOIL rarity, and det1 renders window despite
  'ultra rare'. Regenerate `assignments-index.json` after editing rows.
- **Judging against the exact same card is gold.** Three of the four references
  show the very card we render (det1-5 scored 20/20; identity friction was zero).
  When choosing corpus footage for future patterns, prefer a demo of a card that
  is IN the catalog.

- **External ground truth outranks internal proofs (the R3 diagonal swap — read
  this before dismissing ANY consistent external claim as hallucination).** Both
  diagonal sheens rendered each other's slope for a full day of waves. Gemini
  reported the mirrored slope THREE times; each report was dismissed via a
  geometry proof (band normal provably renders "/"), and the dismissal was even
  codified as "the documented slope-misID failure mode". The proof was sound but
  proved the wrong thing: render-matches-code-comment, not slug-matches-reality —
  the harvest had anchored the slope on a frame where the raw sheet was held
  ROTATED in-hand. Chey's one look at the physical reference settled it. Rules
  distilled: (1) an internal-consistency proof can never clear a claim about the
  MAPPING to reality; (2) verify slope/orientation claims only on frames where
  the sheet/card is upright, and cite the frame numbers in the code comment;
  (3) a claim that stays CONSISTENT across re-rolls and rounds is signal — the
  documented-hallucination label must be re-earned against ground truth each
  time it is applied, or it becomes a self-sealing dismissal.
- **The sheen family is a STREAK FIELD, not a grating (R3, Chey's canon-lab
  critique).** Real sheen sheets read as individual finite streaks: irregular
  spacing/width (per-cell hash + existence drop), per-streak lean that follows
  tangential tilt with opposite bias per layer (crisscross; a streak shearing
  out of its grating cell terminates — converging pairs "come to a point" for
  free), stretched-ellipse envelopes along the band, and hue advancing ALONG
  each strip as well as across (each strip its own rainbow). Keep uniform
  semantics stable when swapping a generator's internals: same uP0×uScale mean
  spacing, same drift/gain meanings — Chey's canons must carry over unchanged.
- **Canon files are FULL uniform snapshots — a recipe-default change never
  reaches a canon'd pattern.** If a rework needs a new default (e.g. uDarken for
  legibility), migrate the canon value in-place and record it in DECISIONS;
  otherwise the fix silently applies only to canon-less patterns.
- **Bright-substrate legibility, third confirmation (striped/horizontal/
  ex-starfoil R3):** saturated streaks over a bright scan are unrenderable
  screen-only — add uDarken (0.2–0.35) and deepen color with pow on the hue
  ramp; raw gain just clips to white through the fragment clamp.
- **Low-frequency streak fields go blank without a fill variant.** At ~2 grating
  cells on-card, existence drops + envelope taper leave whole tilt ranges empty
  (a REAL judge nay, not noise). Scope the fix per-slug (fill option) so
  passed patterns' GLSL stays byte-identical and their verdicts stay banked.
- **Grouped-reveal windows must be sized in the pattern's own coordinate.** The
  striped fan's on-card angular range is ±~0.10 rad; a window clamp of ±0.16
  parked the lit group off-face at strong tilt. Derive window travel from the
  visible coordinate range, not from the tilt range.

- **R3-MOTION field notes (2026-08-03).** (1) Ask which MOTION MODEL a foil uses
  before tuning sliders: starlight is axis-split (vertical tilt = global field
  shift on all layers, horizontal = per-star random fade), cosmos is the inverse
  ruling — zero axis separation — each dot owns independent random tilt directions
  for brightness and hue; radiant is discrete hologram steps (positions
  crossfade, never slide). One shared sweep scalar can't express any of these.
  (2) The cosine hueRamp's peak order is R→B→G (t = 0, 1/3 blue, 2/3 green) —
  derive banded-hue mappings from the actual peak order, not spectral intuition.
  (3) A crossfade between interleaved gratings is judge-invisible in stills
  (reads as a slide) — pixel-verify with cropped adjacent fine-sweep frames and
  flag for the owner's live tilt instead of chasing the note.
  (4) When the owner "can't explain the difference", run an articulation-only
  vision pass (no verdict, sections + image-citation validator) and pixel-verify
  each claimed delta before coding — two of five claims were exaggerations, one
  real delta (the repeat chevron) the pass missed entirely.

- **R3-GLYPH field notes (2026-08-03).** (1) **The glyph slot is the pattern for
  owner-supplied artwork:** assets in `research/foil-glyphs/<slug>/`, dev-gated api
  routes, a polling rasterizer (`foil/glyphs.ts`) and shader branch on `uGlyphOn` —
  missing asset = procedural fallback, bit-identical to the shipped look, so the
  drop is zero-risk and zero-code. Add a slot by registering the slug in
  `GLYPH_SLOTS` and branching the recipe's glyph term on `uGlyphOn`. (2) **"X
  shouldn't darken, it catches light differently" cannot be met with a hue
  offset alone:** a saturated magenta can never reach a saturated yellow's
  luminance through the fragment clamp — hue-offsetting a region reads as
  darkening whenever the ramp lands on a low-luma hue. Differentiate a region
  with a WHITE-mixed (paler/shinier) response, a small phase lead on interior
  detail, and/or a coherent plane-flash — never with chroma that fights luma.
  (3) **Randomized per-element phases are still-frame-invisible (5th data
  point):** checkerboard swaps, random-bank swaps, and per-square size pulses
  all judged "static" against frames that pixel-refute the claim — embedding
  track-this-element protocols in the prompt did NOT break the blindness; one
  judge named a specific square whose change its own frames show. Pixel-verify
  first, spend at most one round on protocol, then bank the pixel proof and
  flag for the owner's live tilt. (4) **A lit bank must be WHITE-LIFTED, not
  just bright:** hue-ramped glyphs at full visibility still read dim when the
  ramp hands them blue/olive — `hueRamp * lum + white * sq` keeps a
  checkerboard legible. (5) Band/window envelopes have a narrowness cliff:
  sharpening radiant-collection-dots' band from 2.2/pow3 to 3.2/pow3 left most
  sweep frames lighting NOTHING — after narrowing an envelope, re-check what
  fraction of the sweep actually lights features (same family as the R3
  grouped-reveal window lesson).

- **R3-MISC field notes (2026-08-03).** (1) **Achromatic light over colored art
  is the "dull and grayish" failure mode:** screen-blending white/silver foil
  raises all three channels equally and compresses chroma — a saturated red
  lands at pastel pink, worse with `uDarken` attenuating the body first. The
  physical model is a DOUBLE ink pass: reflected flash × (luminance-normalized
  scan chroma)² — that's the `uTint` term, and it turns the same flash into
  saturated art-colored metal (before/after: Victini sv10.5b-012 ball reverse).
  It is exactly neutral on the blank canon-lab card, so canon appearance never
  moves — which also means you CANNOT see it in the lab; verify on card scans.
  (2) **A canon value can encode a dead recipe's structure:** fireworks' canon
  uP0 3 was saved when TWO overlapping burst octaves doubled effective density;
  the single-lattice rework at uP0 3 was visibly sparser than his saved look —
  migrated 3 → 4.5. When a rework changes recipe STRUCTURE (layer counts,
  octaves), re-derive what each canon value achieved visually, don't carry the
  number. (3) **Jittered-vertex triangulation needs a containing-quad search:**
  classifying a pixel by `floor()` cell draws the straight lattice back into
  the shards (jittered quads don't align with cells) — search the 3×3
  neighborhood for the quad that contains the point. (4) **"Roughly half
  invisible at any tilt" is a 50%-duty binary gate** (`smoothstep` over
  `sin(TAU·phase + dot(axis, tilt)·k)`), not a deeper visibility curve — the
  same machinery generalizes to any "population swaps with tilt" note.
  (5) **Pixelated stamp edges need ~6-8 quantization steps across the
  silhouette** — quantize the shape-local coord and use a HARD step; at ~3
  steps every silhouette collapses into a plain square. (6) For a "more like X
  than Y" redirect with NO catalog exemplar, run the corpus-vs-corpus
  articulation pass first (prism vs pinwheel here): reference-vs-reference
  deltas are shader-actionable and cheap, and the four no-exemplar rebuilds
  (sequin/tcg-classic/acid-wash/disco) all reuse existing family machinery
  rather than inventing new looks.

- **R4-COMPOSITE field notes (2026-08-03).** (1) **The ink-density estimate must
  be RELATIVE (local contrast), not absolute:** the canon lab's blank bases
  include near-black tones (`#171921`), so "dark pixel = ink" would kill blank
  renders. `inkDark` compares each pixel to an 8-tap two-ring local average
  (radii 0.011/0.028 UV, aspect-corrected) — flat base ⇒ average == pixel ⇒
  exactly 0. Chroma can stay absolute because every lab tone is near-neutral
  (max chroma 0.06 < the 0.12 floor). Mip/LOD bias was rejected: GLSL ES 1.00
  under WebGL2 has no fragment `textureLod`, and mip radius varies with
  on-screen size — fixed UV taps are resolution-independent card-space units.
  (2) **Proving "pixel-identical" through a live viewer needs a frame-stepped
  clock:** with real rAF, the tilt easing (`x += (t−x)·0.12`) never visibly
  settles — a residual of 2e-5 tilt still flips hundreds of 1-LSB pixels along
  pattern band edges, and a same-settings control pair 1s apart diffed 15k px.
  The zero-delta harness stubs `requestAnimationFrame`, freezes
  `performance.now` (uTime), steps ~300 frames to the easing's float64
  underflow fixpoint, and screenshots via `page.screenshot({clip})` (element
  screenshots wait on real rAF for their stability check and hang against the
  stub). Control pair AE 0 first, then judge the knob pair. (3) **uDarken vs
  the invariant:** both are true — mirror foil is dark at off angles AND ink
  must never be muted — because the darkening belongs to the FOIL-VISIBLE
  field. Scope substrate attenuation by `(1 − ink)`; don't weaken canon uDarken
  values.

## Masks

Patterns never mask themselves — `main()` applies the layout-tier mask (see
`.claude/skills/mask-pipeline/SKILL.md` for the tier roadmap). If your printing needs a
zone the layout tier can't express (e.g. holo text-box), that's a mask-pipeline work item,
not a pattern hack.
