---
date: "2026-10-14"
title: "Game reviews are measured per principle, on the owner's games and held-out ones"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-10-14 — Game reviews are measured per principle, on the owner's games and held-out ones
**Decided by:** Chey (via Claude)

**Decision:** Phase 5 of the plan approved on 2026-10-13: an eval of game reviews, `scripts/analysis-eval.mjs` over `evals/analysis/`.

**1. The rubric is organised by principle, not by card.**
- **The six principles** (`evals/analysis/principles.json`):
  - facts come from a source;
  - every surprise has a mechanism;
  - consequences cross the whole board;
  - the opponent is a decision-maker;
  - all the evidence, with the numbers reconciled;
  - judgments are calibrated.
- **Tagging:** every rubric point names one principle. The report scores each principle for each config.
- **The owner's catches are instances.** Nighttime Mine taxing a Tera Dragapult ex is one P1 point, and a Cursed Blast self-Knock Out giving up the last Prize is one P3 point.
- **The aim:** a fix is judged by whether its principle's score moves, not by whether one sentence now appears.

**2. Two kinds of case.**
- **Owner cases:** six of the owner's Phantom Puppeteer games (logs #94, #95, #99, #100, #101, #103).
  - They were read through the connector (read-only), with the player anonymised to PlayerA and the opponent to PlayerB.
  - Each keeps the player's notes where they wrote some.
- **Held-out cases:** three games from the sim's anonymised fixtures (tbs-62, hns-10, hns-36) that nobody annotated.
  - They use the owner's current Toolbox Slowking and Hide 'n' Sneak lists, copied read-only.
  - They are there to show whether a change generalised or only learnt the owner's instances.
  - Playbook and tool work must not be tuned on them. New held-out games are added over time.
- **Rubric checks:** every rubric fact was checked against the simulator's card text.
- **Log checks:** every case's result, Prizes, turns, ending and first player are checked against its log by the sim's parser, in CI (`scripts/__tests__/analysis-eval.test.mjs`). A case cannot drift from its game.

**3. Three configs, one judge.**
- **The configs:**
  - A: Haiku 5.5 end to end.
  - B: Haiku 5.5 gathers with the tools, then one Sonnet 5.5 call writes the review from the evidence.
  - C: Sonnet 5.5 at low effort end to end.
- **What every config sees:** the MCP server's own instructions and full tool list, fetched live, so it measures what claude.ai sees.
- **The judge:** Sonnet 5.5 at medium effort.
  - It marks each rubric point caught, partial or missed, quoting the review.
  - It lists false claims, including the case's known ones.
- **B is there for Phase 7:** a cheap gatherer with a strong writer is a shape Deck-E could take.

**4. It runs on the QA account and cannot spend past its cap.**
- **The token:** `QA_MCP_TOKEN` in `.qa-account`, minted by `scripts/qa-token.mjs`. The maintainer runs that script; an agent never signs in with the password.
- **Owner refusal:** the token's account is read from `/api/me`, and an owner account is refused.
- **The tool guard:** the agent's calls reach QA only for read tools, plus `edit_battle_log` on the case's own log. Any other write is answered "not run in this evaluation" without leaving the process.
- **No leaks between runs:** each case's log is reset (review cleared, notes restored) before every run.
- **Spend:**
  - `--budget` is required.
  - It is checked before every model call against the Gateway's own reported cost.
  - Output is capped at Deck-E's 16k.
  - `report` re-reads a finished run for free.

**Why:** The owner's Haiku review runs (2026-10-13) missed specific things: the Mine on a Tera Pokémon, Fairy Zone's Weakness, a self-Knock Out's Prize, a concession's reason, a miscounted Prize score. The owner asked for those not to become "a butt-ton of specific rules": they are instances of a few principles, and the fixes should be principles too.

Phases 1–4 changed tools and playbooks with no measure of whether reviews got better. A per-principle score, with held-out games beside the owner's, is that measure. It is also the yardstick for Phase 6's knowledge base and Phase 7's Deck-E integration.

**Implications:**
- **Before a change ships:** a playbook or tool change aimed at review quality runs this eval before and after. It reports per principle, with the held-out split beside the owner split.
- **New cases:** a new owner catch becomes a rubric point under an existing principle. A new principle needs a decision.
- **Spend is the owner's:** every live run spends Gateway credit, so runs are capped and their cost is reported in the run's `report.md`.
- **The first results** (baseline, per config) are recorded in a follow-up decision once the QA token exists.
