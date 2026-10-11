---
date: "2026-10-11"
title: "Battle simulator: the right player orders effects that happen at the same time (Advanced Player's Rulebook)"
decided_by: "@cheyras (asked for every official ruling built in, and for the remaining rulings gaps fixed); built by a Claude Sonnet 5.5 engine lane, verified by Claude Opus 5.5."
areas: ["decks"]
supersedes: []
---
## 2026-10-11 — Battle simulator: the right player orders effects that happen at the same time (Advanced Player's Rulebook)
**Decided by:** @cheyras (asked for every official ruling built in, and for the remaining rulings gaps fixed); built by a Claude Sonnet 5.5 engine lane, verified by Claude Opus 5.5.

**Decision:** When two or more effects happen at the same moment and their order can change the outcome, the engine asks the player the official Advanced Player's Rulebook (v3.4) names to pick which happens first. It keeps asking until one effect is left. The decision is an `option` titled "Which effect happens first?", and it lists only the public names of the effects' cards.

Who chooses:
- Effects triggered by a Pokémon taking damage: the player whose Pokémon was damaged.
- Knock Out step-2 effects: the turn player.
- Energy-attach triggers: the turn player.
- Evolve triggers: the turn player.
- End-of-turn effects and due delayed effects: the turn player.
- Pokémon Checkup effects: the player whose turn is next.
  - The Special Condition checks are queued as a stand-in effect, so that player can also put each Checkup effect before or after them.

The engine doesn't ask when only one effect is pending, when the pending effects have the same compiled program, or, at Checkup, when no Active Pokémon has a Special Condition.

The previous Amarys-only end-of-turn question is now a case of the general one. A Checkup trigger's condition is re-checked when it resolves (Snorlax's Good Sleep: "if it remains Asleep").

**Why:** Rulings #146 (Gengar ex's Gnawing Curse against a heal) and #2146 (Team Rocket's Golbat against Team Rocket's Ampharos) give the player this choice, and the rulebook makes it general. A fixed order played some lines that real players can avoid.

**Implications:**
- The policy pilot and replay answer with the engine's previous order, so seeded games are unchanged and `determinism.test.ts` still passes.
- The greedy and search pilots look ahead over the order, as they do for other small `option` decisions.
- Rulings #146 and #2146 are now pinned with both orders. `src/__tests__/trigger-order.test.ts` covers each moment.
- CARDS.md has a section on effects that happen at the same time.
