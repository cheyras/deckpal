---
date: "2026-09-02"
title: "Scanner detection: a pretrained corner model replaces classical CV, unmodified, and the harness era ends"
decided_by: "Not recorded"
areas: ["agents","scanner"]
supersedes: []
---
## 2026-09-02 — Scanner detection: a pretrained corner model replaces classical CV, unmodified, and the harness era ends

Six rounds of classical quad detection (hand-rolled, OpenCV WASM, and a fused
pipeline) plateaued at the same wall: on real phone frames, false positives
out-score true cards on every edge statistic a classical pipeline can compute,
and the detector locks the printed art divider instead of the card perimeter
(measured live: best engine 68% on-card raw, 32% as-displayed). Five research
lanes (`roadmap/plans/card-scanner-redesign/p2-work/research/R1-R6`) found the
industry unanimously escaped this exact ceiling with a small learned boundary
model — and Phase 0 proved it here: DocAligner's LC050 checkpoint (Apache-2.0,
4.9MB, 256px, ZERO training), fed correctly (BGR /255 — an ImageNet-normalize
bug in the first probe produced garbage and a false "model is bad" verdict
before triage caught it), scored 85.5% on-card with ONE art-interior lock in
110 live frames, ran a full 20 minutes on the owner's iPhone at 46-85 inf/s
single-threaded WASM (gate was 12; 70,229 inferences, no crash), and its
presence head correctly silences on 79% of no-card frames.

**Decision (owner, 2026-09-02):** ship the feature on zero-training LC050 —
letterboxed input, reticle intent-crop, hysteresis on the presence gate, the
classical sub-pixel refiner kept as the polish layer, and a tracker rebuilt as
a display-safety layer that can never draw worse than the model's output.
Synthetic training (Phase 1 of `p2-work/research/RECOMMENDATION.md`) is
DEFERRED, not cancelled: it re-opens if the shipped experience misses
displayed-on-card ≥80%, interior-lock ≤5%, or miss-rate ≤15% after the crop.
The dev harness stops evolving; judgment moves to the product feature.

**Accepted residuals:** sleeve/toploader rim ambiguity measured 8-30px live
(labels assumed 3-8) — a refinement question deferred to the refiner layer;
distractor false-quads at 21% ride on the phash identify stage's measured
junk rejection; burst-level jitter was unmeasurable at 0.18Hz sampling and
must be instrumented at frame rate during integration.

**Why:** the evidence, not the sunk cost, picks the architecture. Every
classical round improved localisation while the failure was classification;
the learned model dissolves the failure class instead of gating against it.

**Implications:** rip mode and the matches grid retire when the new scanner
ships (PLAN.md D3/D4); model + ORT WASM assets ship SW-precache-excluded and
lazy-load on the scan route; flag-style capture stays in the product as the
data channel that would feed Phase 1 if it re-opens.

