---
date: "2026-09-27"
title: "Suspend Deck-E in quad labeler"
decided_by: "Chey (via Codex)"
areas: ["scanner", "deck-e", "performance"]
supersedes: []
---
## 2026-09-27 — Suspend Deck-E in quad labeler
**Decided by:** Chey (via Codex)

**Decision:** Suspend Deck-E's host on `/dev/quad-labeler` while keeping the app shell and the labeler's Queue controls. The route resumes the normal host behavior when the user navigates away.

**Why:** The internal labeler decodes and repairs HEIC photos while its capture workspace runs. In the two-device Queue browser journey, two Deck-E WebGL hosts competed with that work. The second desktop page delivered only 8–14 animation frames in 1.5 seconds, while the same fixture without Deck-E delivered 89. The Queue button stayed at exactly the same bounds and had no animation. This measured renderer contention is a plausible contributor to the Queue click timeout under a loaded CI runner; the failed run did not capture a frame trace that would prove the exact cause.

**Implications:** Deck-E does not appear or warm its WebGL renderer on this internal photo workspace. No other route or app chrome changes. The Queue journey still uses the owner fixture with Deck-E entitlement, so it tests the route rule rather than a stripped-down account. Desktop and phone browser captures remain the visual check.
