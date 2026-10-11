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
- The refusal holds per track. A track that showed a back stays refused until the look re-arm sees a steady, different card in it (turned face up in place) or the track departs, because a thumb sliding over a back moves its look off the template for a tick.
- The lock still shows and manual Capture still works. The hint says "That's the back of a card — turn it over" instead of "Got it", and the lock recorder carries `cardBack`.

**Why:**
- **The stray investigation.** The 14 ground-truth videos (`scripts/scan-bench/video`) produce 18 stray captures in 114: booster packs 9, TCG Live code cards 2, video graphics 2, an ETB player's guide 1, a card back 1, a talking head 1, and 2 that are cards outside the GT windows. Three channel end-screens also fire inside a card's scoring slack.
- **Measured: no cheap rule separates packs or code cards from cards at zero card loss.** The positives were 776 real card crops (owner, telemetry, video) and all 20,467 catalog images.
  - A logistic head on the full look, cross-validated by video, refused 0 of 33 packs at zero real-card loss.
  - Aspect, saturation, sharpness, motion and the presence score all overlap. Card captures run down to 0.516 aspect, packs up to 0.914.
  - A pack-logo detector (yellow letters with a blue outline) caught 7 of 33 packs with no card hits, and a looser setting caught 12 with 3 hits in half the catalog. On the 9 GT packs they caught 0 and 1, because most of those logos are washed out.
  - A QR-window test scored dense card text above the code cards, and a white-body or dark-border test found no clean gap.
- **The back separates cleanly.** Real backs sit 0.15-0.62 from the template (leave-one-out). The nearest catalog card is 0.770, the nearest real crop 0.842, and the nearest of 1,033 lock ticks on GT cards 0.850.

**Implications:**
- **It removes 0 of the 18 GT strays.** The one GT back is a close-up the quad sees only part of, and partial backs do not look like the whole design. GT captures are unchanged. Replays of two non-GT videos with a well-framed back (R20ttkcolco 341.75 s, dXzZTc85QtM 142.4 s) lose those captures, and the next card there fires without the back's region in its way.
- **Packs and code cards are still the main strays.** Telling them apart needs a learned "is this a card face" head trained on more negatives than the ~105 there are today, or detector-level training. A threshold on these features will not do it.
- **Japanese backs** are a different design and are not modelled.
- **To re-measure:** `node --import tsx scripts/scan-bench/video/replay.ts <ids> --out <dir>` (`cardBackTracks` in the summary), then `score_video.py --run <dir>`.
