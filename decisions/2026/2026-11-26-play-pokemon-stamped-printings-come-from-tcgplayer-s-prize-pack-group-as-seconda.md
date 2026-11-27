---
date: "2026-11-26"
title: "Play! Pokémon stamped printings come from TCGplayer's Prize Pack group as secondary variants"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["catalog", "prices"]
supersedes: []
---
## 2026-11-26 — Play! Pokémon stamped printings come from TCGplayer's Prize Pack group as secondary variants
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:**
- **Source:** the catalog takes Play! Pokémon (Prize Pack) stamped printings from TCGplayer group 22880, "Prize Pack Series Cards", through TCGCSV. TCGdex stays the source of everything else.
- **Rows:**
  - Each stamped printing is a variant of the card it reprints, never a card of its own.
  - It is written as `source='tcgcsv'` with TCGdex's own kind codes, e.g. `normal-stamp-player-rewards-program` and `holo-foil-cosmos-stamp-player-rewards-program`.
  - Every stamped kind is tier `special`, so it is a secondary printing. It shows in card detail under the other printings and never as a check mark on a card tile. It adds nothing to a Master Set.
- **Matching:**
  - A product is placed only when its collector number, printed set size and name agree on exactly one Sword & Shield, Scarlet & Violet or Mega Evolution card.
  - Unsized numbers ("MEE 003", "016", "SWSH149") are looked up only in the promo and energy sets that print them.
  - Everything else is refused and reported, never guessed.
- **Existing rows:** a card that already has the printing keeps its own row, and gains only a product id it lacked.
- **Schedule and pricing:**
  - The fill runs inside the daily `products-tcgcsv` link step (`apps/sync/src/prices/prizePack.ts`).
  - The price walk then prices group 22880 by product id across every set (`tcgcsv.ts writeProductGroupPrices`).
- **Label:** the stamp now reads "Play! Pokémon Stamp", as printed, instead of "Player Rewards Program Stamp".

**Why:**
- **The report:** on 2026-11-26 the owner scanned a stamped Basic Water Energy (mee-003) and had no printing to pick.
- **The gap:** the audit that day found that TCGdex lists the stamp for some sets and not at all for sv01, sv02, sv04, sv06, sv06.5, sv07, sv08.5, sv10, sv10.5w, me02 and mee. It lists almost none for Sword & Shield.
- **The size:** run offline over that day's TCGplayer data and the TCGdex catalog, the planner adds **736 printings on 597 cards** and links **177** that TCGdex already had.
  - It refuses 45 products: 42 with no collector number (sealed, code cards, unnumbered series energies) and 3 Shining Fates products with no matching card.
  - Products TCGplayer lists in both Normal and Holofoil become two printings. All 90 of them have their own sales and market price in each.
- **Pricing:** every stamped printing was unpriced, TCGdex's own included. The walk priced each set from its own group, and no set's group holds these products.
- **Why a variant, not a card:** a stamped reprint carries the original set code and number. As a variant, the scanner's (set, number) lookup, ownership and deck matching already treat it as that card.

**Implications:**
- **When it lands:** after merge, the first price tick on a new TCGCSV stamp (about 20:05 UTC) adds the printings. Dispatching `price-refresh.yml` with job `prize-pack` adds them now, and prices follow on the next ingest.
- **Unchanged:**
  - Nothing new for the catalog import: it leaves rows it does not publish in place.
  - No migration, secret or variable is needed.
- **If TCGdex adds a printing later:** the import's `(card_id, variant_kind_code)` upsert takes the row over in place, so anything a user owns stays attached.
- **Collection counts:** Grandmaster denominators for the affected sets rise by the new printings. `recomputeCoverage` runs for those sets.
- **Not covered:**
  - Prize Pack Series 1–3's unnumbered basic energies have no card to attach to.
  - A stamped copy still never substitutes for an unstamped one in a deck (`ownedPrints.ts`).
  - The left/right stamp positions and Series 6/7 duplicates collapse to one printing each.
- **Verified:**
  - Pure tests cover the planner (`apps/sync/src/prices/__tests__/prizePack.test.ts`).
  - A real-Postgres CI case covers the writes, the tier and the pricing (`apps/api/src/__integration__/prizePack.mjs`).
  - Not run against production before merge.
