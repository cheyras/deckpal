# Price history: tiered retention and rollup

**Status:** IMPLEMENTED on branch `prices/retention-tiers` (2026-08-29). All eleven
work items are done; done gates 1 and 7 pass. Gates 2-6 are live-database and browser
gates that CANNOT be run from the implementing machine (no Postgres, no Docker, no
`psql`; the live credentials live in repo secrets) — they are owed to a human and the
rollup workflow ships with its cron commented out for exactly that reason.

In place of them the entire pipeline was executed against a REAL Postgres 18 engine
(PGlite/WASM): migration 048 applied verbatim, ~1,500 synthetic observations across 24
months, then the shipped `runRollup`, the shipped reader SQL *extracted from
`cards.ts` so it cannot drift from what production runs*, and the shipped
`backfillValuePoints`. Bucket values were checked against an independent JavaScript
computation rather than against the SQL that produced them. See "What the harness
proved" at the end of this file.

Written 2026-08-29, while the two-year Pokémon price backfill (~2.5 GB) was finishing.

Contracts this plan leans on: **B4** (new migration file, never edit 007), **B8**
(the rollup is idempotent and resumable), **B2** (one worker connection, session
port — the verify step uses a TEMP table, which transaction pooling would break),
**B7** (the live-DB verification is a command, not CI), **B9/B12** (the first
history-destroying run is owner-dispatched, verified against live with the QA
account).

## The requirement

Daily price rows forever do not fit the disk. Measured 2026-08-29 against the live
database and a real TCGCSV archive — these are counts, not estimates:

| Fact | Number |
|---|---|
| One archived day, all TCGplayer categories, priced rows | 464,525 |
| Magic / Yu-Gi-Oh / Pokémon per day (raw) | 158,382 / 58,718 / 44,385 |
| Pokémon rows that join to a `card_variant` here | **28,622/day** |
| Storage per `price_observation` row | ~112 bytes → ~3.2 MB/day Pokémon |
| Daily-forever, Pokémon + Magic + Yu-Gi-Oh | **~6.6 GB/year** |
| Supabase Pro includes | 8 GB |
| The two-year Pokémon backfill, finishing today | ~2.5 GB |

The owner intends to add Magic (~103k matched variants/day, 3.6x Pokémon) and more
TCGs after that. Daily-forever is dead on arrival; the question is what shape the
old data keeps.

## The decided design — specified here, not re-opened

Tiered retention by age. Each non-daily bucket stores the **shape** of its period,
not a closing value:

- last ~30 days: daily rows, as today
- ~30 days to ~6 months: weekly buckets
- beyond ~6 months: monthly buckets
- each bucket: `open, high, low, close, high_on, low_on, mean, median, n_obs`

Evidence, measured over 633,431 real weekly buckets (>=6 observations, >$0.50):

- **Close alone misleads 46.8% of the time** — that fraction of weeks close at or
  near an extreme of their own range. This is the core justification for OHLC.
- Average intra-week range is 4.2% of close; 11.0% of weeks swing >10%; 2.5% >25%.
- Mean and median diverge >5% in only 1.9% of weekly buckets — median earns its
  column monthly, where longer periods let one spike-day distort the mean more.
- **`corr(stddev, high-low) = 0.9878`** — a stored variance column would be
  redundant with the range. Volatility is DERIVED on read (Parkinson or
  Garman-Klass from OHLC), never stored. This is the Parkinson (1980) result: the
  range is a *more* efficient volatility estimator than close-to-close sampling,
  so OHLC buckets measure volatility better per byte than daily closes do.
- Observations are daily and evenly spaced, so the arithmetic mean IS the
  time-weighted mean. **VWAP is impossible: TCGCSV supplies no volume.** Recorded
  so nobody rediscovers either fact.

Buckets aggregate **`market_minor` only**. It is the one metric every consumer
reads — the price chart (`cards.ts:351`), the value rule (`valueSnapshot.ts:72`),
and Cardmarket maps its headline `trend` into it (`cardmarket.ts:28`), so EUR
series are covered too. The other eight metrics live on in the 30-day daily window
and in `price_current`; bucketing all nine would multiply storage ~9x for columns
nothing reads historically. They are deliberately lost with the partition.

## Where the code is today

