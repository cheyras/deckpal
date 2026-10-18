---
date: "2026-10-17"
title: "Battle simulator: the core rules checked against PTCG Live's engine and the general Compendium rulings"
decided_by: "@cheyras (asked for the simulator's rules engine to be made complete against the real rules in PTCG Live); Claude Opus 5.5 (audit and engine changes), with four Claude ruling lanes (tests)."
areas: ["decks"]
supersedes: []
---
## 2026-10-17 — Battle simulator: the core rules checked against PTCG Live's engine and the general Compendium rulings
**Decided by:** @cheyras (asked for the simulator's rules engine to be made complete against the real rules in PTCG Live); Claude Opus 5.5 (audit and engine changes), with four Claude ruling lanes (tests).

**Decision:** PTCG Live is used as a checklist, not a source. Its match engine (`MatchLogic.dll`, read with REA for type, enum and method names only) lists the mechanics the real game models: effect durations, Checkup phases, limit checks, Prize selection, the ways a game ends. Each one was checked against `packages/sim`. What the engine should do is still settled by the order in `roadmap/plans/battle-sim/PLAN.md`: rulebook, then card text, then the Rulings Compendium, with Live as evidence only where those are silent. Nothing from PTCG Live (code, data or text) is in the repo, and ruling text stays on the Compendium.

The engine now follows these rules:
- **Timed effects wait for their turn.** "During your next turn" and "during your opponent's next turn" cover that turn only, not the rest of the turn the effect was made in (`TimedEffect.start`, `durationTurns` in `interp.ts`). The turn is counted for the player whose card made the effect, so an effect made during the opponent's turn lands on the right one. "Until the end of your next turn" is a new duration, `throughMyNextTurn`; Overwriting Bolt is its one card. Live makes the same split: immediate, on my next turn, on the opponent's next turn.
- **The attack-damage steps are for attacks only.** Weakness and Resistance, the attacker's "N more damage", "takes N less damage from attacks", prevention of damage "by attacks" and the Tera Bench rule no longer touch damage done by an Ability or a Trainer. No current Standard script does damage outside an attack (all 244 `damage` steps are in attacks), so this changes no game today.
- **Prize cards are taken one at a time (#809).** While one of a player's Prize cards is face up (Crescent Purge, Bother-Bot), that player chooses each time between it and a face-down one. Face-down Prize cards can't be told apart, so with none face up nothing is asked and the pile's order stands, as before (`takePrizes` in `flow.ts`, `GameState.prizeTaking`).
- **A Retreat Cost may be paid with up to that many Energy cards (#2127, TPCi 2025-03-27).** With a cost of 2, one {C}{C} card or two both pay. Previously only sets with no card to spare were offered. A Retreat Cost of 0 now asks for no Energy at all.
- **The player whose turn is next flips first in Checkup (#867)**, the same order as Prizes and promotion.
- **A Stadium's "once during each player's turn" belongs to the card (#926).** After using the Stadium in play, a player who replaces it may use the new one.
- **A card put into the hand from the discard pile, the Lost Zone or play is known to the opponent (#787)**, so the CPU's model of that hand keeps it.

98 general rulings are newly pinned (433 to 531 of the Compendium's 1,944), in `rulings-general-{conditions,kos,attacks,trainers}.test.ts`: Special Conditions, Retreating, Weakness and Resistance, Knock Outs and Prizes, Win States, Mega Evolution, attacks, Abilities, meta-rulings, Trainers and Energy in general. 23 more in those categories were judged not to apply to Standard (GX, Prism Star, stacked Technical Machines, tournament procedure). New rule tests, `rules-timing`, `rules-attack-damage` and `rules-checklist`, pin the timing and damage changes plus two right but unpinned behaviours: Mega Evolution doesn't end the turn, and a replaced Stadium goes to its owner's discard pile. `rules_lookup` gains an "Effects that last a turn" entry.

**Why:** The owner wanted the rules engine complete against the real game. Two read-only audits found the everyday rules faithful and tested. The gaps were in timing (effect windows, flip order), in damage that isn't an attack's, and in the general rulings: none of them was pinned, so nothing showed whether the engine followed them. The engine disagreed with nine: five are fixed here and four wait (below).

**Implications:**
- `determinism.test.ts` is re-pinned: 14 of its 40 seeded games now play differently. The timing, damage and Prize changes moved none, the Checkup flip order one, and the retreat payments, Stadium use and #787 the rest. Replaying 26 more of the owner's PTCG Live games gives the same results before and after (8 complete; 18 stop where the log shows a move the engine does not offer, a separate investigation).
- `rules-gaps.test.ts`'s retreat test now asserts the #2127 reading. `review-318.test.ts` answers the new Prize question.
- Settled with the owner the same day, following the rulebook, the Compendium and PTCG Live:
  - **Sudden Death.** A tie (both players win in the same number of ways) starts a new game with 1 Prize card each and a new coin flip (`resetForSuddenDeath`); after 3 tied sudden-death games it is recorded as a draw. PTCG Live has the same mode (`MatchMode.SuddenDeath`, a reset-game step) and no draw among its ways for a game to end. Ties were previously recorded as draws.
  - **A deck search for a kind of card may find none (#903).** `chooseCards` from the player's own deck with a `filter` has `min` 0. A search for any card, and a pick from the discard pile, keep the card's "up to" minimum of 1 (#2301). CARDS.md and ten card tests are updated.
  - **Lists passed straight to `simulate_battles`** get a note when they break the deck rules (more than 4 of a card, more than one ACE SPEC, no Basic Pokémon), and are still simulated as listed (`deckNotes` in `apps/api/src/deck/simulate.ts`).
- Still open: #668 (a Special Energy that provides its type only while attached), which needs a card-language term but meets no Standard card yet; the "switch out" half of #1823, which meets no Standard card yet; the 60-turn cap's draws; the CPU always choosing to go first; and the 18 of the owner's replayed games that stop at a move the engine does not offer.
