// Tiered price retention: roll a month of daily observations up into OHLC
// buckets, PROVE the buckets are exactly what the source says, and only then
// retire the source partition.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Daily price rows forever do not fit the disk. Measured 2026-08-29 against the
// live database: 28,622 Pokémon rows a day that join to a `card_variant`, ~112
// bytes each, and the owner intends to add Magic (~103k matched rows/day, 3.6x
// Pokémon) and more after that. Daily-forever is ~6.6 GB/year against a
// Supabase Pro allowance of 8 GB. The tiers below are ~2.9 GB steady state
// growing ~0.27 GB/year.
//
//   last ~30 days      daily rows in `price_observation`, all nine metrics
//   ~30d to ~6 months  weekly OHLC buckets
//   beyond ~6 months   monthly OHLC buckets, forever
//
// ── Why a bucket rather than a closing value ────────────────────────────────
// Over 633,431 real weekly buckets, 46.8% close AT OR NEAR an extreme of their
// own range — a stored close alone misleads the reader almost half the time.
// See `048_price_bucket.sql` for the rest of the measurement, including why
// there is no variance column (corr(stddev, high-low) = 0.9878) and why there
// can never be a VWAP one (TCGCSV supplies no volume).
//
// ── THE SAFETY ARGUMENT ─────────────────────────────────────────────────────
// This job destroys the source it reads. "The job ran" is not proof, so for
// every month, in order:
//
//   1. snapshot the stored n_obs (so a SHRINK is detectable after the write)
//   2. upsert both grains
//   3. recompute the same aggregation into a TEMP table and EXCEPT it against
//      what is stored, BOTH directions — zero rows each way, or abort
//   4. conservation: sum(n_obs) over the month buckets must equal the number of
//      distinct (variant, source, currency, day) tuples in the partition. A
//      series that got no bucket at all cannot hide from this.
//   5. no shrink: a bucket whose n_obs FELL is a source that vanished under us
//      (a neighbouring partition dropped out of order), which is a failure to
//      investigate rather than a value to write
//   6. DETACH CONCURRENTLY + RENAME to `…_retired`
//   7. the DROP happens ONE RUN LATER (`dropRetired`), re-checking the month
//      bucket against the retired table first. One cycle of undo for the cost
//      of one month's extra storage.
//
// Any failure at 3-5 aborts with the partition untouched and the `sync_run`
// marked `failed`. Re-running resumes wherever it died, because every write is
// an upsert and every check is re-derived from the data (B8).
//
// The ultimate backstop: even a wrongly-dropped month is recoverable, because
// TCGCSV's archives are the durable copy and `backfill.ts` replays them.
//
// ── Contracts ───────────────────────────────────────────────────────────────
// B2  ONE session-port worker connection. The verification uses a TEMP table,
//     which does not survive transaction pooling.
// B4  The DDL is migration 048; 007 is never edited.
// B8  Idempotent and resumable: ON CONFLICT DO UPDATE everywhere, no cursor
//     outside the data itself.
// B11 The retention windows are named constants in THIS MODULE, deliberately
//     not environment variables — so there is no runtime configuration surface
//     to declare or to be silently unset. If they ever become tunable,
//     DEPLOYMENT.md gains the row in the same commit.

import { startRun, finishRun, type Queryable } from './db.js';

// ── Retention windows (constants, not env vars — see B11 note above) ────────

/** Days of DAILY rows kept in `price_observation`. A month is eligible for
 *  rollup once its LAST day is older than this. */
export const DAILY_KEEP_DAYS = 30;

/** Days of WEEKLY buckets kept. A whole quarter is dropped once its last day
 *  falls outside this band — ~6 months, the same DROP-not-DELETE idiom the
 *  daily tier uses for its months. */
export const WEEKLY_KEEP_DAYS = 183;

/** How long a DETACHED partition sits around under its `…_retired` name before
 *  `dropRetired` may remove it. Combined with the rule that `dropRetired` runs
 *  BEFORE this run retires anything, this is the "one cycle of undo". */
export const RETIRED_GRACE_DAYS = 31;

/** Months processed per run when `--month` is not given. */
export const DEFAULT_MONTH_LIMIT = 3;

const DAY_MS = 86_400_000;

// ── Pure date algebra ───────────────────────────────────────────────────────
// Extracted from the SQL for the same reason `selectDays` was (backfill.ts:121):
// this is the attribution and eligibility protocol, its failure mode is silent,
// and it is testable without a database.

/** ISO date `n` days after `iso`, in UTC. Negative `n` goes back. */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a), in UTC. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * The MONDAY of the ISO week containing `iso`.
 *
 * ISO weeks are the grain, and Postgres' `date_trunc('week', …)` agrees
 * (it truncates to Monday) — that agreement is what lets the SQL group and this
 * module attribute without a second opinion. The `CHECK (extract(isodow …) = 1)`
 * in 048 is the third.
 */
