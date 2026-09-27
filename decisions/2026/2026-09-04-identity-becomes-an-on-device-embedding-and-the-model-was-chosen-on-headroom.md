---
date: "2026-09-04"
title: "Identity becomes an on-device embedding, and the model was chosen on headroom"
decided_by: "Claude Opus 5 on behalf of @cheyras, implementing the owner's"
areas: ["agents"]
supersedes: []
---
## 2026-09-04 — Identity becomes an on-device embedding, and the model was chosen on headroom

**Decided by:** Claude Opus 5 on behalf of @cheyras, implementing the owner's
2026-09-04 MATCHING ARCHITECTURE RULING (roadmap/plans/card-scanner-redesign/PLAN.md).

**Decision:** the scanner's identity matcher becomes a 768-dimension image
embedding compared against catalogue vectors in pgvector, computed on-device
from open weights. The checkpoint is **CLIP ViT-B/32
(`vit_base_patch32_clip_224.openai`, Apache-2.0 as re-hosted by timm, MIT
upstream, 87.5M parameters)**. dHash is demoted to a prefilter and stays.

**The bakeoff.** 18 configurations across 15 open checkpoints, evaluated on the
19 hand-labelled ground-truth crops from p2-work/phase0b against a gallery of
catalogue renders. Method and full table: `p2-work/embed-spike/NOTES.md`.

A finding that reframes the gate: THREE of the ten distinct truth cards
(`mep-058`, `mep-059`, `mep-060`) have no art in ANY approved source — `mep` is
a documented 49-card gap (research/CARD-ART-SOURCES.md; p2-work/art-sweep/SWEEP.md,
re-confirmed 2026-09-04). Nine of the 19 frames therefore have no correct answer
available to any matcher, phash included, and the 2/19 dHash baseline was
measured against a corpus in which nine were unwinnable. The honest denominator
is the 10 answerable frames. Both are reported everywhere.

| checkpoint | params | dim | top-1 /10 | headroom | int8 MB / ORT CPU-1T |
|---|---|---|---|---|---|
| **CLIP ViT-B/32 (openai)** | 87.5M | 768 | **10** | **0.0731** | 88.2 / 57 ms |
| TinyCLIP ViT-betwixt/32 | 61.1M | 640 | 10 | 0.0685 | 61.7 / 45 ms |
| CLIP RN50 (openai) | 36.2M | 2048 | 10 | 0.0554 | disqualified, see below |
| ViTamin-S (datacomp1b) | 21.9M | 384 | 10 | 0.0455 | 22.8 / 496 ms |
| SigLIP ViT-B/16 | 92.9M | 768 | 10 | 0.0346 | — |
| TinyCLIP ViT-M/32 | 39.4M | 512 | 9 | 0.0620 | 40.0 / 34 ms |
| DINOv2 ViT-S/14 | 22.1M | 384 | 8 | 0.0435 | — |
| ResNet-18 (in1k) | 11.2M | 512 | 5 | 0.0061 | — |
| dHash (shipped) | — | 64 bits | **2**, plus 4 confidently wrong | — | — |

"Headroom" is the gap between the strongest impossible top-1 and the weakest
true match a zero-false-accept similarity threshold still admits. It is the
column that decided this, and the reason is the second finding.

**THE GALLERY SIZE CHANGED THE ANSWER, AND THAT IS THE RESULT.** Round 1 used
2,608 catalogue renders and made ViTamin-S look like the clear winner: it was
the only checkpoint that separated PERFECTLY, weakest true match 0.7659 against
strongest impossible top-1 0.7533. Round 2 doubled the gallery to 6,464 and that
separation vanished — ViTamin's strongest impossible rose to 0.8056, past its
weakest true match. CLIP ViT-B/32's two numbers did not move at all, to four
decimal places.

Why the negatives got stronger is good news about the models and bad news for
any narrow calibration: the added sets contain XY-era Chespin, Fennekin and
Froakie, and the nine unanswerable frames photograph exactly those three
Pokémon. What they now retrieve is ANOTHER PRINTING OF THE SAME POKÉMON
(`xy1-12` Chespin, `xy8-25` Fennekin, `xy8-46` Froakie). dHash's answer to the
same frames was "Earthen Vessel". So the embedding fails in the best available
way — and the gate must still reject it, because a different printing is a
different card in somebody's collection.

**Applied gate:** `similarity >= 0.74 AND margin >= 0.02` — thresholds placed at
the MIDPOINT of each gap rather than just above the negatives, because a cut
fitted to the last sample is what round 1 would have shipped. Result on the
19-frame corpus: **9 of 10 true matches accepted, 0 of 9 negatives accepted.**
The matcher it replaces accepted 4 and was wrong 4 times.

**Two more things the spike settled by measurement:**

* The input transform is a SQUASH of the whole card into the model's square, not
  timm's stock resize-and-centre-crop. Same model, same corpus: 7/10 top-5
  squashed, 4/10 centre-cropped. The centre crop discards the name bar and the
  set/number strip.
* Every candidate exports to ONNX opset 17 with a torch-vs-ORT cosine of 1.0, so
  "WASM-shippable" is verified rather than assumed. Sizes and int8 costs are in
  `p2-work/embed-spike/onnx-probe.json` — including ViTamin-S's, whose int8
  graph is 4.5x SLOWER than its own fp32 under ORT's CPU kernels.
* The SHIPPING ARRANGEMENT was measured end to end, not inferred from that
  table: the real input spec, fp32 vectors for the catalogue and an int8 graph
  for the query, which are two different functions of the same image. It still
  returns 10/10 top-1, and the gate's 0.74 clears that pairing's strongest
  negative (0.7094) by 0.031. The catalogue embed is an eight-minute CPU job for
  all 23,546 cards, which is what makes a later model change cheap.

**`resnet50_clip.openai` is disqualified by pgvector, not by its score.** HNSW
and IVFFlat both cap at 2,000 dimensions; its features are 2,048 wide. An
unindexable column means a sequential scan over every vector on every scan.

**Why:** the shipped matcher is not merely noisy, it is confidently wrong. On
the same 19 crops its `matched: true` gate fired four times and every one was a
different card (0-for-4 precision, DECISIONS 2026-09-04 above). A matcher whose
"I am sure" means nothing cannot be tuned into one whose does.

**Implications:**
- Catalogue and device MUST use the same checkpoint and the same input spec.
  That is what `packages/matching` and the stamp on every stored vector exist to
  enforce; see the schema entry below.
- **The on-device latency and download budget is NOT yet measured on a phone.**
  88 MB of int8 weights on the scan route is a product decision as much as a
  technical one. That probe is a required gate before this ships, in the shape
  of the phase-0b endurance run. If it rejects this checkpoint, **TinyCLIP
  ViT-betwixt/32** is the pre-measured fallback (10/10, headroom 0.0685, 61.7 MB
  at 45 ms) and its thresholds are already in
  `packages/matching/src/confidence.ts`.
- Re-embedding the catalogue costs well under an hour, so a later model change
  is cheap. This decision is reversible; the schema shape it implies is not,
  which is why that is decided separately and carefully.
- The 19-frame corpus is small, single-session, and the gallery is 27% of the
  live index. Round 1 vs round 2 is the standing warning about how much that
  last number matters. Every figure above should be re-measured against the
  flywheel's own data once there is any.

