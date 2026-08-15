// Run a single REAL_JOBS entry once, print the result, exit. Usage:
//   pnpm --filter deckpal-sync run-once <job>     (tsx src/run-once.ts <job>)
// Uses its own 1-connection pool (the sync budget); each job still takes its
// advisory lock + sync_run row, so overlapping the cron is a clean skip.
// Exits 1 on job failure, 2 on a bad/missing job name.
import { loadEnv, makePool } from '@deckpal/db';
import { REAL_JOBS } from './index.js';
import type { Queryable } from './prices/db.js';

loadEnv();

async function main(): Promise<void> {
  const job = process.argv[2] ?? '';
  const fn = REAL_JOBS[job as keyof typeof REAL_JOBS];
  if (!fn) {
    console.error(`usage: tsx src/run-once.ts <job>\nreal jobs: ${Object.keys(REAL_JOBS).join(', ')}`);
    process.exit(2);
  }
  const pool = makePool(1);
  const client = (await pool.connect()) as unknown as Queryable & { release(): void };
  try {
    const result = await fn(client);
    console.log(`[run-once] ${job} ok:`, JSON.stringify(result));
  } catch (err) {
    console.error(`[run-once] ${job} FAILED:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
