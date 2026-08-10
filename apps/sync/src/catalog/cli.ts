// Entrypoint: `tsx src/catalog/cli.ts [dataDir]`
// dataDir defaults to <repo>/data/catalog/en (gitignored). The weekly `catalog` sync job will
// `docker save | tar` the compiled JSON into that dir (ARCHITECTURE §5.1) before calling this.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCatalog } from './import.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..'); // apps/sync/src/catalog -> repo root
const dataDir = process.argv[2] ?? process.env.CATALOG_DATA_DIR ?? join(repoRoot, 'data', 'catalog', 'en');

const t0 = Date.now();
console.log(`[catalog-import] reading ${dataDir}`);
importCatalog(dataDir)
  .then((s) => {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[catalog-import] done in ${secs}s`);
    console.log(JSON.stringify(s, null, 2));
    // CATALOG_SUMMARY_JSON=<path> also writes the summary to a file. The scheduled
    // refresh (.github/workflows/catalog-refresh.yml) reads it to build the job
    // summary and to decide whether a re-key is outstanding. Scraping it back out
    // of the log would work until the day a log line happened to look like JSON;
    // a file is the contract.
    const summaryPath = process.env.CATALOG_SUMMARY_JSON;
    if (summaryPath) {
      writeFileSync(summaryPath, JSON.stringify(s));
      console.log(`[catalog-import] summary written to ${summaryPath}`);
    }
  })
  .catch((err) => {
    console.error('[catalog-import] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