export function isoWeekStart(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const back = (new Date(t).getUTCDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  return new Date(t - back * DAY_MS).toISOString().slice(0, 10);
}

/** First day of the month containing `iso`. */
export function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month AFTER `monthStart` — the exclusive upper bound. */
export function nextMonthStart(monthStart: string): string {
  const y = Number(monthStart.slice(0, 4));
  const m = Number(monthStart.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Last day of the month starting at `monthStart`. */
export function monthEnd(monthStart: string): string {
  return addDays(nextMonthStart(monthStart), -1);
}

/**
 * The ISO weeks THIS month owns: every week whose START falls in the month.
 *
 * ── The straddle-week invariant ─────────────────────────────────────────────
 * ISO weeks cross month boundaries, so "which rollup owns a week?" has to be
 * pinned or a straddler is either bucketed twice or not at all. rollup(M) owns
 * every week STARTING in M — which means the last such week reaches up to six
 * days into M+1, and the aggregation therefore reads the PARENT table rather
 * than partition M.
 *
 * That is safe by induction, because months are processed oldest-first and
 * partition M+1 is not detached until rollup(M+1) a month later:
 *
 *   Partition M is dropped only when its month bucket exists and every ISO week
 *   overlapping M has been bucketed — the weeks starting in M by this run, the
 *   week reaching back into M-1 by last month's run.
 *
 * `assertStraddleCoverage` turns the induction hypothesis into a runtime check
 * rather than a comment nobody re-derives.
 */
export function weekStartsIn(monthStart: string): string[] {
  const end = monthEnd(monthStart);
  let d = isoWeekStart(monthStart);
  if (d < monthStart) d = addDays(d, 7); // the week straddling in from M-1 belongs to M-1
  const out: string[] = [];
  for (; d <= end; d = addDays(d, 7)) out.push(d);
  return out;
}

/** The quarterly `price_bucket_week` sub-partition a week START belongs to. */
export function quarterPartition(iso: string): { name: string; from: string; to: string } {
  const y = Number(iso.slice(0, 4));
  const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
  const from = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const to = q === 4 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  return { name: `price_bucket_week_${y}q${q}`, from, to };
}

/**
 * Which months are old enough to roll up — the LAST day of the month must be
 * older than the daily window. Oldest first, because the straddle invariant
 * above depends on that order.
 */
export function selectEligibleMonths(
  months: readonly string[],
  today: string,
  keepDays: number = DAILY_KEEP_DAYS,
): string[] {
  const cutoff = addDays(today, -keepDays);
  return months.filter((m) => monthEnd(m) < cutoff).sort();
}

/**
 * Should rollup(M) bother writing WEEK buckets?
 *
 * No, when M's quarter is already older than the weekly band: those buckets
 * would be created and quarter-dropped in the same breath. Such months get
 * month grain only. This is what keeps the initial two-year catch-up from
 * writing ~6M week rows it would immediately delete — and it is the same
 * predicate `staleWeekQuarters` uses to decide what to drop, so the two cannot
 * disagree about where the band ends.
 */
export function weekGrainApplies(
  monthStart: string,
  today: string,
  weeklyKeepDays: number = WEEKLY_KEEP_DAYS,
): boolean {
  const q = quarterPartition(monthStart);
  return addDays(q.to, -1) >= addDays(today, -weeklyKeepDays);
}

/** Retired partitions old enough to DROP. `retiredThisRun` is never included —
 *  that ordering is the one cycle of undo. */
export function selectDroppableRetired(
  retired: readonly { table: string; month: string }[],
  today: string,
  retiredThisRun: ReadonlySet<string>,
  graceDays: number = RETIRED_GRACE_DAYS,
  keepDays: number = DAILY_KEEP_DAYS,
): { table: string; month: string }[] {
  const cutoff = addDays(today, -(keepDays + graceDays));
  return retired
    .filter((r) => !retiredThisRun.has(r.table) && monthEnd(r.month) < cutoff)
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ── SQL fragments ───────────────────────────────────────────────────────────

/**
 * Per-DAY series first, then OHLC over those daily values.
 *
 * `max(market_minor)` per (variant, source, currency, UTC day) is exactly the
 * day-grouping the price chart already applies (`cards.ts`), which also
 * collapses the live-run/archive-replay double rows `archive.ts` permits: a
 * replayed day is stamped midnight UTC while a live day carries the source's
 * publish time, so the same calendar day legitimately holds two `captured_at`
 * values.
 *
 * `AT TIME ZONE 'UTC'` is not decoration. Day-bucketing SQL is session-timezone
 * sensitive (DECISIONS 2026-08-29 flagged this for the existing jobs); Actions
 * and Supabase both run UTC, and this pins it anyway so a self-host box with a
 * local timezone cannot silently shift every bucket boundary.
 */
function dayCte(source: string): string {
  return `
    SELECT po.card_variant_id, po.source_code, po.currency_code,
           (po.captured_at AT TIME ZONE 'UTC')::date AS d,
           max(po.market_minor) AS v
      FROM ${source} po
     WHERE po.market_minor IS NOT NULL
       AND po.captured_at >= ($1::date AT TIME ZONE 'UTC')
       AND po.captured_at <  ($2::date AT TIME ZONE 'UTC')
     GROUP BY 1, 2, 3, 4`;
}

/**
 * OHLC over the daily series. `grain` is interpolated, never parameterised —
 * it is a `date_trunc` unit, not a value — so it is restricted to the two
 * literals the schema's CHECK admits.
 *
 * MONTH BUCKETS ARE BUILT FROM THE DAILY ROWS, NEVER FROM WEEK BUCKETS: a
 * median of weekly medians is not a median. Both grains are computed in the
 * same pass, from the same source, before the same drop.
 */
function bucketSelect(grain: 'week' | 'month', source: string): string {
  if (grain !== 'week' && grain !== 'month') throw new Error(`bad grain: ${grain as string}`);
  return `
    WITH day AS (${dayCte(source)})
    SELECT card_variant_id, source_code, currency_code,
           '${grain}'::text AS grain,
           date_trunc('${grain}', d)::date AS bucket_start,
           (array_agg(v ORDER BY d))[1]                          AS open_minor,
           max(v)                                                AS high_minor,
           min(v)                                                AS low_minor,
           (array_agg(v ORDER BY d DESC))[1]                     AS close_minor,
           (array_agg(d ORDER BY v DESC, d))[1]                  AS high_on,
           (array_agg(d ORDER BY v ASC,  d))[1]                  AS low_on,
           round(avg(v))::int                                    AS mean_minor,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY v))::numeric)::int AS median_minor,
           count(*)::smallint                                    AS n_obs
      FROM day
     GROUP BY 1, 2, 3, 5`;
}

const BUCKET_COLS = `card_variant_id, source_code, currency_code, grain, bucket_start,
  open_minor, high_minor, low_minor, close_minor, high_on, low_on,
  mean_minor, median_minor, n_obs`;

const UPDATE_SET = [
  'open_minor', 'high_minor', 'low_minor', 'close_minor', 'high_on', 'low_on',
  'mean_minor', 'median_minor', 'n_obs',
].map((c) => `${c} = EXCLUDED.${c}`).join(', ');

// ── Partition introspection ─────────────────────────────────────────────────

export interface ObservationPartition {
  table: string;
  /** First day of the month the partition covers, from its declared bound. */
  month: string;
}

const FROM_BOUND = /FROM\s*\(\s*'(\d{4}-\d{2}-\d{2})/;

/**
 * The ATTACHED monthly children of `price_observation`, keyed by their declared
 * partition bound rather than by their name.
 *
 * The bound is what Postgres routes on; the name is a convention
 * (`ensureObservationPartition`). Reading the bound means a partition someone
 * created by hand with a mismatched name is still handled correctly — and the
 * name pattern is asserted separately, so a mismatch is reported rather than
 * quietly worked around.
 *
 * `inhdetachpending` rows are EXCLUDED: an interrupted `DETACH CONCURRENTLY`
 * leaves the partition half-detached, and treating it as a live partition would
 * roll up a month that is already out of the routing path.
 */
export async function attachedObservationPartitions(
  client: Queryable,
): Promise<ObservationPartition[]> {
  const { rows } = await client.query<{ table_name: string; bound: string; pending: boolean }>(
    `SELECT c.relname AS table_name,
            pg_get_expr(c.relpartbound, c.oid) AS bound,
            i.inhdetachpending AS pending
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'price_observation'
        AND p.relnamespace = 'public'::regnamespace
      ORDER BY 1`,
  );
  const out: ObservationPartition[] = [];
  for (const r of rows) {
    if (r.pending) continue;
    const m = FROM_BOUND.exec(r.bound ?? '');
    if (!m) throw new Error(`cannot read partition bound of ${r.table_name}: ${r.bound}`);
    // The name is interpolated into DETACH and RENAME below, so it is asserted
    // rather than assumed. A partition someone created by hand with an
    // off-convention name is reported here instead of reaching that SQL.
    if (!/^price_observation_\d{4}_\d{2}$/.test(r.table_name)) {
      throw new Error(
        `price_observation has a child named '${r.table_name}', which does not match ` +
        'price_observation_YYYY_MM. The rollup will not build DDL from it. Rename it ' +
        '(the partition bound, not the name, is what routing uses) and re-run.',
      );
    }
    out.push({ table: r.table_name, month: monthStartOf(m[1]!) });
  }
  return out;
}

/**
 * Finish what a killed run started.
 *
 * Two states a resumed run can find, both leaving data intact and neither
 * self-healing:
 *
 *   1. `inhdetachpending` — `DETACH … CONCURRENTLY` was interrupted. Postgres
 *      wants `FINALIZE`, and re-issuing CONCURRENTLY errors. Since
 *      `attachedObservationPartitions` skips pending rows, nothing else would
 *      ever look at it again.
 *   2. Detached but NOT renamed — the process died between the DETACH and the
 *      RENAME. The table is then neither a partition nor a `…_retired` table,
 *      so no later run adopts it, and `ensureObservationPartition`'s
 *      `IF NOT EXISTS` would quietly no-op on the name if that month were ever
 *      re-ingested.
 *
 * Both are safe to complete, because the buckets were verified BEFORE the
 * detach: reaching either state means verification had already passed.
 */
export async function adoptInterruptedDetaches(client: Queryable): Promise<string[]> {
  const done: string[] = [];

  const { rows: pending } = await client.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'price_observation'
        AND p.relnamespace = 'public'::regnamespace
        AND i.inhdetachpending
      ORDER BY 1`,
  );
  for (const r of pending) {
    if (!/^price_observation_\d{4}_\d{2}$/.test(r.table_name)) continue;
    await client.query(`ALTER TABLE price_observation DETACH PARTITION ${r.table_name} FINALIZE`);
    await client.query(`ALTER TABLE ${r.table_name} RENAME TO ${r.table_name}_retired`);
    done.push(`${r.table_name} (finalized + retired)`);
  }

  // Detached, correctly named, but never renamed: a standalone table matching
  // the partition-name convention that is not a child of anything.
  const { rows: orphans } = await client.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind = 'r'
        AND c.relname ~ '^price_observation_[0-9]{4}_[0-9]{2}$'
        AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
      ORDER BY 1`,
  );
  for (const r of orphans) {
    await client.query(`ALTER TABLE ${r.table_name} RENAME TO ${r.table_name}_retired`);
    done.push(`${r.table_name} (retired)`);
  }
  return done;
}

/**
 * Calendar days in the month on which NOTHING was ingested, for any variant.
 *
 * ── Why this gate exists, and why it is not paranoia ───────────────────────
 * Every verification in this file compares the buckets to THE PARTITION. That
 * is the right question for "did the rollup summarise correctly" and completely
 * blind to "was there anything to summarise". A month with an eight-day
 * ingest outage — the exact shape of the 2026-08-08 one — rolls up, verifies
 * perfectly, retires and drops, and the outage becomes permanent: the buckets
 * are the only copy and they never held those days.
 *
 * Worse, it forecloses its own repair. `backfill.ts` treats a bucketed day as
 * ingested, so `price-backfill.yml` — the "ultimate backstop" — would skip
 * exactly the days that need replaying. (That guard is now narrowed to buckets
 * whose `n_obs` covers their whole span, which is the other half of this fix.)
 *
 * So: a month with a hole is REFUSED, by name, with the archive replay as the
 * stated remedy. `--allow-gaps` overrides for the case the operator has
 * already established is an upstream gap TCGCSV never published.
 */
export async function missingIngestDays(
  client: Queryable, monthStart: string, today: string, source = 'price_observation',
): Promise<string[]> {
  const { rows } = await client.query<{ d: string }>(
    // `today` is passed rather than read as CURRENT_DATE: the rollup already
    // takes it as a parameter everywhere else, and a check that silently
    // consults the server clock cannot be exercised deterministically.
    `SELECT to_char(gs::date, 'YYYY-MM-DD') AS d
       FROM generate_series($1::date, $2::date, interval '1 day') gs
      WHERE gs::date <= $3::date
        AND NOT EXISTS (
          SELECT 1 FROM ${source} po
           WHERE po.market_minor IS NOT NULL
             AND po.captured_at >= (gs::date AT TIME ZONE 'UTC')
             AND po.captured_at <  ((gs::date + 1) AT TIME ZONE 'UTC'))
      ORDER BY 1`,
    [monthStart, monthEnd(monthStart), today],
  );
  return rows.map((r) => r.d);
}

/** Detached `price_observation_YYYY_MM_retired` tables awaiting their DROP. */
export async function retiredPartitions(
  client: Queryable,
): Promise<ObservationPartition[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind = 'r'
        AND c.relname ~ '^price_observation_[0-9]{4}_[0-9]{2}_retired$'
      ORDER BY 1`,
  );
  return rows.map((r) => {
    const m = /^price_observation_(\d{4})_(\d{2})_retired$/.exec(r.table_name)!;
    return { table: r.table_name, month: `${m[1]}-${m[2]}-01` };
  });
}

/**
 * The quarterly week-bucket partition for `weekStart`, created idempotently —
 * `ensureObservationPartition`'s shape, one tier up.
 *
 * NO DEFAULT PARTITION exists (048, following 007), so a missing quarter is an
 * ERROR on insert rather than a silent swallow. This is what stops that being
 * the failure mode of a routine run.
 */
export async function ensureWeekBucketPartition(client: Queryable, weekStart: string): Promise<string> {
  const q = quarterPartition(weekStart);
  if (!/^price_bucket_week_\d{4}q[1-4]$/.test(q.name)) {
    throw new Error(`invalid partition identifier: ${q.name}`);
  }
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${q.name} PARTITION OF price_bucket_week
       FOR VALUES FROM ('${q.from}') TO ('${q.to}')`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${q.name}_start ON ${q.name} (bucket_start)`,
  );
  // Postgres does not inherit the parent's policies to a partition reached
  // DIRECTLY by name, so a quarter created at runtime needs its own enable or
  // it is the one writable door into an otherwise read-only table (048).
  await client.query(`ALTER TABLE ${q.name} ENABLE ROW LEVEL SECURITY`);
  await client.query(
    `DO $do$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public' AND tablename = '${q.name}'
                         AND policyname = '${q.name}_read') THEN
         EXECUTE 'CREATE POLICY ${q.name}_read ON ${q.name} FOR SELECT USING (true)';
       END IF;
     END $do$`,
  );
  return q.name;
}

/** Week-grain quarters whose last day has fallen out of the weekly band. */
export async function staleWeekQuarters(
  client: Queryable,
  today: string,
  weeklyKeepDays: number = WEEKLY_KEEP_DAYS,
): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string; bound: string }>(
    `SELECT c.relname AS table_name, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'price_bucket_week'
        AND p.relnamespace = 'public'::regnamespace
      ORDER BY 1`,
  );
  const cutoff = addDays(today, -weeklyKeepDays);
  const stale: string[] = [];
  for (const r of rows) {
    const m = FROM_BOUND.exec(r.bound ?? '');
    if (!m) continue;
    // The quarter's own last day, from its declared bound.
    const q = quarterPartition(m[1]!);
    if (addDays(q.to, -1) < cutoff) stale.push(r.table_name);
  }
  return stale;
}

// ── Verification ────────────────────────────────────────────────────────────

export interface MonthVerification {
  /** `stored EXCEPT recomputed` — must be 0. */
  storedNotRecomputed: number;
  /** `recomputed EXCEPT stored` — must be 0. */
  recomputedNotStored: number;
  /** sum(n_obs) over the month buckets. */
  bucketedDays: number;
  /** distinct (variant, source, currency, day) tuples in the source. */
  observedDays: number;
  /** Buckets whose n_obs FELL against the pre-run snapshot. Must be 0. */
  shrunk: number;
}

export function verificationFailures(v: MonthVerification): string[] {
  const bad: string[] = [];
  if (v.storedNotRecomputed !== 0) {
    bad.push(`${v.storedNotRecomputed} stored bucket(s) the source does not reproduce`);
  }
  if (v.recomputedNotStored !== 0) {
    bad.push(`${v.recomputedNotStored} recomputed bucket(s) missing or different in the table`);
  }
  if (v.bucketedDays !== v.observedDays) {
    bad.push(
      `conservation: buckets account for ${v.bucketedDays} observed day(s) but the ` +
      `partition holds ${v.observedDays} — a series was not bucketed at all`,
    );
  }
  if (v.shrunk !== 0) {
    bad.push(
      `${v.shrunk} bucket(s) SHRANK (n_obs fell) — source days vanished under the ` +
      'recompute, which normally means a neighbouring partition was dropped out of order',
    );
  }
  return bad;
}

// ── The per-month job ───────────────────────────────────────────────────────

export interface RollupMonthOpts {
  /** Report what would be written without writing it, detaching or dropping. */
  dryRun?: boolean;
  /** Overrides `today` for the eligibility/band arithmetic. Tests and dry runs. */
  today?: string;
  /**
   * Roll up a month with days on which NOTHING was ingested.
   *
   * The refusal exists because the rollup makes such a hole permanent AND
   * forecloses its repair. This is the acknowledgement that the missing days
   * are days TCGCSV never published, not days we failed to fetch.
   */
  allowGaps?: boolean;
}

export interface RollupMonthResult {
  month: string;
  /** Days in the month with no observation at all. Non-empty only under
   *  `allowGaps`, or on a dry run, which reports rather than refuses. */
  missingDays: string[];
  /** Whether WEEK buckets were written (false past the weekly band). */
  weekGrain: boolean;
  weekBuckets: number;
  monthBuckets: number;
  verification: MonthVerification | null;
  /** The partition's new name, or null on a dry run. */
  retiredAs: string | null;
}

/**
 * Fail loudly when the days a straddling week needs are not there to be read.
 *
 * The last ISO week starting in M runs up to six days into M+1. The induction
 * in `weekStartsIn` says partition M+1 is still attached at that point — but an
 * induction whose base case nobody re-checks is how a week bucket quietly gets
 * written with three days in it and presented as a week.
 */
async function assertStraddleCoverage(
  client: Queryable, monthStart: string, weeks: readonly string[], today: string,
  allowGaps = false,
): Promise<void> {
  const last = weeks[weeks.length - 1];
  if (!last) return;
  const weekEnd = addDays(last, 6);
  if (weekEnd <= monthEnd(monthStart)) return; // no straddle: the month ended on a Sunday
  const next = nextMonthStart(monthStart);
  const attached = await attachedObservationPartitions(client);
  if (!attached.some((p) => p.month === next)) {
    throw new StraddleCoverageError(
      `its last ISO week (${last}) runs to ${weekEnd}, but no ATTACHED price_observation ` +
      `partition covers ${next}. Bucketing now would record a truncated week as a whole one — ` +
      'and once this month is retired nothing would ever recompute it. Create the partition ' +
      '(or ingest that month) and re-run.',
    );
  }

  // An EXISTING partition is not the same as a PRESENT day. A partition that is
  // there but empty across the straddle — an outage that resumed mid-month, or
  // a partition created ahead of its data — passes the check above and ships a
  // three-day week as a whole one, unrecomputably, because M is retired by the
  // time anyone notices.
  const { rows } = await client.query<{ d: string }>(
    `SELECT to_char(gs::date, 'YYYY-MM-DD') AS d
       FROM generate_series($1::date, $2::date, interval '1 day') gs
      WHERE gs::date <= $3::date
        AND NOT EXISTS (
          SELECT 1 FROM price_observation po
           WHERE po.market_minor IS NOT NULL
             AND po.captured_at >= (gs::date AT TIME ZONE 'UTC')
             AND po.captured_at <  ((gs::date + 1) AT TIME ZONE 'UTC'))
      ORDER BY 1`,
    [next, weekEnd, today],
  );
  // A MISSING PARTITION is structural and never overridable — the days may
  // exist and simply be unreadable. Days that are present-and-empty are the
  // same class of thing as the completeness gate's holes, so the same
  // acknowledgement covers them.
  if (rows.length && !allowGaps) {
    throw new StraddleCoverageError(
      `its last ISO week (${last}) runs to ${weekEnd}, but ${rows.length} day(s) of that week ` +
      `carry no observation at all: ${rows.map((r) => r.d).join(', ')}. Bucketing now would ` +
      'record a short week as a whole one, and retiring this month makes that permanent. ' +
      'Replay those days (prices backfill) and re-run, or pass --allow-gaps if they are ' +
      'days TCGCSV never published.',
    );
  }
}

/**
 * The one refusal that is a SKIP rather than an abort.
 *
 * It means the days a straddling week needs are not readable — which is a
 * statement about ONE month and its neighbour, not about the run. Aborting on
 * it would leave a monthly cron permanently red because of a single gap in the
 * ingest, while the months either side of the gap roll up perfectly well. The
 * run reports `partial` and names the month, so the gap is visible without
 * being fatal.
 */
export class StraddleCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StraddleCoverageError';
  }
}

/**
 * A month with days nobody ever ingested. Like `StraddleCoverageError` this
 * halts the run rather than failing it outright — but unlike it, the remedy is
 * a replay rather than a partition, and the deadline is real: once the month is
 * retired the archive is the only copy left, and once it is DROPPED the replay
 * guard would have to be overridden by hand to get it back.
 */
export class IngestGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestGapError';
  }
}

/** Detach, tolerating both an interrupted previous attempt and a pre-14 server. */
async function detachPartition(client: Queryable, table: string): Promise<void> {
  try {
    await client.query(`ALTER TABLE price_observation DETACH PARTITION ${table} CONCURRENTLY`);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // An interrupted DETACH … CONCURRENTLY leaves the partition half-detached;
    // FINALIZE is the documented way to complete it, and re-issuing
    // CONCURRENTLY on such a partition errors instead.
    if (/detach|finalize/i.test(msg)) {
      await client.query(`ALTER TABLE price_observation DETACH PARTITION ${table} FINALIZE`);
      return;
    }
    // Self-host fallback: CONCURRENTLY needs PG 14+, and cannot run inside a
    // transaction block. Plain DETACH takes a stronger lock and is correct.
    await client.query(`ALTER TABLE price_observation DETACH PARTITION ${table}`);
  }
}

/**
 * Roll one month up, verify it, and retire its partition.
 *
 * The steps are ordered by the safety argument at the top of this file and the
 * order is load-bearing — in particular the n_obs snapshot has to be taken
 * BEFORE the upsert overwrites the values it is compared against.
 */
export async function rollupMonth(
  client: Queryable,
  partition: ObservationPartition,
  opts: RollupMonthOpts = {},
): Promise<RollupMonthResult> {
  const monthStart = partition.month;
  const monthNext = nextMonthStart(monthStart);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const weeks = weekStartsIn(monthStart);
  const doWeeks = weekGrainApplies(monthStart, today);
  const weekFrom = weeks[0]!;
  const weekTo = addDays(weeks[weeks.length - 1]!, 7);

  // Completeness BEFORE correctness. Every other check in this function asks
  // whether the buckets match the partition; none of them can see a day that
  // was never ingested, and this is the last moment at which that day is still
  // repairable.
  const missingDays = await missingIngestDays(client, monthStart, today);
  if (missingDays.length && !opts.allowGaps && !opts.dryRun) {
    throw new IngestGapError(
      `${monthStart} has ${missingDays.length} day(s) with no price observation at all: ` +
      `${missingDays.slice(0, 10).join(', ')}${missingDays.length > 10 ? ' …' : ''}. ` +
      'Rolling it up would bake the hole into the buckets permanently and stop ' +
      '`prices backfill` from ever repairing it. Replay those days first, or pass ' +
      '--allow-gaps if TCGCSV never published them.',
    );
  }

  if (doWeeks) {
    await assertStraddleCoverage(client, monthStart, weeks, today, opts.allowGaps);
    for (const w of weeks) await ensureWeekBucketPartition(client, w);
  }

  // Scope of everything below: this month's month bucket, plus the week buckets
  // whose START is in this month. Written once so the upsert, the EXCEPT and
  // the shrink check cannot drift apart.
  // The scope predicate and the parameters it consumes travel together: a
  // month-only scope references $1 alone, and binding a $2 it never mentions is
  // a wire-protocol ERROR ("bind message supplies 2 parameters"), not a
  // harmless extra. That is the shape of bug that only appears on the months
  // past the weekly band — i.e. only during the two-year catch-up.
  const scope = doWeeks
    ? `((grain = 'month' AND bucket_start = $1::date)
        OR (grain = 'week' AND bucket_start >= $1::date AND bucket_start < $2::date))`
    : `(grain = 'month' AND bucket_start = $1::date)`;
  const scopeParams: unknown[] = doWeeks ? [monthStart, monthNext] : [monthStart];

  await client.query(`DROP TABLE IF EXISTS rollup_prior`);
  await client.query(`DROP TABLE IF EXISTS rollup_recomputed`);

  // 1. Snapshot n_obs BEFORE writing, so step 5 has something to compare to.
  await client.query(
    `CREATE TEMP TABLE rollup_prior AS
       SELECT card_variant_id, source_code, currency_code, grain, bucket_start, n_obs
         FROM price_bucket WHERE ${scope}`,
    scopeParams,
  );

  // 2. Compute. On a dry run the numbers are produced and reported but the
  //    table is never touched — which also means no verification is possible,
  //    and the result says so rather than implying a pass.
  let monthBuckets = 0;
  let weekBuckets = 0;
  if (opts.dryRun) {
    const { rows: mc } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (${bucketSelect('month', 'price_observation')}) b`,
      [monthStart, monthNext],
    );
    monthBuckets = Number(mc[0]!.n);
    if (doWeeks) {
      const { rows: wc } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (${bucketSelect('week', 'price_observation')}) b`,
        [weekFrom, weekTo],
      );
      weekBuckets = Number(wc[0]!.n);
    }
    return {
      month: monthStart, missingDays, weekGrain: doWeeks, weekBuckets, monthBuckets,
      verification: null, retiredAs: null,
    };
  }

  const upsert = (grain: 'week' | 'month', from: string, to: string) =>
    client.query<{ one: number }>(
      `INSERT INTO price_bucket (${BUCKET_COLS})
       SELECT ${BUCKET_COLS} FROM (${bucketSelect(grain, 'price_observation')}) b
       ON CONFLICT (card_variant_id, source_code, currency_code, grain, bucket_start)
         DO UPDATE SET ${UPDATE_SET}
       RETURNING 1 AS one`,
      [from, to],
    );

  monthBuckets = (await upsert('month', monthStart, monthNext)).rows.length;
  if (doWeeks) weekBuckets = (await upsert('week', weekFrom, weekTo)).rows.length;

  // 3-5. Verify against the source that is about to be destroyed.
  const verification = await verifyMonth(client, {
    monthStart, monthNext, weekFrom, weekTo, doWeeks, scope, scopeParams,
    source: 'price_observation', checkShrink: true,
  });
  const failures = verificationFailures(verification);
  if (failures.length) {
    throw new Error(
      `rollup verification FAILED for ${monthStart}; the partition is untouched:\n  - ` +
      failures.join('\n  - '),
    );
  }

  // 6. Only now. DETACH first (the routing change), then RENAME — a partition
  //    renamed while still attached would leave `ensureObservationPartition`
  //    free to create a second partition for the same range and fail.
  const retiredAs = `${partition.table}_retired`;
  await detachPartition(client, partition.table);
  await client.query(`ALTER TABLE ${partition.table} RENAME TO ${retiredAs}`);

  return {
    month: monthStart, missingDays, weekGrain: doWeeks, weekBuckets, monthBuckets,
    verification, retiredAs,
  };
}

/**
 * Recompute-and-EXCEPT, conservation, and the no-shrink check, over one month.
 *
 * `source` is the table the buckets are checked AGAINST: the live parent while
 * the partition is attached, the `…_retired` table itself once it is not.
 */
async function verifyMonth(
  client: Queryable,
  q: {
    monthStart: string; monthNext: string; weekFrom: string; weekTo: string;
    doWeeks: boolean; scope: string; scopeParams?: unknown[]; source: string;
    /** Compare n_obs against the pre-write snapshot. Only the rollup writes. */
    checkShrink?: boolean;
  },
): Promise<MonthVerification> {
  await client.query(`DROP TABLE IF EXISTS rollup_recomputed`);
  await client.query(
    `CREATE TEMP TABLE rollup_recomputed AS
       SELECT ${BUCKET_COLS} FROM (${bucketSelect('month', q.source)}) b`,
    [q.monthStart, q.monthNext],
  );
  if (q.doWeeks) {
    await client.query(
      `INSERT INTO rollup_recomputed (${BUCKET_COLS})
       SELECT ${BUCKET_COLS} FROM (${bucketSelect('week', q.source)}) b`,
      [q.weekFrom, q.weekTo],
    );
  }

  // Set difference BOTH ways. One direction alone proves only half of it: a
  // stored bucket the source no longer reproduces, and a series the source has
  // that got no bucket, are different bugs and both are fatal here.
  const { rows: diff } = await client.query<{ a: string; b: string }>(
    `SELECT
       (SELECT count(*)::text FROM (
          SELECT ${BUCKET_COLS} FROM price_bucket WHERE ${q.scope}
          EXCEPT
          SELECT ${BUCKET_COLS} FROM rollup_recomputed) x) AS a,
       (SELECT count(*)::text FROM (
          SELECT ${BUCKET_COLS} FROM rollup_recomputed
          EXCEPT
          SELECT ${BUCKET_COLS} FROM price_bucket WHERE ${q.scope}) y) AS b`,
    q.scopeParams ?? [q.monthStart, q.monthNext],
  );

  // Conservation. `sum(n_obs)` counts the observed DAYS the buckets claim to
  // summarise; the right-hand side counts the days the source actually holds.
  // A whole series that never got a bucket is invisible to the EXCEPT above
  // (nothing stored, nothing recomputed for it, if the recompute shares the
  // bug) and cannot hide from this.
  const { rows: cons } = await client.query<{ bucketed: string; observed: string }>(
    `SELECT
       (SELECT COALESCE(sum(n_obs), 0)::text FROM price_bucket
         WHERE grain = 'month' AND bucket_start = $1::date) AS bucketed,
       (SELECT count(*)::text FROM (
          SELECT DISTINCT po.card_variant_id, po.source_code, po.currency_code,
                 (po.captured_at AT TIME ZONE 'UTC')::date AS d
            FROM ${q.source} po
           WHERE po.market_minor IS NOT NULL
             AND po.captured_at >= ($1::date AT TIME ZONE 'UTC')
             AND po.captured_at <  ($2::date AT TIME ZONE 'UTC')) z) AS observed`,
    [q.monthStart, q.monthNext],
  );

  // Only meaningful when something was WRITTEN between the snapshot and now.
  // At drop time `rollup_prior` is a copy of the same rows nothing has touched,
  // so the join could only ever return zero — a check that cannot fail reads as
  // protection and is not.
  const shrink = q.checkShrink
    ? (await client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM rollup_prior p
           JOIN price_bucket b USING (card_variant_id, source_code, currency_code, grain, bucket_start)
          WHERE b.n_obs < p.n_obs`,
      )).rows
    : [{ n: '0' }];

  return {
    storedNotRecomputed: Number(diff[0]!.a),
    recomputedNotStored: Number(diff[0]!.b),
    bucketedDays: Number(cons[0]!.bucketed),
    observedDays: Number(cons[0]!.observed),
    shrunk: Number(shrink[0]!.n),
  };
}

// ── The one-cycle-later DROP ────────────────────────────────────────────────

export interface DropResult {
  table: string;
  month: string;
  dropped: boolean;
  reason?: string;
  bytes?: number;
}

/**
 * Drop retired partitions — the LAST irreversible step, and the only one that
 * cannot be undone from inside this database.
 *
 * It re-derives the month bucket from the retired table itself and EXCEPTs it
 * against what is stored. The month bucket is entirely derivable from partition
 * M, so this is a complete re-proof of it; the WEEK buckets starting in M are
 * NOT re-checkable here, because a straddler's last days live in M+1 and this
 * table does not contain them. Weeks fully inside M are included, which is most
 * of them, and the straddler was verified at rollup time against the parent.
 */
export async function dropRetired(
  client: Queryable,
  opts: { today?: string; dryRun?: boolean; retiredThisRun?: ReadonlySet<string> } = {},
): Promise<DropResult[]> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const all = await retiredPartitions(client);
  const due = selectDroppableRetired(all, today, opts.retiredThisRun ?? new Set());
  const out: DropResult[] = [];

  for (const r of due) {
    const monthNext = nextMonthStart(r.month);
    const weeks = weekStartsIn(r.month).filter((w) => addDays(w, 6) <= monthEnd(r.month));

    // Whether to re-verify WEEK buckets is decided by what is STORED, not by
    // what a week's worth of days would produce. Two states are both legitimate
    // and produce no week buckets: a month past the weekly band at rollup time
    // never got any, and a month whose quarter has since been dropped no longer
    // has any. Recomputing weeks in either state would EXCEPT against nothing
    // and fail a partition that is perfectly safe to drop.
    //
    // The one state that is NOT legitimate — the band says weeks should be here
    // and they are not — is turned into a refusal rather than absorbed.
    const lastWhole = weeks[weeks.length - 1];
    const { rows: wk } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM price_bucket
        WHERE grain = 'week' AND bucket_start >= $1::date AND bucket_start <= $2::date`,
      [r.month, lastWhole ?? r.month],
    );
    const storedWeeks = Number(wk[0]!.n);
    if (storedWeeks === 0 && weekGrainApplies(r.month, today) && weeks.length > 0) {
      out.push({
        table: r.table, month: r.month, dropped: false,
        reason: `${r.month} is inside the weekly band but has no week buckets — they were lost ` +
                'rather than retired, and the daily source is the only remaining copy',
      });
      continue;
    }
    const doWeeks = storedWeeks > 0 && weeks.length > 0;
    // Only the weeks whose WHOLE span is inside M. A straddler's last days live
    // in M+1 and this table does not contain them, so re-deriving it here would
    // manufacture the very shrink the check exists to catch.
    // $1 then $2, with no gap: a predicate that mentions $1 and $3 but not $2
    // is "could not determine data type of parameter $2", because Postgres
    // infers a parameter's type from where it is USED and an unused one has
    // nowhere to infer it from.
    const scope = doWeeks
      ? `((grain = 'month' AND bucket_start = $1::date)
          OR (grain = 'week' AND bucket_start >= $1::date AND bucket_start <= $2::date))`
      : `(grain = 'month' AND bucket_start = $1::date)`;
    const scopeParams: unknown[] = doWeeks ? [r.month, lastWhole] : [r.month];

    await client.query(`DROP TABLE IF EXISTS rollup_prior`);
    await client.query(
      `CREATE TEMP TABLE rollup_prior AS
         SELECT card_variant_id, source_code, currency_code, grain, bucket_start, n_obs
           FROM price_bucket WHERE ${scope}`,
      scopeParams,
    );

    const v = await verifyMonth(client, {
      monthStart: r.month, monthNext,
      weekFrom: weeks[0] ?? r.month, weekTo: addDays(weeks[weeks.length - 1] ?? r.month, 7),
      doWeeks, scope, scopeParams, source: r.table,
    });
    const failures = verificationFailures(v);
    if (failures.length) {
      out.push({ table: r.table, month: r.month, dropped: false, reason: failures.join('; ') });
      continue;
    }

    const { rows: sz } = await client.query<{ bytes: string }>(
      `SELECT pg_total_relation_size($1::regclass)::text AS bytes`, [r.table],
    );
    if (!opts.dryRun) await client.query(`DROP TABLE ${r.table}`);
    out.push({ table: r.table, month: r.month, dropped: !opts.dryRun, bytes: Number(sz[0]!.bytes) });
  }
  return out;
}

// ── The whole run ───────────────────────────────────────────────────────────

export interface RollupOpts {
  /** Roll up exactly this month (`YYYY-MM` or `YYYY-MM-DD`), eligible or not. */
  month?: string;
  /** Months per run when `month` is not given. ZERO means none — drops only. */
  limit?: number;
  dryRun?: boolean;
  /** Roll up a month still inside the daily window. Nothing else. */
  force?: boolean;
  /** Proceed past days nobody ever ingested. See `missingIngestDays`. */
  allowGaps?: boolean;
  /** Overrides today's date. Verification harnesses only. */
  today?: string;
}

export interface RollupResult {
  today: string;
  eligible: string[];
  /** Half-finished detaches from a killed run, completed on the way in. */
  adopted: string[];
  months: RollupMonthResult[];
  /** The month this run stopped at, and why. At most one. */
  skipped: { month: string; reason: string }[];
  /**
   * Eligible months this run did NOT attempt because an older one halted it.
   *
   * Not a detail: skipping a month and carrying on would roll up the months
   * AFTER it, which pushes `day_floor` past the skipped month — and the reader
   * serves daily rows only from `day_floor` forward. The skipped month's data
   * would then be in the database and visible at NO grain, a months-long hole
   * in every chart. Halting keeps `day_floor` at the first un-rolled month,
   * which is the invariant the reader silently depends on.
   */
  blocked: string[];
  dropped: DropResult[];
  droppedWeekQuarters: string[];
  /** Total bytes reclaimed by this run's DROPs. The reclaim IS the deliverable. */
  bytesReclaimed: number;
  sizes: { priceObservation: number; priceBucket: number };
}

export async function runRollup(client: Queryable, opts: RollupOpts = {}): Promise<RollupResult> {
  // Day-bucketing and partition bounds are both session-timezone sensitive.
  // Pin it once for the whole run rather than trusting the server's default.
  await client.query(`SET TimeZone TO 'UTC'`);

  // ── Why this job raises its own statement timeout ──────────────────────────
  // Supabase ships `statement_timeout = 2min` on the database role. That is a
  // sensible ceiling for an interactive API query and the wrong one for a
  // monthly maintenance job: the recompute-and-EXCEPT verification over a
  // week-grain month is ~24k variants x 5 weeks and takes longer than that at
  // production scale. Measured 2026-08-30 against the live database, where the
  // catch-up died on 2025-11 with "canceling statement due to statement
  // timeout" — AFTER writing its buckets and BEFORE detaching anything, which
  // is the safe half of the failure but still a job that cannot finish.
  //
  // A finite ceiling rather than 0: a genuinely stuck statement on this
  // connection holds locks against the price ingest, and a run that has hung
  // for half an hour is a run to look at rather than one to wait on. Session
  // scope, on a worker connection (B2), so nothing the API does is affected.
  await client.query(`SET statement_timeout TO '30min'`);

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const runId = opts.dryRun ? null : await startRun(client, 'prices-rollup', today);

  try {
    // Finish any half-done detach from a killed run before reading the
    // partition list — otherwise an interrupted month is invisible to every
    // later run and has to be repaired by hand.
    const adopted = opts.dryRun ? [] : await adoptInterruptedDetaches(client);

    // The DROPs go FIRST, so nothing retired by THIS run can be dropped by it.
    // That ordering is the one cycle of undo; the age rule in
    // `selectDroppableRetired` is the belt to its braces.
    const dropped = await dropRetired(client, { today, dryRun: opts.dryRun });

    const attached = await attachedObservationPartitions(client);
    const byMonth = new Map(attached.map((p) => [p.month, p]));

    const eligible = selectEligibleMonths(attached.map((p) => p.month), today);

    let targets: ObservationPartition[];
    if (opts.month) {
      const m = monthStartOf(opts.month.length === 7 ? `${opts.month}-01` : opts.month);
      const p = byMonth.get(m);
      if (!p) {
        throw new Error(
          `no attached price_observation partition for ${m}. It may already be retired ` +
          '(rolling it up again would recompute from nothing and fail verification), or the ' +
          'month may never have been ingested.',
        );
      }
      // `--force` means "this month, even though it is inside the daily window".
      // Without it a mistyped `--month` could retire the month the app is
      // currently quoting prices from, and every check in this file would pass
      // while doing it: the buckets would be correct, the conservation exact,
      // and the last 30 days of nine-metric daily rows gone anyway.
      if (!eligible.includes(m) && !opts.force) {
        throw new Error(
          `${m} is not eligible: its last day (${monthEnd(m)}) is within the ` +
          `${DAILY_KEEP_DAYS}-day daily window. Rolling it up would retire days the app still ` +
          'serves at daily grain. Pass --force if that is genuinely what you mean.',
        );
      }
      targets = [p];
    } else {
      // `limit: 0` means ZERO, not "use the default". "Drop what is due and
      // retire nothing" is a real thing to want from a job like this, and
      // silently turning it into 3 retires three months of daily rows.
      const limit = opts.limit ?? DEFAULT_MONTH_LIMIT;
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error(`--limit must be a non-negative integer, got ${String(opts.limit)}`);
      }
      targets = eligible.slice(0, limit).map((m) => byMonth.get(m)!);
    }

    const months: RollupMonthResult[] = [];
    const skipped: { month: string; reason: string }[] = [];
    let blocked: string[] = [];
    for (const [i, p] of targets.entries()) {
      try {
        months.push(await rollupMonth(client, p, {
          dryRun: opts.dryRun, today, allowGaps: opts.allowGaps,
        }));
      } catch (err) {
        // Two refusals HALT the run rather than failing it: an unreadable
        // straddle, and a month nobody finished ingesting. Both are about ONE
        // month and its neighbour, so the months already rolled up stay rolled
        // up — but the ones AFTER it are not attempted, because rolling past a
        // gap moves `day_floor` beyond it and hides the skipped month from the
        // reader entirely. Everything else is a real failure and propagates.
        if (!(err instanceof StraddleCoverageError) && !(err instanceof IngestGapError)) throw err;
        skipped.push({ month: p.month, reason: err.message });
        blocked = targets.slice(i + 1).map((t) => t.month);
        break;
      }
    }

    // Week quarters that have fallen out of the weekly band. A DROP, not a
    // DELETE — the same idiom, one tier up.
    const stale = await staleWeekQuarters(client, today);
    if (!opts.dryRun) for (const t of stale) await client.query(`DROP TABLE ${t}`);

    // `pg_total_relation_size` on a PARTITIONED table reports the parent's own
    // (empty) storage and not its children's — the number that matters is the
    // sum over the partition tree. Getting this wrong would report a reclaim of
    // zero bytes on a run that freed gigabytes, and the reclaim IS the
    // deliverable (done gate 6).
    const { rows: sizes } = await client.query<{ obs: string; buck: string }>(
      `SELECT (SELECT COALESCE(sum(pg_total_relation_size(t.relid)), 0)::text
                 FROM pg_partition_tree('price_observation'::regclass) t) AS obs,
              (SELECT COALESCE(sum(pg_total_relation_size(t.relid)), 0)::text
                 FROM pg_partition_tree('price_bucket'::regclass) t)      AS buck`,
    );

    const result: RollupResult = {
      today,
      eligible,
      adopted,
      months,
      skipped,
      blocked,
      dropped,
      droppedWeekQuarters: stale,
      bytesReclaimed: dropped.reduce((n, d) => n + (d.dropped ? d.bytes ?? 0 : 0), 0),
      sizes: { priceObservation: Number(sizes[0]!.obs), priceBucket: Number(sizes[0]!.buck) },
    };

    if (runId != null) {
      const failed = dropped.filter((d) => !d.dropped);
      const degraded = failed.length + skipped.length;
      await finishRun(client, runId, degraded ? 'partial' : 'ok', {
        rowsWritten: months.reduce((n, m) => n + m.monthBuckets + m.weekBuckets, 0),
        itemsSeen: months.length,
        itemsFailed: degraded,
        cursor: {
          adopted,
          months: months.map((m) => m.month),
          skipped: skipped.map((sk) => sk.month),
          blocked,
          retired: months.map((m) => m.retiredAs).filter(Boolean),
          dropped: dropped.filter((d) => d.dropped).map((d) => d.table),
          bytesReclaimed: result.bytesReclaimed,
        },
        error: degraded
          ? [
              ...failed.map((d) => `${d.table}: ${d.reason}`),
              ...skipped.map((sk) => `${sk.month}: ${sk.reason}`),
            ].join(' | ')
          : undefined,
      });
    }
    return result;
  } catch (err) {
    if (runId != null) {
      await finishRun(client, runId, 'failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
