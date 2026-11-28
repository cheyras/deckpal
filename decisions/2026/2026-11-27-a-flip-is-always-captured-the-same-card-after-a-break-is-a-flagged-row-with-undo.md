---
date: "2026-11-27"
title: "A flip is always captured; the same card after a break is a flagged row with Undo, not Already scanned"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: ["2026-11-26 A card the scanner already took is offered again with a tap, not re-captured by a flip rule"]
---
## 2026-11-27 — A flip is always captured; the same card after a break is a flagged row with Undo, not Already scanned
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The scanner stops asking the camera "is this the card I already scanned?" and asks "has the card I took stayed in view since?" (design: `.cache/tack-2026-11-27/scan/DESIGN.md`, by the design advisor). This supersedes the 2026-11-26 decision's blocking "Already scanned" and its "Tap to scan again".
- **The presentation episode** (`scan/ui/presentation.ts`, one pure machine). A capture opens an episode.
  - **WATCHING:** the card stays in view. Nothing fires. The pill says "Scanned ✓ {name}", a positive statement that is true by construction. "Scan again" stays on it.
  - **BROKEN:** a hand over the card, the card leaving, the look moving off it. Any break, then a steady card, is captured. Always.
  - Each tick is classed by the lock's look against the episode's reference (the median of its first three steady lock looks). When nothing is locked on the episode's spot, the **spot look** stands in: the engine's look of whatever lies on that quad now (`EngineState.spotLook`, `engine.watch`). So a detector dropout over an untouched card reads quiet, and a hand reads hard.
  - **Thresholds (the design's starting values):** quiet ≤ 0.60, hard > 0.90 or a null look. A break is 2 hard ticks in 12 (1.5 s), or 1 hard and 2 soft. A drift is 8 soft ticks with no hard tick, and fires a silent probe. The settle after a break is 2 steady lock ticks.
  - **Two track rules added to the design (supporting evidence, never proof):** the tracker re-identifying the lock on the card's spot counts as one hard tick (`reidIsHard`). After a break, a track the episode never saw fires on its lock as a fresh lock does (`freshTrackFires`). See the deviations below.
  - **The old policy is removed, not left running beside it:** the per-track refractory, `regions.ts`, `rearm.ts`, `REPEAT_OFFER_MS` and the repeat hold.
- **Same card or not is decided afterwards, by identity** (`scan/ui/repeat.ts`), against the capture the episode broke from:
  - a different card is a row;
  - the same card is a row **flagged "Same as last scan"**. The pill says "Same card again · kept as a copy" with **Undo** for 4 s, and the row carries the chip;
  - unknown is a row;
  - a drift probe of the same card at a close capture look (≤ 0.60) is dropped. It is the only capture ever dropped, and nobody saw it happen.
  - Same means equal card ids, or else equal OCR names (≥ 4 letters) with numbers equal where both have one.
  - Two rows stay two rows (2026-09-07). There is no merge.
- **The kill switch:** `SAME_AFTER_BREAK: 'keep-flagged' | 'ask'` in `repeat.ts`, default `'keep-flagged'`. `'ask'` holds the thumbnail in the tray with "Same card again — add a copy?" (Add copy / Skip), adds nothing until tapped, and skips it when the next capture fires.
- **The capture flash:** 540 ms (`DURATION.instant + DURATION.slower`). It rises to 0.92 in 50 ms (linear), holds to 120 ms, then falls on `EASE.enter`, fired at the shutter. The captured quad's outline goes white for the hold.
  - Reduced motion keeps it: peak 0.5, no hold, gone over `DURATION.fast`.
  - Captures are never closer than 400 ms (`MIN_FIRE_GAP_MS`), so it stays under 3 flashes a second.
- **The status pill** (`scan/ui/statusLine.ts`, pure). Facts go in; a priority order, enter delays, minimum dwells and exit holds decide what shows. "Already" appears nowhere.
  - The pill says "Captured ✓" for at least 1.2 s.
  - "Scanned ✓" waits 1.5 s after the capture (S1).
  - Aiming advice is not offered while a card is being watched.
  - While "Scanned ✓" shows, the tray thumbnail or list row it is about carries a 2 px `ring-action-primary`.
- **The camera → list hand-off** (`scan/ui/handoff.ts`): one capture, one visible image, at every frame.
  - The tray slot and the row picture are inserted hidden. Each leg's courier is made in the same frame and homes on its target every frame (requestAnimationFrame, transform and opacity only; a documented exception to `ui/motion.ts`'s WAAPI rule). It is swapped for the target on the landing frame.
  - Landings queue at least 150 ms apart. The bin stays newest first, in shutter order even when cards settle out of order (`feed.addArrival`).
  - A reader who has scrolled the bin is not scrolled. A landing above them moves the scroll position by exactly the insert, so their rows stay put. The courier fades at the list's top edge, and "1 new ↑" appears.
