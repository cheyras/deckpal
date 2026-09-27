---
date: "2026-08-20"
title: "Revealing the uncollected series is one-way"
decided_by: "user (issue #51), implemented by Claude Opus 5."
areas: ["general"]
supersedes: []
---
## 2026-08-20 — Revealing the uncollected series is one-way
**Decided by:** user (issue #51), implemented by Claude Opus 5.

**Decision:** On /series, the "Show N series with no cards collected" control and
the rule above it are removed once used, instead of becoming a "Hide" toggle.

**Why:** Once you have asked for the rest of the catalog, the control and its
divider have said everything they had to say; leaving a "Hide" in their place
parks a row of chrome between the two groups for the rest of the session. The
top-level collected/not-collected split is unchanged — the 24px group gap
carries it, not the divider.

**Implications:** No way to re-hide within a session; a reload restores the
collapsed state. Verified: card count 5 → 20 on click, with zero reveal buttons
and zero `.border-t` dividers remaining.

