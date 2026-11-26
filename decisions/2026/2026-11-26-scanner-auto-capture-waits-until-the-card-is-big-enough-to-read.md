---
date: "2026-11-26"
title: "Scanner auto-capture waits until the card is big enough to read"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-11-26 — Scanner auto-capture waits until the card is big enough to read
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** An automatic capture now fires only when the card's long side spans at least 60% of the square the detector sees (`MIN_CARD_SIDE = 0.6`, `apps/web/src/scan/ui/sizeGate.ts`).
- **The measure:** the mean of the locked quad's two long edges, over the canonical frame's side, judged on the tracker's smoothed quad through `decideAutoCapture`.
- **What the reader sees:** the card still locks and its outline still draws. The hint reads "Move a little closer", and the same track fires the moment it is big enough, with no re-aim.
- **Ordering with the focus gate:** too-far outranks focus. The focus wait is not judged while the card is too far, so it starts when the card arrives rather than settling on frames that were never going to be taken.
- **What is not gated:** manual captures. A repeat or a card back is never told to come closer.
- **Telemetry:** lock events record `cardSide` and `tooFar`, so the floor can be re-measured from the field.
- **The offline video replay** runs the same gate, with `--no-size-gate` to replay the earlier policy.

**Why:** The owner asked that a card too far away to read never auto-capture, without making people hold the phone at an exact distance. Nothing checked size before: a card at a quarter of the frame could lock and fire.
- **The sweep** (`scripts/scan-bench/size-sweep.{py,ts}`). 292 of the owner's queued card photos, each captured as the scanner would capture it at nine distances and read by the device OCR:

  | long side / frame | 0.80 | 0.70 | **0.60** | 0.55 | 0.50 | 0.45 | 0.40 | 0.35 | 0.30 |
  |---|---|---|---|---|---|---|---|---|---|
  | a printed field kept | 95% | 92% | **84%** | 83% | 83% | 71% | 63% | 48% | 43% |
  | the number kept | 92% | 95% | **80%** | 73% | 65% | 52% | 32% | 7% | 1% |
  | number misread (of 128) | 0 | 0 | **3** | 2 | 2 | 5 | 6 | 12 | 2 |

  A usable printed field (name, or number and total) plateaus down to 0.50, then steps down. From 0.45 the number starts to be misread, not just missed. Names survive almost any distance and were never misread.
- **Why 0.60 and not the sweep's 0.50 (the owner's call):**
  - The sweep shrinks sharp still photos, which only removes pixels. A real camera at distance is also softer: lens blur, video noise reduction that smears small text, hand shake. So the sweep is a best case, and the real limit sits closer than 0.50 by an amount nothing on record measures.
  - 0.60 is where even the best case keeps the number on four cards in five.
  - It is also where the owner's sharp live captures read theirs (0.59–0.61, 2026-11-25 session).
- **What it costs:**
  - Of the owner's 115 real camera captures, 0.60 would have asked 30 to come closer (0.50: 6).
  - People hold a card at a median 0.70 of the frame, and the on-screen outline is 0.88 of it. 0.60, about two thirds of the outline's height, still leaves a band to aim in.

**Implications:**
- **Speed:** a card held at the usual distance fires exactly as before. A far one waits until it is brought closer.
- **Detector error:** a close card the detector outlines by its inner frame (about 11% small) can read as too far near the floor. That costs a nudge closer, not a stall.
- **Calibration:**
  - The floor assumes the 960 px stream every recorded phone capture used. A lower-resolution camera reads less at the same fraction. The gate stays a fraction of the frame so the ask is the same on every device.
  - The real-camera answer is a field session: cards captured by hand at several distances, OCR on their full-resolution crops, against `cardSide`. That decides whether 0.60 moves.
- **Video bench:** footage cannot come closer when told to. `farTracks` in a replay's summary counts the cards the gate held, the gate's cost on a video that a phone would mostly not pay.