- `packages/db/src/migrations/007_pricing.sql:45-64` — `price_observation`,
  PK `(card_variant_id, source_code, currency_code, captured_at)`, RANGE-partitioned
  by month; `:69-83` seeds two partitions with BRIN + fillfactor 100; `:66-67`
  says NO DEFAULT partition, a missing partition must ERROR; `:90` REVOKEs
  UPDATE/DELETE (append-only as a grant — DDL by the owner, i.e. DETACH/DROP, is
  untouched by it, per the caveat at `:86-89`).
- `apps/sync/src/prices/db.ts:71-89` — `ensureObservationPartition` creates a
  month idempotently; `:100-139` `appendObservations` is ON CONFLICT DO NOTHING on
  the natural PK (B8); `:16` `PriceJob` union; `:58-67` advisory lock helpers.
- `apps/sync/src/prices/backfill.ts:98-110` — `alreadyIngestedDays` decides what a
  replay skips by looking at `price_observation` ONLY. After a partition drop this
  would re-download and resurrect the month; item 3 closes that hole.
- `apps/sync/src/prices/archive.ts:371` — `archiveCapturedAt` files archive rows at
  midnight UTC, so a live day and a replayed day coexist under different
  `captured_at`; every reader (and the rollup) must group by day first.
- `apps/sync/src/jobs/valueSnapshot.ts:160-277` — `backfillValuePoints`
  reconstructs past collection value from `price_observation` as-of a day, gated by
  `maxPriceStalenessDays ?? 2` (`:164`, gate at `:190-204`). Past the daily window
  every older day gets skipped; item 7 makes the gate grain-aware.
- `apps/api/src/routes/cards.ts:14-16` — `PRICE_RANGES` (`30d…2y`) and intervals;
  `:320-388` `GET /cards/:cardId/prices`, grouped by day via
  `to_char(po.captured_at,'YYYY-MM-DD')` + `max(po.market_minor)` (`:344-345`),
  window filter at `:353`. Response: `{currency, range, series:[{variantId, kind,
  displayName, tier, points:[{date, value}]}]}`.
- `apps/web/src/lib/api.ts:492-501` — `CardPriceHistoryResponse`, the shape the
  Price tab chart consumes.
- `.github/workflows/price-refresh.yml`, `price-backfill.yml` — the cron and the
  self-chaining replay (green as of 2026-08-29; five repo secrets).
- Migrations run 001–047 (`047_playable_fingerprint_index.sql` is the highest), so
  the new migration is **048**. (`variant-scoped-decks.md` still claims 034 for
  itself; 034 shipped as `bug_report_kind` — that plan's number is stale, not a
  free slot.)

## The design, pinned down

### The bucket table (migration `048_price_bucket.sql`)

```sql
CREATE TABLE price_bucket (
  card_variant_id INTEGER  NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  source_code     SMALLINT NOT NULL REFERENCES price_source(id),  -- same narrow key as price_observation
  currency_code   CHAR(3)  NOT NULL REFERENCES currency(code),
  grain           TEXT     NOT NULL CHECK (grain IN ('week','month')),
  bucket_start    DATE     NOT NULL,
  open_minor      INTEGER  NOT NULL CHECK (open_minor   > 0),
  high_minor      INTEGER  NOT NULL,
  low_minor       INTEGER  NOT NULL CHECK (low_minor    > 0),
  close_minor     INTEGER  NOT NULL CHECK (close_minor  > 0),
  high_on         DATE     NOT NULL,
  low_on          DATE     NOT NULL,
  mean_minor      INTEGER  NOT NULL CHECK (mean_minor   > 0),
  median_minor    INTEGER  NOT NULL CHECK (median_minor > 0),
  n_obs           SMALLINT NOT NULL CHECK (n_obs > 0),   -- distinct days observed, <= 31
  CHECK (high_minor >= low_minor),
  CHECK (open_minor  BETWEEN low_minor AND high_minor),
  CHECK (close_minor BETWEEN low_minor AND high_minor),
  CHECK (high_on >= bucket_start AND low_on >= bucket_start),
  CHECK (grain <> 'week'  OR extract(isodow FROM bucket_start) = 1),  -- ISO weeks, Monday
  CHECK (grain <> 'month' OR extract(day    FROM bucket_start) = 1),
  PRIMARY KEY (card_variant_id, source_code, currency_code, grain, bucket_start)
) PARTITION BY LIST (grain);

-- month grain is FOREVER: a plain partition, never retired.
CREATE TABLE price_bucket_month PARTITION OF price_bucket FOR VALUES IN ('month');
CREATE INDEX price_bucket_month_start ON price_bucket_month (bucket_start);

-- week grain is retired past ~6 months by DROPPING a quarterly sub-partition —
-- the same DROP-not-DELETE idiom as price_observation. NO DEFAULT partition:
-- a missing quarter must ERROR, not swallow rows (007's stance, kept).
CREATE TABLE price_bucket_week PARTITION OF price_bucket FOR VALUES IN ('week')
  PARTITION BY RANGE (bucket_start);
CREATE TABLE price_bucket_week_2026q3 PARTITION OF price_bucket_week
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE INDEX price_bucket_week_2026q3_start ON price_bucket_week_2026q3 (bucket_start);
```

