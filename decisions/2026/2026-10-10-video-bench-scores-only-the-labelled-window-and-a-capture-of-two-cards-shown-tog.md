---
date: "2026-10-10"
title: "Video bench scores only the labelled window, and a capture of two cards shown together may name either"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "tooling"]
supersedes: []
---
## 2026-10-10 — Video bench scores only the labelled window, and a capture of two cards shown together may name either
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** `scripts/scan-bench/video/score_video.py` changes in two ways.

1. **It scores only captures inside the ground truth's `window`**, with the
   usual lead and lag slack. A replay runs the whole video, but a ground-truth
   file can label only part of it.
2. **A capture that two appearances' OWN windows both hold counts for
   whichever of the two cards it names.** Own windows are the appearances
   themselves, not their slack. Before, such a capture always went to the
   appearance with the nearest midpoint. A slack window still excuses nothing.

**Why:** The 14 newly labelled videos seemed to show PR #292's policy making
13 confident-wrong captures, against 5 for the policy before it. Checked one by
one, none of the 13 was a wrong answer:

- **12 came from one video, `H4FjFjvLhbg`.** Its ground truth labels
  296-636 s of a longer video. Every capture outside that stretch counted as a
  "stray", and as "confident wrong" when the matcher was sure: 27 strays, out
  of cards nobody had labelled. The old policy's 5 were the same artefact.
- **The 13th was `Gc9d5_87odU` at 231.25 s.** The capture plainly shows Petilil
  091/086, which is what the matcher named. Petilil was being held beside
  Pawniard, and the scorer picked Pawniard by midpoint.

Corrected, over all 21 labelled videos:

| policy | captured | auto-ID | strays | confident-wrong |
|---|---|---|---|---|
| before #292 | 62/463 (13%) | 35 (8%) | 16 | 0 |
| #292 (shipping) | 134/463 (29%) | 80 (17%) | 25 | 0 |

**Implications:**

- Numbers measured before this change are not comparable on videos whose
  ground truth has a `window` shorter than the video, or whose appearances
  overlap. Re-score old runs with this version before comparing them.
- A confident-wrong that survives this scorer is either a real mistake or a
  ground-truth error. Look at it with `--show-wrong` before acting on it.
