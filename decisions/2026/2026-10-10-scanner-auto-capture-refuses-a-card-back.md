---
date: "2026-10-10"
title: "Scanner auto-capture refuses a card back"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-10-10 — Scanner auto-capture refuses a card back
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** A lock whose look is the English card back's never auto-captures (`engine/cardBack.ts`, applied in `scan/ui/autoCapture.ts`).
- The back is one fixed design, so its look (the 8x11 Y/Cb/Cr grid `EngineState.look` already carries) is a template: the mean of eight real backs. A look within 0.65 of it (`lookDistance`, either way up) is a back. No extra pixels are read.
- A tick whose look is the back's never fires. Two of a track's lock ticks in a row HOLD the track (`createCardBackHolds`), because a thumb sliding over a back moves its look off the template for a tick. One tick does not hold it: the margin to the nearest card is carried mostly by chroma, which the light's colour moves, so a single misread tick costs that tick only.
- A held track lets go on its own rule, not the look re-arm's: its look has held still (`REARM_STEADY_MAX`, the re-arm's steadiness rule) and sits further than 0.75 from the back, either way up (`CARD_BACK_RELEASE_DISTANCE`). 0.75 is above every replayed back tick (up to 0.70, thumb on it) and below the nearest catalog card (0.770) and real crop (0.842). The re-arm's 1.0 would never release the ~1% of cards within 1.0 of the back, nor a captured card flipped to its back and back again (it is not "new" against its own capture). Released, a fresh lock fires and a repeat is judged by the re-arm as before. The verdict reports the release as `backReleased`, separate from `newByLook`, and the lock recorder carries it.
- A track that departs takes its hold with it. The template is compared upright and turned 180°; a back lying sideways (past 45°, which the warp turns a quarter, see #306's decision) is not modelled.
- The lock still shows and manual Capture still works. The hint says "That's the back of a card — turn it over" instead of "Got it", and the lock recorder carries `cardBack`.

**Why:**
- **The stray investigation** (2026-10-10, on the 14 ground-truth videos labelled then, before the #317 detector). The 14 ground-truth videos (`scripts/scan-bench/video`) produce 18 stray captures in 114: booster packs 9, TCG Live code cards 2, video graphics 2, an ETB player's guide 1, a card back 1, a talking head 1, and 2 that are cards outside the GT windows. Three channel end-screens also fire inside a card's scoring slack.
- **Measured: no cheap rule separates packs or code cards from cards at zero card loss.** The positives were 776 real card crops (owner, telemetry, video) and all 20,467 catalog images.
  - A logistic head on the full look, cross-validated by video, refused 0 of 33 packs at zero real-card loss.
  - Aspect, saturation, sharpness, motion and the presence score all overlap. Card captures run down to 0.516 aspect, packs up to 0.914.
  - A pack-logo detector (yellow letters with a blue outline) caught 7 of 33 packs with no card hits, and a looser setting caught 12 with 3 hits in half the catalog. On the 9 GT packs they caught 0 and 1, because most of those logos are washed out.
  - A QR-window test scored dense card text above the code cards, and a white-body or dark-border test found no clean gap.
- **The back separates cleanly.** Real backs sit 0.15-0.62 from the template (leave-one-out). The nearest catalog card is 0.770, the nearest real crop 0.842, and the nearest of 1,033 lock ticks on GT cards 0.850.

**Implications:**
- **Re-measured on main at 9219ef99 (#317 detector)**, the rule above, all 22 GT videos over their GT windows plus the two back clips (R20ttkcolco 320-360 s, dXzZTc85QtM 125-160 s), scored with `score_video.py`: 395 scored captures, captured 229 of 463 capturable (49%), auto-ID 123 (27%), duplicates 56, strays 32, confident-wrong 2. Every number, and every one of the 412 fired captures across the 24 replays, is identical to the branch before the hold changes; the 2 confident-wrong (RLULfTjTFSs, gUw1BTjycBU) are on videos where the gate never refused a tick.
- **The only GT refusal is a genuine back:** ARAWSwYFz2I 26.125 s, track 11, one tick, on a track already captured, so no capture changes. It no longer holds the track (one tick), and its next two lock ticks are refused as repeats instead. The two back clips refuse the well-framed back on every lock tick and never fire on it (R20ttkcolco 341.75 s track 5, 12 ticks; dXzZTc85QtM 142.4 s track 7, 23 ticks).
- **It removes no stray that was not a back.** On the 2026-10-10 bench the one GT back was a close-up the quad sees only part of, and partial backs do not look like the whole design.
- **Packs and code cards are still the main strays.** Telling them apart needs a learned "is this a card face" head trained on more negatives than the ~105 there are today, or detector-level training. A threshold on these features will not do it.
- **Japanese backs** are a different design and are not modelled.
- **To re-measure:** `node --import tsx scripts/scan-bench/video/replay.ts <ids> --out <dir>` (`cardBackTracks` in the summary), then `score_video.py --run <dir>`.
