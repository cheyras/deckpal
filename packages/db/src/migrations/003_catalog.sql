-- 003 · Catalog: catalogue -> series -> card_set -> card, plus card attribute junctions.
-- SCHEMA §6. All global; no user_id anywhere in this file.

CREATE TABLE catalogue (              -- three-way catalogue partition (EN TCG / JP / TCG Pocket)
  code         TEXT PRIMARY KEY,      -- 'en', 'jp', 'pocket-en'
  label        TEXT NOT NULL,
  route_prefix TEXT NOT NULL,         -- '', '/jp', '/tcg-pocket-en'
  is_enabled   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE series (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalogue_code   TEXT NOT NULL REFERENCES catalogue(code),
  tcgdex_id        TEXT NOT NULL,
  slug             TEXT NOT NULL,      -- 'scarlet-violet'
  name             TEXT NOT NULL,
  first_release_on DATE,
  sort_order       SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (catalogue_code, tcgdex_id),
  UNIQUE (catalogue_code, slug)
);

CREATE TABLE card_set (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series_id           BIGINT NOT NULL REFERENCES series(id) ON DELETE RESTRICT,
  tcgdex_id           TEXT NOT NULL,   -- 'sv3pt5'
  slug                TEXT NOT NULL,   -- '151'
  name                TEXT NOT NULL,
  released_on         DATE,
  card_count_official SMALLINT,        -- printed size (the 165 in "#006/165"). DISPLAY ONLY (§6, C10)
  card_count_total    SMALLINT,        -- TCGdex cardCount.total (207). DISPLAY/health only, NOT a denominator
  -- ⚠ TCGdex cardCount.{normal,holo,reverse,firstEd} are deliberately NOT stored: in 47/214 sets
  --   a per-variant count exceeds the set's card count (base1 normal=346 for 102 cards). (C10)
  ptcgl_code          TEXT,            -- seed from Set.tcgOnline, never trust it (§8.4); authority is ptcgl_set_alias
  tcgplayer_group_id  INTEGER,         -- TCGCSV group (178/218 sets have one)
  is_promo            BOOLEAN NOT NULL DEFAULT FALSE,
  logo_url            TEXT,
  symbol_url          TEXT,
  background_url      TEXT,
  UNIQUE (series_id, tcgdex_id),
  UNIQUE (series_id, slug)
);
COMMENT ON COLUMN card_set.card_count_official IS
  'Printed set size (the 165 in "#006/165"). NEVER a completion denominator — secret rares count toward the main set. SCHEMA §6, BEHAVIOR-SPEC §2.1.';

CREATE TABLE card (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id               BIGINT NOT NULL REFERENCES card_set(id) ON DELETE RESTRICT,
  tcgdex_id            TEXT NOT NULL,        -- 'sv3pt5-6'
  lang                 TEXT NOT NULL DEFAULT 'en',
  local_id             TEXT NOT NULL,        -- OPAQUE collector number: '006','13','SWSH133','TG03'
  local_id_numeric     INTEGER,              -- §8.4 PTCGL join key; NULL when local_id not purely numeric
  number_sort          TEXT NOT NULL,        -- derived collation key (§6, §13 Q1): 'A000006', 'PSWSH0133'
  name                 TEXT NOT NULL,
  name_normalized      TEXT NOT NULL,        -- casefolded, U+2019/U+0027-folded (Farfetch'd, §6)
  category             TEXT NOT NULL CHECK (category IN ('Pokemon','Trainer','Energy')),  -- capture gate
  rarity               TEXT,
  illustrator          TEXT,
  hp                   SMALLINT,
  stage                TEXT,                 -- 'Basic','Stage1','Stage2'
  suffix               TEXT,                 -- 'ex','TAG TEAM-GX','VMAX' (rule-box detection, §8)
  evolve_from          TEXT,
  trainer_type         TEXT,                 -- 'Item','Supporter','Stadium','Tool'
  energy_type          TEXT CHECK (energy_type IS NULL OR energy_type IN ('Normal','Special')),
  retreat              SMALLINT,
  effect               TEXT,
  regulation_mark      CHAR(1),
  legal_standard       BOOLEAN NOT NULL DEFAULT FALSE,   -- upstream-mirror ONLY; NOT the legality predicate (§8.1a)
  legal_expanded       BOOLEAN NOT NULL DEFAULT FALSE,
  -- ── deck/format flags folded from SCHEMA §8.3 ALTER ──────────────────────────
  is_ace_spec          BOOLEAN NOT NULL DEFAULT FALSE,   -- VENDORED (TCGdex has no such field)
  is_radiant           BOOLEAN NOT NULL DEFAULT FALSE,
  is_prism_star        BOOLEAN NOT NULL DEFAULT FALSE,
  has_rule_box         BOOLEAN NOT NULL DEFAULT FALSE,
  playable_fingerprint CHAR(64),             -- SHA-256 reprint-equivalence hash; NULL until full data present
  released_on          DATE,                 -- denormalised from set for the 'Released' sort
  tcgdex_updated_at    TIMESTAMPTZ,
  data_source_lang     TEXT,                 -- provenance stamp; NULL = native
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tcgdex_id, lang),
  UNIQUE (set_id, local_id, lang)
);

-- Multi-valued card attributes as junction tables (identical shape on SQLite; directly indexable).
CREATE TABLE card_type (               -- filter: "Energy Type"
  card_id BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  slot    SMALLINT NOT NULL,
  type    TEXT NOT NULL,
  PRIMARY KEY (card_id, slot)
);
CREATE TABLE card_subtype (            -- filter: "Sub-Type" — ORDER IS SIGNIFICANT
  card_id BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  ord     SMALLINT NOT NULL,
  subtype TEXT NOT NULL,
  PRIMARY KEY (card_id, ord)
);
CREATE TABLE card_tag (                -- chip field on card-detail (e.g. 'Basic'). D8; provisional (§18.4)
  card_id BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  ord     SMALLINT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (card_id, ord)
);
CREATE TABLE card_attack (             -- filter: "Attack Search..."
  card_id BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  ord     SMALLINT NOT NULL,
  name    TEXT NOT NULL,
  damage  TEXT,
  effect  TEXT,
  cost    TEXT,                        -- 'Fire,Fire,Fire' — no child table (nothing filters by cost)
  PRIMARY KEY (card_id, ord)
);
CREATE TABLE card_ability (            -- filter: "Ability Search..."
  card_id BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  ord     SMALLINT NOT NULL,
  kind    TEXT,                        -- 'Ability' | 'Pokemon Power' | 'Poké-Body' …
  name    TEXT NOT NULL,
  effect  TEXT,
  PRIMARY KEY (card_id, ord)
);
CREATE TABLE card_matchup (            -- filters: "Weakness", "Resistance"
  card_id BIGINT NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('weakness','resistance')),
  ord     SMALLINT NOT NULL,
  type    TEXT NOT NULL,
  value   TEXT NOT NULL,               -- '×2', '-30'
  PRIMARY KEY (card_id, kind, ord)
);
