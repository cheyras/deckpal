-- 020 · Multi-user UUID transformation.
-- Changes app_user.id from BIGINT IDENTITY to UUID and cascades through all
-- FK columns. Adds user_id UUID to deck_version and battle_log for direct RLS
-- without joins (spec section 3, decision D9).
--
-- Works on any Postgres 15+; does NOT reference auth.users (that is 021).
-- When app_user is empty (fresh cloud DB), every USING clause is a no-op.
-- When there IS data (self-host, scratch testing), every existing user gets a
-- stable UUID that propagates consistently via the temporary _map_uid function.

-- ── Phase 0: Build a mapping from old BIGINT ids to new UUIDs ───────────────
CREATE TEMPORARY TABLE _user_id_map (
  old_id BIGINT PRIMARY KEY,
  new_id UUID NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO _user_id_map (old_id) SELECT id FROM app_user;

-- Temporary function wrapping the lookup — ALTER TYPE USING accepts function
-- calls but not subqueries.
CREATE FUNCTION pg_temp._map_uid(old_id BIGINT) RETURNS UUID
  LANGUAGE sql STABLE AS $$
    SELECT new_id FROM _user_id_map m WHERE m.old_id = old_id
  $$;

-- ── Phase 1: Drop dependent views ──────────────────────────────────────────
-- collection_dupe_predicate references collection_item.user_id; PG refuses
-- ALTER COLUMN TYPE while a view depends on the column.
DROP VIEW IF EXISTS collection_dupe_predicate;

-- ── Phase 2: Drop ALL foreign key constraints involving user_id / app_user.id
-- Order: deepest children first, then direct children of app_user(id).

-- card_list composite FK children
ALTER TABLE binder_placement DROP CONSTRAINT binder_placement_card_list_id_user_id_fkey;
ALTER TABLE list_item        DROP CONSTRAINT list_item_list_id_user_id_fkey;

-- Direct children of app_user(id)
ALTER TABLE deck_card              DROP CONSTRAINT deck_card_user_id_fkey;
ALTER TABLE deck                   DROP CONSTRAINT deck_user_id_fkey;
ALTER TABLE card_list              DROP CONSTRAINT card_list_user_id_fkey;
ALTER TABLE user_dex_state         DROP CONSTRAINT user_dex_state_user_id_fkey;
ALTER TABLE collection_value_point DROP CONSTRAINT collection_value_point_user_id_fkey;
ALTER TABLE user_set_progress      DROP CONSTRAINT user_set_progress_user_id_fkey;
ALTER TABLE card_note              DROP CONSTRAINT card_note_user_id_fkey;
ALTER TABLE graded_card            DROP CONSTRAINT graded_card_user_id_fkey;
ALTER TABLE collection_event       DROP CONSTRAINT collection_event_user_id_fkey;
ALTER TABLE collection_item        DROP CONSTRAINT collection_item_user_id_fkey;
ALTER TABLE user_showcase          DROP CONSTRAINT user_showcase_user_id_fkey;
ALTER TABLE user_profile           DROP CONSTRAINT user_profile_user_id_fkey;
ALTER TABLE user_settings          DROP CONSTRAINT user_settings_user_id_fkey;

-- ── Phase 3: Transform app_user.id ──────────────────────────────────────────
ALTER TABLE app_user ALTER COLUMN id DROP IDENTITY;
ALTER TABLE app_user ALTER COLUMN id TYPE UUID USING pg_temp._map_uid(id);
ALTER TABLE app_user ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ── Phase 4: Transform user_id on every per-user table ─────────────────────
-- Indexes and PK/UNIQUE constraints on these columns are automatically rebuilt
-- by PostgreSQL when the column type changes.
ALTER TABLE user_settings ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE user_profile ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE user_showcase ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE collection_item ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE collection_event ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE graded_card ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE card_note ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE user_set_progress ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE collection_value_point ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE user_dex_state ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE card_list ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE list_item ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE binder_placement ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE deck ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);
ALTER TABLE deck_card ALTER COLUMN user_id TYPE UUID
  USING pg_temp._map_uid(user_id);

-- ── Phase 5: Add user_id to deck_version and battle_log (spec D9) ──────────
-- Previously scoped through the deck FK; adding direct user_id for RLS without
-- a join through deck. Populated from the owning deck's (already-UUID) user_id.
ALTER TABLE deck_version ADD COLUMN user_id UUID;
UPDATE deck_version dv SET user_id = d.user_id FROM deck d WHERE d.id = dv.deck_id;
ALTER TABLE deck_version ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE battle_log ADD COLUMN user_id UUID;
UPDATE battle_log bl SET user_id = d.user_id FROM deck d WHERE d.id = bl.deck_id;
ALTER TABLE battle_log ALTER COLUMN user_id SET NOT NULL;

-- ── Phase 6: Recreate foreign key constraints ──────────────────────────────
-- Direct children of app_user(id)
ALTER TABLE user_settings ADD CONSTRAINT user_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE user_profile ADD CONSTRAINT user_profile_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE user_showcase ADD CONSTRAINT user_showcase_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE collection_item ADD CONSTRAINT collection_item_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE collection_event ADD CONSTRAINT collection_event_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE graded_card ADD CONSTRAINT graded_card_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE card_note ADD CONSTRAINT card_note_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE user_set_progress ADD CONSTRAINT user_set_progress_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE collection_value_point ADD CONSTRAINT collection_value_point_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE user_dex_state ADD CONSTRAINT user_dex_state_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE card_list ADD CONSTRAINT card_list_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE deck ADD CONSTRAINT deck_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE deck_card ADD CONSTRAINT deck_card_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;

-- Newly added user_id columns on deck_version and battle_log
ALTER TABLE deck_version ADD CONSTRAINT deck_version_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE battle_log ADD CONSTRAINT battle_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;

-- Composite FKs (card_list children)
ALTER TABLE list_item ADD CONSTRAINT list_item_list_id_user_id_fkey
  FOREIGN KEY (list_id, user_id) REFERENCES card_list(id, user_id) ON DELETE CASCADE;
ALTER TABLE binder_placement ADD CONSTRAINT binder_placement_card_list_id_user_id_fkey
  FOREIGN KEY (card_list_id, user_id) REFERENCES card_list(id, user_id) ON DELETE CASCADE;

-- ── Phase 7: Recreate dependent views ───────────────────────────────────────
CREATE VIEW collection_dupe_predicate AS
SELECT ci.user_id, cv.card_id, SUM(ci.quantity) >= 2 AS is_dupe
FROM collection_item ci JOIN card_variant cv ON cv.id = ci.card_variant_id
GROUP BY ci.user_id, cv.card_id;

-- ── Cleanup ─────────────────────────────────────────────────────────────────
DROP FUNCTION pg_temp._map_uid(BIGINT);
DROP TABLE _user_id_map;
