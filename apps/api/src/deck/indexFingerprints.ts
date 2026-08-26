/**
 * CLI for {@link indexFingerprints}. Run after a catalogue import, and once as a
 * backfill:
 *
 *   pnpm --filter deckpal-api fingerprint:index          # only rows with no hash
 *   pnpm --filter deckpal-api fingerprint:index --all    # recompute everything
 *
 * `--all` is for when `fingerprint.ts` itself changes: the hash is a contract
 * between rows, so half the table on an old definition is worse than none.
 *
 * Exits non-zero when the pass leaves the index obviously broken — every row
 * sharing one hash, or no row getting one — because this runs unattended from
 * `refresh-catalog.sh` and a silent no-op is how a column stays empty for
 * months without anybody noticing.
 */
import { makeDeckPool } from './db.js';
import { indexFingerprints, collisionReport } from './fingerprintIndex.js';

const all = process.argv.includes('--all');
const pool = makeDeckPool();
try {
  const started = Date.now();
  const res = await indexFingerprints(pool, {
    all,
    onProgress: (done, total) => {
      if (done % 5000 === 0 || done === total) console.log(`    ${done}/${total}`);
    },
  });
  const report = await collisionReport(pool);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `[fingerprint] ${all ? 'recomputed' : 'filled'} ${res.written} row(s) in ${secs}s ` +
      `(scanned ${res.scanned}, unchanged ${res.unchanged}, too thin to hash ${res.tooThin})`,
  );
  console.log(
    `[fingerprint] index now: ${report.rowsFingerprinted} row(s) hashed, ${report.rowsNull} NULL; ` +
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
