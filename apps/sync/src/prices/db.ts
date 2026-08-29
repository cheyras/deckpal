// Shared DB plumbing for the price jobs: sync_run bookkeeping, advisory lock, partition
// assurance, and the two idempotent price writers (observation append + current upsert).
// All price writes go through here so the reverse-holo field mapping and the
// captured_at-from-source invariant live in exactly one place.

import { METRIC_COLS, hasAnyMetric, type Metrics } from './types.js';

export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export type SyncStatus = 'running' | 'ok' | 'partial' | 'failed' | 'skipped';
export type PriceJob = 'prices-tcgcsv' | 'prices-cardmarket' | 'products-tcgcsv' | 'prices-rollup';

// ── sync_run lifecycle ────────────────────────────────────────────────────────
export async function startRun(
  client: Queryable,
  job: PriceJob,
  sourceStamp: string | null,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO sync_run (job, status, source_stamp) VALUES ($1, 'running', $2) RETURNING id`,
    [job, sourceStamp],
  );
  return Number(rows[0]!.id);
}

export async function finishRun(
  client: Queryable,
  id: number,
  status: SyncStatus,
  patch: { rowsWritten?: number; itemsSeen?: number; itemsFailed?: number; cursor?: unknown; error?: string } = {},
): Promise<void> {
  await client.query(
    `UPDATE sync_run SET status=$2, finished_at=now(),
       rows_written=$3, items_seen=$4, items_failed=$5, cursor=$6, error=$7 WHERE id=$1`,
    [
      id, status, patch.rowsWritten ?? 0, patch.itemsSeen ?? 0, patch.itemsFailed ?? 0,
      patch.cursor != null ? JSON.stringify(patch.cursor) : null, patch.error ?? null,
    ],
  );
}

// Last successful source_stamp for skip-if-unchanged (DATA-LAYER §7.3).
export async function lastOkStamp(client: Queryable, job: PriceJob): Promise<string | null> {
  const { rows } = await client.query<{ source_stamp: string | null }>(
    `SELECT source_stamp FROM sync_run WHERE job=$1 AND status IN ('ok','partial')
       ORDER BY started_at DESC LIMIT 1`,
    [job],
  );
  return rows[0]?.source_stamp ?? null;
}

// Cross-run advisory lock so a manual re-run cannot race the cron (DATA-LAYER §7.3).
export async function tryLock(client: Queryable, job: string): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
    [`pokedex:sync:${job}`],
  );
  return rows[0]!.locked;
}
export async function unlock(client: Queryable, job: string): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`pokedex:sync:${job}`]);
}

// A missing monthly partition must ERROR on insert (no DEFAULT partition — DATA-LAYER §4.6).
// Create the partition the source stamp falls in, idempotently, before appending.
export async function ensureObservationPartition(client: Queryable, capturedAt: Date): Promise<void> {
  const y = capturedAt.getUTCFullYear();
  const m = capturedAt.getUTCMonth(); // 0-based
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  const name = `price_observation_${y}_${String(m + 1).padStart(2, '0')}`;
  if (!/^price_observation_\d{4}_\d{2}$/.test(name)) {
    throw new Error(`invalid partition identifier: ${name}`);
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF price_observation
       FOR VALUES FROM ('${iso(from)}') TO ('${iso(to)}')`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${name}_brin ON ${name}
       USING brin (captured_at) WITH (pages_per_range = 32)`,
  );
}

// ── a single (variant, source, currency) observation to write ────────────────
export interface PricePoint {
  cardVariantId: number;
  sourceId: number; // price_source.id (SMALLINT) for price_observation
  sourceCode: string; // price_source.code (TEXT) for price_current
  currency: string;
  metrics: Metrics;
}

// price_observation is append-only + idempotent: ON CONFLICT DO NOTHING on the natural PK
// (card_variant_id, source_code, currency_code, captured_at). captured_at is the SOURCE stamp.
// Returns the number of rows actually inserted (0 on a re-run of an unchanged day).
export async function appendObservations(
  client: Queryable,
  points: PricePoint[],
  capturedAt: Date,
  syncRunId: number | null,
  chunk = 400,
): Promise<number> {
  const rows = points.filter((p) => hasAnyMetric(p.metrics));
  const COLS = 4 + METRIC_COLS.length + 2; // variant, source, currency, captured_at, 9 metrics, priced_at, run
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values: unknown[] = [];
    const ph = slice
      .map((p, r) => {
        const base = r * COLS;
        values.push(
          p.cardVariantId, p.sourceId, p.currency, capturedAt,
          ...METRIC_COLS.map((c) => p.metrics[c] ?? null),
          capturedAt, syncRunId,
        );
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      })
      .join(',');
    const { rows: back } = await client.query<{ one: number }>(
      `INSERT INTO price_observation
         (card_variant_id, source_code, currency_code, captured_at,
          ${METRIC_COLS.join(',')}, priced_at, sync_run_id)
       VALUES ${ph}
       ON CONFLICT (card_variant_id, source_code, currency_code, captured_at) DO NOTHING
       RETURNING 1 AS one`,
      values,
    );
    inserted += back.length;
  }
  return inserted;
}

// price_current is the hot snapshot: upsert on (card_variant_id, source_code, currency_code).
// Always reflects the latest fetch; priced_at carries the source freshness stamp.
export async function upsertCurrent(
  client: Queryable,
  points: PricePoint[],
  capturedAt: Date,
  chunk = 400,
): Promise<number> {
  const rows = points.filter((p) => hasAnyMetric(p.metrics));
  // fetched_at is omitted from the column list so its DEFAULT now() applies on insert;
  // DO UPDATE sets it to now() explicitly.
  const COLS = 3 + METRIC_COLS.length + 1; // variant, source_code, currency, 9 metrics, priced_at
  const setList = METRIC_COLS.map((c) => `${c}=EXCLUDED.${c}`).join(',');
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values: unknown[] = [];
    const ph = slice
      .map((p, r) => {
        const base = r * COLS;
        values.push(
          p.cardVariantId, p.sourceCode, p.currency,
          ...METRIC_COLS.map((c) => p.metrics[c] ?? null),
          capturedAt,
        );
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(',')})`;
      })
      .join(',');
    await client.query(
      `INSERT INTO price_current
         (card_variant_id, source_code, currency_code, ${METRIC_COLS.join(',')}, priced_at)
       VALUES ${ph}
       ON CONFLICT (card_variant_id, source_code, currency_code) DO UPDATE
         SET ${setList}, priced_at=EXCLUDED.priced_at, fetched_at=now()`,
      values,
    );
    n += slice.length;
  }
  return n;
}
