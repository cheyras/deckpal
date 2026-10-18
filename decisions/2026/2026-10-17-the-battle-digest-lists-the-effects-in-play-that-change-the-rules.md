---
date: "2026-10-17"
title: "The battle digest lists the effects in play that change the rules"
decided_by: "Chey (via Claude)"
areas: ["agents", "sim"]
supersedes: []
---
## 2026-10-17 — The battle digest lists the effects in play that change the rules
**Decided by:** Chey (via Claude)

**Decision:** The simulator's replay insights gain `ruleEffects` (`packages/sim/src/replay/ruleEffects.ts`), and `battle_digest` prints them as "effects in play that change the rules".

**1. What qualifies.** Every Stadium played, every Ability of a Pokémon that came into play, and every Tool attached, whose text changes any of the following:
- Weakness or Resistance;
- what attacks cost;
- whether Tools work;
- how much damage is done;
- whether damage or effects land;
- Retreat Costs;
- HP.

The kind is read from the WORDING of the card's text (`ruleKinds`), never from a list of card names. A card nobody has thought about yet is caught by what it does. "(before applying Weakness and Resistance)" orders a damage change, so it does not count as a Weakness change.

**2. The evidence for each effect, from the log.**
- **Weakness:** Weakness that Live applied to a target that does not print it is credited to the attacker's effects in play.
- **Damage:** breakdown lines that name the effect, two copies shown as "30 ×2".
- **Tera:** the Tera Pokémon in play while a rule naming Tera Pokémon was up.
- **Tools:** Tools on the board while Tools were switched off.
- **Prevention:** effects that "did not affect" a Pokémon with a prevention Ability, credited to the side whose turn it was not (both players can have a Shuppet). Also, attacks into a damage-preventing Pokémon that did no damage.

**3. How the digest shows them.** Effects with evidence get a line each, with the turn they came into play (and the turn a Stadium was replaced). The rest share one line: in play, but nothing visible in the log.

**Why:** In the analysis eval (`evals/analysis/RESULTS.md`), P2 (every surprise has a mechanism) scored low in every configuration, Sonnet included. The digest printed "Weakness to Psychic: 160" on a Dragapult ex that prints no Weakness. It never said Nighttime Mine was raising Phantom Dive's cost, or that Jamming Tower had switched off an Air Balloon. The owner asked for a system, not a rule per card: this is one rule for the class.

**Implications:**
- It is measured AFTER deploy: a preview deployment cannot run the tools (the MCP function's internal API calls meet deployment protection), so the eval runs against production once merged, and the change is reverted if P2 does not rise on the held-out games as well as the owner's. The section is additive output, so a revert loses nothing.
- The eval sends `VERCEL_PROTECTION_BYPASS` (never printed) as the bypass header when set, for previews that can serve tools.
- The replay is computed per request from the stored raw log (`routes/decks.ts`), so every existing log gets the section at once. The renderer still accepts a payload without `ruleEffects` (an API deployed before the tools), and prints it as before.
