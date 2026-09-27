---
date: "2026-09-12"
title: "Three.js 0.185.1→0.186.0 visual review: approved, @types/node 26.5.1 retained"
decided_by: "GPT-6 Astra on behalf of @cheyras, from the root visual review. Documented by GLM-5.2 (Ringer worker), which recorded the verified facts but did not make the visual judgment."
areas: ["general"]
supersedes: []
---
## 2026-09-12 — Three.js 0.185.1→0.186.0 visual review: approved, @types/node 26.5.1 retained
**Decided by:** GPT-6 Astra on behalf of @cheyras, from the root visual review. Documented by GLM-5.2 (Ringer worker), which recorded the verified facts but did not make the visual judgment.

**Decision:** Approve Three.js 0.185.1→0.186.0 for integration after the owner's PR CI goes green. Retain the six intended dependency updates from PR #179; reverse only its unexplained lock-only `@types/node` 26.5.1→26.5.0 downgrade back to 26.5.1. Both 26.5.0 and 26.5.1 exist on the registry, no repo policy or deprecation justified the downgrade, and the exact Dependabot cause is unknown. The six retained updates are: `@ai-sdk/gateway` 4.0.75→4.0.76, `ai` 7.0.93→7.0.94, `three` 0.185.1→0.186.0, TanStack Router 1.170.32→1.170.33, TanStack Virtual 3.14.10→3.14.11, and `html2canvas-pro` 2.4.1→2.4.2. The `pnpm@10.34.5` repo-level pin is preserved. Approval is conditioned on the owner's PR CI going green; the PR has not yet merged.

**Why.** Visual evidence: the same actual character code and assets underlie both the baseline (`a260525`) and the PR #179 head (`3e6930b`); the real DeckE WebGL pipeline ran with matching camera and scene-node hashes (1e-6 precision), custom Blender AgX active, 10 still cases covering both desktop 1280×900 DPR 1 and mobile 390×844 DPR 2 (rest, left, mouth+bend, alert, card-present), and 7 synchronized desktop happy-animation frames. Two fresh baseline scenes decoded EXACT RGB-equal. Independent PNG comparison: largest still mean absolute RGB error 0.00413248875926601 on a 0–255 scale; max channel difference 2/255; largest motion MAE 0.00026244212962963. No visible regression in reviewed silhouettes, eyes, gold accents, body highlights, mouth, or card surfaces; no runtime errors or external browser requests. Test framing (300 CSS px desktop / 200 mobile) keeps full extreme poses in frame and is not an app change. Source audit found the AgX hook unchanged and a PMREM spiral-blur change on `fromScene`, while DeckE uses `fromEquirectangular`; do not infer bit-identical output from the source. No source, material, or lighting tuning was needed.

**Implications.** The candidate passed 27 CI-equivalent checks, 97 security tests, 22 browser assertions, and zero audit findings. Rendering dependency updates need visual comparison as well as CI: here that comparison ran on Chromium SwiftShader with mobile viewport emulation on one machine — not on a physical-phone GPU or Safari — and cross-version pixels differ slightly even though the baseline scenes decoded exact RGB-equal (scene matrix hashes rounded to 1e-6). Approval remains conditioned on green owner-PR CI as stated in the Decision; the PR has not yet merged.

---

