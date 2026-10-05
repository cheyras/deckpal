---
date: "2026-10-04"
title: "Card-corner detector training prep: harvest, frozen split, baseline scorer and an LC050 fine-tune pipeline"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml", "tooling"]
supersedes: []
---
## 2026-10-04 — Card-corner detector training prep: harvest, frozen split, baseline scorer and an LC050 fine-tune pipeline
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Build everything a fine-tune of the scanner's corner detector (DocAligner LC050, shipped with zero training) needs, so a real run is a command and not a project.
- **Harvest and audit:** `scripts/quad-corpus/harvest.mjs`.
  - Signs in as the QA account (B12) and pulls every `quad-label` row and its frame from `/dev/scan-flags`, paced under the 600/min flood guard and resumable.
  - Checks each row against HARVEST.md §4 and writes a manifest and an audit report outside the repo (`~/deckpal-data/quad-corpus`, which holds the owner's photos).
- **One frozen split:** `scripts/quad-corpus/split.ts`.
  - Splits by session and near-duplicate group, never by frame, and pins to the manifest's sha256.
  - `tools/quad-train/dataset.py` reads the same `split.json`, so a model is never scored on frames it trained on.
- **Baseline scorer:** `scripts/quad-corpus/eval.ts`.
  - Runs the shipping engine path through the offline harness.
  - Scores against the 2026-09-02 gates, using R5's definitions scaled to the 416 canonical square: on-card ≥ 80%, interior lock ≤ 5%, miss ≤ 15%, false quad ≤ 20%.
  - `--model` scores any candidate on the same split.
- **Tight test set:** `scripts/quad-corpus/make-tight.mjs` builds a tight-framing test set by re-cropping held-out cards so the card spans 85–92% of the square's side.
- **Fine-tune pipeline:** `tools/quad-train/` (Python venv, RTX 5080).
  - LC050 converted to PyTorch via onnx2torch with four tested fixes. Parity with the shipped ONNX is about 1e-5.
  - Preprocessing is bit-exact against the TypeScript engine.
  - Augmentation includes deliberate tight framings.
  - The export keeps LC050's exact I/O contract (`img` 1x3x256x256 BGR /255 → `points` 1x8, `has_obj` 1x1), so `model.ts` loads it unchanged.

**Why:** The owner asked whether the corpus is ready for training. As measured, it was not, and the tools above are what made that measurable.
- **The corpus is 163 valid labels.** 95 are positives (88 fronts, 7 backs) and 68 are negatives. 87 are uploads and 76 camera frames, from four labelling days. Nothing has been saved since 2026-09-27: the labeler's queue listing times out, which is fixed separately.
- **Few show the target failure.** Only 8 positives are close-ups (the card's bounding box spans ≥ 80% of the square's side), the case where LC050 outlines the text panel (HARVEST.md §5). LC050 gets 7 of those 8 on-card. Close-ups are measured by side, not area: an upright card covers at most about 72% of a square's area, so an area cut such as "fill ≥ 75%" finds none by construction.
- **The shipping model's baseline:**
  - Whole corpus: on-card 65.3% (fail), interior lock 6.3% (fail), miss 14.7%, false quad 14.3% on 7 distractors.
  - Frozen test split: on-card 69.0%, against an 80% gate.
- **A pilot fine-tune** (60 epochs, 54 training rows, tight augmentation on, about 2 min) shows the margin failure is learnable:
  - **Tight test set** (58 crops of held-out cards): on-card rose from 48% to 74% and interior lock fell from 31% to 5%. The median predicted/label area ratio went from 0.91 to 0.99.
  - **Normal-framing test split:** no gain (65.5% against 69.0%, inside the noise), and false quads on all negatives rose.
  - It is a signal, not a candidate.
- **Leave-one-day-out cross-validation** (`experiments/cv.sh`, every card tested once, same fixed config, last checkpoint):
  - Across all 94 test cards, on-card went from 61 to 59. Interior lock fell from 6 to 0 and false outlines from 33% to 24%, but overhang rose from 13 to 21.
  - The fold trained on 65 rows got worse; the folds trained on 123–140 rows improved. More labels, not a different recipe, is the lever.
- **A lower presence gate does not help:** at 0.3 instead of 0.8 it recovers 8 misses but only 2 more on-card frames, for 10 more false outlines.
- **Corner accuracy is not the main identification loss** (`experiments/check-a*`). Detector crops are typically a few percent off (median mean corner error 3.4% of the diagonal). Perfect corners would add about 5 correct IDs out of 88 fronts. Rotated cards, never-detected cards, resolution and look-alikes cost more.

**Implications:**
- **Not shipped:** the pilot model is not shipped. A production run waits for real data:
  - labelled real tight framings (the synthetic crops are upscaled, so a real set is the arbiter);
  - more card backs and distractor-only negatives;
  - a working labeler queue;
  - ideally the Phase 1b synthetic compositor from DeckPal's card art.
- **Gate:** any candidate must beat the shipped LC050 on the frozen test split and on a real tight-framing set before it replaces `lc050.onnx`.
- **Corpus location:** the corpus stays out of git. `harvest.mjs` reruns are incremental, and `split.ts --extend` keeps frozen assignments when new rows arrive.
