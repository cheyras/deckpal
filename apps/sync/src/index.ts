import cron from 'node-cron';
import { loadEnv, makePool } from '@deckscout/db';
import { ingestTcgcsvPrices } from './prices/tcgcsv.js';
import { ingestCardmarket } from './prices/cardmarket.js';
import { runReconcile, runSnapshotCollection } from './jobs/api-jobs.js';
import type { Queryable } from './prices/db.js';

// The node-cron scheduler. FOUR of the seven jobs are real (see REAL_JOBS): the two price
// ingests (prices-tcgcsv, prices-cardmarket) run in-process, and snapshot-collection /
// reconcile call deckscout-api's internal endpoints over HTTP (jobs/api-jobs.ts — sync must
// not import apps/api, whose db.ts opens its own 2-connection pool at module load).
// catalog / images / products-tcgcsv remain MANUAL per the sync runbook and fire as
// logging stubs. Cadences and the job list come from research/DATA-LAYER.md §7.2 and the
// sync_run.job CHECK. Run any real job once by hand: `pnpm --filter deckscout-sync run-once <job>`.
loadEnv();

// Connection budget: the sync process gets 1 of the 3 total. DATA-LAYER §6.5.
const pool = makePool(Number(process.env.PGPOOL_MAX_SYNC ?? 1));

type JobName =
  | 'catalog'
  | 'images'
  | 'prices-tcgcsv'
  | 'prices-cardmarket'
  | 'products-tcgcsv'
  | 'snapshot-collection'
  | 'reconcile';

// cron cadences (local time unless noted); DATA-LAYER §7.2.
const SCHEDULE: Record<JobName, string> = {
  catalog: '30 4 * * 0', // weekly, Sun 04:30 (after the JFF timer at 03:00)
  images: '0 5 * * 0', // triggered by catalog; placeholder weekly slot
  'prices-tcgcsv': '30 20 * * *', // daily 20:30 UTC + jitter (added in impl)
  'prices-cardmarket': '0 2 * * *', // daily 02:00 UTC + jitter
  'products-tcgcsv': '0 3 1 * *', // monthly
  'snapshot-collection': '0 21 * * *', // daily, after prices
  reconcile: '0 1 * * *', // nightly set-progress sweep
};

function registerStub(job: JobName, expr: string): void {
  cron.schedule(expr, () => {
    // Intentionally a no-op in this scaffold. Real jobs: pg_advisory_lock, skip-if-unchanged,
    // one transaction per group, resumable cursor, write sync_run. See ARCHITECTURE §5.4.
    console.log(`[deckscout-sync] (stub) would run job "${job}" at ${new Date().toISOString()}`);
  });
}

// Run a real job on the single sync client, then release it. Each job internally holds a
// pg advisory lock (+ skip-if-unchanged for prices), so a cron fire that overlaps a manual run
// is a clean no-op. The catch here is the scheduler's crash barrier: a failed run (fetch error,
// non-2xx, DB hiccup) is logged and the scheduler lives on.
async function runJob(job: JobName, fn: (c: Queryable) => Promise<unknown>): Promise<void> {
  const client = (await pool.connect()) as unknown as Queryable & { release(): void };
  try {
    const r = await fn(client);
    console.log(`[deckscout-sync] ${job} ok:`, JSON.stringify(r));
  } catch (err) {
    console.error(`[deckscout-sync] ${job} FAILED:`, err instanceof Error ? err.message : err);
  } finally {
    client.release();
  }
}

// Exported for run-once.ts (the manual single-job CLI). Guarded by isMain below,
// importing this module does NOT start the scheduler.
export const REAL_JOBS: Partial<Record<JobName, (c: Queryable) => Promise<unknown>>> = {
  'prices-tcgcsv': (c) => ingestTcgcsvPrices(c),
  'prices-cardmarket': (c) => ingestCardmarket(c),
  'snapshot-collection': (c) => runSnapshotCollection(c),
  reconcile: (c) => runReconcile(c),
};

async function main(): Promise<void> {
  // Prove DB reachability at boot, then idle as the scheduler.
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM sync_run');
  const roster = (Object.keys(SCHEDULE) as JobName[])
    .map((j) => `${j}=${REAL_JOBS[j] ? 'REAL' : 'stub'}`)
    .join(' ');
  console.log(
    `deckscout-sync up. sync_run rows: ${rows[0]?.n ?? 0}. Registering ${Object.keys(SCHEDULE).length} cron jobs: ${roster}`,
  );
  for (const [job, expr] of Object.entries(SCHEDULE)) {
    const real = REAL_JOBS[job as JobName];
    if (real) cron.schedule(expr, () => void runJob(job as JobName, real));
    else registerStub(job as JobName, expr);
  }
}

// Same isMain dance as apps/api: under some process managers pm_exec_path is the real script
// path; argv[1] covers direct node/tsx runs. run-once.ts imports REAL_JOBS from here
// without tripping the scheduler (its argv[1] ends in run-once.ts).
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
if (entryPath.endsWith('index.js') || entryPath.endsWith('index.ts')) {
  main().catch((err) => {
    console.error('[deckscout-sync] fatal at boot:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
