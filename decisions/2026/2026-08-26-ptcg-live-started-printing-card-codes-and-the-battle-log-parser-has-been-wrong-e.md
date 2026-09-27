---
date: "2026-08-26"
title: "PTCG Live started printing card codes, and the battle-log parser has been wrong ever since"
decided_by: "Claude (Opus 5), from the owner’s report on a battle that did"
areas: ["catalog"]
supersedes: []
---
## 2026-08-26 — PTCG Live started printing card codes, and the battle-log parser has been wrong ever since
**Decided by:** Claude (Opus 5), from the owner’s report on a battle that did
not get logged: *"Seems like he interpreted MY deck as being my opponent’s
deck, and then he did way too many tool calls and errored out."*

**Decision:** `battlelog.ts` strips the Live card code before anything reads a
line. It was never the model.

### What changed underneath us

Live now prefixes every card with its set code:

```
JazzyWazzy11222 played (sv10_102) Cynthia’s Gible to the Active Spot.
```

Every action line still matched. Turn counting still worked. The parser
returned a populated-looking result and never threw — which is exactly why
this survived. What broke is the card NAME it extracts, which became
`(sv10_102) Cynthia’s Gible`, and owner identification scores the overlap
between the names a player uses and the names in the deck. That overlap is now
ZERO FOR BOTH PLAYERS, because no deck contains a card by that name.

Re-parsed across the owner’s fourteen most recent logs, before and after:

| logs | before | after |
|---|---|---|
| #47 #46 #40 #38 #35 | confidence LOW, no owner, 0-0 prizes, no knockouts | high, correct |
| **#36 #34** | **high confidence, owner identified as the OPPONENT** — prizes, knockouts and win/loss all attributed to the wrong player | high, correct |
| #41 #39 #37 | high, deck guess reads `(me1_1) Bulbasaur / (me1_8…)` | `Bulbasaur / Chikorita` |
| #45 #44 #43 #42 | fine (these predate the format change) | unchanged |

14 of 14 now parse `high` with the right owner, and the inverted pair is the
literal source of "he interpreted MY deck as being my opponent’s".
`add_battle_log` refused the two most recent games outright, which is why a
battle the owner asked to record simply was not recorded.

**How much of that reached the database — checked, because the first draft of
this entry got it wrong.** It said the inverted parse was "stored that way".
It was not. Every `battle_log.result` and `opponent` column on file is correct:
`add_battle_log` takes both explicitly and the caller supplied them whenever
the parser came back unsure, so **the deck's win/loss record was never wrong.**
The damage is confined to the `parsed` JSONB detail — #34 stored with `players`
and `prizesTaken` inverted, #46 stored empty, and the code-era rows carrying
codes inside their names. #36 re-parses inverted from raw but is stored
correctly, because that write named the player.

Recorded rather than quietly amended: an entry that overstates its own blast
radius is the same failure as a message that misstates its evidence, which is
the fault this very entry corrects two sections down.

**The discriminator is underscore-then-digits.** `(sv10_102)`, `(me2-5_98)`,
`(mee_6)`, `(me5_29_ph)` go; `(Ability) Cheer On to Glory` and `(Item) Premium
Power Pro` stay, because this same parser reads those. A test says so.

Stripped rather than captured: the set code names the exact printing and is
genuinely useful, but every consumer here matches on NAMES, and half-adopting
it would leave two identifiers to keep in step.

### Three smaller faults from the same two turns

**A failure message that misstated its own evidence.** `deck_strategy` said
*"More than one deck matches 'slowking toolbox'"* and then listed ONE deck.
`strict` turns any inexact hit into `ambiguous` — correctly, since a lone
fuzzy match is what would rewrite the wrong guide — but `explainMiss` counted
the candidates it was handed and called one of them several. This file’s own
doctrine is that the failure message teaches the model its next move, and
lists three originals that taught it wrong; a message confidently wrong about
how many things it found belongs on that list. One candidate now reads as what
it is: a near miss, with the id, and the next call named.

**A read that was stricter than the read beside it.** `deck_strategy` resolved
its deck once, before the read/write branch, with `strict: true` — so READING
a guide was strict too. In one turn, `decks({deck_id: 'slowking toolbox'})`
returned the deck and `deck_strategy({deck_id: 'slowking toolbox'})` refused
it. Strict now follows the write.

**A count that reads like a card list.** Asked to show a decklist, the model
called `decks` WITHOUT `include: ['cards']`, got a header saying `60 cards (23
Pokemon / 27 Trainer / 10 Energy)`, and told the user "here it is". The reply
contained no cards. A count is the most misleading thing that response can
carry, because it reads as evidence the list was fetched — so the absence is
now stated as an absence, where the list would have been.

### And the `finishReason` shipped two commits ago never fired

Migration 046 added the column; the write used `streamText`’s `onFinish`,
which races the close of the merged UI stream. The write landed on a closed
writer, the catch swallowed it, and every turn recorded NULL — verified on the
build that shipped it. It is now written inside `execute`, from the awaited
`result.finishReason`, beside the empty-turn guard that already proves the
writer is open there.

That is the fifth instance of the same rule in three days, and the first one
where the author was this session: **a capability that is declared but never
exercised will eventually be reported as built.** A callback nobody watched
fire is a declaration.

**Implications:**
- Six stored logs still hold the pre-fix parse, two of them with the players
  inverted. The rows are the owner’s to correct or keep; nothing here rewrites
  history behind them.
- `card.playable_fingerprint` is NULL on all 23,546 rows while `save_deck` and
  `search_cards` both instruct the model to "use the cheapest printing". Those
  are only safe for true reprints: `Shaymin` sv10-010 (80 HP) and sv08.5-087
  (70 HP) share a name and are different cards. Building the deck for this
  report needed an equivalence check on name+HP+stage+effect to avoid exactly
  that swap. Recorded, not fixed — it wants either the column populated or the
  instruction narrowed, and both are their own change.

---
