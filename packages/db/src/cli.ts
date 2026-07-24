import { makePool } from './pool.js';
import { migrateUp, migrationStatus } from './migrate.js';

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  // Migrations use a single connection; well within the budget.
  const pool = makePool(1);
  try {
    if (cmd === 'up') {
      const results = await migrateUp(pool);
      const newly = results.filter((r) => r.applied);
      for (const r of results) {
        console.log(`${r.applied ? 'APPLIED ' : 'present '} ${r.version}`);
      }
      console.log(`\n${newly.length} migration(s) applied, ${results.length} total.`);
    } else if (cmd === 'status') {
      const rows = await migrationStatus(pool);
      for (const r of rows) console.log(`${r.applied ? '[x]' : '[ ]'} ${r.version}`);
      const pending = rows.filter((r) => !r.applied).length;
      console.log(`\n${pending} pending, ${rows.length} total.`);
    } else {
      console.error(`unknown command: ${cmd} (use "up" or "status")`);
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
