---
date: "2026-09-27"
title: "Deck-E body renders in the brand cyan"
decided_by: "Chey (via Claude)"
areas: ["decke"]
supersedes: []
---
## 2026-09-27 — Deck-E body renders in the brand cyan
**Decided by:** Chey (via Claude)

**Decision:** Deck-E's body material uses DeckPal's `--color-brand-primary-400` (#00d3f3), metalness 0.3 (lacquer, not metal), and the Khronos PBR Neutral tone curve injected into its own shader. The renderer keeps its AgX curve for everything else on him (face, mouth, accents).

**Why:** The owner saw him desaturated and slightly grey. Sampling his rendered pixels at phone width: body #4c95a1, ΔE 28 from the brand cyan; lit face ΔE 24; 63% saturation. Three causes: the renderer-wide AgX curve compresses saturated colours toward grey; 85% metalness made the body a cyan tint on grey environment reflections; and the base colour was #22d3ee, a copy that had drifted from the token. After: lit face ΔE 3, whole body ΔE 12 with the shaded side in, 89 to 90% saturation, nothing clipped to white; iOS Safari matches (lit ΔE 3, 89%).

**Implications:** A unit test pins the colour to the theme token, so changing the brand cyan changes him. The browser suite samples his rendered body in Chromium and WebKit (lit face ΔE at most 8, saturation at least 75%, at most 1% white). Swapping the curve for the whole renderer would recolour the rest of him, whose palette was chosen for AgX.
