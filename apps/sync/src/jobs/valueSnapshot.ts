// The daily collection-value snapshot, for EVERY account, in SQL.
//
// ── Why this is not the API endpoint ───────────────────────────────────────
// `POST /insights/value/snapshot` (apps/api/src/routes/insights.ts) does the
// same arithmetic for ONE user — `currentUserId(req)`, i.e. whoever is holding
// the session. That was the whole story when the product had one account. A
// scheduled runner holds a database password and no session, so "whoever is
// signed in" is nobody and it would snapshot nothing at all.
//
// The alternative considered was giving the runner a service credential and
// having it impersonate each account in turn over HTTP. That keeps one copy of
// the value rule, at the cost of building an impersonation path that does not
// exist today — a real security surface, for a diary entry. The owner's call
// (2026-08-29) was the set-based statement below.
//
// ── HOW THE TWO COPIES ARE KEPT HONEST ─────────────────────────────────────
// Not by a unit test: both halves are SQL over the live schema, so a pure test
// could only re-implement the rule a third time. `prices value-parity` runs
// BOTH and diffs them per (user, currency) — B7 keeps live-DB checks out of CI,
// so it is a command you run, not a gate. Verified 2026-08-29: USD 84824 /
// EUR 90659 / 604 unique / 1298 cards, matching the app exactly.
//
// Run it after touching either copy.
//
// ── The rule being copied ──────────────────────────────────────────────────
// `collectionValue.ts` `ownedPriceRows` + `aggregateValue` + `ownedCounts`:
//
//   best(variant, currency) = max(market_minor) across sources, NULLs excluded
//   total_minor(user, currency) = SUM(quantity x best)
//   unique_cards / total_quantity are COLLECTION-WIDE, not per currency —
//     the same pair is written onto every currency row. That looks like a bug
//     and is not: they count cards, which have no currency.
//
// Idempotent per (user, observed_on, currency) exactly as the endpoint is, so a
// double-fire or a manual re-run on the same day inserts nothing.

import type { Queryable } from '../prices/db.js';

export interface ValueSnapshotResult {
  observedOn: string;
  /** Rows actually inserted. 0 on a same-day re-run. */
  inserted: number;
  /** Accounts that got at least one row. */
  users: number;
}

/**
 * `observedOn` is the date the row is filed under. It defaults to CURRENT_DATE;
 * the backfill passes a past date, and `pricesAsOf` then decides WHICH prices
 * are used (see below). Never pass a future date — the PK would accept it and
 * the chart would grow a spike nobody can explain.
 */
export interface SnapshotOpts {
  observedOn?: string | null;
}

/**
 * Today's snapshot, for every account, from `price_current`.
 *
 * `price_current` is the right source here and the wrong one for the backfill:
 * it holds the LATEST price per variant with no history, so it answers "what is
 * it worth now" and cannot answer "what was it worth on the 14th".
 */
export async function snapshotAllUsers(
  client: Queryable,
  opts: SnapshotOpts = {},
): Promise<ValueSnapshotResult> {
  const { rows } = await client.query<{ user_id: string }>(
    `WITH best AS (
       SELECT pc.card_variant_id, upper(btrim(pc.currency_code)) AS currency_code,
              max(pc.market_minor) AS best_minor
         FROM price_current pc
        WHERE pc.market_minor IS NOT NULL
        GROUP BY pc.card_variant_id, upper(btrim(pc.currency_code))
     ),
     owned AS (
       SELECT ci.user_id, ci.card_variant_id, ci.quantity, cv.card_id
         FROM collection_item ci
         JOIN card_variant cv ON cv.id = ci.card_variant_id
        WHERE ci.quantity > 0
     ),
     counts AS (
       SELECT user_id,
              count(DISTINCT card_id)::int AS unique_cards,
              COALESCE(sum(quantity), 0)::int AS total_quantity
         FROM owned GROUP BY user_id
     ),
     totals AS (
       SELECT o.user_id, b.currency_code, sum(o.quantity::bigint * b.best_minor)::bigint AS total_minor
         FROM owned o JOIN best b ON b.card_variant_id = o.card_variant_id
        GROUP BY o.user_id, b.currency_code
     )
     INSERT INTO collection_value_point
       (user_id, observed_on, currency_code, total_minor, unique_cards, total_quantity)
     SELECT t.user_id, COALESCE($1::date, CURRENT_DATE), t.currency_code,
            t.total_minor, c.unique_cards, c.total_quantity
       FROM totals t JOIN counts c ON c.user_id = t.user_id
     ON CONFLICT (user_id, observed_on, currency_code) DO NOTHING
     RETURNING user_id`,
    [opts.observedOn ?? null],
  );

  const { rows: dateRows } = await client.query<{ d: string }>(
    `SELECT to_char(COALESCE($1::date, CURRENT_DATE), 'YYYY-MM-DD') AS d`,
    [opts.observedOn ?? null],
  );

  return {
    observedOn: dateRows[0]!.d,
    inserted: rows.length,
    users: new Set(rows.map((r) => r.user_id)).size,
  };
}

