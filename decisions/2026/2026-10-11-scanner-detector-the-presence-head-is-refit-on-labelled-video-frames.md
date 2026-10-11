---
date: "2026-10-11"
title: "Scanner detector: the presence head is refit on labelled video frames"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml"]
supersedes: []
---
## 2026-10-11 — Scanner detector: the presence head is refit on labelled video frames
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The shipped `lc050.onnx` keeps its original presence head and
gains a second one beside it. The output is the larger of the two:

    has_obj = max(sigmoid(original Gemm), sigmoid(refit Gemm))

- **What the refit head is:** a 256->1 head over the same pooled feature
  (`head.has_obj_refit.weight` / `.bias`). It is a class-balanced logistic
  regression (L2 0.01) on LC050's own features.
- **What it was fitted on:**
  - the 20 labelled video-bench videos (CC BY);
  - the owner's phone frames: phase 0b session 2's flagged frames and
    snapshots, labelled by scene, and every lock and capture frame of the three
    owner sessions.
- **What else changed in the model:** nothing. Every original node and
  initializer is byte-identical, the corner outputs are bit-identical, and
  `hasObj` can only rise.
- **Reproducing it:** `scripts/scan-bench/video/presence_head.py` (`collect`,
  `collect-phone`, `report`, `export`) with `phone_frames.ts`. It reproduces the
  shipped file byte for byte from cached features.
- **Provenance and credit:** `scan-assets/SOURCES.md` records both checkpoints'
  sha256 and attributes the CC BY videos.

**Why:** On the pack-opening videos, the original head put only 31% of frames
that show a card over the gate's acquire threshold (0.8). The head averages
over the whole input, so busy tables, mats and sleeves out-vote the card. The
tracker never sees a quad the gate kept shut, so the card is never captured.

**Why not replace the head.** The first version of this PR did, with a head
fitted on video frames alone. Astra's review caught that it lost the case the
scanner was built for, the owner's phone camera. F028, a sleeved card lying on
a wooden table, fell from hasObj 1.000 to 0.085. Of 618 phone frames, 30 that
the original head saw as cards dropped below the hold threshold, so those cards
would never lock.

Fitting one head on video and phone frames together still lost phone frames,
92% against the original's 95.9%. A single linear head cannot hold both. The
max keeps the original's answer wherever it was confident, and adds the
refit's where the original was blind.

**Measured.** Every refit below was held out: each video, and each phone
group, is scored by a model whose refit never saw it.

Phone and video frames at or above the acquire threshold, as share of card
frames / share of no-card frames:

| | original | refit alone | max (shipped) |
|---|---|---|---|
| phone frames (618) | 95.9% / 16.9% | 92.1% / 7.2% | **97.0%** / 19.3% |
| video frames (2372) | 31.2% / 4.7% | 69.8% / 2.5% | **72.4%** / 6.5% |

The shipped max model is never below the original on any phone frame. On
F028, F030, F032, F055 and F059 it gives exactly the original's 1.000, 1.000,
1.000, 1.000 and 0.993.

Through the shipping capture policy (`replay.ts` on main at #306, scored with
`score_video.py` and the fine-tuned identity model's main tier, as live):

| | captured | auto-ID | strays | confident-wrong |
|---|---|---|---|---|
| original | 134/463 (29%) | 74 (16%) | 25 | 0 |
| max, refit held out | **219/463 (47%)** | **108 (23%)** | 42 | 1 |

- **The one confident-wrong:** BO1Wa-evt6k at 59 s, a plain Air Balloon named
  as the me01-166 Ultra Rare printing. That is the identity model's mistake, on
  a card the detector now lets through.
- **With #288's wide tier:** auto-ID goes from 80 to 121, and confident-wrong
  stays at 1.
- **The extra strays are other cards, not hallucinations.** In H4FjFjvLhbg, 6
  of the 9 are Yu-Gi-Oh cards and Japanese card backs, plus a TCG Live code
  card and a booster pack. None was named confidently, so each asks the reader.

**Implications:**

- `integration-frames.test.ts` now asserts presence on the owner's labelled
  frames through the shipping preprocessing, with three checks:
  - no labelled card frame falls below the hold threshold;
  - the five tabletop frames acquire;
  - no fewer frames acquire than under the original head.

  It fails on the video-only head and passes on both the original and the
  shipped model.
- `offline-harness.ts` now loads THIS checkout's `lc050.onnx`. Before, it
  loaded another worktree's copy, so these tests could not see a change to the
  model.
- The shipped model has SEEN these 20 videos and these phone frames. Measure
  any of them with a model refit without them (`export --exclude`), never with
  the shipped file.
- More capture means more of the identity model's own mistakes reach a
  confident answer, and more non-Pokémon cards reach the reader. Watch the
  video bench's confident-wrong and stray counts when either model changes. A
  card-back gate would take out the backs.
