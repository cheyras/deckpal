-- 014 · card_variant provenance for the reverse-holo cross-fill, and a correction to the
--       tcgdex_variant_id identity assumption. Both are forced by the real compiled catalog and
--       by ARCHITECTURE §8.1 (marked RESOLVED after the base migrations were written).
--
-- WHY THIS MIGRATION EXISTS (flagged deviations from research/SCHEMA.md §4.4/§4.6):
--
-- 1. `source` + `fill_confidence` were never declared on card_variant.
--    ARCHITECTURE §8.1 ("Model — now folding into the schema") says card_variant *gains* `source`
--    (tcgdex | tcgcsv) and `fill_confidence`, so the reverse-holo cross-fill (next task) can write a
--    provisional row that a later TCGdex backfill promotes in place. The 004 DDL predates that
--    resolution and omits both columns. The catalog importer is required to set source='tcgdex' on
--    every row, so the column must exist. Added here.
--
-- 2. `tcgdex_variant_id` cannot be UNIQUE — SCHEMA §4.4's premise is false against the data.
--    §4.4 states variantId is "TCGdex's own opaque per-variant id … THIS is the sync idempotency
--    key". Measured over the compiled EN catalog (generated/en/cards.json, 35,648 variant rows):
--        • only 324 DISTINCT variantId values exist (it is a facet-tuple hash, not a per-row id)
--        • one sentinel value "generated" covers 10,296 rows across 9,969 different cards
--        • 331 rows repeat a variantId WITHIN a single card
--    A UNIQUE constraint therefore makes the import impossible after ~324 rows. The real idempotency
--    key is the EXISTING `UNIQUE (card_id, variant_kind_code)` — which is also exactly what the
--    §8.1 cross-fill keys on ("a cross-filled row has tcgdex_variant_id = NULL and keys on the
--    existing UNIQUE (card_id, variant_kind_code)"). Drop the UNIQUE; keep the column as a plain,
--    nullable, non-unique provenance value (NULL on synthesized/cross-filled rows, the upstream
--    hash on TCGdex rows). This makes "tcgdex_variant_id IS NULL" a valid "not from TCGdex" test,
--    per §8.1, and preserves the upstream value without pretending it is a key.

ALTER TABLE card_variant DROP CONSTRAINT card_variant_tcgdex_variant_id_key;

ALTER TABLE card_variant
  ADD COLUMN source TEXT NOT NULL DEFAULT 'tcgdex'
             CHECK (source IN ('tcgdex', 'tcgcsv')),
  ADD COLUMN fill_confidence SMALLINT
             CHECK (fill_confidence IS NULL OR fill_confidence BETWEEN 0 AND 100);

COMMENT ON COLUMN card_variant.source IS
  'Provenance of the row: tcgdex (catalog import) | tcgcsv (reverse-holo cross-fill, next task).
   ARCHITECTURE §8.1. The cross-fill INSERTs with source=tcgcsv and keys on
   UNIQUE (card_id, variant_kind_code); a later TCGdex backfill promotes it to source=tcgdex via
   ON CONFLICT DO UPDATE, preserving id and any attached collection_item.';
COMMENT ON COLUMN card_variant.tcgdex_variant_id IS
  'Upstream variants_detailed[].variantId — a facet-tuple hash, NOT a per-row unique id (only 324
   distinct across 35,648 rows). NULL on synthesized and cross-filled rows. Never a conflict key;
   the idempotency key is UNIQUE (card_id, variant_kind_code). See migration 014 header.';

-- Non-unique lookup index (some diagnostics join by it); intentionally NOT unique.
CREATE INDEX card_variant_tcgdex_variant_id_idx ON card_variant (tcgdex_variant_id)
  WHERE tcgdex_variant_id IS NOT NULL;
