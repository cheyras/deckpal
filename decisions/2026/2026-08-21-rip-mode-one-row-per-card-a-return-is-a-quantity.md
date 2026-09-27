---
date: "2026-08-21"
title: "Rip mode: one row per card, a return is a quantity"
decided_by: "Claude. Found while wiring Deck-E into the scan flow."
areas: ["catalog"]
supersedes: []
---
## 2026-08-21 — Rip mode: one row per card, a return is a quantity
**Decided by:** Claude. Found while wiring Deck-E into the scan flow.
**Decision:** A card that leaves the frame and comes back increments the quantity
on its existing row. It no longer appends a second row.

**Why:** The previous behaviour appended a second `RipEntry` with the same
`cardId`, and every consumer addresses a row BY `cardId` — React keys off it,
`setQuantity` and `removeEntry` match on it. So two rows sharing one id meant a
duplicate React key, editing either row edited both, and deleting the duplicate
took the original with it. The intent behind the old test ("departure then return
is a second event") was right; the representation was not.

The module's header claimed quantity was "a user action, never inferred", which
the same file's own tests contradicted. Corrected to what is actually true: a
return proposes a count, the reader adjusts it in an editable field, and what is
never inferred is a quantity from a card merely re-stabilising while still held —
which is the failure the departure rule exists to prevent.

**Implications:** covered by four tests, including an explicit invariant that no
two rows may share a `cardId`. Two pre-existing tests were updated to the new
representation rather than deleted, since their semantics still hold.

