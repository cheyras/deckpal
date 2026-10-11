---
date: "2026-10-11"
title: "Simulator CPU: measured against real games and made stronger"
decided_by: "@cheyras (asked for a stronger, measured CPU as a step toward a fully usable simulator); built by Claude Sonnet 5.5, verified by Claude Opus 5.5."
areas: ["sim", "cpu"]
supersedes: []
---
## 2026-10-11 — Simulator CPU: measured against real games and made stronger
**Decided by:** @cheyras (asked for a stronger, measured CPU as a step toward a fully usable simulator); built by Claude Sonnet 5.5, verified by Claude Opus 5.5.

**Decision:** The simulator's CPU players are now measured two ways, and the
'strong' (search) pilot is changed only by what those measurements support.

- **Agreement with real players** (`packages/sim/scripts/pilot-agreement.ts`):
  replays the ten anonymised PTCG Live logs through the engine and, at every
  decision the logged player answered (main-phase action or a choice inside
  one), asks each pilot (policy, greedy, search) what it would do from the same
  position, on the player's own view. Reported per decision kind, with the most
  common disagreements and examples. The replay gained an optional
  `observe` hook (`src/replay/replay.ts`) and nothing else.
- **Strength** (`scripts/pilot-h2h.ts`): a candidate pilot against a baseline,
  paired: for every pair of decks (nine: the owner's two and the seven meta
  lists, mirrors included) and every seed, four games with the same game seed
  and pilot seeds, each deck piloted by both pilots in both seats. Reports the
  candidate's score, a Wilson interval on games and a t-interval over the
  (pair, seed) clusters, and how each side's losses ended. `search:legacy`
  (and `greedy:legacy`, `policy:legacy`) reproduce the pilots as they were
  (checked game for game on the mini-gauntlet).
  `scripts/pilot-patterns.ts` prints the loss patterns (decking out, no attack
  by turn three, ...).
- **Kept** (search pilot; n = 4320 games per row, fresh seeds each):
  - The search reuses what the earlier searches of the same turn found out
    (`reuse`, `Memo` in `search.ts`): a position an earlier search already played
    out is not searched again, and the budget goes on what was left. Positions
    are keyed by what the player can see (`publicKey`, a numeric hash), never by
    the opponent's hand or either deck's order. With it the search runs 125
    nodes (was 100) at the old speed. Alone: 52.3% [50.8, 53.8] against the same
    pilot without it at 100 nodes.
  - A Pokémon with a drawing or searching Ability is worth more when the policy
    chooses what to fetch, keep or bench (+14 on its card value). Measured
    alone: 52.1% [50.3, 53.9] (n = 2880).
  - Three evaluation changes, each small and principled: a Knock Out on a lone
    Active ends the game, whatever the Prizes say (`wipeout`; 52.0% alone, and
    "lost with no Pokémon in play" fell from 85 to 62 games); a Knock Out that
    needs an Energy my hand does not have counts half (`koNoEnergy`, 51.4%);
    deck-out risk starts at 12 cards, not 4 (`deckSafe`, 51.3%; deck-out losses
    fell from 276 to 76 games, and some of that came back as lost races).
  - Replaying a "win found past the node budget" line could throw ("option 1 out
    of range", "choose 2..2 options, got 1"): the line was found with the policy
    answering its last sub-decisions and replayed with branching. It now stops
    instead. This was in the shipped pilot.
- **Result:** `search` against `search:legacy`: 53.4% [51.9, 54.8], n = 4320
  (2268-1978-74) with collision-free seeds and the review fixes (exact information
  keys, memo entries marked played out only when they were; 54.9% [53.4, 56.4] before
  them); 54.0% [52.6, 55.5] at the previous setting (115 nodes) on
  other seeds. `greedy`: 52.4% [50.9, 53.9]. `policy` does not use the
  evaluation: 50.0%. Agreement with the logs is unchanged within a couple of
  decisions of 683 (search 270 -> 272 hits overall, 108 -> 107 of the 394
  decisions with a fully known hand).
- **Tried and dropped** (each against the then-current pilot, n >= 1440):
  evaluation weights x0.5 / x2 one at a time (a plateau: nothing outside the
  noise except Bench threat x2, 40.0%); a lookahead over single-card choices
  (49.1%); following one plan for the rest of the turn (48.5-52.2% at 100-450
  nodes); expansion-order bonuses for unspent Supporter / Energy and for
  remaining moves (1.5% at first, 50.3% at n = 2880); skipping the end-turn
  child (49.5%); Energy-type value when fetching (50.1%); penalising the loss
  of Energy / evolutions on a Knock Out (46.9-49.3%); Energy toward an evolution
  in hand (49.9%); a bonus for drawing Abilities first (49.3%); cheaper or
  dearer Bench attackers by Retreat Cost (49.8-50.5%); an engine bonus in the
  evaluation (48.3-49.6%); one world sampled once per turn (50.0%); a larger
  first search per turn (48.8-49.0%). More nodes do buy strength: 300 against
  100 is 54.4% [52.9, 55.9] but costs 2.7x; 3 worlds is 51.0% [49.5, 52.5].

**Why:** The pilots had never been measured against anything but each other on
the owner's account decks, and the weights had been tuned by self-play of the
greedy pilot. The logs show where a person plays differently (an engine
Pokémon first, fewer marginal plays before attacking) and the head-to-head says
which of those differences are mistakes. Most are not: the pilot sits on a
plateau, and what is left to gain is search effort, so the change that matters
is spending the same time on more of the tree.

**Implications:**
- Agreement is a proxy, read with care: humans make mistakes, the replay shows
  a hand only as far as the log does (cards never shown are fillers until played),
  and a different order of the same plays counts as a disagreement. Strength is
  the arbiter.
- 55% was the aim; the point estimate is 53.4% and the interval [51.9, 54.8]
  excludes 50% but not 52%. It moved down from 54.9% with the review fixes (on other seeds,
  so the gap is not cleanly theirs): the earlier
  memo skipped work it had not finished. More nodes would get further, but not within the
  speed limit.
- A game takes about 15% longer after the review fixes (28 fixed games, `mini-gauntlet hns 2 meta`:
  10.4-10.8 s before, 11.8-12.4 s after, as the memo now skips less); originally 25 fixed games: 9.4-10.4 s against
  9.5-10.7 s for the legacy pilot). `src/__tests__/determinism.test.ts`'s pins
  were regenerated because the pilot's games changed.
- Switches live in `src/pilot/tuning.ts` (`engine`, `reuse`), weights in
  `DEFAULT_WEIGHTS`; `LEGACY_WEIGHTS` keeps the old values for the baseline.