No REVOKE here, deliberately: unlike `price_observation`, buckets are **derived,
recomputable state** — the rollup upserts them (`ON CONFLICT DO UPDATE`), which is
what makes it re-runnable (B8). The two small `bucket_start` indexes exist for the
reader's grain floors (below) and cost ~nothing.

### How a bucket is computed

Per-day series first — `max(market_minor)` per (variant, source, currency, UTC
day) — exactly the day-grouping the chart already applies (`cards.ts:344-345`),
which also collapses the live-run/archive-replay double rows `archive.ts:371`
permits. Then OHLC over those daily values:

```sql
WITH day AS (
  SELECT card_variant_id, source_code, currency_code,
         (captured_at AT TIME ZONE 'UTC')::date AS d, max(market_minor) AS v
    FROM price_observation
   WHERE market_minor IS NOT NULL AND captured_at >= $1 AND captured_at < $2
   GROUP BY 1,2,3,4
)
INSERT INTO price_bucket (card_variant_id, source_code, currency_code, grain,
                          bucket_start, open_minor, high_minor, low_minor,
                          close_minor, high_on, low_on, mean_minor, median_minor, n_obs)
SELECT card_variant_id, source_code, currency_code, 'week',
       date_trunc('week', d)::date,
       (array_agg(v ORDER BY d))[1],                 -- open: first observed day
       max(v), min(v),
       (array_agg(v ORDER BY d DESC))[1],            -- close: last observed day
       (array_agg(d ORDER BY v DESC, d))[1],         -- high_on: EARLIEST day at the high
       (array_agg(d ORDER BY v ASC,  d))[1],         -- low_on: earliest day at the low
       round(avg(v))::int,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY v))::int,
       count(*)::smallint
  FROM day GROUP BY 1,2,3,5
ON CONFLICT (card_variant_id, source_code, currency_code, grain, bucket_start)
  DO UPDATE SET open_minor = EXCLUDED.open_minor, /* … all nine … */ n_obs = EXCLUDED.n_obs;
```

Month grain: same statement with `date_trunc('month', …)`. **Month buckets are
built from the daily rows, never from week buckets** — a median of weekly medians
is not a median, and month-from-daily is free because both grains are computed in
the same pass, before the same drop.

### Why the daily tier stays in `price_observation`

Considered and rejected: moving daily rows into `price_bucket` as degenerate
`grain='day'` buckets for a uniform table. Rejected because (1) the ingest choke
point (`appendObservations`, `db.ts:100`) would either double-write ~28.6k
rows/day or move wholesale, churning the one path three jobs share; (2) daily rows
carry nine metrics plus `priced_at`/`sync_run_id` provenance a bucket cannot hold,
and the last-30-days window is precisely where consumers want the full metric set;
(3) the retention mechanism this schema was built for — monthly partitions you can
DROP — already lives on `price_observation`. Uniformity is the READER's problem
and is solved there: the endpoint returns every point in one bucket shape, a day
row presenting as `open=high=low=close`, `n=1`.

### The straddle-week invariant — why rollup(M) may drop partition M

