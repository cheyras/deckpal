---
date: "2026-08-22"
title: "A turn is an ordered list of parts"
decided_by: "Claude."
areas: ["general"]
supersedes: []
---
## 2026-08-22 — A turn is an ordered list of parts
**Decided by:** Claude.
**Decision:** `ChatMessage` becomes `{ id, role, parts }`; `text` and `tools` are
derived.

**Why:** three parallel arrays have no order between them, so a lookup that
happened halfway through a sentence rendered above the sentence it interrupted —
and updating a chip filtered-and-appended, moving every settled row to the end,
which is why the order visibly shifted between frames and why the one call that
FAILED read as the most recent thing rather than the broken one.

**Implications:** movement tools can emit rows from their real results, so a
journey leaves a record; and interleaving rows with prose in occurrence order
becomes expressible at all.