- **Tick trace v2** (`flags.ts`). Each row carries the machine's state, `d`, the tick class, the spot flag, the episode and the break. `episode-fire` and `repeat-outcome` (with `undone`, the label that calibrates the rule) ride inside the same image-less `tick-trace` record.

**Why:** The owner's 2026-11-27 field session (SCAN-SPEC S1-S3, S5). His closing words: "It's been pretty frustrating, actually."
- **S3, the false "Already scanned".** In his words: "So I have flipped. I didn't move my camera. But I flipped to another card, and it's saying, already scanned, so that's not correct". And: "that's a false signal… that will confuse people and make them not trust the scanner."
  - **The diagnosis (design §1):** "not provably different by look" was shown as "already scanned". 19 % of 6,156 unrelated pairs of his own crops sit under the re-arm's 1.0. PR #416 measured his White Flare cards at 0.44–0.99 from each other.
  - The regions re-anchored to the next card put on the spot, and held it for up to 30 s.
  - No local pixel test separates same from different at the tails; identity has to.
- **S1, the capture must be unmistakable.** "make it way more clear when there's a scan, like have the whole camera like flash to white and then fade back… there's no question that it captured just now."
- **S2, the pill flickered.** "The little message under there changes too much."
- **S5, the hand-off.** "it can't feel glitchy and it can't feel like it just… goes away and appears somewhere else… it needs to feel fluid and smooth". For 300 ms one capture was on screen three times, and the courier landed where the row had been.
- **Pushing back on #397's conclusion, not its measurements.** #397 showed that no transition signal can decide by itself whether to capture without creating duplicates. Here the transition signal only decides whether to look again, and identity decides what it was. The one case identity cannot settle is kept, flagged and undoable instead of refused.

**The trade-off, stated:** a hand that fully covers the card, or the phone leaving and coming back, is the same pixels as an identical copy swapped in. Either one now yields a **flagged extra row with Undo**: visible as it happens (flash and pill), in the list (the chip) and at Verify. It never yields a silently refused card. If the owner finds that worse than a tap, `SAME_AFTER_BREAK = 'ask'` flips it. His standing priority (regions.ts, 2026-09) is that a duplicate row costs less than a refused card, and his stated goal is that a flip counts without a tap.

**Deviations from the design, each for a stated reason:**
- **After a break, a track the episode never saw fires on its lock (`freshTrackFires`).** The design's two-tick settle applied to every lock after a break. On the 7-video bench, cards in a flip-through that were never steady for 2 ticks were missed.
  - Captures fell to 53 of 192 appearances (28 %). The regions took 63 (33 %), and the design's own bar is ≥ 31 %.
  - The settle exists for the tracker following one object mid-slide, so it still applies to a track the episode saw. A new track is a new object, the IDLE rule.
  - With the rule: 66 (34 %).
- **The tracker re-identifying the lock on the episode's spot counts as one hard tick (`reidIsHard`).** PR #416 measured the owner's White Flare cards at 0.44–0.99 from each other by look, so a swap can read as quiet. A re-id plus any other hard tick (the hand) is a break; a re-id alone is not.
  - It is neutral on the video bench (53 → 53 by itself, 66 → 66 with the rule above).
  - It costs only on the desktop fake camera, which re-ids one static card fifteen times: e2e round 2 goes 4 → 7, round 3 goes 6 → 8.
- **A second card locked elsewhere, steady for 2 ticks, while the first still lies on its spot, is a break.** The design's machine would leave that card waiting until the first is moved, which is a silent refusal.
- **A vacancy (8 ticks with nothing locked) keeps the comparison.** The next capture is `disturbed`, not `first`, and is compared with the last capture. The design's table gives IDLE→first no flag, but its own phone script step 5 ("point the phone at the table for two seconds, come back") expects "Same card again".
- **Manual captures:** the Capture button is a plain row (the §2.3 table). "Scan again" is flagged when it names the same card (§2.5).
- **The tray → row courier:** `EASE.enter`, 420–720 ms by distance (`COURIER_MAX_SPEED` 2.6 px/ms), not 420 ms on `EASE.sheet`. That flight is about 600 px on a 390×844 phone. The sheet curve's fastest frame then moves 96 px, twice the design's own 48 px smoothness bar. Measured: 43 px. The tray leg keeps `EASE.sheet` and may stretch to `DURATION.slower`.
- **The status arbiter adds one rule:** outside the capture events, two changes are never closer than 800 ms. The design's table alone does not hold its own "≤ 1 change per 800 ms" bar, because "Point the camera" has no dwell.
- **"Got it — {name}" waits for the final name.** PR #416 found the hash can name a wrong card first (a blurred Joltik hashed 5 bits from Raticate), which `narrowedIdentity` corrects a moment later.
  - The pill says "Scanned ✓ identifying…" until the capture's second answer has reported, then names the card that stuck.
  - The row keeps the recognition lane's behaviour.
  - A "Same as last scan" flag set on the hash's name is re-asked after that correction.
