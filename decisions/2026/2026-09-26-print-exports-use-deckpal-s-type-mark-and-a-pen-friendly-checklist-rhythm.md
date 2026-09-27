---
date: "2026-09-26"
title: "Print exports use DeckPal's type, mark, and a pen-friendly checklist rhythm"
decided_by: "Chey"
areas: ["decks"]
supersedes: []
---
## 2026-09-26 — Print exports use DeckPal's type, mark, and a pen-friendly checklist rhythm

**Decided by:** Chey

**Decision:** The set checklist, list checklist, and deck list share a white print layout: the dark DeckPal vector logo, Fraunces titles, Figtree text, warm gray rules, and a narrow cyan progress line. Set cards use three numbered columns with 12-point boxes and pink Printed cards / Secret cards labels; list cards use two columns with set details; deck cards use Pokémon, Trainer, and Energy tables with a have/quantity column. Letter is the default, and `?paper=a4` selects A4. Owned cards are pre-ticked in neutral ink, while missing cards have empty boxes; card names keep the same weight whether owned or missing. Licensed Noto font glyphs render ♀, ♂, δ, ☆, and ◇ where the brand faces lack them. Chey selected these three treatments on 2026-09-27.

**Why:** The old PDFs used an unrelated red accent, nine-point boxes, and repeated rarity lines that made a 230-card set take four pages. Helvetica also corrupted ♀, ♂, δ, ☆, and ◇ in card names. The printed sheet needs to be easy to scan and mark with a pen while spending little ink.

**Implications:** The API build copies the embedded fonts and vector logo into its output, and the cloud function includes those assets. A 230-card Obsidian Flames sample uses three Letter pages instead of four; a 60-card sample deck fits on one page. The cyan progress line and pink section labels use DeckPal's print legible brand shades.
