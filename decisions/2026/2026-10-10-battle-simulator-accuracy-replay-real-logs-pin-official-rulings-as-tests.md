---
date: "2026-10-10"
title: "Battle simulator accuracy: replay real logs, pin official rulings as tests"
decided_by: "@cheyras (\"They really need to be accurate... I'm hesitant to agree that we're done\"); built by Claude Opus 5.5."
areas: ["decks", "agents"]
supersedes: []
---
## 2026-10-10 — Battle simulator accuracy: replay real logs, pin official rulings as tests
**Decided by:** @cheyras ("They really need to be accurate... I'm hesitant to agree that we're done"); built by Claude Opus 5.5.

**Decision:** The simulator's correctness is checked against things it didn't write. Two checks join the existing ones (rule tests, card scenario tests, the text round-trip, the data diff, random-play fuzz, the damage audit of real logs, the hidden-information invariance tests):

- **Full replay of real games** (`packages/sim/src/replay/replay.ts`). Every action in a PTCG Live battle log has to be one the engine offers at that moment, every choice inside it is answered from the log's detail lines, and the engine's damage, damage counters, Special Conditions, Knock Outs, Prizes and winner are compared with the log's. What the log hides is filled in without inventing visible state: decks are the cards the log shows plus filler cards; each draw, Prize card and coin flip is matched when the engine makes it (`Env.replay` hooks); a filler in a hidden hand becomes the card the player plays; ambiguous same-named Pokémon are resolved by backtracking. A card the engine doesn't script has its logged effect applied instead, and differences on it are tagged as coverage gaps rather than rule errors. The owner's ten fixture logs run under a ratchet (`replay.test.ts`): none may show a rule mismatch, each must replay at least as far as recorded, and each names the unscripted cards it may take from the log (so a card that loses its script fails the test rather than being supplied by the log). Nine replay start to finish; hns-05 stops because the opponent's Lurantis ex is unscripted.
- **Official rulings as tests** (`rulings.test.ts`, plus `rules-audit.test.ts` and `cards-ghost.test.ts`). Each ruling the TPCi Rules Team has issued for a scripted card is one test quoting it, with its date. A ruling that settles a general reading is applied to every script it touches, not only the card it was asked about.

**Why:** The engine's own tests can only confirm the rules as its author read them. A real game is an oracle that disagrees when the engine is wrong: the first replay pass found an engine bug no other check had (the `when` condition of Tool, Energy and Stadium effects was never evaluated, so Shadowy Darkness Energy protected an Active Pokémon), and a card-identity bug (a Weakness written "x2" made the Mega Lucario ex promo a different, unscripted card). The 2026 rulings sweep changed six behaviours. The biggest was the general "up to X": 1 to X on a Trainer or an Ability, 0 to X only on an attack (TPCi 2026-02-19).

**Implications:**
- A new Live log fixture needs a `REPLAY_FLOOR` entry (its floor and the cards it may take from the log). Raise floors and shrink the list as card coverage grows; never loosen one without a written reason.
- Live's display quirks are handled where they were seen, and listed in the replay module's header: detail lines credited to the wrong player, a passive Ability's "used" line, a failed Confused attack with no "used" line, an unprinted Confusion heads flip. A new quirk shows up as a divergence, not a silent pass.
- Rulings tests cite the Compendium (https://compendium.pokegym.net); `CARDS.md` §6 lists the general rulings every script follows.
- Not checked: the opponent cards in the logs that the engine doesn't script. Their effects come from the log, so the replay verifies the engine around them, not them.
