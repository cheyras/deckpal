// Wraps snapshotAllUsers with advisory lock and sync_run bookkeeping for the
// cloud CLI path (`pnpm prices snapshot`).
//
// ── The bug this fixes ──────────────────────────────────────────────────────
// The cloud workflow invokes `pnpm --filter deckpal-sync prices snapshot`, which
// called snapshotAllUsers directly.  snapshotAllUsers writes collection_value_point
// rows correctly, but it is pure data work: it knows nothing about sync_run.
// GET /api/health reads sync_run WHERE job='snapshot-collection' to surface the
// last-success timestamp.  Because no cloud run ever opened a sync_run row, the
// health endpoint kept returning the last SELF-HOST run timestamp (2026-08-08)
// even after successful cloud snapshots (e.g. workflow 35479253975, 8 rows for
// 4 users, 2026-09-20).
//
// ── The fix ─────────────────────────────────────────────────────────────────
// This wrapper follows the lock → startRunOrSkip → work → finishRun → unlock
// pattern from api-jobs.ts, using job='snapshot-collection' so both the
// self-host HTTP path and the cloud SQL path write to the same health row.
// cli.ts routes the `snapshot` branch through here instead of calling
// snapshotAllUsers directly; no workflow flags change.

import { finishRun, tryLock, unlock, type Queryable } from '../prices/db.js';
import { snapshotAllUsers, type SnapshotOpts, type ValueSnapshotResult } from './valueSnapshot.js';

// Same job name used by the API-backed path in api-jobs.ts.  Both paths do the
// same logical work; /api/health reads whichever record is most recent.
const JOB = 'snapshot-collection';

// Mirrors the private helper in api-jobs.ts: INSERT … ON CONFLICT DO NOTHING
// respects the sync_run_one_active partial unique index (WHERE status='running')
// without a separate check-then-insert.
async function startRunOrSkip(client: Queryable): Promise<number | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO sync_run (job, status) VALUES ($1, 'running')
     ON CONFLICT (job) WHERE status = 'running' DO NOTHING
     RETURNING id`,
    [JOB],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export type CloudSnapshotResult =
  | (ValueSnapshotResult & { skipped?: never })
  | { skipped: true; reason: string };

/**
 * Run the all-users collection-value snapshot with advisory lock and sync_run
 * bookkeeping.
 *
 * Lock held or active run → returns {skipped, reason}; no fabricated completed row.
 * Duplicate same-day run → inserted:0, status ok — idempotency is intentional,
 *   and the fresh finished_at is what /api/health needs to stop advertising a stale date.
 * Snapshot error → run marked 'failed', error re-thrown so the CLI exits non-zero.
 */
export async function runCloudSnapshot(
  client: Queryable,
  opts: SnapshotOpts = {},
): Promise<CloudSnapshotResult> {
  if (!(await tryLock(client, JOB))) {
    console.log(`[deckpal-sync] ${JOB}: advisory lock held — skipping`);
    return { skipped: true, reason: 'advisory lock held' };
  }
  try {
    const runId = await startRunOrSkip(client);
    if (runId === null) {
      console.log(`[deckpal-sync] ${JOB}: a run is already active (sync_run_one_active) — skipping`);
      return { skipped: true, reason: 'sync_run already active' };
    }
    try {
      const result = await snapshotAllUsers(client, opts);
      await finishRun(client, runId, 'ok', { rowsWritten: result.inserted });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finishRun(client, runId, 'failed', { error: msg });
      throw err;
    }
  } finally {
    await unlock(client, JOB);
  }
}
