---
date: "2026-08-19"
title: "Rarity is a filter, because variant tier is not rarity"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["catalog"]
supersedes: []
---
## 2026-08-19 — Rarity is a filter, because variant tier is not rarity
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** `set_progress` shows `rarity` on every missing row and accepts
`rarity` / `rarity_exclude`; so do `set_cart` and `edit_list`'s new
`add_missing`. Matching is case-insensitive against `card.rarity`, and an
unrecognised name is a 400 listing the known vocabulary rather than a silently
empty result.

**Why.** `card_variant.tier` is `standard` or `special` and does NOT line up
with the game's printed rarities: an Illustration Rare and a Special
Illustration Rare are both `standard`. An agent asked for "everything missing
except the Special Illustration Rares" therefore could not express it as a
filter and had to read `rarity` off ~87 individual `get_card` calls — on a list
`set_progress` had already computed. The catalog's casing ("Special illustration
rare") is neither TCGplayer's nor what a person types, hence `lower()` on both
sides.

