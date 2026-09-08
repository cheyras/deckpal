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
      const skipped = results.filter((r) => r.skipped);
      for (const r of results) {
        // ⚠️ THREE WORDS, NOT TWO. `present` used to cover both "already
        // applied" and "skipped because SUPABASE_MODE is unset", which are
        // opposite facts: the first means the schema has it, the second means
        // it never will on this run. A cutover that forgets to load the
        // environment reads a screen of `present` and concludes it is done —
        // and the deploy then hard-fails on a function that was never created.
        console.log(`${r.applied ? 'APPLIED ' : r.skipped ? 'SKIPPED ' : 'present '} ${r.version}`);
      }
      console.log(`\n${newly.length} migration(s) applied, ${results.length} total.`);
      if (skipped.length) {
        console.log(
          `\n⚠️  ${skipped.length} supabase-only migration(s) SKIPPED because SUPABASE_MODE is not set.\n`
            + '   On a cloud deployment that is a MISTAKE, not a no-op: the billing write path, its\n'
            + '   RLS and its SECURITY DEFINER functions all live in the skipped files, and the\n'
            + '   deployed code calls them by name. Load the environment and run again.',
        );
      }
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
