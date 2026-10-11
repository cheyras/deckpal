---
date: "2026-10-10"
title: "Battle simulator: paired comparison mode (compare_with)"
decided_by: "@cheyras (goal: really quickly verify that a deck could be better than before); built by Claude Opus 5.5."
areas: ["agents", "decks"]
supersedes: []
---
## 2026-10-10 — Battle simulator: paired comparison mode (compare_with)
**Decided by:** @cheyras (goal: really quickly verify that a deck could be better than before); built by Claude Opus 5.5.

**Decision:** `simulate_battles` / `POST /decks/simulate` take an optional second version of the deck — `compare_with` (a saved deck id or name), or `compare_cards` / `compare_ptcgl_text` (an unsaved whole list, labelled by `compare_name`). The subject is A, the second list B. Each opponent is played by both versions on the SAME seeds and seats (common random numbers: the same pair seed, who goes first, the opponent's shuffle stream and the opponent pilot's seed), in lockstep (`runPaired` in `packages/sim/src/compare.ts`), so a budget that runs out leaves both versions with the same seeds. The number reported is Δ = mean(score B − score A) per paired game, score = win 1, draw/time-out ½, loss 0 (a game either version lost to an engine error drops out of the pairing), with a 95% t-interval whose standard error is cluster-robust over seeds (each seed's two seat-swapped games are one cluster; df = seeds − 1); over several opponents the clusters are pooled, each game weighing the same. The text leads with a `VERDICT:` line that says "B is better" / "A is better" only when that interval excludes 0 with at least 6 seeds (`MIN_VERDICT_PAIRS`), else "no clear difference at this n"; then the overall and per-opponent Δ, the card counts that differ, each changed card's early-play split in each version, coverage for A, B and the opponents, and the standing caveat, within 5,000 characters.

**Why:** "Is v5 better than v4?" is the question the owner actually asks, and two separate runs answer it badly: their Wilson intervals overlap for any realistic edit, and most of the variance they carry (the opponent's draws, the coin, the bot's tie-breaks) is shared by both versions and cancels when the games are paired. In the first real run (Hide 'n' Sneak vs the same list −1 Gwynn +1 Ultra Ball, vs Toolbox Slowking, 24 strong-pilot games each) only 4 of 24 paired games came out differently; the paired interval was [−13, +9] points where each version's own Wilson interval spanned about 36 points. A t-interval rather than a bootstrap because the clusters are few (often under 15) and the per-seed differences are bounded; the minimum of 6 seeds stops a lopsided handful of games from producing a zero-width interval that "excludes 0".

**Implications:**
- The 25 s budget is shared by both versions, so each gets about half the games of a plain run; with the strong pilot and 6 default opponents that is roughly one seed per opponent and therefore never a verdict. The tool description tells the model to name 1–3 opponents and consider `speed: 'fast'` for comparisons.
- Neither version is a default opponent; `compare_with` naming the subject itself is a 400.
- Known looseness: with the same pair seed the subject is dealt the same shuffle against every opponent, which correlates clusters across opponents a little, so the OVERALL interval may be slightly narrow; per-opponent intervals are unaffected.
- The structured report (`kind: "deckpal.simulation.comparison"`) carries both versions' full single-run reports (`reportA`, `reportB`) beside the paired numbers.
