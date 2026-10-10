---
date: "2026-10-09"
title: "Scanner identity embedding: fine-tuned on the catalogue (93% top-1 on real crops)"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml"]
supersedes: []
---
## 2026-10-09 — Scanner identity embedding: fine-tuned on the catalogue (93% top-1 on real crops)
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The scanner's identity embedding switches from zero-shot CLIP ViT-B/32 (`clip-vit-b32-openai`) to the same architecture fine-tuned on the catalogue (`deckpal-card-b32-v1`, `tools/scan-embed`).
- **Training:** every catalogue card is a class. Training pairs synthetic phone captures with clean renders under symmetric InfoNCE. Batches are filled by name family so hard negatives are present, and identical-art reprints are masked out of each other's negatives because printing is OCR's job.
- **Gate:** new thresholds simMin 0.65, marginMin 0.03 and simFloor 0.45, measured on the scan benchmark.
- **Deployment:** a new stamp with its own HNSW index (migration 082). The old rows and index stay, so rolling back is one line in `packages/matching`.

**Why:** On the scan benchmark (`scripts/scan-bench`, the production pairing of fp32 gallery and int8 query, never trained on):
- **The embedding alone:**
  - Top-1 rose from 80.9% to 93.0%.
  - Right art rose from 86.3% to 96.1%.
  - Top-5 rose from 89.1% to 96.5%.
  - The median top-1 to top-2 margin rose from 0.053 to 0.320.
- **Through the whole identification path (244 distinct cards):**
  - With OCR on, auto-identified rose from 68.9% to 83.2%, and confident-but-wrong fell from 0.6% to 0.
  - With OCR off, auto-identified rose from 63.1% to 81.1%, with 0 wrong.
- **The fine-tuned model's errors fall in two clean clusters, and each knob of the gate sits in one cluster's gap:**
  - cards with no catalogue art reach a top-1 similarity of 0.562 at most;
  - identical-art reprints reach a margin of 0.004 at most.
- **Robustness:** 2,320 digital-only Pocket cards added to the gallery as distractors changed nothing.
- **Checkpoint choice:** the final checkpoint (`last.pt`) was exported, not the epoch that scored best on the benchmark. Picking by test score would have fitted the model to its own exam.

**Implications:**
- **Production steps are the owner's (B9):**
  1. stage the int8 model with `scripts/stage-embed-model.mjs`;
  2. apply 082;
  3. embed the catalogue under `e1:deckpal-card-b32-v1` with the fp32 model;
  4. deploy.
  
  Until step 3 runs, the code would query an empty stamp, and the ladder degrades to OCR and dHash by design. So the deploy waits for the embed.
- **Rollback:** set `EMBED_MODEL_ID` back to `clip-vit-b32-openai`. The old rows, index and staged model are untouched.
- **Retraining:** `tools/scan-embed` is the recipe, and the benchmark is the gate. A new checkpoint gets a new id, new thresholds and a new stamp, never an overwrite.
- **Latency:** the same architecture and the same 88 MB int8 file, so latency is unchanged. A smaller backbone is the latency lever and is measured separately.