ISO weeks straddle month boundaries, so "which rollup owns a week?" must be
pinned: **rollup(M) computes the week buckets for every ISO week whose START falls
in M** (reading the parent table, so a straddler sees its first days of M+1), plus
the month bucket for M. Eligibility: the last day of M is older than
`DAILY_KEEP_DAYS` (30) — in practice rollup(M) runs at the start of M+2, when
M+1's first six days (the tail of M's last straddling week) are all still present,
because partition M+1 is not dropped until rollup(M+1) a month later. Months are
processed oldest-first, so the invariant holds by induction:

> Partition M is dropped only when its month bucket exists and every ISO week
> overlapping M has been bucketed — the weeks starting in M by this run, the week
> reaching back into M-1 by last month's run.

One refinement for the initial two-year catch-up: rollup(M) skips week-bucket
creation when M's quarter is already older than the weekly band (~6 months) —
those weeks would be quarter-dropped immediately. Such months get month grain only.

### Verify BEFORE drop — the highest-risk step

The source is about to be destroyed, so "the job ran" is not proof. For month M,
in order, all inside one `sync_run` (`job='prices-rollup'`, added to the
`PriceJob` union at `db.ts:16` so `/api/health → syncs` reports it):

1. Upsert both grains (above).
2. **Recompute-and-EXCEPT:** re-run the same aggregation into a TEMP table
   (session-port worker connection, B2), then `stored EXCEPT recomputed` and
   `recomputed EXCEPT stored` over M's month bucket and M-started week buckets —
   both must return zero rows. This proves the buckets are exactly what the
   source says, not merely present.
