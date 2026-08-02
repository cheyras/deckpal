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
| `foil/resolver.ts` | v2: `(series, set, rarity, variant kind) → { patternId, scope, eraId, guess }`. The base pattern guess reads the CITED usage table (`foil/usage-index.json`, derived from `research/foil-pattern-usage.json` by `tools/foil/build-usage-index.mjs` — regenerate after editing the research file, never hand-edit the index). Set-name match → era/series token match → era-default heuristics; `guess` carries match level + confidence + citation hosts for the UI. Scope→mask-uniform conversion unchanged. |
| `foil/CardViewer.tsx` | three.js scene; rAF loop pushes uniforms from a settings ref (no React re-renders per frame). Also exports `cardScreenRect` — the exact on-screen card rect used to align overlays. |
| `foil/useTilt.ts` | pointer / gyro (iOS permission) / manual tilt; reduced-motion → manual. |
| `foil/MaskEditor.tsx` | Apple-Pencil hand-mask drawing overlay (see mask-pipeline SKILL.md). |
| `foil/CanonLab.tsx` | **Surface A — canon pattern lab** (`/pokedex/foil-lab/canon`, 2026-08-02 split): bare pattern on a blank card (no ink) beside the real reference clip + keyframes (`research/foil-video-reference/`, streamed by the branch api), full 39-slug picker, sliders, tilt, **Save canon** → `data/foil-canon/<patternId>.json` (full uniform snapshot; replaces code defaults as the baseline everywhere). |
| `foil/FoilLab.tsx` | **Surface B — card adjustment** (`/pokedex/foil-lab`): era-grouped card picker over the **whole catalog** (Owned-only is a filter toggle; unowned cards list their catalog variants and resolve a base-guess pattern like any other), full-catalog name search, pattern/scope overrides, mask overlay + hand-mask editing, uniform sliders baselined on canon with **per-card sparse overrides** → `data/foil-overrides/<cardId>/<variantId>.json`, comment queue, Copy-recipe-JSON. Single column at 390px; two columns (viewer \| controls) from 700px (iPad-mini portrait) up. |
| `foil/canon.ts` | The canon-vs-override layering model: code defaults < canon file < per-card sparse override < live sliders. Also `seedUniforms` and the pattern-id → reference-dir mapping. |
| `foil/ui.tsx` | Shared UI atoms for both surfaces + the surface tab switcher. |
| `foil/api.ts` | Self-contained read client (series → sets → paged set cards → card detail, plus `/search`; each browse tier takes an ownedOnly flag) + the foil-lab dev surface (masks, comments). Do NOT import `lib/api.ts`. |
| `apps/api/src/routes/foil-lab.ts` | Branch-instance-only routes (mask save/load with sidecar v2 prior+diff artifacts, artwork-keyed alias lookup, comments → working tree). Mounted only when `POKEDEX_FOIL_LAB=1`; inert in prod. Artifact generation: `apps/api/src/foil/mask-artifacts.ts` + pure-JS `png.ts`. |

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
| `uMask*` | layout mask uniforms — handled entirely by `main()`; patterns never mask themselves |
| `uMaskTex` / `uMaskTexOn` | hand-mask tier: when on, `main()` samples the mask canvas's ALPHA (shader flips V; the CanvasTexture sets `flipY=false` — exactly one flip, ever) instead of the layout rect |
| `uP0..uP3` | **yours** — per-recipe params, surfaced as labelled sliders |

Preamble helpers available to every recipe: `hash21`, `hash22`, `vnoise`, `fnoise`
(3-octave fbm), `hueRamp(t)` (uSat-aware cosine rainbow), `screenBlend`, `sdRoundRect`,
plus constants `PI`, `TAU`, `CARD_ASPECT` (h/w ≈ 1.3755). For isotropic patterns multiply
uv by `vec2(1.0, CARD_ASPECT)` so cells aren't stretched.

Blend model (in `main()`): `screenBlend(scan, clamp(foil * uIntensity * mask * gate, 0, 1))`
then `+ uSpecular * sheen`. Screen blending means foil **lightens**; it can never darken
the scan — matching how real foil reads through ink.

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

## Taxonomy status (research/foil-patterns.md — the canonical 39 types)

The dropdown carries ALL 39 video taxonomy types plus `none` and `reverse-sheet`.
Implemented recipes: **Starlight** (#1; #24 Starlight II at parallax 0), **Cosmos** (#2 —
label is Cosmos only; "Galaxy" is Bulbapedia's synonym for *Starlight*), the **sheen
family** — ONE generator (`sheenGlsl`) at four rotations + stripe option: `vertical-sheen`
(#14, ex-`sv-holo`), `horizontal-sheen` (#21, the TRUE SV default / Bulbapedia "Mirage"),
`diagonal-sheen-right` (#19, "/"), `diagonal-sheen-left` (#20, "\\"),
`striped-vertical-sheen` (#22, "Line") — **Reverse sheet** (≈ #30 pokeball-masterball,
ring+dot coarse tier), and **Cracked Ice** (#9). Everything else renders via its nearest
recipe with `implemented: false` + `approxVia` and is labeled "approx via …" in the UI —
unimplemented ≠ hidden; taxonomy leads. To ship a real recipe: write the GLSL, flip the
entry to `implemented: true`, drop `approxVia`. Gap priorities live in
`research/foil-patterns.md` "Implementation gap summary" and
`research/foil-verification.md` (recipe-wave plan).

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

## Masks

Patterns never mask themselves — `main()` applies the layout-tier mask (see
`.claude/skills/mask-pipeline/SKILL.md` for the tier roadmap). If your printing needs a
zone the layout tier can't express (e.g. holo text-box), that's a mask-pipeline work item,
not a pattern hack.
