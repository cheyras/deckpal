-- 048 · Price history: tiered retention. The OHLC bucket table the rollup writes.
--
-- SCHEMA §7. `price_observation` (007) keeps the last ~30 days at DAILY grain and
-- is then retired a whole monthly partition at a time; what survives that DROP is
-- the SHAPE of each period, recorded here.
--
-- ── Why a bucket rather than a closing value ────────────────────────────────
-- Measured over 633,431 real weekly buckets (>=6 observations, >$0.50) on
-- 2026-08-29: 46.8% of weeks close AT OR NEAR an extreme of their own range, so a
-- stored close alone misleads the reader almost half the time. Average intra-week
-- range is 4.2% of close; 11.0% of weeks swing >10%.
--
-- No variance column, deliberately: corr(stddev, high-low) = 0.9878 over the same
-- sample, so a stored variance would be a second name for the range. Volatility is
-- DERIVED on read (Parkinson / Garman-Klass from OHLC) — Parkinson (1980) is the
-- reason that is not a compromise: the range is a MORE efficient volatility
-- estimator than close-to-close sampling, so these buckets measure volatility
-- better per byte than the daily closes they replace.
--
-- No VWAP column, ever: TCGCSV supplies no volume. Recorded here so nobody
-- rediscovers its absence and designs around a column that cannot exist.
--
-- ── Why only market_minor ───────────────────────────────────────────────────
-- `market_minor` is the one metric every consumer reads — the price chart, the
-- collection value rule, and Cardmarket's headline `trend` is mapped into it, so
-- the EUR series are covered too. The other eight metrics live on in the 30-day
-- daily window and in `price_current`; bucketing all nine would multiply storage
-- ~9x for columns nothing reads historically. They are deliberately lost with the
-- partition.

CREATE TABLE price_bucket (
  card_variant_id INTEGER  NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  source_code     SMALLINT NOT NULL REFERENCES price_source(id),  -- the same narrow key price_observation uses
  currency_code   CHAR(3)  NOT NULL REFERENCES currency(code),
  grain           TEXT     NOT NULL CHECK (grain IN ('week','month')),
  bucket_start    DATE     NOT NULL,
  open_minor      INTEGER  NOT NULL CHECK (open_minor   > 0),
  high_minor      INTEGER  NOT NULL,
  low_minor       INTEGER  NOT NULL CHECK (low_minor    > 0),
  close_minor     INTEGER  NOT NULL CHECK (close_minor  > 0),
  high_on         DATE     NOT NULL,   -- a TRUE daily fact that survives the rollup
  low_on          DATE     NOT NULL,
  mean_minor      INTEGER  NOT NULL CHECK (mean_minor   > 0),
  median_minor    INTEGER  NOT NULL CHECK (median_minor > 0),
  n_obs           SMALLINT NOT NULL CHECK (n_obs > 0),   -- distinct DAYS observed, <= 31
  CHECK (high_minor >= low_minor),
  CHECK (open_minor  BETWEEN low_minor AND high_minor),
  CHECK (close_minor BETWEEN low_minor AND high_minor),
  CHECK (high_on >= bucket_start AND low_on >= bucket_start),
  CHECK (grain <> 'week'  OR extract(isodow FROM bucket_start) = 1),  -- ISO weeks start Monday
  CHECK (grain <> 'month' OR extract(day    FROM bucket_start) = 1),
  PRIMARY KEY (card_variant_id, source_code, currency_code, grain, bucket_start)
) PARTITION BY LIST (grain);

-- Month grain is FOREVER: a plain partition, never retired. ~2.0M rows/year at the
-- three-TCG scale the owner is heading for, which is ~0.27 GB/year — the whole
-- point of the tiers.
CREATE TABLE price_bucket_month PARTITION OF price_bucket FOR VALUES IN ('month');
CREATE INDEX price_bucket_month_start ON price_bucket_month (bucket_start);

-- Week grain is retired past ~6 months by DROPPING a quarterly sub-partition — the
-- same DROP-not-DELETE idiom `price_observation` uses for its months. Quarters are
-- created idempotently by the rollup (`ensureWeekBucketPartition`), exactly as
-- `ensureObservationPartition` creates months.
--
-- NO DEFAULT PARTITION, matching 007: a missing quarter must ERROR rather than
-- silently swallow rows into a bucket nothing will ever retire.
CREATE TABLE price_bucket_week PARTITION OF price_bucket FOR VALUES IN ('week')
  PARTITION BY RANGE (bucket_start);
CREATE TABLE price_bucket_week_2026q3 PARTITION OF price_bucket_week
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE INDEX price_bucket_week_2026q3_start ON price_bucket_week_2026q3 (bucket_start);

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Every table since 021 carries RLS, and a public catalogue table carries the
-- world-readable, nobody-writable pair. This one is REQUIRED, not decorative:
-- the API serves `/cards/:id/prices` under `SET LOCAL role` = 'anon' /
-- 'authenticated' (apps/api/src/index.ts), and on Supabase those roles hold
-- default CRUD grants on public-schema tables. RLS is the only thing standing
-- between the anon key and this table — and after the rollup has run, this
-- table is the ONLY copy of that history in the database.
--
-- Inline rather than in a separate `_rls` file, and NOT `-- @supabase-only`,
-- following 025: a self-host deployment gets the same enable, where it is
-- harmless (the app connects as the table owner, and an owner bypasses RLS by
-- default) and correct if that ever stops being true.
--
-- Applied to the PARTITIONS as well as the parent, deliberately. Postgres does
-- not inherit a parent's policies to a partition accessed DIRECTLY, so a
-- parent-only enable leaves `price_bucket_month` writable by name. (The same
-- gap exists on `price_observation`'s runtime-created partitions — 021 enables
-- the parent only. Out of scope here; flagged in DECISIONS.md.)
ALTER TABLE price_bucket            ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_bucket_month      ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_bucket_week       ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_bucket_week_2026q3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_bucket_read       ON price_bucket            FOR SELECT USING (true);
CREATE POLICY price_bucket_month_read ON price_bucket_month      FOR SELECT USING (true);
CREATE POLICY price_bucket_week_read  ON price_bucket_week       FOR SELECT USING (true);
CREATE POLICY price_bucket_week_2026q3_read
  ON price_bucket_week_2026q3 FOR SELECT USING (true);

-- ⚠ NO `REVOKE UPDATE, DELETE` here, and that is a decision rather than an
-- oversight. `price_observation` is an OBSERVATION LOG: rewriting a recorded price
-- is falsifying history, so append-only is expressed as a grant there (007:90).
-- A bucket is DERIVED, RECOMPUTABLE state — the rollup upserts it with
-- ON CONFLICT DO UPDATE, which is precisely what makes the job re-runnable and
-- resumable (contract B8). Revoking UPDATE here would forbid the idempotency the
-- job's safety argument rests on.

-- ── The rollup is a sync_run job, so `job` has to admit its name ────────────
-- `sync_run.job` is a CHECK-constrained vocabulary (006), and `/api/health` →
-- `syncs` reports one row per job. A job that cannot INSERT its own sync_run row
-- is a job nobody can see the last outcome of — which for a job that DESTROYS
-- history is not acceptable. B4: 006 is untouched; the constraint is replaced
-- here.
ALTER TABLE sync_run DROP CONSTRAINT IF EXISTS sync_run_job_check;
ALTER TABLE sync_run ADD  CONSTRAINT sync_run_job_check CHECK (job IN (
  'catalog','images','prices-tcgcsv','prices-cardmarket','products-tcgcsv',
  'snapshot-collection','reconcile','prices-rollup'
));