3. **Conservation:** `sum(n_obs)` over M's month buckets = `count(DISTINCT
   (variant, source, currency, day))` in partition M. A coverage miss (a series
   that got no bucket) cannot hide from this.
4. **No shrink:** on a `--force` recompute, any bucket whose new `n_obs` is lower
   than stored is a FAILURE to investigate (it means source days vanished —
   e.g. a neighbouring partition was dropped out of order), not a value to write.
5. Only then: `ALTER TABLE price_observation DETACH PARTITION
   price_observation_YYYY_MM CONCURRENTLY` (its own statement — it cannot run in a
   transaction; needs PG 14+, plain DETACH is the self-host fallback), then RENAME
   to `…_retired`.
6. **The DROP happens one cycle later:** the next run re-checks the buckets still
   pass step 2 for retired months, then `DROP TABLE`. One month of undo, for the
   cost of one month's extra storage. Any failure at 2–4 aborts with `sync_run`
   status `failed` and the partition untouched; re-running resumes wherever it
   died, because every write is an upsert and every check is re-derivable (B8).

The ultimate backstop: even a wrongly-dropped month is recoverable — TCGCSV's
archives are the durable copy, and `backfill.ts` already replays them.

### How the reader picks a grain

Two cheap floors, from the two small `bucket_start` indexes:

- `day_floor` = `max(bucket_start) + 1 month` over `price_bucket_month` (the first
  month not yet rolled up; NULL → everything is daily).
- `week_floor` = `min(bucket_start)` over `price_bucket_week` (quarters below are
  dropped).

Serve month grain for `[range_start, week_floor)`, week grain for
`[week_floor, day_floor)`, daily for `[day_floor, today]`, UNION ALL, per variant.
Deterministic, self-adjusting as the jobs run, no partition introspection. Known
seam: a week starting in the last rolled month may overlap `day_floor` by up to
six days that are also served daily — a band overlapping a line for one week at
one seam, accepted and documented rather than special-cased.

### Steady-state budget (at ~170k matched rows/day: Pokémon 28.6k + Magic ~103k + YGO remainder)

| Tier | Retention | Rows | Size (~130 B/bucket row incl. index) |
|---|---|---|---|
| daily | ~30–90 days (2 attached months + 1 retired) | ≤ ~15M | ~1.7 GB |
| weekly | until quarter > 6 months (≤ ~39 weeks) | ~6.6M | ~0.9 GB |
| monthly | forever | +2.0M/year | +~0.27 GB/year |

**~2.9 GB steady state, growing ~0.27 GB/year** — versus 6.6 GB/year daily-forever.
Pokémon-only today: ~0.5 GB steady, +45 MB/year, and the finished 2.5 GB backfill
reclaims ~2.2 GB once the catch-up rollup lands. Nothing in the schema or the job
references a TCG: keys are `card_variant`/`price_source`, and the only
Pokémon-specific constant in the pipeline is ingest-side
(`archive.ts:270 POKEMON_CATEGORY`), untouched here. At Magic scale a month's
rollup scans ~5.3M rows — minutes on one worker connection.

## Work items

- [x] **1. Migration `048_price_bucket.sql`** — the DDL above, comments carrying
      the no-DEFAULT-partition and derived-state-so-no-REVOKE rationale. B4: a new
      file; 007 is never touched.
- [x] **2. `apps/sync/src/prices/rollup.ts`** — `eligibleMonths()` (attached
      `price_observation_YYYY_MM` children from `pg_inherits`, last day older than
      `DAILY_KEEP_DAYS`, oldest first), `ensureWeekBucketPartition()` (quarterly,
      mirroring `db.ts:71-89`), `rollupMonth()` implementing compute → verify →
      detach+rename, `dropRetired()` implementing the one-cycle-later drop.
      Retention windows are named constants in this module — not env vars, so no
      B11 surface; if they ever become tunable, `DEPLOYMENT.md` gains the row in
      the same commit.
- [x] **3. Resurrection guard in `backfill.ts`** — `alreadyIngestedDays` (`:98`)
      additionally treats a day as done when a tcgcsv bucket covering it exists;
      otherwise a replay of a rolled-up range re-downloads 30 archives and
      recreates the partition `ensureObservationPartition` will happily rebuild.
      `--force` still overrides, documented as obliging a `rollup --month --force`
      afterwards to re-retire.
- [x] **4. CLI + lock** — `rollup` command in `cli.ts` (`--month`, `--limit`
      default 3, `--dry-run`, `--force`), guarded by
      `tryLock(client, 'prices-rollup')` (`db.ts:58`); refuses to start while a
      backfill run is active.
- [x] **5. Reader** — `cards.ts:320-388` becomes the floors + three-way UNION.
      Every point in one shape:
      `{grain: 'day'|'week'|'month', start, end, open, high, low, close, highOn,
      lowOn, mean, median, n}` — day points have `open=high=low=close`,
      `start=end=highOn=lowOn`, `n=1`. Top level unchanged
      (`{currency, range, series:[…]}`); `PRICE_RANGES` unchanged; `API.md`
      updated.
- [x] **6. Web** — `CardPriceHistoryResponse` (`api.ts:492-501`) and the Price tab
      chart: `close` line plus a high–low band where `grain != 'day'`, and a
      grain caption in the `insightsCaption` spirit ("daily since Jul 30 · weekly
      to Feb · monthly before"). Minimum viable render; candlesticks are not this
      plan.
- [x] **7. Grain-aware value backfill** — `backfillValuePoints`
      (`valueSnapshot.ts:160`): the price source becomes daily observations
      UNIONed with bucket closes filed at the bucket END date, taking only buckets
      whose end <= D (no future-peeking: a mid-week D must not see that week's
      close). The staleness gate (`:164`, `:190-204`) scales with the tier
      covering D: 2 days in the daily band, grain length + 2 beyond it (9 weekly,
      33 monthly). Skip reasons name the grain, so an outage still reads as an
      outage. The nightly diary stays primary; a value point reconstructed in the
      weekly band carries an up-to-9-day-old close, and that is the disclosed cost
      of the tiers, reported in the command output rather than stored.
- [x] **8. Workflow `.github/workflows/price-rollup.yml`** — monthly cron (e.g.
      3rd of the month, after the live ingest has owned the new month) +
      `workflow_dispatch` with `month`/`limit`/`force` inputs; same five repo
      secrets as `price-refresh.yml`, preflight naming any missing ones. **The
      first, two-year catch-up rollup is owner-dispatched** after the backfill
      chain reports complete — a job that destroys data does not get to introduce
      itself on a schedule; the cron is armed after that supervised run is
      verified.
- [x] **9. The agent contract** — the licensing text below goes in the endpoint
      JSDoc now and MUST ship verbatim in any `packages/agent-tools` / MCP tool
      that later exposes price history (none does today; `get_card` serves current
      prices only). Grounded on `grain`, an agent:
      - MAY assert: open/close/high/low/mean/median of a bucket; the exact dates
        and values of the period's high and low (`high_on`/`low_on` are true daily
        facts that survive rollup); trend across buckets; volatility DERIVED from
        OHLC (Parkinson/Garman-Klass).
      - MAY NOT assert: any specific day's price inside a week/month bucket other
        than the two extremes; the path between them; durations ("stayed under $5
        for eleven days"); or a second/third dip or spike within one bucket. Those
        are the things rollup genuinely destroys. "It dipped to $4.00 on the 12th"
        is licensed if and only if `low_on` says the 12th and `low` says $4.00.
- [x] **10. Tests** — pure (no DB; shipped as `deckpal-sync test:pure` and web
      `test:insights`, both already wired into CI, rather than `test:deck`, whose
      glob is the deck engine's own directory): ISO-week attribution
      including straddlers, OHLC/median arithmetic, eligibility and floor
      arithmetic, the day-point degeneration — the `selectDays` precedent
      (`backfill.ts:121`) of extracting the resume/attribution logic pure. Live
      (B7 — commands, not CI): `rollup --dry-run`, the EXCEPT verification, and a
      recorded before/after spot-check of three real series.
- [x] **11. Docs, same sitting (gate 6)** — `DECISIONS.md` entry;
      `research/SCHEMA.md` §7 (new table + retention story); `API.md` (response
      shape); `DEPLOYMENT.md` (workflow table); wiki Data-Layer, Decision-Log,
      Contribution-Record.

## Risks

1. **Dropping the source.** Mitigated by recompute-and-EXCEPT + conservation
   checks before detach, the one-cycle retired grace, oldest-first ordering, and
   TCGCSV's archives as the durable backstop. This is the risk the whole plan is
   arranged around.
2. **Racing the archive backfill.** A rollup during an incomplete replay would
   bake a partial month into buckets and drop the rest. Mitigations: the advisory
   locks, the catch-up being owner-dispatched only after the chain reports
   complete, and steady-state months being live-ingested (complete by
   construction).
3. **Timezone.** Day-bucketing SQL is session-timezone sensitive (noted in
   DECISIONS 2026-08-29 for the existing jobs). The rollup pins
   `AT TIME ZONE 'UTC'`; Actions and Supabase both run UTC; the self-host caveat
   carries over unchanged.
4. **The seam.** Up to six days at the daily/weekly boundary appear both inside
   the last straddling week bucket and as daily points. Cosmetic, documented,
   chosen over a special case in either the writer or the reader.
5. **`--force` after a neighbour dropped.** Recomputing month M's straddler weeks
   after M+1's partition is gone would silently shrink them; the no-shrink
   verification turns that into a loud failure instead.
6. **Web type break.** `CardPriceHistoryResponse` changes shape; API and web ship
   in the same commit, and the endpoint has no third-party consumers today (the
   MCP/agent tools do not read it yet).

## Done gate

1. `pnpm --filter @deckpal/db build`, the workspace `tsc --noEmit`, and
   `pnpm --filter deckpal-api test:deck` (including the new pure rollup tests) all
   clean.
2. Live, oldest month first: `prices rollup --month=… --dry-run`, then the real
   run — verification passes, `sync_run` shows `prices-rollup ok`, the partition
   is detached and renamed, and the next run drops it. Three series' OHLC values
   recorded from daily rows BEFORE the run match their bucket rows after.
3. `GET /cards/:cardId/prices?range=2y` returns mixed grains — month, then week,
   then day — with no gap at either floor, and every non-day point carrying all
   nine bucket fields.
4. `prices snapshot-backfill` for a day in the weekly band WRITES (grain-aware
   gate) instead of skipping with "no price observation within 2 day(s)".
5. Browser, QA account (B12), desktop and 390px: the Price tab draws the close
   line + band across a 2y range, grain caption present, zero console errors.
6. `pg_total_relation_size` totals for `price_observation` + `price_bucket`
   before/after the catch-up rollup are recorded in the DECISIONS entry — the
   reclaim is the deliverable, so it gets measured, not assumed.
7. Docs from item 11 all updated in the same sitting.

## What the harness proved, and what it could not

Gate 1 and gate 7 are DONE. Gates 2-6 need the live database and a browser and are
owed to a human. What follows is what a real Postgres engine confirmed locally, so
that the owed list is a short list of the genuinely un-fakeable things rather than
"everything".

**Proved against real Postgres:**

- Migration 048 applies verbatim, including the `sync_run` `job` CHECK replacement.
- Month and week OHLC exactly match an INDEPENDENT JavaScript computation, over three
  series (two currencies, two sources) with deliberate gaps, a spike, a dip, and a
  duplicated calendar day from a live-run/archive-replay collision.
- Conservation is exact for every month rolled up.
- `DETACH CONCURRENTLY` + rename works; the partition leaves the routing path and the
  `…_retired` table is still readable.
- The one-cycle-later DROP re-verifies and then frees real bytes; nothing retired by a
  run is dropped by that same run.
- Straddling weeks carry their full seven days — i.e. the rollup genuinely reads M+1
  through the parent table.
- The no-shrink guard aborts with the partition untouched and `sync_run` `failed`.
- A missing next-month partition SKIPS that month (run `partial`) instead of writing a
  truncated week or failing the whole run.
- A quarter falling out of the weekly band is DROPPED while month grain survives with
  identical values.
- The reader returns month → week → day with no gap at either floor, correct tiers per
  range chip, degenerate day points, and an all-daily result when nothing is rolled up.
- The value backfill WRITES in the weekly and monthly bands (the regression this item
  exists for) while still refusing a genuine daily-band outage, with the skip message
  naming the tier.
- The two advisory locks are acquired and released. (Their DISTINCTNESS is by
  construction — `hashtext` of two different strings — and was NOT proved by the
  harness, since advisory locks are re-entrant within one session and the probe
  used one connection. Noted rather than overstated.)

**Three real defects the harness found, all invisible to typecheck and the pure tests:**

1. A scope predicate that referenced only `$1` while two parameters were bound — every
   month past the weekly band would have failed on the wire with "bind message supplies
   2 parameters". That is EVERY month of the two-year catch-up.
2. `dropRetired` bound `$1` and `$3` with no `$2` — "could not determine data type of
   parameter $2".
3. The reader served the boundary month at BOTH grains, drawing a whole month twice
   (one wide band under four or five weekly bands). Fixed with a `month_ceiling` hand-off
   so the seam is six days, symmetric with the day-floor seam the plan already accepted.

**A correction to the plan's own design, made while implementing:** the plan anticipated
ONE seam (at `day_floor`). There are TWO. A month bucket and that same month's week
buckets describe the same days at two grains, so the week floor needs a hand-off rule
too. Both are bounded at six days and both resolve as an OVERLAP rather than a gap, on
the principle the plan already chose: a chart with a hole in it reads as missing data.

## The adversarial review round

An independent reviewer (Claude Fable 5, fresh context) was given the diff, the
plan and the harness, and asked to break it. It found eight defects, all fixed
before commit, and confirmed the rest. The two that mattered:

- **`price_bucket` had no RLS** — the only table since 021 without it, on a table
  the rollup makes the only copy of its data, reachable by the `anon` role the
  public price endpoint runs as.
- **The rollup could bury an un-repaired ingest gap permanently and then close the
  repair path**, because every check compares buckets to the partition (blind to
  days never ingested) and the replay guard treated any bucketed day as done.
  Demonstrated end to end.

Also fixed: a straddle-skipped month left a months-long hole in the chart (a
refusal now HALTS the run); `assertStraddleCoverage` checked a partition's
existence rather than its contents; `--limit=0` meant 3; a false comment about a
name assertion (the assertion now exists); a vacuous no-shrink check on the drop
path; and two resumability gaps — an orphaned partition after a kill between
DETACH and RENAME, and an unreachable FINALIZE path — both now adopted on the way
in. `scratchpad/pgverify/guards.ts` proves each fix against real Postgres.

The reviewer independently confirmed: B4 compliance and the CHECK-name choice,
straddle-week ownership as a true partition, OHLC arithmetic against an
independent computation, the order of operations and the absence of any vacuous
pass at rollup time, no parameter mismatches anywhere, timezone pinning, every
reader edge case, the staleness gate's refusal of a real outage and its inability
to future-peek, B2/B8/B9/B11, and no regression to the Insights chart.

**Still owed to a human (gates 2-6):** the supervised catch-up run itself, the live
endpoint returning mixed grains for a real card, a live `snapshot-backfill` in the
weekly band, the browser pass on the QA account at desktop and 390px, and the
before/after `pg_total_relation_size` totals for the DECISIONS entry.
