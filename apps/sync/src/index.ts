import cron from 'node-cron';
import { loadEnv, makePool } from '@pokedex/db';

// Phase 2 · task 1 skeleton — the node-cron scheduler shell only. NO network calls, NO catalog
// import; those are later tasks. Cadences and the job list come from research/DATA-LAYER.md §7.2 and
// the sync_run.job CHECK. Every real job's FIRST step will be skip-if-unchanged on its source_stamp.
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

// cron cadences (local time unless noted); DATA-LAYER §7.2. Not yet wired to implementations.
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
    console.log(`[pokedex-sync] (stub) would run job "${job}" at ${new Date().toISOString()}`);
  });
}

async function main(): Promise<void> {
  // Prove DB reachability at boot, then idle as the scheduler.
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM sync_run');
  console.log(`pokedex-sync up. sync_run rows: ${rows[0]?.n ?? 0}. Registering ${Object.keys(SCHEDULE).length} cron stubs.`);
  for (const [job, expr] of Object.entries(SCHEDULE)) registerStub(job as JobName, expr);
}

main().catch((err) => {
  console.error('[pokedex-sync] fatal at boot:', err instanceof Error ? err.message : err);
  process.exit(1);
});
