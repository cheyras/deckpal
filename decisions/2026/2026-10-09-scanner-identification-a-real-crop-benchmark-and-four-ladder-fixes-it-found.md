---
date: "2026-10-09"
title: "Scanner identification: a real-crop benchmark, and four ladder fixes it found"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml", "tooling"]
supersedes: []
---
## 2026-10-09 — Scanner identification: a real-crop benchmark, and four ladder fixes it found
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Every scanner identification change is now scored on one fixed benchmark of real crops before it ships, and the first four fixes it found ship together.
- **The benchmark:** `scripts/scan-bench/`.
  - It replays saved crops through the shipping path with no database and no deployment: server dHash, device OCR, image vector, resolve ladder, client identity reducer.
  - It scores AUTO-ID (confident and right, over real cards) and WRONG (confident and wrong, over confident answers).
  - Data is 278 real crops from six earlier owner sessions, 256 of them cards with a known answer, kept under `~/deckpal-data/scan-bench` because they are the owner's photos.
- **Name cleanup:** `cleanNameRead` strips what OCR reads off the frame: a stray CJK glyph from the Chinese recogniser, the stage badge (`BAS`, `STAGE 1`, `suppoter`) and the HP tail. The word list was checked against all 21,291 catalogue names; `Basic … Energy`, `Item Finder` and `Tool Box` are untouched.
- **New `name+denominator` rung:** a dropped numerator digit (`03/182` for `063/182`) used to name two wrong cards. The printings of the read name in sets of the read size now name one.
- **A decisive vector that the printed name agrees with is the answer, even after an unconfident key rung.** It resolves as `corroborated`. A name that disagrees still leaves the reader to choose. With no name read, an unconfident key that disagrees with the vector stays silent, as before.
- **The dHash may name a card alone only at distance ≤ 7** (`PHASH_SOLO_MAX`, client tie gate). At 8–9 it stays in the picker and the capture waits for the resolve leg.

**Why:** The owner wants to stop verifying every scan, and earlier work circled because nothing had a fixed scoreboard. Measured on the 256 cards:
- **With OCR on**, AUTO-ID rose from 63.7% to 68.8% and WRONG fell from 3.0% to 1.7%.
- **As deckpal.app runs today (OCR off)**, AUTO-ID rose from 62.5% to 62.9% and WRONG fell from 3.0% to 1.8%.
- **What drove it:** 12 captures moved from needs-you to right, 2 from wrong to right, and 1 lost (a correct dHash claim at distance 9 now waits).
- **The failures were specific:**
  - Nine decisive, correct vectors were hidden behind a misread number.
  - A Mankey was committed as a Togetic δ by a distance-9 dHash claim. That was the first answer to land, while the vector and OCR both said Mankey.
  - `BAS社 Torchic` failed the name lookup.
- **Also found:**
  - OCR is off by default on deckpal.app (`ocr/flag.ts`), so production users get no printed-key reading at all.
  - Telemetry keeps crops at 229×320, below what OCR can read.
  - Two benchmark labels were wrong: the scanner was right and the label was not. They were fixed and annotated.

**Implications:**
- **Gate for future changes:** any identification change reports its benchmark delta. A change that raises AUTO-ID must not raise WRONG.
- **Next levers, in measured order:**
  - fine-tune the image embedding (zero-shot CLIP is 80% top-1 on these crops);
  - make printed-key reading available to production users;
  - keep full-resolution crops in telemetry so OCR changes can be measured.
- **`resolvedBy` gains `name+denominator`;** the client records and displays it and branches on nothing new.
