---
date: "2026-10-17"
title: "Analysis eval baseline: Haiku gathers and Sonnet writes; the gaps are in the digest"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-10-17 — Analysis eval baseline: Haiku gathers and Sonnet writes; the gaps are in the digest
**Decided by:** Chey (via Claude)

**Decision:** The first results of the analysis eval (Phase 5) are recorded in `evals/analysis/RESULTS.md`. They set the direction for the next change. Two full runs (9 cases × 3 configs, QA account, $3.85 in all) agree within 5 points on every summary row.

**1. For game reviews, a Haiku 5.5 gatherer feeding one Sonnet 5.5 writer is the shape to use.**

| Config | Overall | Held-out games | Cost per review |
|---|---|---|---|
| B: Haiku gathers, Sonnet writes | 77% | 65% | about 5¢ |
| C: Sonnet low effort, end to end | 68% | 59% | 4.4¢ |
| A: Haiku end to end | 60% | 52% | 0.6¢ |

- B leads on every principle.
- The largest gap is P4, the opponent as a decision-maker: B scores 69%, Haiku alone 41%.
- Sonnet alone looks cards up least (4 `get_card` calls over 9 reviews, against B's 31), and it alone misses the P1 point.

**2. The next fix is in the tool, and it is a class of event.**
- P2 (mechanisms) is the weakest principle in every config, at 49–63%.
- The digest states Weakness and damage figures without the effect that caused them. It reports Fairy Zone's Weakness as a plain Weakness, never says Nighttime Mine raised a cost, and never mentions Jamming Tower.
- `battle_digest` should list every effect in play that changes Weakness or Resistance, attack costs, Tools or damage, with the Pokémon each touched. One rule, not one rule per card.
- It ships when this eval shows P2 rising on the held-out split as well as the owner split.

**3. The judge sees card text.**
- Without it, the judge listed correct card facts (HPs, attack text) as false claims.
- `run --rejudge` judges a finished run again and keeps the earlier verdicts as `.judge.vN.json`.
- The false-claim counts are still approximate: about one in four listed claims is not a real error.

**Why:** The owner asked for a system, not rules for single cards. The eval scores reviews by principle, and the two runs say the same thing: the model choice matters (B), and the remaining misses are shared by every model. Shared misses are the tool's to fix.

**Implications:**
- The digest change above is the next step, measured by re-running this eval.
- Phase 7 (Deck-E) should route game reviews to a gatherer plus a writer rather than to Sonnet alone.
- Spend per full eval run is about $1.60. Results live in `evals/analysis/runs/` (gitignored) and are summarised in `RESULTS.md`.