export type PriceGrain = 'day' | 'week' | 'month';

/** How stale a price may be, per tier: the grain's own length, plus the 2 days
 *  the daily band already allowed for a late or missed ingest. */
export const GRAIN_STALENESS: Record<PriceGrain, number> = { day: 2, week: 9, month: 33 };

export interface PriceGrainBands {
  /** First day still held at DAILY grain, or null if nothing is rolled up. */
  dayFloor: string | null;
  /** Oldest day covered by a WEEK bucket, or null if there is no weekly tier. */
  weekFloor: string | null;
}

/**
 * Which price tier covers day `d`, and therefore how stale a price for it may
 * legitimately be.
 *
 * The gate below used to be a flat 2 days, which was right when every day in
 * history had a row of its own. Since the retention tiers landed (migration
 * 048) a day in the weekly band has no price OF ITS OWN by design — the nearest
 * reading is that week's close, up to 9 days back. A flat gate turns that into
 * "no price observation within 2 day(s)" and skips every day past the daily
 * window, which would make `snapshot-backfill` useless for exactly the range it
 * exists to repair.
 *
 * Scaling the gate is NOT the same as loosening it. Within each band the gate
 * still refuses a price older than that band can explain, so a genuine ingest
 * outage still reads as an outage rather than as the tiers doing their job.
 * What the reconstruction loses is DISCLOSED (`BackfillResult.grains`) rather
 * than hidden: a value point rebuilt in the weekly band carries an up-to-9-day
 * old close, and that is the cost of the tiers, not a defect.
 *
 * Pure, and exported, because it is the whole of the new policy.
 */
export function grainForDay(d: string, bands: PriceGrainBands): PriceGrain {
  if (!bands.dayFloor || d >= bands.dayFloor) return 'day';
  if (bands.weekFloor && d >= bands.weekFloor) return 'week';
  return 'month';
}

export interface BackfillOpts {
  from: string;
  to: string;
  /**
   * How stale a price may be and still be used for a given day, in days.
   *
   * This is the honesty knob. Reconstructing a past day needs a price FOR that
   * day; when the nearest earlier reading is older than its own tier can
   * explain, carrying it forward does not recover history, it draws a flat line
   * and calls it market data. Such a day is reported in `skipped`, not written.
   *
   * UNSET is the right setting: the gate is then derived per day from the tier
   * covering it (`GRAIN_STALENESS`) — 2 days in the daily band, 9 in the weekly
   * one, 33 in the monthly one. Setting it pins ONE number across every tier,
   * which is necessarily either too strict for old days or too loose for recent
   * ones.
   */
  maxPriceStalenessDays?: number;
}

export interface BackfillResult {
  days: number;
  inserted: number;
  /** Days that had no price data fresh enough to reconstruct honestly. */
  skipped: { date: string; reason: string }[];
  /**
   * How many days were rebuilt against each tier, and the staleness that tier
   * allows. The disclosed cost of tiered retention — reported, never stored,
   * because the number belongs to the reconstruction rather than to the value.
   */
  grains: { grain: PriceGrain; days: number; maxStaleDays: number }[];
}

/** The two grain floors the API reader uses, read once per run. */
export async function priceGrainBands(client: Queryable): Promise<PriceGrainBands> {
  const { rows: has } = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.price_bucket')::text AS t`,
  );
  if (!has[0]?.t) return { dayFloor: null, weekFloor: null };
  const { rows } = await client.query<{ day_floor: string | null; week_floor: string | null }>(
    `SELECT to_char((SELECT max(bucket_start) + interval '1 month'
                       FROM price_bucket WHERE grain = 'month'), 'YYYY-MM-DD') AS day_floor,
            to_char((SELECT min(bucket_start)
                       FROM price_bucket WHERE grain = 'week'),  'YYYY-MM-DD') AS week_floor`,
  );
  return { dayFloor: rows[0]?.day_floor ?? null, weekFloor: rows[0]?.week_floor ?? null };
}

