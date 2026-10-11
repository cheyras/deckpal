---
date: "2026-10-11"
title: "Battle simulator: every official ruling filed under a scripted card is pinned by a test or reviewed with a reason"
decided_by: "@cheyras (asked for every Standard card scripted with all of its official rulings built in); audit run by Claude Sonnet 5.5 lanes, verified by Claude Opus 5.5."
areas: ["decks"]
supersedes: []
---
## 2026-10-11 — Battle simulator: every official ruling filed under a scripted card is pinned by a test or reviewed with a reason
**Decided by:** @cheyras (asked for every Standard card scripted with all of its official rulings built in); audit run by Claude Sonnet 5.5 lanes, verified by Claude Opus 5.5.

**Decision:** Every Compendium ruling filed under a scripted card's name, or under one of its attacks or Abilities, gets one of three outcomes:
- **A scenario test that pins it.** The test cites the ruling id with a one-line summary of what it decides.
- **A script fix plus that test.** Where a ruling contradicts an earlier one, the newer TPCi date wins.
- **An entry in the `REVIEWED` table** of the batch's test file, with a specific reason: different text, superseded, outside the game, unscripted card, or no observable effect.

A ruling that needs an engine change stays uncited until the engine follows it.

The first pass covered the 278 such rulings that no test cited: 226 pinned, 45 reviewed and 7 left open. Six scripts were fixed:
- Pyroar's reduction also covers the attacker's own Pokémon.
- Mystery Garden is only offered when a card would be drawn.
- Noctowl's Jewel Seeker doesn't trigger on a Pokémon that is already over its HP.
- A Supporter used through Ninetales' attack may choose none for "up to".
- N's Zoroark ex can't Trade with an empty deck.
- Munkidori's moved counters are lost when Battle Cage blocks the target.

**Why:** A ruling cited only in a comment can drift, while a test can't. Recording the untestable ones with a reason makes the `rulings-sync.ts --uncited` list a true to-do list. The repository is public, so ruling text stays on the Compendium: tests and scripts carry a summary in our own words, never the question or answer.

**Implications:**
- After a FAQ update, `rulings-sync.ts` reports the new rulings and the same three outcomes apply. CARDS.md "FAQ update" documents the `REVIEWED` table.
- Six rulings needed engine work: #1138, #2041, #1822, #342, #2212 and #620. They go to a follow-up engine change.
- Ruling #2150 (Team Rocket's Wobbuffet moving counters onto a protected Pokémon) is held for the owner. The fix was proposed but not applied.
- About 455 older script comments from earlier batches quote ruling answers verbatim. New work paraphrases; whether to paraphrase the old quotes is an open question for the owner.
- The 816 rulings that only mention a scripted card's name in their text (weaker matches, often about another card) are not covered by this pass.
