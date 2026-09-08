-- 052 - Retire the third accepted value of card_variant.source and narrow the
-- CHECK back to the two approved catalog sources.
--
-- BACKGROUND. Migration 024 widened `card_variant_source_check` to three values
-- so a batch of locally-synthesized variant rows could be replicated to the
-- cloud. The source those rows were modelled from was subsequently ruled out
-- entirely, on legal grounds, by the owner on 2026-08-26 (research/CARD-ART-
-- SOURCES.md records the ruling). The code, docs and guardrails followed on
-- 2026-08-31; this migration is the schema half.
--
-- 024's header says "the 103 card_variant rows". That count is from 2026-08-22
-- and is stale: production carries NINE such rows today (measured 2026-08-31
-- against prod, read-only). The catalog has been re-imported several times
-- since, and the importer promotes a row in place when TCGdex starts listing
-- the facet, so most of the original 103 have already resolved themselves.
--
--
-- RE-LABEL, NOT DELETE. Both halves of that were decided from the data:
--
--   (a) NONE of the nine duplicates a sibling. `card_variant` carries
--       UNIQUE (card_id, variant_kind_code), so a retired-source row and an
--       approved-source row can never describe the same printing of the same
--       card. Every one of the nine is the ONLY row of its kind for its card.
--       There is nothing to fold into, so "delete the duplicate" has no
--       applicable case here.
--
--   (b) All nine carry user data. Eight have a `collection_item` row (one with
--       quantity 2) and a `collection_event`; one also has a `price_current`
--       row. Every FK into `card_variant` from those tables is ON DELETE
--       CASCADE, so deleting the variants would silently destroy the owner's
--       collection records for nine printings they actually hold. Contract B8
--       ("an import never deletes user data") is about importers, but the
--       principle is the same one, and a schema migration has no better
--       licence to do it.
--
--
-- WHY 'tcgdex' IS THE HONEST RE-LABEL. These rows are not scraped catalog data.
-- Every one has `is_synthesized = true` and was created locally to model a
-- printing the owner holds but TCGdex does not (yet) list:
--
--   card 14157 Mimikyu            Darkness Ablaze 81    holo-stamp-trick-or-trade
--   card 14159 Polteageist        Darkness Ablaze 83    normal-stamp-trick-or-trade
--   card 15504 Phantump           Fusion Strike 16      normal-stamp-trick-or-trade
--   card 17293 Metal Energy       SV Energy 008         holo-foil-cosmos
--   card 22535 Kirlia             Mega Evolution 059    normal-stamp-player-rewards-program
--   card 22550 Lunatone           Mega Evolution 074    normal
--   card 23066 Charmander         Phantasmal Flames 011 normal-stamp-player-rewards-program
--   card 23145 Grimsley's Move    Phantasmal Flames 090 holo-stamp-player-rewards-program
--   card 24194 Mega Greninja ex   Chaos Rising 122      holo
--
-- Every `variant_kind_code` above is composed from TCGdex's OWN facet
-- vocabulary (`variant_print_subtype` / `variant_foil` / `variant_stamp`), and
-- TCGdex already lists several of these exact kinds on sibling cards - card
-- 17293 has a tcgdex `normal-stamp-player-rewards-program`, card 22550 has a
-- tcgdex `holo-foil-cosmos-stamp-player-rewards-program`. So the rows sit in
-- the TCGdex namespace, keyed the way TCGdex keys them, hanging off TCGdex
-- card rows.
--
-- That also makes them RE-VERIFIABLE against the approved source, which is the
-- test that matters. `apps/sync/src/catalog/import.ts` upserts on
-- (card_id, variant_kind_code) and writes source='tcgdex'; the moment TCGdex
-- publishes one of these facets the row is promoted in place, keeping its id
-- and therefore keeping the collection rows attached to it. Until then
-- `is_synthesized = true` is the standing, machine-readable statement that the
-- row was inferred locally rather than read from an upstream payload - which is
-- exactly what the retired `source` value was carrying, minus the name.
--
-- 'tcgcsv' would have been the wrong choice: that value means "cross-filled
-- from TCGplayer product data" (apps/sync/src/prices/crossfill.ts) and eight of
-- the nine have no TCGplayer product id at all.
--
-- No row is at risk of being pruned by the re-label. The catalog importer PARKS
-- retired variants (bumps sort_order past PARK_BASE) and never deletes them,
-- precisely because user tables point at them.
--
--
-- Safe to run once, and re-runnable: the UPDATEs are keyed on the retired value
-- so a second pass matches nothing, and the constraint is dropped IF EXISTS
-- before being re-added.

-- 1. Re-label the rows. is_synthesized / is_primary / sort_order / all
--    TCGplayer and Cardmarket ids are left exactly as they are.
UPDATE card_variant
   SET source = 'tcgdex',
       last_synced_at = now()
 WHERE source = 'pkmn.gg';

-- 2. Scrub the same name out of the free-text provenance column, where it also
--    landed. The fact the note records - that the row was modelled from a
--    printing the owner holds rather than read from a catalog feed - is worth
--    keeping; the name is not, and `is_synthesized` says the same thing in a
--    column something can actually query.
UPDATE card_variant
   SET source_note = 'synthesized to model an owned printing the catalog does not list'
 WHERE source_note LIKE '%pkmn%';

-- 3. Fail loudly rather than let the ALTER below produce a confusing constraint
--    violation, and prove the re-label was complete before narrowing.
DO $$
DECLARE stragglers BIGINT;
BEGIN
  SELECT count(*) INTO stragglers
    FROM card_variant
   WHERE source NOT IN ('tcgdex', 'tcgcsv');
  IF stragglers > 0 THEN
    RAISE EXCEPTION
      'migration 052: % card_variant row(s) still carry a source outside (tcgdex, tcgcsv); '
      'narrowing the CHECK would fail. Inspect them before re-running.', stragglers;
  END IF;
END $$;

-- 4. Narrow the CHECK back to the two approved catalog sources - the state
--    migration 014 originally shipped, and the state migration 024 widened.
ALTER TABLE card_variant DROP CONSTRAINT IF EXISTS card_variant_source_check;

ALTER TABLE card_variant
  ADD CONSTRAINT card_variant_source_check
  CHECK (source IN ('tcgdex', 'tcgcsv'));
