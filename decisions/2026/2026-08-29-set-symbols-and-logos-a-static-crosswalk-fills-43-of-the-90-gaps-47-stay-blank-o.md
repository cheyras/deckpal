---
date: "2026-08-29"
title: "Set symbols and logos: a static crosswalk fills 43 of the 90 gaps, 47 stay blank on purpose"
decided_by: "@cheyras, implemented by Claude Opus 5 via a Ringer swarm"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-29 — Set symbols and logos: a static crosswalk fills 43 of the 90 gaps, 47 stay blank on purpose

**Decided by:** @cheyras, implemented by Claude Opus 5 via a Ringer swarm
**Decision:** `packages/storage/src/setImageFallback.ts` holds a static
(setId, kind) -> source URL crosswalk. `setWarmer` consults it when
`card_set.logo_url` / `symbol_url` is NULL, and `SetSymbolTile` no longer gates
the image on a catalog URL that is null for exactly the sets we are trying to
fill. **43 pairs become fillable; 47 stay blank deliberately.**

**Why:** For all 90 missing pairs BOTH catalog columns are null, so the warmer
never even tried and the UI fell back to a derived letter tag — `TG` on every
Trainer Gallery, `PE` on Prismatic Evolutions, `ME02` on Phantasmal Flames. Two
findings made this cheaper than it looked:

- **Our ids are zero-padded and dotted; the source's are not.** `me02` -> `me2`,
  `sv08.5` -> `sv8pt5`, `sm3.5` -> `sm35`, `cel25cc` -> `cel25c`. A plain id
  match found nothing; normalising found 54 of 90.
- **Subsets serve their parent's symbol under their own id.** Verified byte-for-
  byte: `swsh12tg/symbol.png` and `swsh12/symbol.png` are identical (md5
  `d83e51dffd610a4d8fd4f27f4f72e396`). So Trainer Gallery, Galarian Gallery,
  Classic Collection and Shiny Vault need a fetch, not a fallback rule.

**Implications:**

- **All 12 McDonald's Collection LOGOS stay excluded**, upholding the 2026-08-10
  ruling. Independently reproduced here: nine of them are byte-identical at
  76,597 bytes — the McDonald's corporate mark, not a set logo. The **9
  McDonald's SYMBOLS are included** (owner's call, 2026-08-29): unlike the
  logos, each is distinct and is the genuine printed expansion symbol.
- **The four EX Trainer Kit logos stay excluded** (owner's call, 2026-08-29):
  they are one byte-identical generic "Trainer Kit" wordmark, and the same logo
  on four different sets reads as a bug rather than as design. All 20 Trainer
  Kits keep their text treatment, which at least is uniform.
- **Three files come from Bulbagarden** (MEE symbol, MEP Black Star Promos
  symbol, My First Battle logo) under a contributor fair-use claim rather than a
  transferable licence. The owner accepted that risk knowingly for these three
  only; it is not a precedent for the slot.
- **Nothing here has been warmed yet.** This commit is code plus tests only — no
  database write, no Supabase Storage write. The actual fill is a separate,
  owner-approved operation, and the cloud path only takes effect once deployed,
  because `warm:cloud` drives the DEPLOYED image tier's lazy fill.
- Provenance still goes through the B1 choke point with `fromUrl(<the URL
  actually fetched>)`. The fallback sources are PNG, not the TCGdex `.webp` that
  `setImageSourceUrl()` assumes, so the source-URL derivation handles both.

