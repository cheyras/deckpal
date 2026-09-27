---
date: "2026-09-26"
title: "Keep virtualized Table rows visible and focusable across card sheets"
decided_by: "Chey (via Codex)"
areas: ["frontend","catalog"]
supersedes: []
---
## 2026-09-26 — Keep virtualized Table rows visible and focusable across card sheets
**Decided by:** Chey (via Codex)

**Decision:** Table view recomputes its document offset on resize, including when a
card sheet has pinned the body. It clears cached row heights only when the table's
width changes, then keeps the first visible row at its prior screen position. When a
keyboard-opened card sheet closes, Table view scrolls the opening row back into its
virtual window only if it is absent or offscreen; a visible opener regains focus
without moving the page. Set pages pass the full card ID
for that return path, although their sheet URL contains only the card number.

**Why:** Changing width across 768px changes the row layout. Cached dimensions and an
offset measured while body scroll is locked can make the list appear blank after the
sheet closes. The sheet's ordinary focus return points to a DOM node that virtualization
may already have removed.

**Implications:** The table owns focus restoration for its own rows; other card-sheet
callers retain the shared sheet behavior. The browser fixture checks keyboard close
and a resize across the breakpoint deep in a 3,200-row list at phone and desktop sizes.
The separate question of whether quantity counters should be hidden below 768px
remains for Chey.

