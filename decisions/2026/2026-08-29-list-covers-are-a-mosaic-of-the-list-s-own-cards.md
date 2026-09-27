---
date: "2026-08-29"
title: "List covers are a mosaic of the list's own cards"
decided_by: "maintainer (2026-08-29 walkthrough recording; deferred item now built)"
areas: ["catalog"]
supersedes: []
---
## 2026-08-29 — List covers are a mosaic of the list's own cards

**Decided by:** maintainer (2026-08-29 walkthrough recording; deferred item now built)

**Decision:** The lists index tile's cover renders a grid of the list's cards
instead of one cropped art. The server sends up to 8 distinct cards per list
(`coverImages`, explicit cover pick first, then list order); the client picks
only layouts it can FILL — 4×2, 3×2, 2×2, 3×1, 2×1 — falling back to the old
single-art cover for one card and the icon for none, and summarising the
overflow with a `+N` chip.

**Why:** The owner's spec verbatim: "like a grid of the cards in the list …
determine how many across smartly … a maximum that will show." Eight is the
measured cap: at the tile's 132px cover height, two rows of four is the floor
where a card is still recognisable; more is confetti. Fill-only layouts
because a half-empty second row reads as a loading failure.

**Implications:** The mosaic is distinct BY CARD, not by item — a static list
with four copies of one card shows the card once (dupes are a quantity, not
four tiles). `coverImage` stays in the payload as the first-tile shorthand;
nothing that wants one image has to learn the array. Decks keep their single
cover — out of this item's scope. Verified in the browser at 1440 and 390 as
the QA account (2/3/10-card lists; scratch lists purged after).

