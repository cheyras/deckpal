---
date: "2026-11-26"
title: "The scanning bin lists newest first; review counts copies up and never shows a confirmed card again"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-11-26 — The scanning bin lists newest first; review counts copies up and never shows a confirmed card again
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:**
- **Scanning bin:** Step 1's card list (under the camera) is **newest first**, with no sort control. It keeps the top in view when a scan lands, unless the reader has scrolled away. The rows already there slide down to make room (FLIP against layout positions).
  - The Verify screen keeps the 2026-09-07 default ("first scanned on top") and its sort control.
- **Swipe review stack:** the stack is one list keyed by entry. A confirmed card flies off on its own layer and is removed without its animation ever being cancelled. The card behind, as the same DOM node, grows into the front.
  - "Wrong" opens the correction picker in place.
  - A drag can take the card mid-animation.
- **Running owned count:** "You'll have" counts the earlier copies of the same printing in this scan (`feed.ts runningOwned`). Three copies read 0→1, 1→2 and 2→3, each labelled "copy n of 3".

**Why:** The owner's 2026-11-26 session reported three problems:
- **The swipe:** "I swipe the card away, and then the same card comes back in from that right edge as the next card ... very disorienting ... it almost made me unconfident in what I was seeing". `flingOut` cancelled its fill-forwards animation on finish, so the node snapped back to the drag's release pose for at least a frame before React swapped the next entry in at centre.
- **The counts:** "3 Oricorios ... all of them said 0 to 1 ... it wasn't clear did that last one count at all". Every row quoted the same pre-session snapshot, even though commit folds them all into +3.
- **The bin:** "it doesn't really keep up with the most current one. I think the most current one should just probably be at the top and push the others down". The bin is two or three rows tall, sorted oldest first, and never scrolled, so each new scan landed out of sight.
  - **Jumps:** its FLIP diffed screen rects saved after the animations started, so a scroll or a slide still in flight made rows leap.

**Implications:**
- **Recorded check:** `tests/browser/scanReviewMotion.mts` mounts the real components over fixture rows, records a video, and samples every animation frame of a button confirm and a drag confirm. The run fails if the confirmed card ever moves back or lingers, if the bin is not newest first, or if the copies do not count up.
- **A desktop bug the recording found:** a mouse drag on the card image started the browser's native image drag and cancelled the pointer after one move. The card wrapper now prevents `dragstart`.
- **Not done here:** the camera's courier/stack hand-off and row height changes when a printing list loads. The owner should judge those on a phone first.
