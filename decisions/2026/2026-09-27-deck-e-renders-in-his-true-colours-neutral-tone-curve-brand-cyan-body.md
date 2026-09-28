---
date: "2026-09-27"
title: "Deck-E renders in his true colours: Neutral tone curve, brand-cyan body"
decided_by: "Chey (via Claude)"
areas: ["decke"]
supersedes: []
---
## 2026-09-27 — Deck-E renders in his true colours: Neutral tone curve, brand-cyan body
**Decided by:** Chey (via Claude)

**Decision:** The app renders Deck-E through Khronos PBR Neutral tone mapping at exposure 1, renderer-wide, instead of the port of Blender's AgX. AgX remains available as `look: 'blender'` for the parity harness only. His body material takes `--color-brand-primary-400` (#00d3f3) at metalness 0.3. No material gets its own tone curve, brightness, saturation or emissive boost.

**Why:** The owner saw him "like someone ran a desaturate filter over him entirely". Checked at 390x844 on the chat's dark background: pixels read inside the canvas and off the page are identical (no CSS filter, opacity, blend mode or overlay; premultiplied alpha composites cleanly; output is sRGB; texture colour spaces are right; no post-processing). The cause was the tone curve: under AgX his #ffffff eye whites rendered #cacbcb, the amber-400 bolts #c29f5e, the rose-400 mouth #d29095 and the body's lit face #5ba1ad (ΔE 25 from the brand cyan). A first attempt swapped the curve for the body alone. It brought the body to the token but left the eyes grey, so the body looked "cranked up" and the whites dim. Under Neutral everywhere, the whites are #f0f3f5, the bolts #e9a915 (ΔE 6), the mouth #f47587 (ΔE 5) and the body's lit face #11cae8 (ΔE 3.5). iOS Safari matches: whites #f0f3f4, lit ΔE 2.5. At the .blend's metalness 0.85 the body's lit faces stay ΔE 15 from the token under any curve, because the shell is a tint on grey reflections; at 0.3 they land on it.

**Implications:** Colour parity with the .blend is measured with `look: 'blender'`; the app intentionally differs. The eye symbol palette (Tailwind 600/400 pairs, picked deeper to survive AgX) now renders as its Tailwind values. The `decke-body-color` browser case asserts white eyes (every channel ≥ 225, spread ≤ 10), body lit face ΔE ≤ 6, bolts ΔE ≤ 14 and mouth ΔE ≤ 10 in Chromium and WebKit; it fails on the AgX pipeline ("his eye whites render #c5c6c6, grey").
