-- 002 · Closed-vocabulary lookup tables (currencies + the five variant facet axes + print runs)
-- SCHEMA §4.3, §5.4.1, §7.2. Seed values are loaded in 014_seed.sql.
-- These are the "open enum implemented as data" tables: a new value is an INSERT, never DDL.

-- ── currency ────────────────────────────────────────────────────────────────
-- SCHEMA §7.2. Amounts everywhere are stored in MINOR units (integer cents).
CREATE TABLE currency (
  code       CHAR(3) PRIMARY KEY,     -- 'USD','EUR'
  symbol     TEXT NOT NULL,
  minor_unit SMALLINT NOT NULL        -- 2 for USD/EUR, 0 for JPY
);

-- ── variant facet vocabularies (SCHEMA §4.3) ────────────────────────────────
-- EXACTLY the five fields of TCGdex's DetailedVariants GraphQL type: type, subtype,
-- size, stamp, foil. Axis set is provably closed (SCHEMA §4.5.1).

CREATE TABLE variant_finish (       -- TCGdex .type — EXACTLY 5 (§4.5.2)
  code  TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE variant_print_subtype (  -- TCGdex .subtype — 21 measured; 12 are printing errors
  code     TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  is_error BOOLEAN NOT NULL DEFAULT FALSE   -- load-bearing: SCHEMA §5.3(e)
);

CREATE TABLE variant_size (         -- TCGdex .size — EXACTLY 2 (standard, jumbo)
  code  TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE variant_foil (         -- TCGdex .foil — 19 non-null values (§4.5.2)
  code              TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  is_organised_play BOOLEAN NOT NULL DEFAULT FALSE   -- drives tier rule §5.3(d)
);

-- TCGdex 'stamp' is an ARRAY -> junction table (variant_kind_stamp, in 004).
-- 116 distinct values incl. ~45 player names; populated by the catalog sync (open enum).
CREATE TABLE variant_stamp (
  code     TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  category TEXT
);

-- ── print runs (SCHEMA §5.4.1) ───────────────────────────────────────────────
-- The provenance sentence "Found in {printRun} Booster Packs". Base run has NULL label.
CREATE TABLE variant_print_run (
  code       TEXT PRIMARY KEY,       -- 'base' | 'first' | 'shadowless' | 'no-e-reader' | …
  label      TEXT,                   -- 'First Print Run' | … | NULL for base
  is_base    BOOLEAN NOT NULL DEFAULT FALSE,
  provenance TEXT                    -- rendered sentence; NULLABLE (non-booster provenance unobserved, §5.4.1)
);
