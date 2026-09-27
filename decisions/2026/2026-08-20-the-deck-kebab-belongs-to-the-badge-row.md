---
date: "2026-08-20"
title: "The deck kebab belongs to the badge row"
decided_by: "user (issue #48), implemented by Claude Opus 5."
areas: ["decks"]
supersedes: []
---
## 2026-08-20 — The deck kebab belongs to the badge row
**Decided by:** user (issue #48), implemented by Claude Opus 5.

**Decision:** On the deck header, the options kebab is a sibling of the
format/legality badges inside one `items-center` row, rather than floating
beside the whole header block under `items-start`.

**Why:** `items-start` aligned the 40px kebab's TOP edge to the badges' top, and
they are ~26px tall, so its centre sat ~7px below theirs — visibly off, with
nothing to read the offset as deliberate. Putting it in the row it visually
belongs to makes `items-center` do the alignment, so there is no measurement to
maintain and no way for it to drift again.

**Implications:** The deck name below is no longer boxed out by the kebab and
takes the full column width, which is a straight gain on a phone where long
names were wrapping early. Measured: kebab centre and badge centre both at
y=151 (delta 0) at 390px, 428px and 1280px.

