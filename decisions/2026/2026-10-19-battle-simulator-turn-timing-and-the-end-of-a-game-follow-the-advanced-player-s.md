---
date: "2026-10-19"
title: "Battle simulator: turn timing and the end of a game follow the Advanced Player's Rulebook and the Tournament Rules"
decided_by: "@cheyras (asked for everything left on purpose that is actually against the rules to be aligned with them); Claude Opus 5.5."
areas: ["decks"]
supersedes: []
---
## 2026-10-19 — Battle simulator: turn timing and the end of a game follow the Advanced Player's Rulebook and the Tournament Rules
**Decided by:** @cheyras (asked for everything left on purpose that is actually against the rules to be aligned with them); Claude Opus 5.5.

**Decision:** The items the 2026-10-17 pass left open were checked against the Pokémon Card Game Advanced Player's Rulebook v3.4 (2025) and the Play! Pokémon Tournament Rules Handbook. Five turned out to be against the rules, and the engine now follows the documents:
- **The tiebreaker game has 6 Prize cards.** A game where both players win at once is a tie. A Tiebreaker game decides it: a new game from the start, a new coin flip and 6 Prize cards each, won by the first player to have fewer Prize cards left than the opponent, or to win outright (APR "Games can result in a tie"; Tournament Rules 5.8.3.1). This corrects the 2026-10-17 entry's 1 Prize card each, which followed older wording. PTCG Live has the mode (`MatchMode.SuddenDeath`), and its starting Prize count is data the engine scan did not read. A third tied tiebreaker game is recorded as a draw.
- **"During ..." effects end before Pokémon Checkup.** "During this turn", "during your next turn" and "during your opponent's next turn" do not apply in the Checkup after that turn, because Checkup is in neither player's turn (APR E-02). "Until the end of your next turn" does still apply in it (E-22, E-23): `TimedEffect.throughCheckup`.
- **A Knock Out from an end-of-turn effect is resolved before Checkup.** A Knock Out is checked whenever a Pokémon's remaining HP becomes zero (APR D), so the turn's end-of-turn effects are followed by a Knock Out check before Checkup starts.
- **Setup is face down.** Each player's Active and Benched Pokémon are chosen face down and kept with the hidden hand (`PlayerState.setupPick`). Both players' Pokémon go into play together when the game starts, after Prize cards and the extra mulligan draws (APR G, steps 5–8). No choice can see the other player's setup.
- **The turn cap is time being called.** `maxTurns` is the turn time is called in. That turn is finished and 3 more are played, then the player with fewer Prize cards left wins (reason `'time'`). With the same number left, play goes on until one player is ahead or wins outright (Tournament Rules 5.8.3, single elimination, where a winner is needed). Only a game still level 40 turns later is recorded as a draw (`'turn limit'`).

Left as they are, because they break no rule: the CPU choosing to go first (a legal choice; batches swap seats on purpose), and Energy and damage-counter moves written per card.

**Why:** The owner asked for everything left on purpose that is actually wrong under the rules to be fixed. The documents settle each of these five: the APR's Knock Out timing (D), Checkup (F), timing terms (E-02, E-21–E-23), setup (G) and tie rules; and the Tournament Rules' end-of-round procedure.

**Implications:**
- `determinism.test.ts` is re-pinned: 18 of its 40 seeded games now play differently, mostly from setup being face down, which changes the order of setup events.
- Every one of the 36 real PTCG Live games tried still replays to the end, with every winner matching.
- Time-called games now count as wins and losses in `simulate_battles` (reason `'time'`). Only the rare level stalemate stays a `'turn limit'` time-out.
- `rules_lookup`'s winning, self-KO and durations entries now say "tie, decided by a tiebreaker game with 6 Prize cards", and describe Checkup timing and time being called.
