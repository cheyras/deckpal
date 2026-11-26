/**
 * CLI for {@link indexFingerprints}. Run after every catalogue import:
 *
 *   pnpm --filter deckpal-api fingerprint:index --all            # recompute everything (the refresh runs this)
 *   pnpm --filter deckpal-api fingerprint:index                  # only rows with no hash
 *   pnpm --filter deckpal-api fingerprint:index --all --dry-run  # report what would move, write nothing
 *
 * `--all` is what `refresh-catalog.sh` runs every time (since 2026-11-17): the
 * hash is a contract between rows, so half the table on an old definition is
 * worse than none, and a change to `fingerprint.ts` should heal on the next
 * refresh instead of waiting for a manual step. `IS DISTINCT FROM` means an
 * unchanged row costs a comparison, not a write.
 *
 * `--dry-run` is the pre-flight for a definition change: it prints how many
 * rows, and which cards, would get a different hash, and writes nothing.
 *
 * Exits non-zero when the pass leaves the index obviously broken — every row
 * sharing one hash, or no row getting one — because this runs unattended from
 * `refresh-catalog.sh` and a silent no-op is how a column stays empty for
 * months without anybody noticing.
 */
import { makeDeckPool } from './db.js';
import { indexFingerprints, collisionReport } from './fingerprintIndex.js';

const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
/** How many changed cards a dry run lists by name; the count is always complete. */
const LIST = 200;
const pool = makeDeckPool();
try {
  const started = Date.now();
  const res = await indexFingerprints(pool, {
    all,
    dryRun,
    onProgress: (done, total) => {
      if (done % 5000 === 0 || done === total) console.log(`    ${done}/${total}`);
    },
  });
  const report = await collisionReport(pool);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  if (dryRun) {
    const changes = res.changes ?? [];
    console.log(
      `[fingerprint] DRY RUN: ${res.written} row(s) WOULD change in ${secs}s ` +
        `(scanned ${res.scanned}, unchanged ${res.unchanged}, too thin to hash ${res.tooThin}); nothing written`,
    );
    for (const c of changes.slice(0, LIST)) {
      console.log(`    ${c.tcgdexId}\t${c.name}\t${c.before ? c.before.slice(0, 12) : 'NULL'} -> ${c.after.slice(0, 12)}`);
    }
    if (changes.length > LIST) console.log(`    … and ${changes.length - LIST} more`);
  } else {
    console.log(
      `[fingerprint] ${all ? 'recomputed' : 'filled'} ${res.written} row(s) in ${secs}s ` +
        `(scanned ${res.scanned}, unchanged ${res.unchanged}, too thin to hash ${res.tooThin})`,
    );
  }
  console.log(
    `[fingerprint] index ${dryRun ? 'as stored (unchanged by the dry run)' : 'now'}: ` +
      `${report.rowsFingerprinted} row(s) hashed, ${report.rowsNull} NULL; ` +
      `${report.namesWithSeveralCards} of ${report.names} card names are MORE THAN ONE CARD`,
  );

  // The two shapes that mean the hash broke rather than the catalogue changing.
  if (report.rowsFingerprinted === 0) {
    console.error('[fingerprint] FAILED: not one row could be hashed.');
    process.exit(1);
  }
  if (report.names > 100 && report.namesWithSeveralCards === 0) {
    console.error(
      '[fingerprint] FAILED: no name resolves to more than one card, which cannot be true ' +
        'of this catalogue — the hash is collapsing distinct cards together.',
    );
    process.exit(1);
  }
} finally {
  await pool.end();
}
