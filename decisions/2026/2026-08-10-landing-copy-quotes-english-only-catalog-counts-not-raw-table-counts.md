---
date: "2026-08-10"
title: "landing copy quotes English-only catalog counts, not raw table counts"
decided_by: "Not recorded"
areas: ["frontend","catalog"]
supersedes: []
---
## 2026-08-10 — landing copy quotes English-only catalog counts, not raw table counts
**What:** the landing shipped quoting 23,444 cards / 40,107 variants / 218 sets / 21
series. Those are the raw `card` / `card_variant` / `card_set` / `series` counts, and
they are correct — but the app's own series index reports **20 series**, because
`GET /api/series` filters `WHERE s.tcgdex_id <> 'tcgp'`: Pokémon TCG Pocket is a
separate digital game, not an English TCG era, and its 15 sets / 2,480 cards are not
browsable anywhere in the product.

**Decision:** the landing quotes the English-only figures — **20,964 cards, 37,627
printings, 203 English sets, 20 series, 1,025 Pokédex species** (verified against the
live Supabase DB, not the local one). Saying "every English Pokémon card — all 23,444
of them" next to a product that browses 20,964 would overstate it by ~12% and would be
falsified by the first click into the app. 23,444 − 2,480 = 20,964; 40,107 − 2,480 =
37,627 (Pocket cards carry exactly one variant each); 218 − 15 = 203.

**Implication:** if TCG Pocket is ever surfaced as a browsable catalogue, these four
numbers in `Landing.tsx` (`STATS`, the hero subhead, the stats caption, the "Which
cards does it cover?" FAQ) and the three in `index.html` need revisiting together.

