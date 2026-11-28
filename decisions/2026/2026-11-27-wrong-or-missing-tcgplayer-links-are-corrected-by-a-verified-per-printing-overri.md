---
date: "2026-11-27"
title: "Wrong or missing TCGplayer links are corrected by a verified per-printing override table"
decided_by: "Claude Opus 5.5 on behalf of @cheyras"
areas: ["prices"]
supersedes: []
---
## 2026-11-27 — Wrong or missing TCGplayer links are corrected by a verified per-printing override table
**Decided by:** Claude Opus 5.5 on behalf of @cheyras

**Decision:** A card's TCGplayer price and its "Buy on TCGplayer" button both come from
`card_variant.(tcgplayer_product_id, tcgplayer_printing)`. The owner asked for the links of about
thirty cards that had none, or the wrong one, to be made accurate. They are now corrected by a small
hand-verified table, `apps/sync/src/catalog/priceLinkOverrides.ts`: 28 printings of 24 cards, keyed by
TCGdex card id + variant kind, each with the group, product and printing TCGplayer lists it under and
an evidence note quoting TCGplayer's own name and number for the product (TCGCSV `/3/<group>/products`
and `/prices`, checked 2026-11-27).

- **Wrong ids replaced (TCGdex's value is wrong, so the weekly import kept restoring it):** Aquapolis
  50b, 74b, 95a and 103b carried their a/b twin's product (both twins quoted one price); Classic
  Collection CC020 Reshiram and CC021 Zekrom carried the main Celebrations cards (002/025, 010/025)
  instead of 113/114 and 114/114; two My First Battle Switch printings carried Potion products; SM
  Trainer Kit (Alolan Raichu) Lightning Energy #2 and #3 shared the #3 product; Unbroken Bonds 195a
  Dedenne GX was linked as Normal to a product TCGplayer prices only as Holofoil.
- **Missing ids filled (the link pass is right to refuse these in general):** five XY Trainer Kit
  (Noivern) and three (Sylveon) cards TCGplayer names with a deck qualifier ("Poke Ball (Noivern)"),
  HS Trainer Kit (Gyarados) #20 ("Gyarados (#20 Non-Holo)"), the two Yellow A Alternate cards
  (Alternate Art Promos, non-holo), and XY promos XY39, XY46 and XY68, which TCGplayer lists only as
  their prerelease printing and a staff one (the catalog carries one printing for each).
- **Left unlinked on purpose:** printings TCGplayer does not list. MEP 064, 067, 074, 075, 076, 077
  (plain holo: TCGplayer lists "<Name> - 0NN", which TCGdex already links to the set-logo-stamped
  printing, and "[Staff]"), MEP 120 Celebratory Fanfare (listed only at 028), SVP 190 Pikachu (one
  product, linked by TCGdex to the Worlds 2024 stamped printing) and Detective Pikachu 25 Lt. Yoshida
  (the group lists 1-18). Linking them to a neighbour would quote another printing's price.
- **Already right:** SM Trainer Kit Lightning Energy #3 (TCGplayer files "Lightning Energy (#3)" with
  the number 2/30; the name is right, and the #2 card was the one at fault) and MEP "Pikachu at the
  Museum" (a Jumbo Cards product, correctly linked, but never priced; see below).

Both writers of the pair honour the table. The importer writes an override in place of TCGdex's value
(and of the release overlay's). The link pass writes it first on every run, over whatever is there,
clearing a stored `tcgplayer_url`, and its planner treats the override's (product, printing) as taken.
An entry also pins the set, collector number and card name, and is refused (logged, upstream kept)
when TCGdex re-keys or renames the card, so it can never apply to another printing. The price ingest
also prices an override whose product is listed outside its set's TCGplayer group from that group,
by product id, and only that product: the set walk joins a set's own group, so Dedenne GX 195a, the
two Yellow A Alternate cards and "Pikachu at the Museum" could not be priced before.

**Why not extend the release overlay (`releasePriceLinks.ts`)?** It is the wrong shape for every one
of these. It is set-scoped (one group per set) where these span 11 sets, three of them with a product
listed in another group than the set's; it covers only a card's canonical single variant where
these include reverse and stamped printings of multi-variant cards; and its contract is that an
upstream id always wins, which is
exactly what has to be reversed for a wrong id. Its two sets and their invariants are left as they
were. A separate per-printing table also lets the link pass apply the same entries without loading
the overlay's set model, so a correction lands on the next daily price run instead of the next
weekly import.

**Implications:**
- Merging changes nothing by itself. The next `prices-tcgcsv` run writes the overrides (the link pass
  runs first) and prices the cross-group products; the weekly `catalog-refresh.yml` (or a dispatch of
  it) then writes the same values from the import. `prices link-tcgcsv --dry-run` reports
  `overridesApplied` / `overridesRefused`; the catalog job summary shows a row for overrides and lists
  any refused.
- No migration, secret or variable. Overrides are written as `id_source = 'variant'`, confidence 100,
  the same as the release overlay.
- A new entry needs the same evidence: TCGplayer's own record must name the card at its number
  (letter suffix included; a reprint prints its original number), in the printing the variant means,
  and no two entries may share a (product, printing) (the index throws).
- An override that goes stale when TCGdex fixes its id is harmless (the values agree); prune it when
  the catalog job summary shows TCGdex now carries the same id.
