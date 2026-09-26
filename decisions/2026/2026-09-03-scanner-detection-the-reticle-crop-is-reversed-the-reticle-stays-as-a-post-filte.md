---
date: "2026-09-03"
title: "Scanner detection: the reticle CROP is reversed; the reticle stays as a post-filter"
decided_by: "Not recorded"
areas: ["scanner"]
supersedes: []
---
## 2026-09-03 — Scanner detection: the reticle CROP is reversed; the reticle stays as a post-filter

The 2026-09-02 decision shipped LC050 with a `reticle intent-crop` on the
strength of PHASE0-CLOSEOUT §3.4, which credited the crop with deleting 6 of 14
failures by construction. Integrated on device it produced the opposite of what
it promised: quads "all over the place... basically never gets the outer edge"
and captures "corner-pin deformed". Every unit test was green — the pure
functions round-trip to 1e-9 — because no unit was wrong.

Reproduced offline over the 87 probe-flag frames of phase 0b session 2, running
the shipping engine code with no device
(`apps/web/src/scan/engine/__tests__/diag-run.ts`), mean corner error in frame
px against the 19 hand-labelled quads, and the predicted quad's linear scale
against the same labels:

| inference input | median | p90 | max | mean | scale | on-card <=12px |
| --- | --- | --- | --- | --- | --- | --- |
| reticle crop (shipped) | 22.2 | 92.0 | 92.4 | 32.3 | 0.886 | 7/19 |
| reticle x1.15 | 13.8 | 97.3 | 103.0 | 25.7 | 0.928 | 8/19 |
| reticle x1.30 | 12.8 | 57.1 | 68.2 | 19.9 | 0.971 | 9/19 |
| full frame, letterboxed | 11.6 | 49.9 | 58.8 | 18.0 | 0.985 | 11/19 |
| full frame, stretched (probe) | 9.1 | 73.6 | 74.5 | 19.7 | 0.964 | 13/19 |

Monotone in the margin, and the scale column is the mechanism: LC050 is a
zero-training DocAligner checkpoint and DocAligner is trained on documents
photographed WITH MARGIN. The reticle is 72% of frame width and the card is most
of it, so cropping to the reticle handed the model an input the card filled edge
to edge — and it stopped returning the card's outer boundary and started
returning an interior rectangle: the illustration window, or the text panel. An
art window is landscape, so `rectify.orderQuadForCard` then rotated it 90
degrees into portrait, which is the deformed capture. This is the
"interior-lock <=5%" re-open condition of the 2026-09-02 entry, hit by the crop
that was supposed to prevent it.

**Decision:** inference runs on the WHOLE FRAME (`engine/index.ts`
`INFERENCE_RECT`). The reticle is unchanged as the aiming guide and becomes the
POST-filter it already half was — `tracker.passesReticle`, centroid inside plus
65% of area. Letterbox, BGR /255, the hysteresis gate and the tracker are
untouched.

Also decided in the same measurement: the sub-pixel refiner's leash drops from
v3's 14 px to 4 px. `maxMove` is a property of the ERROR, not of the image; on a
sleeved card the sleeve rim and the printed inner border sit within a dozen
pixels of every true edge, so a 14 px leash let the refiner CHOOSE an edge
rather than polish one. Measured on the same frames: no refinement 18.02, and
maxMove 2/4/6/14 gives 17.99 / 17.73 / 18.11 / 18.57 — the shipped setting was
net negative.

**Accepted residuals:** the crop deleted multi-instance unions by construction;
the post-filter can only reject them, and cannot reject one at all when the
competing object is itself inside the reticle (F048: a snack packet under the
card, 14.1 px cropped -> 49.9 px full-frame). Full frame is better on 13 of the
19 labelled frames and worse on 6, four of them by under 3 px. Two residual
failures (F048 aspect 0.54, F079 aspect 0.95) are provably not card-shaped and
would be caught by an aspect gate; NOT added, because the labelled aspect range
is 0.649-0.847 and a card tilted away from the camera can legitimately
foreshorten past either bound. Revisit with more labels.

**Why:** the crop was adopted from a count of failure MODES it would delete,
without measuring what it did to the model that had to live inside it. The fix
is the same discipline the 2026-09-02 entry used, applied to its own clause.

**Implications:** `engine/__tests__/integration-frames.test.ts` is new and is
the fence — it runs the shipping code over the labelled frames and fails on
either regression (verified: 5 of 7 cases fail if `INFERENCE_RECT` is put back
to the reticle). `refine.ts`, `preprocess.ts`, `contract.ts` and `tracker.ts`
header comments corrected in the same change. The wiki Decision Log still owes
this entry.

