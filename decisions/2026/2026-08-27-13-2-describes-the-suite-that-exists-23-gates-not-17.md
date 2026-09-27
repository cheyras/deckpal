---
date: "2026-08-27"
title: "§13.2 describes the suite that exists: 23 gates, not 17"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["frontend"]
supersedes: []
---
## 2026-08-27 — §13.2 describes the suite that exists: 23 gates, not 17

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** `DECKE-AGENT-SPEC.md` §13.2 gains rows 18–23, and states which
rows are known-flaky.

**Why it was wrong.** The gate suite was created on 2026-08-22 (PR #74) with 17
gates, one per §13.2 row. The experience pass on 2026-08-23 (PR #78) added six
more — 18 through 23 — from three screen recordings, and **added nothing to
§13.2**. That PR wrote 592 lines to this file across ~20 entries and not one of
them is about the gate suite.

So for four days the suite ran 23 gates while the spec described 17, and each of
the six extra gates carried its entire justification in a source comment. A
reader trusting the spec would reasonably have concluded that 18–23 were
somebody's private additions rather than part of the contract.

That is not a filing error. **A gate with no row here is a gate nobody has
agreed to** — and gate 21 is the demonstration: it failed about half the time
for four days, and because it was outside the table there was no agreed statement
of what it was for to check the failures against. Both wrong diagnoses of that
flake started by re-deriving its purpose from its own code.

**Also recorded: gates 3 and 23 are flaky on production today**, measured with
and without harness changes and indistinguishable across the two. Stated in the
table so a red is read correctly rather than chased.

**Implications.**
- A new gate gets a §13.2 row in the same commit. The source comment is the
  reasoning; the row is the agreement.
- Known-flaky gates say so where the gates are described, not only where they
  are implemented.

---

