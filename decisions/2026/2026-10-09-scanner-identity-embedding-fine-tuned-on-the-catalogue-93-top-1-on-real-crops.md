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

## 2026-10-10 — v2 replaces v1 before deployment
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** #288 ships `deckpal-card-b32-v2` (`tools/scan-embed` run r4, `last.pt`), not `deckpal-card-b32-v1`. v1 was never deployed, so v2 takes its place everywhere and nothing keeps v1: `EMBED_MODEL_ID` and its Python mirror, the `THRESHOLDS` entry, both sha256 pins (int8 query file `67b1068b…`, fp32 catalogue file `45516f0e…`), the stamp `e1:deckpal-card-b32-v2`, `ROTATION_FALLBACK_MODELS`, and migration 082, renamed `082_card_embedding_v2_index.sql` because it had never been applied.
- **What v2 changes in the recipe** (now in `tools/scan-embed`):
  - Identical-art printings are found colour-blind (`same_art.py`: ORB features on equalised luma under one homography, `--same-art-min 80`) and kept out of each other's negatives. The dHash test missed pairs like Base Set and Base Set 2, whose catalogue scans differ in colour cast and crop, so v1 learned to split them by scan colour.
  - A colour-cast augmentation (`augment.py` `CAST_P` 0.4, `CAST_GAIN` 0.15).
  - 185 of the owner's quad-scan crops as extra queries (`--real-pairs`, `--p-real 0.5`). None of them comes from a photo in the owner set the gate is checked on, or in the benchmark.
