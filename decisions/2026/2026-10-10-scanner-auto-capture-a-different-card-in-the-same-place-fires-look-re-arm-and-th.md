---
date: "2026-10-10"
title: "Scanner auto-capture: a different card in the same place fires (look re-arm), and the lock dwell drops"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner auto-capture: a different card in the same place fires (look re-arm), and the lock dwell drops
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Two changes to when the scanner captures on its own.
- **The look re-arm** (`scan/ui/rearm.ts`, `engine/look.ts`). Auto-capture refuses a lock it has already captured: per track (the refractory) and per place (`regions.ts`). A lock refused only for that reason now fires anyway when the card in it looks different from the capture behind the refusal, and its look has held still.
  - A "look" is a 264-byte colour layout of the card: luma and chroma cell means over an 8x11 grid of the rectified card.
  - The engine computes it every tick for the lock (`EngineState.look`). Every capture computes it from its own pixels (`captureLook`), so a manual capture of an unlocked card has one too.
  - The look is kept with the track and with the region, and a later lock is compared only against those. A refusal whose capture has no look is kept.
- **The lock dwell** (`DEFAULT_LOCK_TICKS`) drops from 3 ticks to 2.

**Why:**
- **The stack case.** A reader working a stack puts the next card where the last one was. The tracker keeps the same track id across the swap because the quad barely moved, so the refractory refuses the new card for as long as it sits there. The same case appears in a flip-through, where one card slides off the next.
  - `regions.ts` already measured the place half of this on owner session 1 ("overlap is not identity") and fixed it. A track id is not identity either; the pixels are.
- **Measured.** `scripts/scan-bench/video` replays seven CC BY pack-opening and flip-through videos through the shipping engine and policy as the camera: 192 capturable card appearances, with hand-made ground truth. Each capture is identified with the identity model and its gate.

  | | captured | auto-identified | duplicates | stray captures | confident wrong |
  |---|---|---|---|---|---|
  | before (lock 3, no re-arm) | 18% | 10% | 2 | 8 | 0 |
  | lock 2 + re-arm (this) | 31% | 19% | 9 | 10 | 0 |
  | lock 1 + re-arm (not taken) | 39% | 21% | 14 | 13 | 0 |

- **Lock 1 is not taken, though it measured best.** At 1, a shape flickering between card and not-card on alternate ticks locks on its good ticks. That is the clutter failure field test 2026-09-03 fenced ("the dwell must be UNINTERRUPTED"). Two ticks keep that fence.
- **The re-arm compares only against the captures behind the refusal.** Two unrelated cards land within the threshold about one time in six. Comparing against every recent capture therefore refused most new cards once a session had a dozen captures: a first version that did so measured 35% where this one measures 39% (at lock 1).
- **Memory is by count, not time.** A 15 s memory re-captured a card held for 16.5 s: the refusal lasts as long as the card stays, so the look must too.
- **Measured and rejected:**
  - **Waiting for the card to settle before firing** made it worse (14% captured): in a flip the card leaves before it stops.
  - **A 64-bit dHash as the look** was too noisy: one card's ticks sat a median 16 bits apart against 30 for different cards.
  - **Replacing a mid-motion capture with a steadier frame** rarely triggered, because the cards are almost never at rest.

**Implications:**
- **Duplicates rise, deliberately** (2 to 9 per ~80 captures on the replays). That is the trade `regions.ts` already prices: a duplicate costs a row in a list the reader reads anyway, and a suppression costs a card the scanner silently refused.
- **No merge by identity.** A re-armed capture is not merged into the previous one even when the identifier names the same card. The 2026-09-07 ruling makes two scans of one card two rows, and a normal then a reverse holo, swapped in place, is exactly that.
- **What is still limiting video capture is the detector, not the policy.** On two of the seven videos LC050 never reaches the presence gate on most cards: small hand-held cards on a busy background, and cards cut off by the frame. Those 60 appearances are a detector-training question.
- **Field measurement:** the lock recorder now carries `newByLook`, so a real session can count re-arms the way round 4 counted regions.
- **To re-measure:** `node --import tsx scripts/scan-bench/video/replay.ts <ids> --out <dir>`, then `score_video.py --run <dir>`. `--lock-ticks` and `--no-rearm` replay the alternatives.
