-- 024 · Regularize card_variant source CHECK to include 'pkmn.gg'.
--
-- History: migration 014 shipped CHECK (source IN ('tcgdex','tcgcsv')).
-- The original self-hosted deployment later received an ad-hoc ALTER TABLE
-- that widened the constraint to also accept 'pkmn.gg', but that change was
-- never captured as a migration.  When the database was replicated to the
-- cloud (Supabase), the cloud schema kept the original two-value CHECK from
-- 014, causing INSERT failures for the 103 card_variant rows with
-- source='pkmn.gg' and their dependent price_current / collection_item /
-- collection_event rows.
--
-- This migration drops the old constraint and re-creates it with all three
-- accepted values, bringing both deployments into alignment.

ALTER TABLE card_variant DROP CONSTRAINT card_variant_source_check;

ALTER TABLE card_variant
  ADD CONSTRAINT card_variant_source_check
  CHECK (source IN ('tcgdex', 'tcgcsv', 'pkmn.gg'));
