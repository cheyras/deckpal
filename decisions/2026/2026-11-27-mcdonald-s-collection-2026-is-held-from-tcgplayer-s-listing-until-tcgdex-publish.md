---
date: "2026-11-27"
title: "McDonald's Collection 2026 is held from TCGplayer's listing until TCGdex publishes it"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["catalog"]
supersedes: []
---
## 2026-11-27 — McDonald's Collection 2026 is held from TCGplayer's listing until TCGdex publishes it
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:**
- **What:** The catalog holds sets TCGdex has not published, listed in `apps/sync/src/catalog/supplements.ts`. The first is McDonald's Collection 2026: 15 cards, TCGplayer group 24938, released 2026-11-06.
- **Card data:**
  - Each card is a pointer. It gives its collector number, its TCGplayer product and printing (Normal or Holofoil), and the TCGdex id of the card it reprints.
  - These fields are copied from the reprinted card: name, rules text, attacks, types, weakness, retreat, regulation mark and reprint fingerprint.
  - The card's own rarity is "Promo". Its illustrator and flavour line are left empty.
  - It has one primary, standard-tier printing with its TCGplayer link, written with `source='tcgcsv'`. The daily walk prices it through the set's group.
- **TCGdex's shape:**
  - The rows use TCGdex's own conventions for this set: series `mc`, the name "McDonald's Collection 2026" (as for 2011–2024), unpadded collector numbers, and the expected id `2026me`.
  - When TCGdex publishes the set, the catalog import either upserts these rows by id or re-keys them in place through its rename step, which matches on (series, slug). Either way the bigint ids are kept.
- **Writes:**
  - The supplement only inserts. It refuses a card whose reprinted card is missing or has a different name or HP.
  - It stands down, and reports `superseded`, once any of these appears: a set in the series under another id with the same name or TCGplayer group, or a TCGdex-written printing in the set.
- **When it runs:** `import:catalog` runs it after every import. `catalog:supplement` and the `price-refresh.yml` job `catalog-supplement` run it on demand.

**Why:**
- **The request:** on 2026-11-27 the owner asked for the current McDonald's set, "even if we don't have images for them". TCGdex had McDonald's sets for 2011–2024 and nothing for 2026, so the cards could not be logged.
- **Why the reprint's text:** all 15 cards reprint Scarlet & Violet or Mega Evolution cards that are already in the catalog. Each was matched on name, HP, stage and attack names.
  - TCGplayer's text for the set is hand-typed. Three of its attack names disagree with the reprinted cards: Chandelure "Combustion Burning" for Combustion Chain, Lucario "Vengeful Knuckles" for Avenging Knuckle, Metagross "Lustrous Blast" for Luster Blast. It also lists no Ability on Hawlucha, whose reprinted card has Flying Entry.
  - The reprinted card's text is the text this catalog already serves for that card.
  - **Confirmed against the printed cards:** they print Combustion Chain, Avenging Knuckle, Luster Blast and Flying Entry. The typed listing is what is wrong.
- **The holo split:** 002, 003, 004, 005, 006, 008 and 012 are holo. This matches TCGplayer's prices and a published checklist. The five G regulation marks a checklist reports (Chandelure, Palafin, Lucario, Hawlucha, Tyranitar) are exactly the five reprints from sv01–sv03.
- **Why TCGdex's shape:** the takeover is then the import's existing, tested path, not a second one.

**Implications:**
- **Not verified:**
  - The set id TCGdex will use is a guess. A different id is handled by the rename step.
  - If TCGdex names the set differently, a second set appears beside this one. The fix is a one-time merge by hand.
- **Images:** card art comes through the image tier like any other card's; until it has some, the tiles show the placeholder. The scanner finds these cards by name and number until their art is indexed.
- **Legality:** the regulation mark is copied, so the app's own legality rules (`deck/formats.ts`) decide. The `legal_*` upstream mirror columns are false, as TCGdex leaves them for its McDonald's sets.
- **After takeover:** delete the entry from `SUPPLEMENT_SETS`. If TCGdex's printings carry no TCGplayer id, the link pass relinks them by number.
- **Unchanged:** no migration, secret or variable is needed.
- **Verified:**
  - Pure tests cover the list (`apps/sync/src/catalog/__tests__/supplements.test.ts`).
  - A real-Postgres CI case (`apps/api/src/__integration__/supplementSets.mjs`) covers the copies, idempotence, and a real `importCatalog` run re-keying the rows in place.
