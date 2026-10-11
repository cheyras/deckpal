---
date: "2026-10-10"
title: "Scanner look re-arm: a capture's look carries its four quarter turns"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner look re-arm: a capture's look carries its four quarter turns
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The look re-arm (2026-10-10, "a different card in the same place fires") now compares a lock with a capture at the capture's nearest quarter turn.
- `captureLook` (`engine/look.ts`) stores the capture's look at all four corner orders: 4 x 264 bytes, warped from the full-resolution capture. Turn 0 is the capture as taken, byte for byte the old look.
- `lookDistance` takes the nearest turn, and a turn other than the capture as taken costs `LOOK_TURN_COST` (0.3). A tick's look stays one orientation, so the steadiness check is unchanged.

**Why:**
- **A capture can come out turned.** Rectification picks the card's top-left corner by position (`rectify.orderQuadForCard`), so a card lying, or swinging, past 45° is captured sideways or upside down. 3 of owner session 1's 42 captures were. Its look then fails to match the very card it is: on `scripts/scan-bench/owner-rearm.ts` the re-arm re-captured a Marill twice (look distance 1.45 and 1.51) behind its own sideways capture. At its turn that capture matches at 0.20; the same card turned matched at 0.14-0.57.
- **The turns are not free.** Each extra turn is another draw at a chance look-alike. With no cost, different-card pairs at or under the re-arm threshold rose from 13-27% to 23-36% per session, and the re-arm lost 3 of the 23 new cards it rescues on the owner's sessions (Cinccino matched a Skwovet at its half turn, 0.77) and 3 of 30 captured cards on two of the CC BY videos.
- **At 0.3, nothing else moves.** Owner sessions: 23/39 new cards rescued, as before; same-card fires 3 locks (2 cards) to 1 lock (1 card, a partial quad); motion fires 3, as before. Videos `RLULfTjTFSs` and `BO1Wa-evt6k`: the identical captures (30 of 73 captured, 21 auto-identified, 3 duplicates, 2 strays, 0 confident-wrong).
- **Rejected:** a 180-degree grid flip alone (the duplicates were quarter turns); resampling a turned 8x11 grid back to portrait (a quarter turn of it is 11x8, and smears the layout); quarter turns only, without the cost (21/39 rescued).

**Implications:**
- The nearest rescue on the owner's sessions is now closer to the threshold: Cinccino at 1.07, where it was 1.19.
- `LOOK_TURN_COST` is tied to `REARM_NEW_MIN`. A turned match refuses below 0.7, so retuning one means re-measuring the other with `owner-rearm.ts` and the video replays.
- The remaining same-card fire on the owner's sessions is a lock whose quad held only part of the card. Turns do not help with that.
