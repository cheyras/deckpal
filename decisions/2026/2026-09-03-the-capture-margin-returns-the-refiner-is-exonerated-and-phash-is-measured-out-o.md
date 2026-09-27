---
date: "2026-09-03"
title: "The capture margin returns, the refiner is exonerated, and phash is measured out of the identification job"
decided_by: "Not recorded"
areas: ["scanner"]
supersedes: []
---
## 2026-09-03 — The capture margin returns, the refiner is exonerated, and phash is measured out of the identification job

Follow-ups to today's regression fix, all measured on the phase-0b frame
corpus. (1) Rectified captures now expand the detected quad 5% per side
(`rectify.CAPTURE_MARGIN`) before warping — the sweep saturated whole-card
containment at 5% and all 16 blind-flagged NEAR frames went from
header-cropped to complete-card-with-clearance. Same principle the original
scanner shipped as CAPTURE_MARGIN=1.14: the matcher can trim background, it
can never recover missing card. A fence test bites if the margin is removed.
(2) The refiner's 4px leash was suspected of the top-edge under-crop and
cleared by per-edge measurement: the inward bias (top 16/19, left 12/19)
lives in LC050's raw output; the refiner on average nudges the top edge
OUTWARD. Recorded in refine.ts.
(3) The identification verdict: on 19 hand-labeled PERFECT crops of real
photographed cards, live /scan matched the correct card 2/19, and every
matched:true verdict in the sample was wrong (0/5 precision). Margined crops
re-probed: identical distances (9-15). Crop quality is no longer the
bottleneck — the 64-bit grayscale dHash cannot bridge glare/color-cast/
sleeve reality to catalog art. phash's future role is pre-filter and
confirmation, not identifier; the AI identification layer (vision model
reading name + collector number off the rectified crop) is the evidenced
path, pending the maintainer's env-var approval. Evidence:
roadmap/plans/card-scanner-redesign/p2-work/phash-on-crops/.

