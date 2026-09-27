---
date: "2026-08-22"
title: "Rip-watching presence is removed, not disabled"
decided_by: "owner — *\"the rip-watching feature completely doesn't work, and"
areas: ["general"]
supersedes: []
---
## 2026-08-22 — Rip-watching presence is removed, not disabled
**Decided by:** owner — *"the rip-watching feature completely doesn't work, and
very clearly needs an overhaul, so I'm ok with gutting the implementation as is."*
**Decision:** `attendRip` and `reactToPull` are deleted with their call sites.
`isRarityHit` and the rip landmark survive.

**Why:** every export was a no-op when he is not loaded — correct, because the
scanner must not depend on him — which also made it invisible when he stopped
being loaded. Deleting the idle timer silently killed the feature, and the
connection appeared in **no** document until an adversarial review found it.

**Implications:** deleted rather than disabled, because a function that is present
and does nothing is exactly how this hid. An overhaul wants its own design
alongside the journey sequencer, and it must answer the question this version
never did: how does he come to be loaded at all?

