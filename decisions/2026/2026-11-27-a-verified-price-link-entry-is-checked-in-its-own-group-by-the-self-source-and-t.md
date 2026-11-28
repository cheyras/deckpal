---
date: "2026-11-27"
title: "A verified price-link entry is checked in its own group by the self-source, and the import keeps hand-matched set groups"
decided_by: "Claude Opus 5.5 on behalf of @cheyras"
areas: ["images", "prices"]
supersedes: []
---
## 2026-11-27 — A verified price-link entry is checked in its own group by the self-source, and the import keeps hand-matched set groups
**Decided by:** Claude Opus 5.5 on behalf of @cheyras

**Decision:** Two changes to how the card-art self-source checks a card's linked product.

1. **A verified entry is the stronger record.** The verified per-printing link table moves its rows
   to `@deckpal/db/priceLinkOverrides` (`packages/db/src/priceLinkOverrides.ts`), so the image tier
   can read them. The logic that applies them to the catalog stays in
   `apps/sync/src/catalog/priceLinkOverrides.ts`. When a card's linked product is exactly an
   entry's product, and the card is still the one the entry pins (same set, number and name), the
   self-source (`apps/api/src/images/selfSource.ts`, `verifiedArtLink` / `checkArtProduct`)
   looks the product up in the entry's group instead of the set's. The entry's checked identity
   then stands in for the product's listed collector number. The product's name must still name
   the card. tk-sm-r-3 joins the table for this reason: upstream already links it right, but the
   product record lists the #2 card's number.
2. **The catalog import keeps a hand-matched set group.** `catalogSetGroup` in
   `apps/sync/src/prices/linkMatch.ts` makes the import write a `KNOWN_SET_GROUPS` group instead of
   upstream's value, the same precedence the link pass already used. Before, every weekly import
   reset those sets to upstream's none, and they stayed group-less until the next link pass.

**Why:** The image warm that runs right after a catalog refresh still refused cards whose links had
been verified by hand.
- **Sets with a hand-matched group** (cel25cc, exu, mfb) had just been reset to no group by the
  refresh, so the check found "no product group to check against". The set-to-group map already
  listed them, and every group was re-checked against a fresh product listing on 2026-11-28.
- **Products the entry records in another group** (sm10-195a, mep-Museum) were refused as "not in
  the set's group".
- **Products whose record lists the wrong number** (tk-xy-n-29, tk-sm-r-3) were refused on that
  number.

In each case the entry records the group and identity that were verified, which is stronger
evidence than the set default.

**Implications:**
- **Every other check is unchanged.** Every card that no entry covers keeps the full name-and-number
  check in its set's group. The image must still be card-shaped and large enough, and a placeholder
  is still refused.
- **An entry counts only for its own product.** If upstream relinks the card to another product, or
  renames or renumbers it, the ordinary check applies again.
- **Tests:** `apps/api/src/images/__tests__/selfSource.test.ts` covers both sides: an override case
  that now passes, and refused cases that stay refused. `apps/sync/src/prices/__tests__/linkMatch.test.ts`
  covers the import's group precedence.
- **No new secret, variable or migration.** It takes effect for the fill on the next image warm.
  For the set groups to be in place, the next catalog import (or link pass) has to have run first.
