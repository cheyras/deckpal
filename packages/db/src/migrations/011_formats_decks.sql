-- 011 · Formats-as-data + decks. SCHEMA §8. Format rules are column values, not code branches.

CREATE TABLE format (
  code                    TEXT PRIMARY KEY,     -- 'standard'|'expanded'|'glc'|'unlimited'
  name                    TEXT NOT NULL,
  short_name              TEXT NOT NULL,
  deck_size               SMALLINT NOT NULL DEFAULT 60,
  max_copies_per_name     SMALLINT NOT NULL DEFAULT 4,   -- 1 for GLC
  basic_energy_exempt     BOOLEAN  NOT NULL DEFAULT TRUE,
  max_ace_spec            SMALLINT,             -- 1; 0 for GLC
  max_radiant             SMALLINT,             -- 1; 0 for GLC
  max_prism_star_per_name SMALLINT,             -- 1; 0 for GLC
  require_basic_pokemon   BOOLEAN  NOT NULL DEFAULT TRUE,
  require_single_type     BOOLEAN  NOT NULL DEFAULT FALSE,
  forbid_rule_box         BOOLEAN  NOT NULL DEFAULT FALSE,
  prize_count             SMALLINT NOT NULL DEFAULT 6,
  pool_strategy           TEXT NOT NULL
                          CHECK (pool_strategy IN ('regulation_mark','set_allowance','all')),
  sort_order              SMALLINT NOT NULL,
  source_url              TEXT,
  data_checked_at         TIMESTAMPTZ NOT NULL   -- a hand-maintained table must show its age
);

CREATE TABLE format_regulation_mark (           -- Standard = {H,I,J}; Expanded = {D..J}
  format_code TEXT NOT NULL REFERENCES format(code) ON DELETE CASCADE,
  mark        CHAR(1) NOT NULL,
  legal_from  DATE NOT NULL,
  legal_until DATE,                             -- NULL = still legal; set on rotation
  PRIMARY KEY (format_code, mark)
);

CREATE TABLE format_set_allowance (             -- Expanded's enumerated pre-mark sets; GLC carve-outs
  format_code TEXT NOT NULL REFERENCES format(code) ON DELETE CASCADE,
  set_id      BIGINT NOT NULL REFERENCES card_set(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'allow' CHECK (mode IN ('allow','deny')),
  legal_from  DATE,
  legal_until DATE,
  note        TEXT,
  PRIMARY KEY (format_code, set_id)
);

CREATE TABLE format_promo_allowance (           -- 'Black Star promos, prefix SM, number >= 158'
  format_code   TEXT NOT NULL REFERENCES format(code) ON DELETE CASCADE,
  set_id        BIGINT NOT NULL REFERENCES card_set(id) ON DELETE CASCADE,
  number_prefix TEXT NOT NULL,
  min_number    INTEGER NOT NULL,
  PRIMARY KEY (format_code, set_id, number_prefix)
);

CREATE TABLE format_ban (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  format_code     TEXT NOT NULL REFERENCES format(code) ON DELETE CASCADE,
  scope           TEXT NOT NULL CHECK (scope IN ('print','name')),
  name_normalized TEXT NOT NULL,
  set_id          BIGINT REFERENCES card_set(id),     -- NULL when scope='name'
  local_ids       TEXT[],                             -- NULL = the whole set (the one native array, §16)
  banned_from     DATE NOT NULL,
  lifted_on       DATE,
  source_url      TEXT NOT NULL,
  source_text     TEXT NOT NULL,
  UNIQUE (format_code, name_normalized, set_id, banned_from),
  CHECK ((scope = 'name') = (set_id IS NULL))
);

CREATE TABLE format_exclusive_group (           -- GLC functional-reprint groups (§8.1c)
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  format_code TEXT NOT NULL REFERENCES format(code) ON DELETE CASCADE,
  label       TEXT NOT NULL,                    -- "Boss's Orders / Lysandre"
  max_total   SMALLINT NOT NULL DEFAULT 1,
  source_url  TEXT NOT NULL
);
CREATE TABLE format_exclusive_group_member (
  group_id        BIGINT NOT NULL REFERENCES format_exclusive_group(id) ON DELETE CASCADE,
  name_normalized TEXT NOT NULL,
  PRIMARY KEY (group_id, name_normalized)
);

CREATE TABLE ptcgl_set_alias (                  -- the AUTHORITY for PTCGL codes, not a fallback (§8.4)
  ptcgl_code  TEXT PRIMARY KEY,                 -- 'SVI','MEW','PR-SV','CRZ-GG' (hyphens are real)
  set_id      BIGINT NOT NULL REFERENCES card_set(id) ON DELETE RESTRICT,
  source      TEXT NOT NULL CHECK (source IN ('tcgonline','limitless','manual')),
  verified_at TIMESTAMPTZ
);

CREATE TABLE deck (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  format_code   TEXT   NOT NULL REFERENCES format(code),
  glc_type      TEXT,                           -- GLC's declared single type (11 options)
  name          TEXT NOT NULL,
  description   TEXT,
  cover_card_id BIGINT REFERENCES card(id) ON DELETE SET NULL,
  cover_render  TEXT NOT NULL DEFAULT 'full' CHECK (cover_render IN ('full','art')),
  is_favorite   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((glc_type IS NOT NULL) OR format_code <> 'glc')
);

CREATE TABLE deck_card (               -- keyed on CARD, not (card, variant): deck lists are variant-agnostic
  deck_id  UUID   NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  card_id  BIGINT NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
  user_id  BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  quantity SMALLINT NOT NULL CHECK (quantity BETWEEN 1 AND 60),
  PRIMARY KEY (deck_id, card_id)
);
