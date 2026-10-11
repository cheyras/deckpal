---
date: "2026-10-11"
title: "Scanner detector: the presence head is refit on labelled video frames"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml"]
supersedes: []
---
## 2026-10-11 — Scanner detector: the presence head is refit on labelled video frames
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The shipped `lc050.onnx` gets a new presence head, and nothing
else in the model changes.

- **What changed:** two initializers, `head.has_obj.1.weight` and `.bias`, a
  256->1 layer over the pooled feature. The backbone, the corner head and the
  graph are byte-identical, so every quad the scanner finds is unchanged. Only
  `hasObj`, which the presence gate reads, differs.
- **How it was fit:** a class-balanced logistic regression (L2 0.01) on
  LC050's own pooled features.
- **The frames:** positives are the 25/50/75% points of every capturable
  appearance in the 20 labelled video-bench videos. Negatives are one frame a
  second inside each labelled window, at least 1 s from any appearance.
- **Reproducing it:** `scripts/scan-bench/video/presence_head.py`
  (`collect`, `report`, `export`) reproduces the shipped file byte for byte from
  its cached features.
- **Attribution:** the videos are CC BY. `scan-assets/SOURCES.md` attributes
  them and records both checkpoints' sha256.

**Why:** On the pack-opening videos, the shipped head put only 31% of frames
that show a card over the gate's acquire threshold (0.8). The presence head
averages over the whole input, so busy tables, mats and sleeves out-vote the
card. The tracker never sees a quad the gate kept shut, so the card is never
captured. The corner head's quads were mostly fine. Refitting only the head
fixes the part that is broken and cannot move a quad.

Frame by frame, with each video held out of its own fit: card frames reaching
0.8 went from 31.2% to 74.3%. No-card frames reaching it went from 4.7% to
3.6%, so the false-presence rate fell too. (An earlier fit took negatives from
unlabelled stretches outside four videos' windows and reached 65.5%. Respecting
the windows did better.)

**Measured through the shipping capture policy.** `replay.ts` replayed the 20
videos on main at #306. Each video ran under a head refit WITHOUT it
(`presence_head.py export --exclude <id>`, then `LC050_MODEL=… replay.ts`). The
two videos outside the fit ran under the full head. Scoring used
`score_video.py`, with the fine-tuned identity model's main tier, as the live
gate runs:

| head | captured | auto-ID | strays | confident-wrong |
|---|---|---|---|---|
| shipped | 134/463 (29%) | 74 (16%) | 25 | 0 |
| refit, each video held out | 214/463 (46%) | 108 (23%) | 30 | 1 |

With #288's wide tier, auto-ID goes from 80 (17%) to 122 (26%) and
confident-wrong from 0 to 2. Both errors were looked at:

- **BO1Wa-evt6k at 59 s:** a plain Air Balloon named as me01-166, an Ultra Rare
  printing. That is the identity model's mistake on a card it now gets to see,
  not the detector's.
- **-1hPV6p3Y8E at 634 s:** a barcode on a box, named Alph Lithograph at
  similarity 0.598. It counts as confident only through the wide tier (sim
  ≥ 0.45, margin ≥ 0.12), which is not live. The main tier does not name it.
  That tier needs a non-card floor before #288 ships it.

**Implications:**

- The shipped head has SEEN these 20 videos. Measure any of them with a head
  refit without it, never with the shipped file. A video added later is unseen
  until the next refit.
- More capture means more of the identity model's own mistakes reach a
  confident answer. The video bench's confident-wrong count is the number to
  watch when either model changes.
- Duplicates rose from 25 to 48. Most sit on overlapping appearances (a
  background card spanning the whole clip, and adjacent cards' slack windows),
  and they track the extra cards captured. They are not repeated captures of
  one held card.
- To refit after adding labelled videos: run `collect`, then `report`, then
  `export` with a per-video held-out replay, and check the table above still
  holds.