/**
 * "What was this variant worth as of day D", across both tiers.
 *
 * Daily observations keep their own `captured_at` day. A BUCKET is filed at its
 * END date and contributes its CLOSE — the value that was true at the end of
 * the period — and only when that end is at or before D. That `<= D` is the
 * no-future-peeking rule: a Wednesday in the middle of a week must not be
 * priced off that week's Sunday close, which had not happened yet.
 */
function pricedCte(withBuckets: boolean): string {
  const bucketEnd = `(CASE WHEN b.grain = 'week' THEN b.bucket_start + 6
                          ELSE (b.bucket_start + interval '1 month' - interval '1 day')::date END)`;
  const daily = `
       SELECT po.card_variant_id, po.source_code,
              upper(btrim(po.currency_code)) AS currency_code,
              (po.captured_at AT TIME ZONE 'UTC')::date AS as_of,
              po.market_minor
         FROM price_observation po
        WHERE po.market_minor IS NOT NULL
          AND po.captured_at < ($1::date + 1)
          AND po.captured_at >= ($1::date + 1) - ($2::text || ' days')::interval`;
  if (!withBuckets) return daily;
  return `${daily}
        UNION ALL
       SELECT b.card_variant_id, b.source_code,
              upper(btrim(b.currency_code)) AS currency_code,
              ${bucketEnd} AS as_of,
              b.close_minor AS market_minor
         FROM price_bucket b
        WHERE ${bucketEnd} <= $1::date
          AND ${bucketEnd} >  (($1::date + 1) - ($2::text || ' days')::interval)::date`;
}

/**
 * Reconstruct value points for a past date range from the two append-only
 * ledgers, for every account.
 *
 *   ownership on D = the last `collection_event.quantity_after` per
 *                    (user, variant) at or before the end of D
 *   price on D     = the newest `price_observation` per (variant, source,
 *                    currency) at or before the end of D, then max across
 *                    sources — the same "best" rule the live path uses
 *
 * This is repair, not the primary mechanism: the nightly snapshot is what
 * normally writes the series (it records what was known ON the day, which
 * cannot be recovered later once a backdated collection edit rewrites the
 * ledger). Backfill exists so a MISSED night stops being a permanent notch in
 * the chart.
 *
 * `ON CONFLICT DO NOTHING` means it can never overwrite a real same-day
 * reading — an existing diary line always wins over a reconstruction.
 */
