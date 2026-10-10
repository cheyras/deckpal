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
- **Deployment:** a new stamp with its own HNSW index (migration 082). The old rows and index stay, so rolling back is a revert of #288 with no data to restore.

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
- **Rollback:** revert #288. The id, its Python mirror and the model pin in `fetch-embed-model.mjs` move together, and the old rows, index and staged model are untouched.
- **Unseen cards, measured:** run r3 trained the same recipe with sv09 and sv10 (434 cards) left out entirely, then scored the 146 real crops of those two sets.
  - Top-1 was 97.3% and the name was right 100% of the time, with 130 decisive answers and 0 wrong.
  - That is identical to the model that trained on those sets (97.3%, 130 decisive, 0 wrong), and far above zero-shot (87.7%, 107 decisive).
  - The model learned how a phone photo of a card relates to its art, not the cards themselves. A newly released set therefore needs only its gallery rows (`tools/embed-catalog` embeds missing cards incrementally), not retraining, and the 0.65 / 0.03 gate held at zero wrong on cards the model never saw.
- **Retraining:** `tools/scan-embed` is the recipe, and the benchmark is the gate. A new checkpoint gets a new id, new thresholds and a new stamp, never an overwrite.
- **Latency:** the same architecture and the same 88 MB int8 file, so latency is unchanged. A smaller backbone is the latency lever and is measured separately.
- **A wide confidence tier, added 2026-10-10.** The gate also names a match whose similarity is at least 0.45 and whose margin is at least 0.12 (`EmbedThresholds.wide`). Either tier passing is enough; the main tier is unchanged.
  - **Why:** low-resolution captures (video frames, a card far from the lens) lower every similarity, the right one included. A clean match can land at 0.5 while standing 0.15 clear of everything else, and simMin alone refused those.
  - **Measured at batch size 1** (`scripts/scan-bench/gate_sweep.py`; dynamic int8 quantizes per batch, so batched numbers drift):

    | set | named before | named after | wrong card |
    |---|---|---|---|
    | benchmark: 247 cards, 11 negatives, 9 no-art | 207 | 210 | 0 |
    | owner quad photos checked by eye: 227 cards, 35 negatives, 10 no-art | 134 | 152 | 0 |
    | video replay captures: 106 cards plus strays | 49 | 64 | 0 |

  - On the owner photos the tier adds one wrong printing (vintage Base Set named as its reprint), against 16 the main tier already makes. That class is being fixed in training; it is not a gate question.
  - No negative and no no-art card is named by the new tier. The strongest non-card beneath it stood 0.118 clear, and it was a blurred real card the ground truth had missed.
  - The whole ladder with OCR on rose from 83.2% to 84.4% auto-identified, still with 0 wrong and 0 of 11 negatives.
  - `isConfidentScore` is the single rule both `identityConfidence` and the API's `vectorVerdict` use, so they cannot drift.
