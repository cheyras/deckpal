---
date: "2026-10-11"
title: "Deck-E answers rules questions on Sonnet 5.5: Haiku 5.5 got a basic first-turn rule wrong 16 times in 18"
decided_by: "@cheyras (\"ship option 1\": rules on Sonnet), on a measurement by Claude Opus 5.5."
areas: ["agents"]
supersedes: []
---
## 2026-10-11 — Deck-E answers rules questions on Sonnet 5.5: Haiku 5.5 got a basic first-turn rule wrong 16 times in 18
**Decided by:** @cheyras ("ship option 1": rules on Sonnet), on a measurement by Claude Opus 5.5.

**Decision:** The `card_rules` pathway's floor is Standard (Claude Sonnet 5.5), not Quick (`pathways/names.ts`). This covers every question triage files as a card or rules question: card text, attacks and Abilities, rulings and format legality. Everything else keeps its floor.

**Why:** Asked on production after #293 shipped, Haiku 5.5 answered two of three rules questions wrong. It said playing a Supporter ends your turn, and that only the player going first can't evolve on their first turn (neither player can). Measured afterwards through the Gateway, same question, 18 Haiku samples:

| Setup | Right |
|---|---|
| bare | 2/3 |
| bare + adaptive thinking | 0/5 |
| Deck-E prompt | 0/3 |
| Deck-E prompt, thinking off | 0/5 |
| Deck-E prompt, effort high | 0/5 |
| Sonnet 5.5, bare or with Deck-E's prompt | 6/6 |

Both models answered "one Supporter per turn?" right every time. The prompt is not the cause: nothing in it mentions first-turn rules, and Haiku is wrong without it. Card text already comes from tools (`get_card`, `search_cards`), but the game's rules come from the model's memory, and long-tail TCG rules are where the small model is weakest. A rules question on Sonnet costs about a cent or two against Haiku's fraction of one. Being wrong about the rules costs more than that.

**Implications:**
- A pure card-text lookup ("what does Cursed Blast do") now also runs on Sonnet, although Haiku handles those well from the tool result. Splitting rules from card text into two pathways is possible later, if the cost matters.
- The real fix is to give Deck-E the official rules as something it looks up, as card text is, so neither model answers rules from memory. Not built yet.
- The triage eval's `card_rules` cases expect Standard now (`scripts/fixtures/decke-triage/cases.json`).