export async function backfillValuePoints(
  client: Queryable,
  opts: BackfillOpts,
): Promise<BackfillResult> {
  const skipped: BackfillResult['skipped'] = [];
  const bands = await priceGrainBands(client);
  const PRICED = pricedCte(bands.dayFloor != null);
  const grainDays: Record<PriceGrain, number> = { day: 0, week: 0, month: 0 };

  // Which currencies the live table can price today — the yardstick for
  // "did this day lose one?" rather than a hardcoded list that would go stale
  // the moment a source is added.
  const { rows: curRows } = await client.query<{ currency_code: string }>(
    `SELECT DISTINCT upper(btrim(currency_code)) AS currency_code
       FROM price_current WHERE market_minor IS NOT NULL`,
  );
  const expectedCurrencies = curRows.map((r) => r.currency_code);
  let inserted = 0;
  let days = 0;

  const { rows: dayRows } = await client.query<{ d: string }>(
    `SELECT to_char(gs::date, 'YYYY-MM-DD') AS d
       FROM generate_series($1::date, $2::date, interval '1 day') gs
      WHERE gs::date <= CURRENT_DATE
      ORDER BY 1`,
    [opts.from, opts.to],
  );

  for (const { d } of dayRows) {
    days += 1;

    // The gate scales with the tier covering THIS day, unless the caller pinned
    // it. Named in every message below, so a skip always says which standard
    // the day failed to meet — an outage and a rolled-up range must not produce
    // the same sentence.
    const grain = grainForDay(d, bands);
    const maxStale = opts.maxPriceStalenessDays ?? GRAIN_STALENESS[grain];
    const tier = `${grain} grain (${maxStale}-day window)`;

    // Freshness gate first: one cheap question before any heavy join.
    const { rows: fresh } = await client.query<{ newest: string | null }>(
      `SELECT to_char(max(p.as_of), 'YYYY-MM-DD') AS newest FROM (${PRICED}) p`,
      [d, String(maxStale + 1)],
    );
    if (!fresh[0]?.newest) {
      skipped.push({
        date: d,
        reason: `no price reading within ${maxStale} day(s) of ${d} at ${tier} — ` +
                'the day cannot be reconstructed, only guessed',
      });
      continue;
    }

    // The gate above asks "is there ANY fresh price?", which passes as soon as
    // one source is healthy. A currency whose feed was down that day then gets
    // no row and no complaint — the chart simply has a hole in EUR while USD
    // looks complete. Name the currencies actually reconstructible for the day,
    // so a per-currency outage is reported rather than absorbed.
    const { rows: curs } = await client.query<{ currency_code: string }>(
      `SELECT DISTINCT p.currency_code FROM (${PRICED}) p`,
      [d, String(maxStale + 1)],
    );
    const have = new Set(curs.map((c) => c.currency_code));
    for (const c of expectedCurrencies) {
      if (!have.has(c)) {
        skipped.push({
          date: d,
          reason: `${c} has no price reading within ${maxStale} day(s) of ${d} at ${tier}`,
        });
      }
    }
    grainDays[grain] += 1;

    const { rows } = await client.query<{ user_id: string }>(
      `WITH priced AS (${PRICED}),
       latest AS (
         SELECT DISTINCT ON (p.card_variant_id, p.source_code, p.currency_code)
                p.card_variant_id, p.currency_code, p.market_minor
           FROM priced p
          ORDER BY p.card_variant_id, p.source_code, p.currency_code, p.as_of DESC
       ),
       best AS (
         SELECT card_variant_id, currency_code, max(market_minor) AS best_minor
           FROM latest GROUP BY card_variant_id, currency_code
       ),
       owned AS (
         SELECT o.user_id, o.card_variant_id, o.quantity, cv.card_id
           FROM (
             SELECT DISTINCT ON (ce.user_id, ce.card_variant_id)
                    ce.user_id, ce.card_variant_id, ce.quantity_after AS quantity
               FROM collection_event ce
              WHERE ce.occurred_at < ($1::date + 1)
              ORDER BY ce.user_id, ce.card_variant_id, ce.occurred_at DESC, ce.id DESC
           ) o
           JOIN card_variant cv ON cv.id = o.card_variant_id
          WHERE o.quantity > 0
       ),
       counts AS (
         SELECT user_id,
                count(DISTINCT card_id)::int AS unique_cards,
                COALESCE(sum(quantity), 0)::int AS total_quantity
           FROM owned GROUP BY user_id
       ),
       totals AS (
         SELECT o.user_id, b.currency_code, sum(o.quantity::bigint * b.best_minor)::bigint AS total_minor
           FROM owned o JOIN best b ON b.card_variant_id = o.card_variant_id
          GROUP BY o.user_id, b.currency_code
       )
       INSERT INTO collection_value_point
         (user_id, observed_on, currency_code, total_minor, unique_cards, total_quantity)
       SELECT t.user_id, $1::date, t.currency_code, t.total_minor, c.unique_cards, c.total_quantity
         FROM totals t JOIN counts c ON c.user_id = t.user_id
       ON CONFLICT (user_id, observed_on, currency_code) DO NOTHING
       RETURNING user_id`,
      [d, String(maxStale + 1)],
    );
    inserted += rows.length;
  }

  return {
    days,
    inserted,
    skipped,
    grains: (['day', 'week', 'month'] as const)
      .filter((g) => grainDays[g] > 0)
      .map((g) => ({
        grain: g,
        days: grainDays[g],
        maxStaleDays: opts.maxPriceStalenessDays ?? GRAIN_STALENESS[g],
      })),
  };
}

/**
 * Does the ledger-derived total for TODAY agree with the live `price_current`
 * total for today?
 *
 * The backfill assumes `collection_event` is a COMPLETE record of ownership.
 * Every `collection_item` write in the API is paired with an event append, so
 * it should be — but "should be" is how a chart quietly starts lying. This
 * recomputes today both ways and reports the difference per account, which is a
 * question with a known right answer (zero) on a day both methods can see.
 *
 * Used by the backfill command as a preflight, and worth running by hand after
 * any bulk import.
 */
