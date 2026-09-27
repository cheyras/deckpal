---
date: "2026-08-21"
title: "The landmark cap: 40, prioritised, and why order matters more than the number"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — The landmark cap: 40, prioritised, and why order matters more than the number
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Decision.** `collectLandmarks()` and `api/chat.mjs` cap at 40 rather than 24,
and SORT before slicing: on-screen first, then `data-decke-rank="container"`
before `"item"`, then DOM order as the stable tiebreak.

**Why there is a cap at all.** The landmark list is PROMPT TEXT, re-billed on
every leg of a turn, at roughly 15 tokens each. Forty is ~600 tokens a turn,
which is affordable; unbounded is not, and a page with a long list would quietly
become the most expensive page in the app.

**Why the ORDER is the real decision.** The previous behaviour sliced 24 in DOM
order, so a `SeriesDetail` with 15+ set rows plus a header could push the row
the reader just asked about out of the list entirely — and the failure is
silent. He does not say "I cannot see it"; he says something else about
something else. `data-decke-rank` is DECLARED on the element rather than
inferred from nesting, because inferring it means a layout change silently
reorders what he can see.

**Implications.** Zero-size nodes fall out of the on-screen test for free, which
also removes a class of landmark that resolves but cannot be flown to.

