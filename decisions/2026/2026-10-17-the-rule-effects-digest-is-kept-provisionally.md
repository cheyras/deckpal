---
date: "2026-10-17"
title: "The rule-effects digest is kept provisionally"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-10-17 — The rule-effects digest is kept provisionally
**Decided by:** Chey (via Claude)

**Decision:** The rule-effects section of `battle_digest` (#351) stays live for now. It is re-measured with a second run of configs A and B before Phase 7 builds Deck-E's review path on the digest. If the repeat does not show held-out P2 above its baseline in at least one config, with the overall score back inside the baseline range, it is reverted. Revert means taking the `ruleEffects` render out of `battleReplay.ts`; the sim's data can stay.

**Why:** The #351 decision promised a revert unless P2 rose on the held-out games as well as the owner's. One post-deploy run (`evals/analysis/RESULTS.md`) meets that rule only in part.

For keeping it:
- Every rubric point the change is meant to cover moved up in both configs, including a held-out one, Jamming Tower on hns-36.
- B's held-out P2 rose from 50 / 50 to 60.
- A's owner P2 rose from 56 / 50 to 72.

Against it:
- A's held-out P2 (40) did not rise above its baseline average (40).
- B's overall score (72) fell below both baseline runs (78, 76), mostly on P3 and P4, which the change does not address.
- Points outside its scope fell in some configs: `codebreaking-seek`, and B's `dark-weakness`.

One run cannot separate a side effect of the longer digest from run-to-run variation. The covered points moved the way a class fix should, so the change is kept while that question is settled, not declared a success.

**Implications:**
- The repeat run costs about $1. It needs the owner's go-ahead, because Phase 5's ~$5 approval is spent: $4.80 so far.
- A digest change is not counted as proven by one run again. Two runs after the change are the bar, matching the two baseline runs.