- **The trace events ride inside `tick-trace`, not as their own record types.** The scan-flags endpoint accepts one image-less type, and the web and API deploy together, so this needs no server change.
- **Undo goes through the review-list lane's door (`undoRemove.ts`, #417).**
  - The pill's Undo removes the flagged row with `removeWithUndo`, so its toast names the card and offers the row back. It also records `repeat-outcome {undone: true}`.
  - It withdraws "Same card again" from the pill at once; the status line drops a one-shot whose fact is gone.
- **The row picture is `self-start`.** It is the courier's landing target, and the stretched box put the landing 20 px off the picture.
- **The flash reaches 0.9 within one frame of 60 ms** (53–67 ms measured). The design's own 50 ms rise starts on the frame after the shutter, so 60 ms flat cannot be met at 60 Hz.
- **A landing above a reader who has scrolled the bin is compensated by hand.** The scroll position moves by the insert, so the rows hold within 0.5 px. The scroller gets `overflow-anchor: none` (iOS has no scroll anchoring). This was left to this lane by #417, and it is built on #417's touch and idle tracking.

**Not done, and why:**
- **Step 0, replaying the owner's 2026-11-27 tick traces, was not done.** They are on the server behind `GET /api/dev/scan-flags` and a QA sign-in, and no one working on this may sign in.
  - So the thresholds are the design's provisional values, checked only on the offline replays below.
  - Trace v2 measures `d` directly, so the next field session calibrates them.

**Measured** (the before/after numbers are in the PR):
- **Unit tests:** the four cases, the edges, the §2.3 table, and a property test of the arbiter over random sessions.
- **The regression fixtures are re-baselined**, not deleted. Each file states its old and new numbers.
  - owner session 1: regions 33 auto-captures, 10 of 21 presses saved, 4 duplicates. Episode 58 / 14 / 8, every duplicate a flagged row.
  - owner session 2: 35 of 35 locked presentations captured once each, at the floor.
  - e2e round 3, one card on a fake camera: regions 7, episode 8 to 11. Round 2: 9, episode 7 to 9.
  - round 5's re-id churn: no duplicate.
- **The video bench** (`scripts/scan-bench/video`, 7 videos, 192 capturable appearances, `score_video.py`). Before is today's regions and re-arm, replayed on the same engine.

  | | captured | auto-ID | captures | duplicates | strays | confident wrong |
  |---|---|---|---|---|---|---|
  | before (regions + re-arm) | 63 (33 %) | 39 (20 %) | 85 | 10 | 10 | 1 (a transition) |
  | the design as written | 53 (28 %) | 34 (18 %) | 78 | 13 | 10 | 1 |
  | **shipped (+ both track rules)** | **66 (34 %)** | **39 (20 %)** | 93 | 14 | 11 | 1 |
  | settle 1 tick instead of 2 (not taken) | 79 (41 %) | 50 (26 %) | 112 | 19 | 12 | 1 |

  - **Settle at 1 tick is not taken.** It measured best, but the replay does not model the focus gate, which on a device holds the mid-motion frames 1 tick would take. It is the one constant (`SETTLE_TICKS`) to move if the owner's phone session agrees.
  - **Duplicates** are extra captures inside one appearance. On a device identity flags them "Same as last scan" when it names the same card.
- **The stack-flip videos** (5 videos; `flip_swaps.py`). This counts each swap that ever locked and was taken within 2 s of its first lock:
  - before: 49 %, or 50 % of the locks the size gate did not hold;
  - the design as written: 48 % (55 %);
  - shipped: 56 % (69 %).
  - The design's ≥ 95 % bar is not met. Most of the remainder is the size gate on footage that cannot come closer.

**Implications:**
- **Watch the false copies.** Hand-held cards break continuity more often than a card on a table, so those users get more flagged rows. `repeat-outcome.undone` rates are the number to watch after release.
- **More captures means more `/scan/embed` calls**, one per presentation including false breaks. No paid AI call is involved.
- **The owner's phone script** (design §5.5, in the PR) is the acceptance test. Its v2 traces and Undo taps are the labelled data for the next tuning pass.
