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

**Why:** The owner wants to stop verifying every scan, and earlier work circled because nothing had a fixed scoreboard. Measured on 244 distinct real cards (labels audited by eye; 12 byte-identical duplicate crops counted once):
- **With OCR on**, AUTO-ID rose from 63.9% to 68.9% and WRONG fell from 1.9% to 0.6%.
- **On full-resolution crops**, AUTO-ID rose from 66.7% to 70.2% and WRONG fell from 1.8% to 0%.
- **As deckpal.app runs today (OCR off)**, AUTO-ID rose from 62.7% to 63.1% and WRONG fell from 1.9% to 0.6%.
- **The failures were specific:**
  - Decisive, correct vectors were hidden behind a misread number.
  - A Mankey was committed as a Togetic δ by a distance-9 dHash claim. That was the first answer to land, while the vector and OCR both said Mankey.
  - `BAS社 Torchic` failed the name lookup.
- **A fresh-context review tightened the fixes before merge:**
  - The key's own candidates return above rung 9 and the vector rung.
  - `nameAgrees` accepts only a lost owner prefix or a clipped first word, so Kadabra is not Abra and Kabuto is not Kabutops.
  - The override never beats a printed number the printed name also agrees with, and it respects the near-exact dHash veto.
  - `N` and `AZ` survive cleaning.
- **Also found:**
  - OCR is off by default on deckpal.app (`ocr/flag.ts`), so production gets no printed-key reading.
  - Telemetry keeps crops at 229×320, below what OCR can read.
  - The label audit adjusted 7 truths at the printing level (identical-art reprints) and confirmed 44.

**Implications:**
- **Gate for future changes:** any identification change reports its benchmark delta. A change that raises AUTO-ID must not raise WRONG.
- **Next levers, in measured order:**
  - fine-tune the image embedding (zero-shot CLIP is 80% top-1 on these crops);
  - make printed-key reading available to production users;
  - keep full-resolution crops in telemetry so OCR changes can be measured.
- **`resolvedBy` gains `name+denominator`;** the client records and displays it and branches on nothing new.
