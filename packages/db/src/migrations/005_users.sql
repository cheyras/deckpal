-- 005 · The user root + 1:1 settings/profile + showcase.
-- SCHEMA §9.1, §9.5. Single-user now, multi-user-ready: every user-owned row carries user_id.

CREATE TABLE app_user (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
  user_id               BIGINT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  default_goal          TEXT NOT NULL DEFAULT 'complete'
                        CHECK (default_goal IN ('complete','master','grandmaster')),
  display_currency      CHAR(3) NOT NULL DEFAULT 'USD' REFERENCES currency(code),
  pricing_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  show_collection_value BOOLEAN NOT NULL DEFAULT TRUE,
  binder_pocket_size    SMALLINT NOT NULL DEFAULT 9 CHECK (binder_pocket_size IN (4,9,12,16)),
  binder_stack_variants BOOLEAN NOT NULL DEFAULT TRUE,
  -- §14.2 ALTER folded: Additional Variants control (Hide | Inline | End)
  binder_additional_variants TEXT NOT NULL DEFAULT 'inline'
                        CHECK (binder_additional_variants IN ('hide','inline','end')),
  enabled_catalogues    TEXT NOT NULL DEFAULT 'en'
);

CREATE TABLE user_profile (
  user_id              BIGINT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  display_name         TEXT,
  bio                  TEXT,
  avatar_path          TEXT,
  banner_path          TEXT,
  joined_on            DATE NOT NULL DEFAULT CURRENT_DATE,
  unique_cards         INTEGER NOT NULL DEFAULT 0,   -- COUNT(DISTINCT card_id) WHERE quantity>0
  unique_card_variants INTEGER NOT NULL DEFAULT 0,   -- COUNT(DISTINCT card_variant_id)
  total_quantity       INTEGER NOT NULL DEFAULT 0,
  trainer_level        INTEGER NOT NULL DEFAULT 0,   -- floor(unique_cards/10), level-0 start (§9.5, D7)
  recomputed_at        TIMESTAMPTZ
);

CREATE TABLE user_showcase (          -- 8 featured slots. Survives Reset Collection.
  user_id         BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  slot            SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 8),
  card_variant_id BIGINT NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, slot)
);
