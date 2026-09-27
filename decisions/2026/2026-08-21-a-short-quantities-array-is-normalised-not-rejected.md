---
date: "2026-08-21"
title: "A short `quantities` array is normalised, not rejected"
decided_by: "Claude, from live probe evidence."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — A short `quantities` array is normalised, not rejected
**Decided by:** Claude, from live probe evidence.
**Decision:** In `sanitizeScreen`, a `cardGrid` whose `quantities` is shorter than
`cards` is padded with 1s. Longer than `cards` is still rejected, as is a
quantity below 1.

**Why:** it was the most common rejection in practice — models list quantities
only where they differ from one. And rejecting it was an inconsistency in the
schema rather than a safety property: omitting `quantities` ENTIRELY already means
every card is a single, so "the ones I did not mention are singles" is the same
rule, not a guess about intent. A longer array has no such reading, so it still
rejects.

This does not soften the reject-loudly doctrine anywhere else. Measured after the
change: six consecutive live runs, one screen each, no `showScreen` rejections.

