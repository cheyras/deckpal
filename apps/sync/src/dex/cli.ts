// Entrypoint: `tsx src/dex/cli.ts [pokeapiDir] [catalogDir]`
//   pokeapiDir defaults to <repo>/data/pokeapi     (vendored CSVs, committed)
//   catalogDir defaults to <repo>/data/catalog/en  (compiled TCGdex JSON, gitignored)
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDex } from './import.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..'); // apps/sync/src/dex -> repo root
const pokeapiDir = process.argv[2] ?? process.env.POKEAPI_DATA_DIR ?? join(repoRoot, 'data', 'pokeapi');
const catalogDir = process.argv[3] ?? process.env.CATALOG_DATA_DIR ?? join(repoRoot, 'data', 'catalog', 'en');

const t0 = Date.now();
console.log(`[dex-import] species <- ${pokeapiDir}, mapping <- ${catalogDir}`);
importDex(pokeapiDir, catalogDir)
  .then((s) => {
    console.log(`[dex-import] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(JSON.stringify(s, null, 2));
  })
  .catch((err) => {
    console.error('[dex-import] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
