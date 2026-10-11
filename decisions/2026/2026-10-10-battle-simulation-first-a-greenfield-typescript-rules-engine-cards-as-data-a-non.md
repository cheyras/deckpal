---
date: "2026-10-10"
title: "Battle simulation first: a greenfield TypeScript rules engine, cards as data, a non-cheating CPU"
decided_by: "@cheyras (direction: simulation first, not LLM-driven, rules-accurate); Claude Opus 5.5 (engine design), from a research plan the owner commissioned."
areas: ["decks", "agents"]
supersedes: []
---
## 2026-10-10 — Battle simulation first: a greenfield TypeScript rules engine, cards as data, a non-cheating CPU
**Decided by:** @cheyras (direction: simulation first, not LLM-driven, rules-accurate); Claude Opus 5.5 (engine design), from a research plan the owner commissioned.

**Decision:** The battle-intelligence work is re-ordered around simulation (`roadmap/plans/battle-sim/PLAN.md`; `BATTLE-INTEL-SPEC.md`'s Wave order is superseded). A new package, `packages/sim` (`@deckpal/sim`), is written new in TypeScript rather than forked: the engine is the only judge of legality and the pilot can only pick from the options it lists. The state is plain JSON data including half-finished effects (compiled clause programs with `pc` and variables in the state), every decision is "pick `min`..`max` of numbered options", randomness is seeded streams inside the state, and every change is an event in the battle_events vocabulary. Card behaviour is data over a reviewed clause vocabulary (`src/dsl.ts`), keyed by printed text so reprints resolve to one script; frames are snapshotted from the public catalog so tests stay pure. The CPU player searches its own turn under a hand-tuned evaluation and never reads hidden information (search runs on determinised copies). The first payoffs are two read-only assistant tools, `deck_odds` and `simulate_battles`, usable from Deck-E and the DeckPal MCP.

**Why:** The owner wants deck questions answered with real data — "stack a deck against a bunch of archetypes … simulate a whole bunch of battles … verify that a deck could be better than before" — by "an actual simulation, almost like two CPU players playing chess … working with the real rules of the game". The August spec put simulation last, behind a knowledge layer and a board UI. The fork-vs-new gate it set is answered by the research: no reusable engine has current Standard cards and is trustworthy (RyuuPlay, MIT: ~900 cards, nothing newer than early Sword & Shield; twinleafgg: current cards but no licence file, 11 card-test files, no seed, and effects held in memory outside the state; TCG ONE's open card scripts stop at gen 8; the 2026 competition engine is licensed for the competition only). The three properties the roadmap requires — survive a restart mid-game, repeat under a seed, a legal-action list — are missing from the RyuuPlay design as shipped, and every current card would be new work either way.

**Implications:**
- Accuracy is proven, not asserted: rule tests per rulebook row, a scenario test per card, random-play invariants (zones, prize monotonicity, damage multiples, limits, determinism, clone and JSON round-trips), a text round-trip, and a Live-log audit. Both owner decks (45 cards) are scripted and tested at this commit.
- Recorded rule calls: double Active Knock Out → the player whose turn is next takes Prizes and promotes first (Compendium, 2018); mutual mulligans cancel; Prizes are taken from the top of the shuffled pile; a both-win tie is recorded as a draw. Metallic Hammer's +150 applies with nothing to discard (Compendium #2352).
- Data quirks handled in scripts, not the catalog: TCGdex marks Mega-era Special Energy as "Normal" (`fix.specialEnergy`); Tera has no frame marker (`fix.tera`); ACE SPEC status is not in the frame (`fix.aceSpec`).
- Simulation results are never merged with real-game statistics and always carry n, intervals, a bot-quality caveat and the list of approximated/unplayable cards.
- Runs inside the existing 60 s `/api` function; any `maxDuration` increase is an infrastructure change for the owner (B9).
- Deferred, on the owner's say-so: match play against the AI, Deck-E as an opponent, difficulty/personality, a board UI. Rights in card text inside a paid product need a deliberate decision before match play ships.
