// Entrypoint: `tsx src/catalog/supplementCli.ts [--dry-run]`
//
// Writes the sets TCGdex has not published yet (supplements.ts). The weekly catalog import runs
// this after itself (cli.ts); this is the same pass on demand, and --dry-run reports what it
// would write. One pooled client (B2).
import { makePool } from '@deckpal/db';
import { fillSupplementSets } from './supplements.js';

const dryRun = process.argv.includes('--dry-run');
const pool = makePool(1);
const client = await pool.connect();
try {
  const r = await fillSupplementSets(client, { dryRun });
  console.log(JSON.stringify(r, null, 2));
  if (dryRun) console.warn('[catalog-supplement] dry run — nothing was written.');
} catch (err) {
  console.error('[catalog-supplement] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
