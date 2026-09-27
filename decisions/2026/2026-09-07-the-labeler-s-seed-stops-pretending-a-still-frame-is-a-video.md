---
date: "2026-09-07"
title: "The labeler's seed stops pretending a still frame is a video"
decided_by: "Agent, closing round 9c's open item 38, on the owner's \"the next"
areas: ["general"]
supersedes: []
---
## 2026-09-07 — The labeler's seed stops pretending a still frame is a video

**Decided by:** Agent, closing round 9c's open item 38, on the owner's "the next
step is for me to start assembling the training data for the quads".

**Decision:** `detectSeed.ts` no longer builds a synthetic MediaStream. The
canvas-`captureStream()` → hidden `<video>` → `createScanEngine().start()` bridge
is deleted and replaced by a direct single-shot call into the engine's own
inference path: `drawModelInput` → `rgbaToBGRPlanar` → the cached `loadModel()`
session → `hasObj >= DEFAULT_ACQUIRE` → `modelPointsToCanonicalQuad` →
`refineQuadChecked(gradientField(...))`. Every one of those is the shipping
module, called unmodified.

**Why:** The seed had never once produced a quad — not on any device, in any
round. Round 9 blamed the environment, round 9b traced an unbounded
`await video.play()` that never settles on a canvas-backed stream, and round 9c
fenced that await and found the seed *still* `default`: with the hang bypassed,
the synthetic frame never reached the engine inside its 4 s window either. The
transport was the defect. `captureStream()` is driven by DRAWING — a canvas
nobody paints to after the stream opens has, from the track's point of view,
nothing to send — so it was being asked to deliver a video with one frame, to a
detector whose presence gate (hysteresis) and tracker (age, coasting) are both
explicitly about change over time. A still frame has no time axis, and two of
the three stages downstream were therefore answering a question that could not
arise. What was left out is stated as such in the file: the rAF cadence, the
gate's hysteresis (a cold gate is CLOSED, and a closed gate opens at exactly
`acquire`, so the single-frame test IS what the shipping gate does on frame one)
and the tracker, none of which changes the quad the detector proposed.

**Implications:**

* **The seed works, measured.** On a local production build in headless Chrome:
  `seededFrom: 'detector'`, `hasObj` 0.999, and the seeded quad lands on the card
  at **IoU 0.931** against an independently measured truth (0.19 against the
  centred fallback). The editor opens in **~210 ms** where round 9c measured
  **9.07 s**; `warmSeed()` starts the model load on mount, so the cold ORT boot
  is spent while the reader is still framing rather than after the shutter.
* **`seededTopLeftIndex` finally means something.** Every `default` row recorded
  before today is a rig artefact, not a detector miss, so the
  `topLeftIndex !== seededTopLeftIndex` rate over those rows measures nothing
  about rectify.ts's ~7 % orientation residual. Rows from this build do.
* **The fallback stays, and now says why it fired.** `pipeline.seedFallback`
  distinguishes `'no_object'` (the model ran and declined — real signal, and a
  recorded detector MISS when paired with a human positive) from `'unavailable'`
  (it never ran — says nothing about the frame). `hasObj` and
  `seedAcquireThreshold` ride along so a later re-tune cannot retroactively
  change what a row claimed.
* **Rows carry their provenance.** `stream` and `crop` are new and optional:
  `dims` is always the canonical square, so before them every row looked like a
  416x416 photo and no corner could be mapped back to a pixel in the original.
  `labelSchema` stays **2** — these add provenance, not meaning — and they are
  absent on the six schema-2 rows from 2026-09-06, where absence reads as
  UNKNOWN.
* **Nothing on the seed path awaits something unbounded any more**, which is
  `scan/ui/deadline.ts`'s rule and the one round 9b's hang broke. A source-level
  test asserts both awaits are raced against `SEED_BUDGET_MS` and that the
  captureStream bridge cannot come back.
* Harvest procedure is written down in `apps/web/src/scan/labeler/HARVEST.md`.

