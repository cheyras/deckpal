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
| `foil/patterns.ts` | **The pattern library.** One recipe per physical foil process. You will usually only touch this. |
| `foil/shader.ts` | Uniform contract, GLSL preamble (helpers), fragment `main()`, material builder. Contract changes happen here — rarely, and update this doc when they do. |
| `foil/era-layouts.json` | Era layout spec — art-window rects per frame generation. **Data, not code.** Top-left-origin fractions measured on 600×825 cache scans. |
| `foil/resolver.ts` | `(series, rarity, variant kind) → { patternId, scope, eraId }` heuristic + scope→mask-uniform conversion. |
| `foil/CardViewer.tsx` | three.js scene; rAF loop pushes uniforms from a settings ref (no React re-renders per frame). Also exports `cardScreenRect` — the exact on-screen card rect used to align overlays. |
| `foil/useTilt.ts` | pointer / gyro (iOS permission) / manual tilt; reduced-motion → manual. |
| `foil/MaskEditor.tsx` | Apple-Pencil hand-mask drawing overlay (see mask-pipeline SKILL.md). |
| `foil/FoilLab.tsx` | The workbench page (`/pokedex/foil-lab`): era-grouped card picker (owned scans only), pattern/scope overrides, mask overlay + hand-mask editing, uniform sliders, comment queue, Copy-recipe-JSON. Single column at 390px; two columns (viewer \| controls) from 700px (iPad-mini portrait) up. |
| `foil/api.ts` | Self-contained read client (series → sets → owned cards → card detail) + the foil-lab dev surface (masks, comments). Do NOT import `lib/api.ts`. |
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

## Taxonomy status (Bulbapedia "Holofoil")

Shipped v1 (eras Chey owns): **Starlight** (WOTC), **Cosmos/Galaxy**, **SV default holo**
(sheen/vertical-beam), **Reverse sheet (SV)**, **Cracked Ice**, plus `none`.
Remaining for `foil/patterns`: Tinsel, Sheen (distinct from SV default), Water Web, Line,
Crosshatch, Pixel/Confetti, SWSH reverse (vertical-bar sheet), mirror variants, and
texture-embossed illustration-rare relief (hardest — do it last; needs normal-map-style
relief, likely a contract extension).

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

## Masks

Patterns never mask themselves — `main()` applies the layout-tier mask (see
`.claude/skills/mask-pipeline/SKILL.md` for the tier roadmap). If your printing needs a
zone the layout tier can't express (e.g. holo text-box), that's a mask-pipeline work item,
not a pattern hack.
