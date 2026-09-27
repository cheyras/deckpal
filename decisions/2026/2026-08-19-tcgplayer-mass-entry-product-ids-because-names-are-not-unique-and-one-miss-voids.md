---
date: "2026-08-19"
title: "TCGplayer Mass Entry: product ids, because names are not unique and one miss voids the cart"
decided_by: "Claude (on behalf of @cheyras). Supersedes the 2026-08-16"
areas: ["commerce","catalog"]
supersedes: ["2026-08-16 NUMBERED_GROUP_IDS entry"]
---
## 2026-08-19 — TCGplayer Mass Entry: product ids, because names are not unique and one miss voids the cart
**Decided by:** Claude (on behalf of @cheyras). Supersedes the 2026-08-16
`NUMBERED_GROUP_IDS` entry, which was a per-set model of a per-product property.

**Two findings, both probed live against
`POST https://mpgateway.tcgplayer.com/v1/cart/massentry/addtocartandretrieve`:**

1. **Mass Entry is ALL-OR-NOTHING.** `['1 Tropius [PBL]']` adds 1;
   `['1 Tropius [PBL]', '1 Fomantis [PBL]']` adds **0**. A single unresolvable
   line makes the whole submission add nothing — which is exactly the reported
   symptom, "the cart links usually just error, none of the cards can be found".
2. **A name line only resolves when the card name is unique inside the group.**
   TCGplayer disambiguates a repeated name by appending the collector number to
   the *product* name, so within Pitch Black both `"Tropius"` and
   `"Fomantis - 003/084"` exist. `1 Fomantis [PBL]` → `InvalidProduct`;
   `1 Fomantis - 003/084 [PBL]` → resolves. Every modern set reprints base-card
   names as Illustration / Special Illustration / hyper rares, so a large
   fraction of name lines missed — and by (1), took the cart with them.

**The grammar has a third form.** TCGplayer's own parser
(`MassEntryExpressions` in the site bundle) accepts `<qty>-<productId>` in every
branch. That names the product directly: no name matching, no set code, no
punctuation to get wrong.

**Measured, 40 Pitch Black primaries:** name form → **0 of 40 added**, 11
`InvalidProduct`. Product-id form → **40 of 40**, zero errors. The full
master-goal cart (111 lines, 151 copies) replayed through the live endpoint:
**111 listings, 151 copies, 0 invalid**. A filtered list cart built through the
new `list_id` path: **104 listings, 144 copies, 0 invalid**.

**Decision.** `buildCart()` in `apps/api/src/tcgplayer/massentry.ts` emits
`<qty>-<productId>`, aggregated per product id. `NUMBERED_GROUP_IDS` and
`isNumberedSet` are deleted. A curated `tcgplayer_mass_entry` token is the only
fallback and its lines go in SEPARATE URLs, so a guess that misses cannot void
the verified cart. A variant with neither is reported as unlinkable, never
guessed at.

**No coverage regression:** `linkable` already required
`tcgplayer_product_id IS NOT NULL OR tcgplayer_mass_entry IS NOT NULL`, and
`tcgplayer_mass_entry` is NULL for all 41 341 variants — so the 5 474 variants
without a product id (13.2 %, concentrated in TCG Pocket sets, Black Star Promos
and pre-2010 sets) were already unlinkable.

**Aggregating per product id is correct, not a rounding-off.** 12 671 product
ids in the shipped catalog map to exactly two variants — the normal/reverse
pair — and two missing printings genuinely are two copies to buy. Mass Entry
cannot preselect a printing per line anyway (it is a page-wide preference), and
duplicate product-id lines are merged and summed by TCGplayer (verified).

**Side effect worth having:** the cart path no longer needs a TCGplayer set
abbreviation, so `tcgplayerAbbrev` (a 5-second-timeout fetch to tcgcsv.com) is
off the hot path entirely.

