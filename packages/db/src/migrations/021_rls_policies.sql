-- @supabase-only
-- 021 · Row-Level Security policies for Supabase Auth.
-- ONLY run on Supabase (or a test DB with auth schema stubs).
-- Self-host deployments skip this migration (the runner checks the marker above).
--
-- Depends on: 020_multi_user_uuid (app_user.id is UUID).
-- Requires: auth.users table, auth.uid() function, authenticated/anon/service_role
-- roles — all provided by Supabase; for scratch testing, create stubs first.
--
-- Performance: auth.uid() is ALWAYS wrapped in (SELECT ...) so the query planner
-- treats it as an initplan constant — benchmarked at ~95% improvement over a bare
-- function call in USING clauses.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Link app_user to Supabase Auth
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE app_user
  ADD CONSTRAINT app_user_auth_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Auto-create app_user + settings + profile on Supabase Auth signup
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.app_user (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    )
  );
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
  INSERT INTO public.user_profile (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CATALOG TABLES — world-readable, service-role-writable
--    (service_role has BYPASSRLS so no write policies needed)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 002 vocabulary ──────────────────────────────────────────────────────────
ALTER TABLE currency ENABLE ROW LEVEL SECURITY;
CREATE POLICY currency_read ON currency FOR SELECT USING (true);

ALTER TABLE variant_finish ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_finish_read ON variant_finish FOR SELECT USING (true);

ALTER TABLE variant_print_subtype ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_print_subtype_read ON variant_print_subtype FOR SELECT USING (true);

ALTER TABLE variant_size ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_size_read ON variant_size FOR SELECT USING (true);

ALTER TABLE variant_foil ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_foil_read ON variant_foil FOR SELECT USING (true);

ALTER TABLE variant_stamp ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_stamp_read ON variant_stamp FOR SELECT USING (true);

ALTER TABLE variant_print_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_print_run_read ON variant_print_run FOR SELECT USING (true);

-- ── 003 catalog ─────────────────────────────────────────────────────────────
ALTER TABLE catalogue ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalogue_read ON catalogue FOR SELECT USING (true);

ALTER TABLE series ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_read ON series FOR SELECT USING (true);

ALTER TABLE card_set ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_set_read ON card_set FOR SELECT USING (true);

ALTER TABLE card ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_read ON card FOR SELECT USING (true);

ALTER TABLE card_type ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_type_read ON card_type FOR SELECT USING (true);

ALTER TABLE card_subtype ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_subtype_read ON card_subtype FOR SELECT USING (true);

ALTER TABLE card_tag ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_tag_read ON card_tag FOR SELECT USING (true);

ALTER TABLE card_attack ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_attack_read ON card_attack FOR SELECT USING (true);

ALTER TABLE card_ability ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_ability_read ON card_ability FOR SELECT USING (true);

ALTER TABLE card_matchup ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_matchup_read ON card_matchup FOR SELECT USING (true);

-- ── 004 variants ────────────────────────────────────────────────────────────
ALTER TABLE variant_kind ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_kind_read ON variant_kind FOR SELECT USING (true);

ALTER TABLE variant_kind_stamp ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_kind_stamp_read ON variant_kind_stamp FOR SELECT USING (true);

ALTER TABLE card_variant ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_variant_read ON card_variant FOR SELECT USING (true);

ALTER TABLE variant_tier_override ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_tier_override_read ON variant_tier_override FOR SELECT USING (true);

-- ── 006 sync ────────────────────────────────────────────────────────────────
ALTER TABLE sync_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_run_read ON sync_run FOR SELECT USING (true);

ALTER TABLE sync_cursor ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_cursor_read ON sync_cursor FOR SELECT USING (true);

ALTER TABLE catalog_change ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_change_read ON catalog_change FOR SELECT USING (true);

ALTER TABLE image_asset ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_asset_read ON image_asset FOR SELECT USING (true);

-- ── 007 pricing ─────────────────────────────────────────────────────────────
ALTER TABLE price_source ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_source_read ON price_source FOR SELECT USING (true);

ALTER TABLE price_source_field_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_source_field_map_read ON price_source_field_map FOR SELECT USING (true);

ALTER TABLE price_current ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_current_read ON price_current FOR SELECT USING (true);

ALTER TABLE price_observation ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_observation_read ON price_observation FOR SELECT USING (true);

ALTER TABLE fx_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY fx_rate_read ON fx_rate FOR SELECT USING (true);

-- ── 008 dex (catalog portion) ───────────────────────────────────────────────
ALTER TABLE dex_species ENABLE ROW LEVEL SECURITY;
CREATE POLICY dex_species_read ON dex_species FOR SELECT USING (true);

ALTER TABLE dex_species_type ENABLE ROW LEVEL SECURITY;
CREATE POLICY dex_species_type_read ON dex_species_type FOR SELECT USING (true);

ALTER TABLE card_species ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_species_read ON card_species FOR SELECT USING (true);

ALTER TABLE card_species_conflict ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_species_conflict_read ON card_species_conflict FOR SELECT USING (true);

-- ── 011 formats ─────────────────────────────────────────────────────────────
ALTER TABLE format ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_read ON format FOR SELECT USING (true);

ALTER TABLE format_regulation_mark ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_regulation_mark_read ON format_regulation_mark FOR SELECT USING (true);

ALTER TABLE format_set_allowance ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_set_allowance_read ON format_set_allowance FOR SELECT USING (true);

ALTER TABLE format_promo_allowance ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_promo_allowance_read ON format_promo_allowance FOR SELECT USING (true);

ALTER TABLE format_ban ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_ban_read ON format_ban FOR SELECT USING (true);

ALTER TABLE format_exclusive_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_exclusive_group_read ON format_exclusive_group FOR SELECT USING (true);

ALTER TABLE format_exclusive_group_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY format_exclusive_group_member_read ON format_exclusive_group_member FOR SELECT USING (true);

ALTER TABLE ptcgl_set_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY ptcgl_set_alias_read ON ptcgl_set_alias FOR SELECT USING (true);

-- ── 016 phash ───────────────────────────────────────────────────────────────
ALTER TABLE card_image_phash ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_image_phash_read ON card_image_phash FOR SELECT USING (true);

-- ── schema_migrations — service_role only (no policies = no access for others)
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. PER-USER TABLES — own rows only (unless noted otherwise)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── app_user: read own row only ─────────────────────────────────────────────
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_user_select ON app_user
  FOR SELECT USING (id = (SELECT auth.uid()));

-- ── user_settings: full CRUD on own row ─────────────────────────────────────
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_settings_own ON user_settings
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── user_profile: public read, own-row update only ──────────────────────────
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_profile_read ON user_profile
  FOR SELECT USING (true);
CREATE POLICY user_profile_update ON user_profile
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── user_showcase: public read, own-row write ───────────────────────────────
ALTER TABLE user_showcase ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_showcase_read ON user_showcase
  FOR SELECT USING (true);
CREATE POLICY user_showcase_insert ON user_showcase
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_showcase_update ON user_showcase
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_showcase_delete ON user_showcase
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ── collection_item: full CRUD on own rows ──────────────────────────────────
ALTER TABLE collection_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_item_own ON collection_item
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── collection_event: own-row read + insert only (append-only) ──────────────
ALTER TABLE collection_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_event_select ON collection_event
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY collection_event_insert ON collection_event
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- ── graded_card: full CRUD on own rows ──────────────────────────────────────
ALTER TABLE graded_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY graded_card_own ON graded_card
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── card_note: full CRUD on own rows ────────────────────────────────────────
ALTER TABLE card_note ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_note_own ON card_note
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── user_set_progress: read own rows; writes are service-role only ──────────
ALTER TABLE user_set_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_set_progress_select ON user_set_progress
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- ── collection_value_point: full CRUD on own rows ───────────────────────────
ALTER TABLE collection_value_point ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_value_point_own ON collection_value_point
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── user_dex_state: full CRUD on own rows ───────────────────────────────────
ALTER TABLE user_dex_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_dex_state_own ON user_dex_state
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── card_list: full CRUD on own rows ────────────────────────────────────────
ALTER TABLE card_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_list_own ON card_list
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── list_item: full CRUD on own rows ────────────────────────────────────────
ALTER TABLE list_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY list_item_own ON list_item
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── binder_placement: full CRUD on own rows ─────────────────────────────────
ALTER TABLE binder_placement ENABLE ROW LEVEL SECURITY;
CREATE POLICY binder_placement_own ON binder_placement
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── deck: full CRUD on own rows ─────────────────────────────────────────────
ALTER TABLE deck ENABLE ROW LEVEL SECURITY;
CREATE POLICY deck_own ON deck
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── deck_card: full CRUD on own rows ────────────────────────────────────────
ALTER TABLE deck_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY deck_card_own ON deck_card
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── deck_version: full CRUD on own rows ─────────────────────────────────────
ALTER TABLE deck_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY deck_version_own ON deck_version
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── battle_log: full CRUD on own rows ───────────────────────────────────────
ALTER TABLE battle_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY battle_log_own ON battle_log
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
