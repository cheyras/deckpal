-- 006 · Sync bookkeeping + image-cache metadata.
-- SCHEMA §15. Created before pricing and dex because price_observation and
-- card_species_conflict reference sync_run(id).

CREATE TABLE sync_run (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job          TEXT NOT NULL CHECK (job IN ('catalog','images','prices-tcgcsv','prices-cardmarket',
                                            'products-tcgcsv','snapshot-collection','reconcile')),
  status       TEXT NOT NULL CHECK (status IN ('running','ok','partial','failed','orphaned','skipped')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  cursor       JSONB,
  source_stamp TEXT,                  -- the skip-if-unchanged key (TCGCSV last-updated.txt, etc.)
  rows_written INTEGER NOT NULL DEFAULT 0,
  items_seen   INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
-- serves skip-if-unchanged lookup and GET /health per-job status (I17)
CREATE INDEX sync_run_last_ok ON sync_run (job, started_at DESC) WHERE status = 'ok';
-- ⚠ DEVIATION (flagged): SCHEMA §15 writes this partial-unique index as
--   "ON sync_run (kind)", but sync_run has no `kind` column — its discriminator is `job`.
--   (`kind` belongs to the separate sync_cursor table.) Corrected to (job) so it applies and
--   actually enforces "one active run per job type" — the schema-level advisory lock.
CREATE UNIQUE INDEX sync_run_one_active ON sync_run (job) WHERE status = 'running';

CREATE TABLE sync_cursor (
  kind                 TEXT NOT NULL,
  scope_key            TEXT NOT NULL,   -- 'set:sv3pt5' | 'group:23237' | 'variant:9931'
  last_attempt_at      TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  consecutive_failures SMALLINT NOT NULL DEFAULT 0,
  cooldown_until       TIMESTAMPTZ,     -- 24h no-price cooldown
  next_offset          TEXT,            -- resume point mid-scope
  PRIMARY KEY (kind, scope_key)
);

CREATE TABLE catalog_change (          -- powers /sync-log (/card-changelog)
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_run_id BIGINT REFERENCES sync_run(id) ON DELETE SET NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('card','card_variant','card_set','card_species')),
  entity_id   TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE image_asset (             -- METADATA ONLY. Bytes live on the filesystem.
  cache_key      TEXT PRIMARY KEY,     -- 'card:sv3pt5-6:large' | 'set:sv3pt5:logo'
  kind           TEXT NOT NULL CHECK (kind IN ('card','set-logo','set-symbol','set-background','sprite','avatar','banner')),
  relative_path  TEXT NOT NULL UNIQUE, -- under the cache root
  content_type   TEXT NOT NULL,
  byte_size      INTEGER NOT NULL CHECK (byte_size > 0),
  source_url     TEXT,
  etag           TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_access_on DATE NOT NULL DEFAULT CURRENT_DATE,   -- DATE (≤1 write/day/asset), for LRU (§15)
  is_pinned      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX image_asset_lru ON image_asset (last_access_on) WHERE NOT is_pinned;
