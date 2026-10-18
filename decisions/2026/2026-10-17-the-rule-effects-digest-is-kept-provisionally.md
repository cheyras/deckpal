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
- Two covered points rose in both configs: `jamming-tower` (held-out hns-36) and `fairy-zone-340`.
- `crustle-mechanism` rose in A; B was already at full marks.
- B's held-out P2 rose from 50 / 50 to 60.
- A's owner P2 rose from 56 / 50 to 72.

Against it:
- A's held-out P2 (40) did not rise above its baseline average (40).
- The Nighttime Mine point the change also covers (`mine-tera`) did not improve: A went 0.5 / 1 → 0.5, and B stayed at 1.
- B's overall score (72) fell below both baseline runs (78, 76), mostly on P3 and P4, which the change does not address.
- Points outside its scope fell in some configs: `codebreaking-seek`, and B's `dark-weakness`.

One run cannot separate a side effect of the longer digest from run-to-run variation. Most covered points moved the way a class fix should, one of them on a held-out game, so the change is kept while that question is settled, not declared a success.

**Implications:**
- The repeat run costs about $1. It needs the owner's go-ahead, because Phase 5's ~$5 approval is spent: $4.80 so far.
- A digest change is not counted as proven by one run again. Two runs after the change are the bar, matching the two baseline runs.

**Update 2026-10-18: the repeat run, and the owner's call.**
- **The repeat (A and B, all 9 cases, $1.08 including one resumed case) agreed with the first:**
  - A overall 66 / 67 against 61 / 59;
  - B held-out P2 60 / 60 against 50 / 50;
  - B overall 72 / 73 against 78 / 76.
- **The condition for keeping the section was not met:** B's overall score did not return to its baseline range. Under the rule above, that meant revert.
- **The owner overrode the revert to try a fix for B.**
- **What fell:** B's loss is in its held-out P4. `boss-targets` fell from partial to missed in both runs. In that case's digest (hns-36) the content was otherwise the same, with the same attacks, board and card lines. Other digests did shrink under the size cap; owner-99's dropped from 15 to 19 omitted card descriptions.
- **The fix:**
  - the section moves after the board, under a neutral header ("effects in play that changed the rules");
  - only effects with evidence are listed, the rest counted.

  Placed first, under "a surprising number usually comes from one of these", it likely pulled the writer's reasoning towards mechanisms.
- **Next:** this placement is measured with two B runs after deploy. If B's overall is still below its baseline range, the section is reverted.

**Outcome 2026-10-18 (#354 measured):**
- **B after the placement fix, two complete runs (9 of 9 cases judged):** overall 78 / 77, back inside the 78 / 76 baseline range. Held-out P2 70 / 70, above the 50 / 50 baseline.
- **The keep condition is met, and the section is kept.**
- **What it does not prove:** #354 changed placement, header wording and filtering together, so the runs show the recovery, not which change caused it.
- **Precaution for future digest sections:** a new section goes after the game's own facts, under a neutral header, and is measured on the writer config (B).
- **Spend:** $7.20 recorded across all eval runs.
