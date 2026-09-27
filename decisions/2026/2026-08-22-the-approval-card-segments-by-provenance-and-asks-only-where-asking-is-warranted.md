---
date: "2026-08-22"
title: "The approval card segments by provenance, and asks only where asking is warranted"
decided_by: "owner (his own design), executed by Claude."
areas: ["catalog"]
supersedes: []
---
## 2026-08-22 — The approval card segments by provenance, and asks only where asking is warranted
**Decided by:** owner (his own design), executed by Claude.
**Decision:** the consent card has two sections — what he knows, and "what was the
variant on these?" — with no numeric confidence meter. Accept commits the known
section even if a printing is left unpicked.

**Why:** miscalibrated AI confidence measurably degrades decisions, and ~93% of
permission prompts are approved regardless of content. Provenance is a real fact
that cannot be miscalibrated.

**Implications, and the last one is a behaviour change:**
- Classification keys on **candidate count, not resolution status**. An omitted
  variant on a multi-printing card resolves *successfully* to the primary, so a
  status-keyed field would file the very row the owner wants asked about under
  "known". It is a NEW field; `pickVariant`'s semantics are unchanged and pinned
  by a test, because other flows depend on the silent default.
- The settled card **cannot** be expressed through the existing protocol: the SDK
  signs over the held input. So an unedited accept takes today's signed path
  unchanged, and an edited accept commits a corrected batch from the browser and
  *then* settles a denial carrying the real response as its reason.
  Commit-then-settle is correct by discipline, so the ordering is pinned by a test.
- The idempotency key is scoped to the held call. The pure-content key the design
  borrowed is honoured unbucketed and unbounded, so the second identical
  correction anyone ever made would have written nothing while reciting the old
  numbers as fresh.
- **A card with more than one printing and no stated variant is today silently
  resolved to the primary AND WRITTEN. After this it is asked about, and not
  written if the question is ignored.** The owner asked for exactly this. The
  first person to notice a card that "didn't get added" will otherwise file it as
  a bug.

