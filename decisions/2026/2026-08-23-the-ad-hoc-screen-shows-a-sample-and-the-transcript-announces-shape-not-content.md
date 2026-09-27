---
date: "2026-08-23"
title: "The ad-hoc screen shows a sample, and the transcript announces shape not content"
decided_by: "Claude, resolving C40 (first bullet) and D13's live region."
areas: ["frontend"]
supersedes: []
---
## 2026-08-23 — The ad-hoc screen shows a sample, and the transcript announces shape not content
**Decided by:** Claude, resolving C40 (first bullet) and D13's live region.
**Decision:** `screenCompact.ts` cuts a large screen to 4 blocks / 6 cards with
an accessible expand control and a truthful `Showing N of M`. `DeckeChat` gains
one always-mounted `sr-only` live region that fires **once per turn boundary**
with the reply's SHAPE ("Deck-E replied, with 2 panels"), never its content.

**Why.** C40: *"he could present that ad hoc screen first as a little widget
inline chat with some actual visuals."* `MAX_BLOCKS = 12` caps authoring, not
display, so a full-budget panel is an order of magnitude larger than what a
phone shows.

**Implications:**
- **Cut at block and card boundaries, not a max-height fade**, despite the brief
  naming the fade. A clip feathers through the middle of a card or a table row;
  cutting at boundaries means everything drawn is drawn whole and the number
  says what is missing.
- **`N of M` excludes cards no amount of pressing expand can reveal** — the
  renderer refuses a group inside a group, so counting those would be a promise
  the panel cannot keep.
- The grid slices ids BEFORE `useCardArt`, so a compact panel does not fetch
  thumbnails it will not draw.
- **`aria-live` on the message list is the obvious repair and is worse than the
  defect** — the list is rewritten per token, so a long answer would arrive as
  hundreds of overlapping fragments. Hence the turn boundary. It says nothing
  about tool failures or thinking, because `ToolRow` and `ThinkingRow` own live
  regions already and announcing twice rebuilds the double-announcement bug this
  branch fixed.
- Openers rotate on **times-shown, not times-declined**: deciding when a chip
  counts as declined is a guess about intent, and times-shown is a fact.

