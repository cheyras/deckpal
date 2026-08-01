---
name: mask-pipeline
description: "The foil-mask derivation pipeline for the foil/main track: how holo-zone masks are derived and stored per (card, variant) — layout rects (shipped), Apple-Pencil hand-drawn masks (shipped, the ground-truth corpus), and the future art-driven tier. Read before touching mask storage, the mask editor, or building art-driven masks."
---

# mask-pipeline

Masks decide **where** foil appears on a card face. Tiers, cheapest first
(spec: `roadmap/plans/foil-main.md`):

## Tier 1 — layout-driven (SHIPPED)

`apps/web/src/foil/era-layouts.json` holds art-window rects per frame generation (data,
not code; top-left-origin fractions of the card face, measured on 600×825 cache scans).
`resolver.ts` maps a resolved scope to mask uniforms: `window` = inside the art window
(classic holo), `sheet` = outside it (reverse holo), `full` = whole face. Zero image
analysis. Supplements: the `uArtGate` luminance gate in the shader (foil only where the
scan is dark) approximates ink-vs-foil *within* the zone; the workbench mask-overlay
toggle is the review tool for rect accuracy.

## Tier 3 — hand-drawn (SHIPPED; deliberately before tier 2)

Chey draws masks directly on the scan with Apple Pencil on the workbench
(`foil/MaskEditor.tsx`): brush/eraser with size + pen pressure, undo (12 steps),
pen+mouse by default with an allow-finger toggle, `touch-action: none` while editing,
editing starts from the layout prior (or the saved mask). **The explicit purpose is a
ground-truth corpus**: an agent later compares these hand masks against the art scans to
learn where masks really go and write real layout/derivation rules — masks are more
complicated than a square.

Storage (committed, reviewable artifacts on the branch — NOT the image cache, which is a
contract for card art only):

```
data/foil-masks/<cardId>/<variantId>.png    # ALPHA channel = foil coverage (RGB = display tint)
data/foil-masks/<cardId>/<variantId>.json   # { cardId, variantId, width, height,
                                            #   channel: "alpha", derivation_method: "hand", savedAt }
```

Canvas resolution is 490×674 (2× the 245×337 card fraction). Saved via the branch api
dev instance (`POKEDEX_FOIL_LAB=1`, port 3712 — `apps/api/src/routes/foil-lab.ts`,
env-gated, inert in prod); the files land in whatever working tree that instance runs
from and are committed by the next agent pass. When a hand mask exists for the selected
`(card, variant)` the workbench auto-loads it and it beats the layout tier
(`uMaskTex`/`uMaskTexOn` in the shader — canvas is y-down, the shader flips V once;
`CanvasTexture.flipY` is explicitly false, don't reintroduce the double-flip).

**Never fabricate corpus entries**: only Chey's actual drawings belong in
`data/foil-masks/`. Synthetic test masks from verification runs must be deleted before
commit.

## Tier 2 — art-driven (NEXT, sub-branch `foil/masks`)

Segmentation/luminance analysis on the actual scan to find the true foil region (holo
behind the subject only, cosmos voids, textured IR relief zones), **trained/validated
against the hand-drawn corpus above**. Constraint: must run sanely on the Pi 5 — prefer
classical CV (luminance/chroma thresholds, flood fill from layout priors) over models;
decide at build time with measurements. Derived masks use the same storage shape with
`derivation_method: "layout" | "luminance" | …`; hand masks always win.

Contract to preserve: the shader takes whatever mask it is given (layout rect uniforms or
`uMaskTex`). Storage-shape or contract changes must update
`.claude/skills/foil-effects/SKILL.md` in the same commit.
