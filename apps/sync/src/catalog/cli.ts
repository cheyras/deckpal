// Entrypoint: `tsx src/catalog/cli.ts [dataDir]`
// dataDir defaults to <repo>/data/catalog/en (gitignored). The weekly `catalog` sync job will
// `docker save | tar` the compiled JSON into that dir (ARCHITECTURE §5.1) before calling this.
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
  })
  .catch((err) => {
    console.error('[catalog-import] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
