// The two API-backed cron jobs: snapshot-collection (daily collection-value point)
// and reconcile (nightly user_set_progress sweep).
//
// 🔴 apps/sync must NOT import from apps/api — apps/api/src/db.ts instantiates a
// 2-connection pool at module load, which inside this process would blow the
// 4-connection budget (sync gets exactly 1). The single-source logic therefore
// stays in deckpal-api and we call its internal endpoints over localhost HTTP,
// the same principle as apps/mcp (SPEC §3). This module only does what sync owns:
// the advisory lock, the sync_run bookkeeping, and the HTTP call.

import { finishRun, tryLock, unlock, type Queryable } from '../prices/db.js';

const TIMEOUT_MS = 120_000;

function apiBase(): string {
  return process.env.DECKPAL_API_BASE ?? 'http://127.0.0.1:3700/deckpal/api';
}

type ApiJob = 'snapshot-collection' | 'reconcile';

// Per job: the endpoint to POST and which response field lands in sync_run.rows_written.
const JOB_SPEC: Record<ApiJob, { path: string; rowsWrittenKey: string }> = {
  'snapshot-collection': { path: '/insights/value/snapshot', rowsWrittenKey: 'inserted' },
  reconcile: { path: '/collection/reconcile', rowsWrittenKey: 'sets' },
};

/**
 * Open the 'running' sync_run row, honoring the one-active-per-job partial unique
 * index (sync_run_one_active: UNIQUE (job) WHERE status='running'). Returns null
 * when another run of this job is already active — the caller logs + skips.
 */
async function startRunOrSkip(client: Queryable, job: ApiJob): Promise<number | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO sync_run (job, status) VALUES ($1, 'running')
     ON CONFLICT (job) WHERE status = 'running' DO NOTHING
     RETURNING id`,
    [job],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Acquire the job's advisory lock (skip cleanly if held, same as the price jobs),
 * open a sync_run row, POST the API endpoint, then close the run as 'ok' with
 * rows_written from the response — or 'failed' with the error message, re-throwing
 * so the caller decides: the scheduler's runJob CATCHES and logs (a failed fetch
 * can never crash the scheduler); run-once exits non-zero.
 */
async function runApiJob(client: Queryable, job: ApiJob): Promise<unknown> {
  const spec = JOB_SPEC[job];
  if (!(await tryLock(client, job))) {
    console.log(`[deckpal-sync] ${job}: advisory lock held — skipping`);
    return { skipped: true, reason: 'advisory lock held' };
  }
  try {
    const runId = await startRunOrSkip(client, job);
    if (runId === null) {
      console.log(`[deckpal-sync] ${job}: a run is already active (sync_run_one_active) — skipping`);
      return { skipped: true, reason: 'sync_run already active' };
    }
    try {
      const res = await fetch(`${apiBase()}${spec.path}`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} from POST ${spec.path}: ${text.slice(0, 300)}`);
      const body = JSON.parse(text) as Record<string, unknown>;
      const rowsWritten = Number(body[spec.rowsWrittenKey] ?? 0);
      await finishRun(client, runId, 'ok', { rowsWritten });
      return body;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finishRun(client, runId, 'failed', { error: msg });
      throw err;
    }
  } finally {
    await unlock(client, job);
  }
}

export function runSnapshotCollection(client: Queryable): Promise<unknown> {
  return runApiJob(client, 'snapshot-collection');
}

export function runReconcile(client: Queryable): Promise<unknown> {
  return runApiJob(client, 'reconcile');
}
