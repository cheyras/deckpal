---
name: mask-pipeline
description: "STUB — the foil-mask derivation pipeline for the foil/main track: how holo-zone masks are derived per (card, variant), from cheap layout rects up to art-driven and hand-corrected masks. Read before building the art-driven mask tier or changing mask storage."
---

# mask-pipeline (stub — layout tier shipped, art tiers are future sub-branches)

Masks decide **where** foil appears on a card face. Tiers, cheapest first
(spec: `roadmap/plans/foil-main.md`):

1. **Layout-driven (SHIPPED, v1).** `apps/web/src/foil/era-layouts.json` holds
   art-window rects per frame generation (data, not code; top-left-origin fractions of
   the card face, measured on 600×825 cache scans). `resolver.ts` maps a resolved scope
   to mask uniforms: `window` = inside the art window (classic holo), `sheet` = outside
   it (reverse holo), `full` = whole face. Zero image analysis. Two supplements:
   - the `uArtGate` luminance gate in the shader (foil shows where the scan is dark)
     approximates ink-vs-foil *within* the zone at zero cost;
   - the workbench mask-overlay toggle is the review tool for rect accuracy.
2. **Art-driven (NEXT, own sub-branch `foil/masks`).** Segmentation/luminance analysis on
   the actual scan to find the true foil region (e.g. holo behind the subject only, cosmos
   voids, textured IR relief zones). Constraint: must run sanely on the Pi 5 — prefer
   classical CV (luminance/chroma thresholds, flood fill from layout priors) over models;
   decide at build time with measurements. Masks become **stored, reviewable artifacts**
   (grayscale images in the image-cache layout, NOT in git), cached against
   `(card_id, variant_id)` with a `derivation_method` field.
3. **Hand-corrected (LAST).** Same storage, `derivation_method: 'manual'`; the workbench
   grows a paint/erase tool. Hand masks always win over derived ones.

Contract to preserve when building tiers 2–3: the shader takes whatever mask it is given
(today a rect + invert; later a `sampler2D uMaskTex` — that swap is a deliberate contract
change in `foil/shader.ts`, update `.claude/skills/foil-effects/SKILL.md` when it lands).
Era layout rects stay authoritative as the *prior* and the fallback for cards without a
derived mask.
