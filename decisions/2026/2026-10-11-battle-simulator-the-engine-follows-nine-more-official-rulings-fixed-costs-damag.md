---
date: "2026-10-11"
title: "Battle simulator: the engine follows nine more official rulings (fixed costs, damage reductions everywhere, self-damage Weakness, setup choice)"
decided_by: "@cheyras (asked for every Standard card scripted with all of its official rulings built in); built by a Claude Sonnet 5.5 engine lane, verified by Claude Opus 5.5."
areas: ["decks"]
supersedes: []
---
## 2026-10-11 — Battle simulator: the engine follows nine more official rulings (fixed costs, damage reductions everywhere, self-damage Weakness, setup choice)
**Decided by:** @cheyras (asked for every Standard card scripted with all of its official rulings built in); built by a Claude Sonnet 5.5 engine lane, verified by Claude Opus 5.5.

**Decision:** The rulings audit (2026-10-11, PR #328) left these rulings open for engine work. The engine now follows each one, and each is pinned in `src/__tests__/rulings-engine.test.ts`.
- **Fixed attack costs (#2032).** A cost an effect sets is final, so cost increases don't add to it. Waivers that make it cheaper still apply. Kyurem's Plasma Bane against Antique Root Fossil: one Energy.
- **Damage reductions on every target (#1822).** "Attacks used by this Pokémon do N less damage" reduces all the damage the attack does, Benched Pokémon and its own side included. Increases still apply only to the opponent's Active Pokémon. Three cards that had added paired statics to cover the Bench (Pikachu, Pyroar, Garbodor) now rely on the general rule.
- **Weakness and Resistance on self-damage (#620).** They apply when an attack damages the attacking player's own Active Pokémon, never a Benched one. No newer ruling says otherwise.
- **Resolute Heart (#2041).** The attack places its full damage. "Its remaining HP becomes 10" is settled when Knock Outs are checked, at the max HP the Pokémon has then.
- **Evolving by an attack on the first turn (#342, #1820, #98).** Ascension and the like can evolve on the player's own first turn and on a Pokémon put into play that turn. Rare Candy (#1136) and Evosoda (#9) still can't, because their own text forbids it.
- **Rare Candy after a devolve (#1138).** A Pokémon devolved this turn can't be Rare Candied that turn.
- **Searching for the Bench (#362).** With no Bench space, an attack that searches for Pokémon to Bench doesn't search at all: no shuffle, and the Prizes stay unknown.
- **Knock Out on evolve (#2122).** A Pokémon that evolves with damage at or over its new HP is Knocked Out before its "when you play this Pokémon to evolve" trigger.
- **Cinderace's Explosiveness (#2212).** An opening hand with no Basic Pokémon but a Pokémon that may start in the Active Spot asks the player whether to put it there or mulligan. The CPU puts it in play.

**Why:** These rulings change what happens in real games: the Plasma Bane cost, Moonblast on the Bench, a first-turn Ascension, and whether Cinderace can be your starter. A simulator used to compare decks has to get them right.

**Implications:**
- `determinism.test.ts` is re-pinned, because some seeded meta games now play differently.
- Still open: the player's choice of order for simultaneous triggers (#146, #2146), and #2150 (Team Rocket's Wobbuffet), which is held for the owner.
- Opening hands are now dealt one player at a time (`deal` then `deal1`) so that a choice can interrupt the deal. RNG order is unchanged.
