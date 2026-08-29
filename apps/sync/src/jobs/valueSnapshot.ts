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
// (2026-08-29) was the set-based statement below, with a test pinning it
// against the API's arithmetic so the two copies cannot drift.
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

export interface BackfillOpts {
  from: string;
  to: string;
  /**
   * How stale a price may be and still be used for a given day, in days.
   *
   * This is the honesty knob. Reconstructing a past day needs a price FOR that
   * day; when the nearest earlier observation is weeks old, carrying it forward
   * does not recover history, it draws a flat line and calls it market data.
   * At the default of 2 a normally-fed database (prices land daily) backfills
   * cleanly, and a real ingestion outage is REFUSED rather than papered over —
   * such a day is reported in `skipped`, not written.
   *
   * Raise it only deliberately, knowing the resulting segment is carried
   * forward rather than observed.
   */
  maxPriceStalenessDays?: number;
}

export interface BackfillResult {
  days: number;
  inserted: number;
  /** Days that had no price data fresh enough to reconstruct honestly. */
  skipped: { date: string; reason: string }[];
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
  const maxStale = opts.maxPriceStalenessDays ?? 2;
  const skipped: BackfillResult['skipped'] = [];
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

    // Freshness gate first: one cheap question before any heavy join.
    const { rows: fresh } = await client.query<{ newest: string | null; age_days: number | null }>(
      `SELECT to_char(max(po.captured_at), 'YYYY-MM-DD') AS newest,
              EXTRACT(day FROM ($1::date + 1) - max(po.captured_at))::int AS age_days
         FROM price_observation po
        WHERE po.captured_at < ($1::date + 1)
          AND po.captured_at >= ($1::date + 1) - ($2::text || ' days')::interval`,
      [d, String(maxStale + 1)],
    );
    if (!fresh[0]?.newest) {
      skipped.push({
        date: d,
        reason: `no price observation within ${maxStale} day(s) of ${d} — the day cannot be reconstructed, only guessed`,
      });
      continue;
    }

    const { rows } = await client.query<{ user_id: string }>(
      `WITH latest AS (
         SELECT DISTINCT ON (po.card_variant_id, po.source_code, po.currency_code)
                po.card_variant_id,
                upper(btrim(po.currency_code)) AS currency_code,
                po.market_minor
           FROM price_observation po
          WHERE po.market_minor IS NOT NULL
            AND po.captured_at < ($1::date + 1)
            AND po.captured_at >= ($1::date + 1) - ($2::text || ' days')::interval
          ORDER BY po.card_variant_id, po.source_code, po.currency_code, po.captured_at DESC
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

  return { days, inserted, skipped };
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
): Promise<{ user_id: string; ledger_qty: number; actual_qty: number }[]> {
  const { rows } = await client.query<{ user_id: string; ledger_qty: string; actual_qty: string }>(
    `WITH ledger AS (
       SELECT user_id, COALESCE(sum(quantity), 0) AS qty FROM (
         SELECT DISTINCT ON (ce.user_id, ce.card_variant_id)
                ce.user_id, ce.quantity_after AS quantity
           FROM collection_event ce
          ORDER BY ce.user_id, ce.card_variant_id, ce.occurred_at DESC, ce.id DESC
       ) x WHERE quantity > 0 GROUP BY user_id
     ),
     actual AS (
       SELECT user_id, COALESCE(sum(quantity), 0) AS qty
         FROM collection_item WHERE quantity > 0 GROUP BY user_id
     )
     SELECT COALESCE(l.user_id, a.user_id) AS user_id,
            COALESCE(l.qty, 0) AS ledger_qty,
            COALESCE(a.qty, 0) AS actual_qty
       FROM ledger l FULL OUTER JOIN actual a ON a.user_id = l.user_id
      WHERE COALESCE(l.qty, 0) <> COALESCE(a.qty, 0)`,
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    ledger_qty: Number(r.ledger_qty),
    actual_qty: Number(r.actual_qty),
  }));
}
