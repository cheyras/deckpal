---
date: "2026-11-26"
title: "A card the scanner already took is offered again with a tap, not re-captured by a flip rule"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-11-26 — A card the scanner already took is offered again with a tap, not re-captured by a flip rule
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** When the lock is a card the duplicate policy refuses (`regions.ts`, the per-track refractory, `rearm.ts`), the hint says **"Already scanned"**.
- After `REPEAT_OFFER_MS` (1 s), the hint becomes a button: **"Tap to scan again"**. It runs a real manual capture, read and identified like any other.
- There is no automatic "it was flipped" rule.
- Every detect tick now goes into a numbers-only `tick-trace` record (`flags.ts recordTick`), posted every 10 s. Each row holds the tracks, the verdict, and the lock's look distance to the capture behind a refusal and to its own previous lock look. The scan-flags endpoint accepts that one record type without an image.

**Why:** The owner's 2026-11-26 session raised two problems.
- With two copies of one card in a stack, flipping to copy 2 never captured it.
- Different cards often would not fire until he pointed away and back. The hint read "Got it — hold on…" the whole time, which looks like a scanner about to fire.

**Why no automatic flip rule:** the owner asked for one, but nothing the scanner sees separates an identical copy put down in the same place from the same card still lying there. Look, hash and embedding are identical by construction. Every transition signal measured fires on ordinary handling of one card:
- **A finer look** (grey grids 16–48 wide, high-passed, NCC) on the labelled refusals of owner sessions 1–3: same-card similarity spread over 0–0.96 from blur and misregistration, so it cannot say "different".
- **A track jump** (centroid moving ≥ x card-lengths between observations), on 20 ground-truth videos: same-card jumps outnumber real swaps at every threshold (59 vs 25 at 0.2).
- **The look leaving and coming back** after a capture, on 5 stack-flip videos: 2 fires, both on the same card, and 0 true ones. The footage has no identical copies, so the true side is unmeasured.
- **The tracker keeps one track id across a real swap** on the fast stack-flip video (46OLXH5): the quad jumps about 30% after a coasting tick. So identity cannot come from the tracker either.

A rule built on these would generate duplicates. Once second copies are a normal flow, a duplicate looks like a real second copy and commits a wrong quantity. A tap costs one touch per extra copy, never captures silently, and also rescues a different card the look could not tell apart: about a third of refused new cards sit within `REARM_NEW_MIN` of the capture behind them (owner-rearm.ts).

**Implications:**
- **Unchanged:** `REARM_NEW_MIN` stays 1.0 until the seven-video bench re-measures 0.9. Its own record prices 0.8 at ten more duplicates per hundred.
- **The trace is the instrument for revisiting this.** Replaying the next field session's traces says whether any flip signature fires on real copies and not on one card handled. Until then, any automatic rule runs in shadow only.
- **What "Already scanned" shows:** the card just captured, still in hand, shows it once its capture is done. The button holds back for a second so reaching for the next card does not flash an offer.
