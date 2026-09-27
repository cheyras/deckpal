---
date: "2026-08-20"
title: "Draw the Venus and Mars signs; do not typeset them"
decided_by: "Claude Opus 5 on behalf of @cheyras (issue #54)."
areas: ["catalog"]
supersedes: []
---
## 2026-08-20 — Draw the Venus and Mars signs; do not typeset them
**Decided by:** Claude Opus 5 on behalf of @cheyras (issue #54).

**Decision:** `components/SpeciesName.tsx` renders the ♀/♂ in species names as
inline SVG marks, cap-height tall and sitting on the baseline.

**Why:** Figtree has no glyph for either character. The browser falls back
per-glyph to whatever system font does — DejaVu on Linux, Apple Symbols on iOS —
and that font's metrics are not Figtree's, so the mark lands below the baseline
and is then sheared off by the Pokédex tile's `truncate` box, whose line is only
18px tall. Raising the line-height would have papered over the clipping on one
platform while leaving the mark sitting low on all of them.

**Implications:** Deterministic on every platform, and unclippable by
construction — the box is exactly cap-height, so no part of the mark can fall
below the baseline. Same authored-mark call the set symbols already make
(`PromoStarMark`). Carries `role="img"` + `aria-label` so the sign is still
announced. Adopted at both render sites (the Pokédex grid and the species
heading); measured in the browser at 5px inside the box bottom at 390/428/1280.

