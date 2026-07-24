-- 007 · Pricing: sources, current snapshot, append-only partitioned history, field map, FX.
-- SCHEMA §7, §11. currency (002), variant_finish (002), card_variant (004), sync_run (006) exist.

CREATE TABLE price_source (
  id               SMALLINT PRIMARY KEY,   -- narrow so the price_observation key stays small
  code             TEXT NOT NULL UNIQUE,   -- 'tcgcsv' | 'tcgdex-tcgplayer' | 'tcgdex-cardmarket'
  label            TEXT NOT NULL,
  marketplace      TEXT NOT NULL,          -- 'tcgplayer' | 'cardmarket'
  default_currency CHAR(3) NOT NULL REFERENCES currency(code),
  is_bulk          BOOLEAN NOT NULL,
  priority         SMALLINT NOT NULL       -- lower wins when both have a price for the same variant
);

-- The source->metric mapping as DATA, so the reverse-holo trap is inspectable with a SELECT (§7.3).
CREATE TABLE price_source_field_map (
  source_code    TEXT NOT NULL REFERENCES price_source(code),
  upstream_field TEXT NOT NULL,            -- 'avg-holo', 'marketPrice', 'subTypeName=Reverse Holofoil'
  target_finish  TEXT NOT NULL REFERENCES variant_finish(code),
  target_metric  TEXT NOT NULL,            -- 'avg' | 'market' | 'low' | 'direct_low' | 'trend' | 'avg1' …
  note           TEXT NOT NULL,
  PRIMARY KEY (source_code, upstream_field)
);

CREATE TABLE price_current (
  card_variant_id  BIGINT  NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  source_code      TEXT    NOT NULL REFERENCES price_source(code),
  currency_code    CHAR(3) NOT NULL REFERENCES currency(code),
  market_minor     INTEGER CHECK (market_minor     > 0),
  low_minor        INTEGER CHECK (low_minor        > 0),
  mid_minor        INTEGER CHECK (mid_minor        > 0),
  high_minor       INTEGER CHECK (high_minor       > 0),
  direct_low_minor INTEGER CHECK (direct_low_minor > 0),
  trend_minor      INTEGER CHECK (trend_minor      > 0),
  avg1_minor       INTEGER CHECK (avg1_minor       > 0),
  avg7_minor       INTEGER CHECK (avg7_minor       > 0),
  avg30_minor      INTEGER CHECK (avg30_minor      > 0),
  priced_at        TIMESTAMPTZ,            -- SOURCE freshness stamp, PER (variant, source) (D9)
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_fallback      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (card_variant_id, source_code, currency_code)
);
-- Absence of a price is a MISSING ROW, not a row of NULLs. The `> 0` CHECKs make a stored zero
-- unrepresentable, so NULL unambiguously means "no price" (rendered N/A). SCHEMA §7.2.

CREATE TABLE price_observation (
  card_variant_id  INTEGER NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,  -- INTEGER: 35,648 variants
  source_code      SMALLINT NOT NULL REFERENCES price_source(id),                    -- SMALLINT, narrow key
  currency_code    CHAR(3) NOT NULL REFERENCES currency(code),
  captured_at      TIMESTAMPTZ NOT NULL,  -- ⚠ THE SOURCE'S OWN STAMP, TRUNCATED — NEVER now(). §7.2
  market_minor     INTEGER CHECK (market_minor     > 0),
  low_minor        INTEGER CHECK (low_minor        > 0),
  mid_minor        INTEGER CHECK (mid_minor        > 0),
  high_minor       INTEGER CHECK (high_minor       > 0),
  direct_low_minor INTEGER CHECK (direct_low_minor > 0),
  trend_minor      INTEGER CHECK (trend_minor      > 0),
  avg1_minor       INTEGER CHECK (avg1_minor       > 0),
  avg7_minor       INTEGER CHECK (avg7_minor       > 0),
  avg30_minor      INTEGER CHECK (avg30_minor      > 0),
  priced_at        TIMESTAMPTZ,
  sync_run_id      BIGINT REFERENCES sync_run(id) ON DELETE SET NULL,
  CHECK (num_nonnulls(market_minor, low_minor, mid_minor, high_minor,
                      direct_low_minor, trend_minor, avg1_minor, avg7_minor, avg30_minor) > 0),
  PRIMARY KEY (card_variant_id, source_code, currency_code, captured_at)
) PARTITION BY RANGE (captured_at);

-- Monthly partitions, created a month ahead by the sync job. NO DEFAULT PARTITION: a missing
-- partition must ERROR, not silently swallow rows (SCHEMA §7.2, DATA-LAYER §4.6).
-- Seeded with the current month and next month so the append path works out of the box.
CREATE TABLE price_observation_2026_07 PARTITION OF price_observation
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
ALTER TABLE price_observation_2026_07 SET (fillfactor = 100,
  autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 100000,
  autovacuum_analyze_scale_factor = 0.02);
CREATE INDEX price_observation_2026_07_brin ON price_observation_2026_07
  USING brin (captured_at) WITH (pages_per_range = 32);

CREATE TABLE price_observation_2026_08 PARTITION OF price_observation
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
ALTER TABLE price_observation_2026_08 SET (fillfactor = 100,
  autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 100000,
  autovacuum_analyze_scale_factor = 0.02);
CREATE INDEX price_observation_2026_08_brin ON price_observation_2026_08
  USING brin (captured_at) WITH (pages_per_range = 32);

-- Append-only, expressed as a grant. SCHEMA §7.2.
-- ⚠ CAVEAT (flagged): the pokedex role OWNS this table, and a table owner's rights are implicit —
--   this REVOKE does NOT stop the owner from UPDATE/DELETE. It only bites a future non-owner app
--   role. True append-only enforcement against the owner would need a BEFORE UPDATE/DELETE trigger
--   (the SQLite path in §16). Kept because it is correct and free for the multi-role future.
REVOKE UPDATE, DELETE ON price_observation FROM pokedex;

CREATE TABLE fx_rate (
  base_code  CHAR(3) NOT NULL REFERENCES currency(code),
  quote_code CHAR(3) NOT NULL REFERENCES currency(code),
  as_of      DATE    NOT NULL,
  rate       NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  source     TEXT NOT NULL,
  PRIMARY KEY (base_code, quote_code, as_of)
);