export async function ledgerAgreesWithCollection(
  client: Queryable,
): Promise<{ user_id: string; card_variant_id: string; ledger_qty: number; actual_qty: number }[]> {
  const { rows } = await client.query<{
    user_id: string; card_variant_id: string; ledger_qty: string; actual_qty: string;
  }>(
    // Per (user, VARIANT), not per user total. Two drifts that cancel in the
    // sum — +1 on one variant, -1 on another — would pass a totals comparison
    // while still corrupting every reconstructed value, because different
    // variants carry different prices.
    `WITH ledger AS (
       SELECT DISTINCT ON (ce.user_id, ce.card_variant_id)
              ce.user_id, ce.card_variant_id, ce.quantity_after AS quantity
         FROM collection_event ce
        ORDER BY ce.user_id, ce.card_variant_id, ce.occurred_at DESC, ce.id DESC
     ),
     actual AS (
       SELECT user_id, card_variant_id, quantity
         FROM collection_item WHERE quantity > 0
     )
     SELECT COALESCE(l.user_id, a.user_id) AS user_id,
            COALESCE(l.card_variant_id, a.card_variant_id) AS card_variant_id,
            COALESCE(l.quantity, 0) AS ledger_qty,
            COALESCE(a.quantity, 0) AS actual_qty
       FROM (SELECT * FROM ledger WHERE quantity > 0) l
       FULL OUTER JOIN actual a
         ON a.user_id = l.user_id AND a.card_variant_id = l.card_variant_id
      WHERE COALESCE(l.quantity, 0) <> COALESCE(a.quantity, 0)
      LIMIT 50`,
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    card_variant_id: r.card_variant_id,
    ledger_qty: Number(r.ledger_qty),
    actual_qty: Number(r.actual_qty),
  }));
}

/**
 * Do the SQL copy of the value rule and the API's TypeScript copy agree?
 *
 * The duplication was accepted deliberately (see the header); this is the check
 * that keeps it honest. It runs the SQL totals and, for the same accounts, the
 * arithmetic `collectionValue.ts` performs — `max(market_minor)` per
 * (variant, currency), then `SUM(quantity x best)` — from the same rows the API
 * would read, and reports any per-(user, currency) disagreement.
 *
 * Not a unit test: both halves are SQL over the live schema, so a pure test
 * could only re-implement the rule a third time and pin nothing. B7 keeps
 * live-DB checks out of CI, so this is a command (`prices value-parity`) to run
 * after touching either copy.
 */
export async function valueParity(client: Queryable): Promise<{
  user_id: string; currency_code: string; sql_minor: number; ts_minor: number;
}[]> {
  // The SQL copy's totals, without writing anything.
  const { rows: sqlRows } = await client.query<{ user_id: string; currency_code: string; total_minor: string }>(
    `WITH best AS (
       SELECT pc.card_variant_id, upper(btrim(pc.currency_code)) AS currency_code,
              max(pc.market_minor) AS best_minor
         FROM price_current pc WHERE pc.market_minor IS NOT NULL
        GROUP BY pc.card_variant_id, upper(btrim(pc.currency_code))
     ),
     owned AS (
       SELECT ci.user_id, ci.card_variant_id, ci.quantity
         FROM collection_item ci WHERE ci.quantity > 0
     )
     SELECT o.user_id::text, b.currency_code,
            sum(o.quantity::bigint * b.best_minor)::text AS total_minor
       FROM owned o JOIN best b ON b.card_variant_id = o.card_variant_id
      GROUP BY o.user_id, b.currency_code`,
  );

  // The rows the API's `ownedPriceRows` returns, folded the way `aggregateValue`
  // folds them — one row per (owned variant, currency), summed in JS.
  const { rows: tsRows } = await client.query<{ user_id: string; currency: string; qty: string; best: string }>(
    `WITH best AS (
       SELECT pc.card_variant_id, pc.currency_code, max(pc.market_minor) AS best_minor
         FROM price_current pc WHERE pc.market_minor IS NOT NULL
        GROUP BY pc.card_variant_id, pc.currency_code
     )
     SELECT ci.user_id::text, b.currency_code AS currency,
            ci.quantity::text AS qty, b.best_minor::text AS best
       FROM collection_item ci JOIN best b ON b.card_variant_id = ci.card_variant_id
      WHERE ci.quantity > 0`,
  );
  const ts = new Map<string, number>();
  for (const r of tsRows) {
    const key = `${r.user_id}|${r.currency.trim().toUpperCase()}`;
    ts.set(key, (ts.get(key) ?? 0) + Number(r.qty) * Number(r.best));
  }

  const out: { user_id: string; currency_code: string; sql_minor: number; ts_minor: number }[] = [];
  const seen = new Set<string>();
  for (const r of sqlRows) {
    const key = `${r.user_id}|${r.currency_code}`;
    seen.add(key);
    const a = Number(r.total_minor);
    const b = ts.get(key) ?? 0;
    if (a !== b) out.push({ user_id: r.user_id, currency_code: r.currency_code, sql_minor: a, ts_minor: b });
  }
  // A pair the SQL copy produced no row for at all is the more dangerous
  // direction: a silently missing currency rather than a wrong number.
  for (const [key, b] of ts) {
    if (seen.has(key)) continue;
    const [user_id, currency_code] = key.split('|') as [string, string];
    out.push({ user_id, currency_code, sql_minor: 0, ts_minor: b });
  }
  return out;
}