- **The gate is unchanged: 0.65 / 0.03, floor 0.45, wide tier 0.45 / 0.12**, re-measured for v2 rather than carried over (below).
- **A turned crop must now clear the main tier.** The sideways-card fallback (#290) checks three extra orientations of a capture that was not decisive upright, and it now accepts a turn only on the main tier, never the wide one (`isConfidentScore(..., { mainTierOnly: true })`).

**Why:**
- **In short:**
  - **v2's vector alone names more on every set.** At the main tier it gains 3 on the benchmark, 14 on the owner photos and 6 on the video replays, with no wrong card. It also stops separating Base Set from Base Set 2 by scan colour, which v1 did confidently and was often wrong about.
  - **Through the whole path it is level, not better.** It gains 1 on the default benchmark. On the owner photos, with turns applied, it names 1 fewer card and makes 1 more wrong-printing call, but names 1 fewer negative.
  - The remaining errors are the printing class, which is #294's job either way.
- **Every number here is the production pairing embedded one capture at a time.** `scripts/scan-bench/embed.py` used to embed benchmark queries 32 at a time. Dynamic int8 sets its activation scale per batch, so batched vectors differ from what production computes for a single capture. On v1, batching moved top-1 from 93.8% (one at a time) to 93.0%. Queries are now embedded one at a time (`QUERY_BS`), in `score_queue.py` too, and v1 was re-measured the same way for the comparison.
- **Retrieval on the benchmark's 256 real crops:**

  | | v1 (r1) | v2 (r4) |
  |---|---|---|
  | top-1, exact printing | 93.8% | 90.6% |
  | top-1, right name | 96.1% | 95.7% |
  | top-5 | 96.5% | 96.5% |
  | median top-1 − top-2 margin | 0.317 | 0.334 |
  | decisive at 0.65 / 0.03, all right | 207 | 210 |

  Top-1 falls because v2 is trained not to split identical-art printings: its first answer among them is a coin toss, with a margin under 0.01, which the gate refuses. That question was always the printed key's.
- **Named confidently by the vector alone** (`gate_sweep.py`, main tier → with the wide tier):

  | set | v1 | v2 |
  |---|---|---|
  | benchmark: 247 cards, 11 negatives, 9 no-art | 207 → 210, 0 wrong | **210 → 212**, 0 wrong |
  | owner quad photos checked by eye: 227 cards, 35 negatives, 10 no-art | 134 → 152 exact; wrong printing 16 → 17, plus 2 no-art | **148 → 157** exact; wrong printing 11 → 12, plus 7 no-art |
  | video replay captures: 106 cards plus strays | 49 → 64 | **55 → 64** |

  - Neither model names a wrong card or a true negative on any of the three sets at this gate.
  - **"Plus N no-art"** means a card with no art in the catalogue was named confidently. All 9 such answers (v1's 2, v2's 7) are Celebrations Classic Collection reprints, named as the original card they reprint. That is the right name in the wrong printing, not a wrong card. v2 names more of them because it matches the same artwork across scans, which is the point of the change. Counting them, v2 makes 18 wrong-printing calls on the owner photos at the main tier, the same as v1. The fix for this class is catalogue art for `cel25cc` plus #294's printing guard, not the gate.
  - The video "stray" v2 names under the wide tier (sim 0.562, margin 0.125) is a motion-blurred real Tyrogue 0.125 s before its ground-truth window opens, and the answer is right. It is the same capture v1 had at margin 0.118.
- **Why the thresholds stay where they are, for v2:**
  - **simMin 0.65.** The strongest wrong card or true negative in all three sets reaches 0.597 (margin 0.019); with a margin of 0.03 or more, the strongest reaches 0.552. On the benchmark alone, cards with no catalogue art top out at 0.484 and other wrong cards at 0.500. 0.60 was measured and rejected: it adds 1 video card and 1 wrong printing, with 0.003 of headroom over that negative.
  - **marginMin 0.03.** The identical-art cluster's widest margin is 0.008.
  - **The wide tier's marginMin 0.12.** The strongest wrong card or negative with sim ≥ 0.45 stands 0.102 clear (an owner photo of a Gym Heroes card named as a Trainer Gallery card). 0.10 names it, 0.11 adds 3 cards with 0.008 of headroom, and 0.12 keeps 0.018.
  - `calibrate.py`'s zero-error edge on the benchmark alone (0.505 / 0.010) names 213 crops there against the two tiers' 212, but its leave-one-dataset-out check produces 2 wrong answers. It is fitted to the exam, as it was for v1.
- **The turned-crop rule, replayed** (`router.ts` logic in Python, on all three sets):
  - On v2 a turn named 12 more cards exactly (benchmark 2, owner photos 10) and 2 more by name in the wrong printing, every one of them on the main tier (the exact ones at sim ≥ 0.72, margin ≥ 0.23).
  - Through the wide tier only, it also named a Pokémon TCG Live code card as Beedrill ex, and an owner photo labelled negative (a Brock's Lickitung under a price sticker, which looks real) as Brock's Lickitung.
  - On v1 the same rule named one negative (as Alph Lithograph) through the wide tier.
  - The wide tier was measured on one look per capture, and three more looks are three more tries at its lower bar. Holding turns to the main tier keeps all 14 and drops the code card (and the sticker-covered Lickitung with it).
- **Through the whole identification path** (`scripts/scan-bench/bench.ts`, OCR on):
  - "Upright" replays the embedding as the benchmark always has.
  - "+ turns" also applies the sideways-card fallback the way the server would: v1 under #290's rule as it stood, v2 with turns held to the main tier.

  | bench | v1 upright | v2 upright | v1 + turns | v2 + turns |
  |---|---|---|---|---|
  | default: 244 cards, 11 negatives | 206, 0 wrong | 207, 0 wrong | 208, 0 wrong | **209, 0 wrong** |
  | owner quad photos: 218 cards, 32 negatives | 142; 24 wrong of 166; 0 negatives | 140; 25 wrong of 165; 0 negatives | 150; 24 wrong of 174; **1 negative** | 149; 25 wrong of 174; 0 negatives |

  - **On the owner photos v2 is not a gain through the whole path**, though it is one for the vector alone.
    - Its vector gains land mostly on cards v1's whole path already named. Of the main-tier gains that are in this bench, 14 of 22 were already right for v1, through its wide tier or corroboration.
    - It stops claiming Base Set against Base Set 2 from scan colour. 7 answers v1 got right that way now go to the reader, and so do 7 it got wrong, 6 of them the same vintage printings.
    - The ladder names 4 Classic Collection reprints as their originals, which v1 left alone.
  - **Of the wrong answers on the owner photos, all but 3 are the right card in the wrong printing** (v1 21, v2 22). The 3 wrong cards are the same 3 for both models, and none of them was decided by the vector alone: one came from a dHash-confident answer the vector disagreed with (v2's vector had the right card, decisively), one from a misread number, and one from a dHash prior.
  - **The 1 negative v1 names** is a turned photo cleared through the wide tier, named Alph Lithograph. That is the case the main-tier turn rule removes.
  - All of these runs use the original 218-card owner set. A second verified set (`quad-verify2`) appeared in the bench while they ran and is not in these numbers.
- **Leakage check.** v2's gain on the owner photos is on card names that are not among the 185 training pairs.
  - Main tier: 125 against v1's 109 on the 184 cards whose name v2 never saw a real photo of, and 23 against 25 on the 43 it did.
  - With the wide tier: 132 against 124, and 25 against 28.

**Implications:**
- **The production steps above stand, with v2's names.** They are the owner's (B9):
  1. stage `deckpal-card-b32-v2.int8.onnx`;
  2. apply `082_card_embedding_v2_index`;
  3. embed the catalogue under `e1:deckpal-card-b32-v2` with `deckpal-card-b32-v2.fp32.onnx`;
  4. deploy.
  
  #288's ship steps had not been run for v1 when v2 replaced it. If any v1 staging, rows or index were made anyway, they are inert: no build fetches that key and nothing queries that stamp.
- **Query numbers from before this change are batched.** Re-embed with `embed.py queries` before comparing a new checkpoint with them. v1's one-at-a-time vectors are kept under `embed/…-v1.int8-bs1`.
- **The printing problem is not solved by v2 alone.** On the owner photos v2 still makes 11 wrong-printing calls among cards with art (v1: 16), almost all vintage Base Set named as Base Set 2. Those, and the Classic Collection reprints, are why #294 guards the printing separately.
