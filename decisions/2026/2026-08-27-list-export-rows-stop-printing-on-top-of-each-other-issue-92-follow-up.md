---
date: "2026-08-27"
title: "List-export rows stop printing on top of each other (issue #92 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-27 — List-export rows stop printing on top of each other (issue #92 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** The list export and the set checklist derive their row geometry
from pdfkit's own font metrics (`listRowMetrics()`) instead of two hardcoded
numbers.

**What was actually wrong — measured, not assumed.** `rowHeight` was 15 and the
sub-label was drawn at `cell.y + 9.5`. Against the real metrics:

```
Helvetica 9pt currentLineHeight = 8.325   (card name)
Helvetica 7pt currentLineHeight = 6.475   (set id / rarity)
```

The sub-label **cleared the name** — 9.5 > 8.325, the placement was never the
bug — but it ran to `9.5 + 6.475 = 15.975` inside a **15pt** row, overflowing by
about a point into the top of the next row's name. Every list export and set
checklist printed that on every row carrying a set id or a rarity.

Worth stating plainly because the first description of this defect (and my own
first reading of it) claimed the sub-label also collided with the name above it.
It did not. One point of overlap is easy to wave away on a screen, but it is a
descender's worth of ink on the line below on a page someone prints and ticks
off by hand, and the fix is the same either way.

**Why derived rather than corrected.** `rowHeight: 15` is right for a row that
is one line of 9pt text, which is what it was when it was written; nothing
recomputed it when a second line was added underneath. Two constants that must
agree, in different functions, with a font size in between, is the arrangement
that produced this. `listRowMetrics()` asks the document, and the regression
test asserts the stack against those same metrics rather than against numbers
copied out of the source — so a font or size change has to keep it honest.

**Cost:** ~2pt per row, 15 → 17, about one extra page per fourteen. Paid
deliberately.
---

