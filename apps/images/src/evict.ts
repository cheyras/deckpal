import { rm } from 'node:fs/promises';
import { CAP_BYTES, EVICT_HIGH_WATER, EVICT_LOW_WATER } from './config.js';
import {
  cacheStats,
  closePool,
  deleteAsset,
  evictionCandidates,
  type ImageAssetRow,
} from './assets.js';
import { absoluteFromRelative } from './layout.js';

/**
 * LRU eviction honouring the 4 GB cap (DATA-LAYER §5.3, ARCHITECTURE §5.2).
 *
 * Policy: evict `high` ONLY, never `low`. `low` (~403 MB) backs every grid/binder
 * view and evicting it makes the app feel broken offline; `high` is only the
 * detail page. Coldest `last_access_on` first. Trigger at the 3.5 GB high-water
 * mark, drain down to 3.0 GB. In practice (corpus ~1.96 GB) this never fires.
 */

export interface EvictResult {
  before: number;
  after: number;
  evicted: number;
  freedBytes: number;
  triggered: boolean;
}

export async function evict(force = false): Promise<EvictResult> {
  const stats = await cacheStats();
  const before = stats.totalBytes;

  if (!force && before < EVICT_HIGH_WATER) {
    return { before, after: before, evicted: 0, freedBytes: 0, triggered: false };
  }

  const target = EVICT_LOW_WATER; // drain down to the low-water mark
  const candidates: ImageAssetRow[] = await evictionCandidates(); // coldest high first
  let current = before;
  let evicted = 0;
  let freed = 0;

  for (const row of candidates) {
    if (current <= target) break;
    await rm(absoluteFromRelative(row.relative_path), { force: true });
    await deleteAsset(row.cache_key);
    current -= row.byte_size;
    freed += row.byte_size;
    evicted++;
  }

  return { before, after: current, evicted, freedBytes: freed, triggered: true };
}

const isMain = process.argv[1]?.endsWith('evict.js') || process.argv[1]?.endsWith('evict.ts');
if (isMain) {
  const force = process.argv.includes('--force');
  evict(force)
    .then((r) => {
      process.stderr.write(
        `[evict] cap=${CAP_BYTES} high-water=${EVICT_HIGH_WATER} low-water=${EVICT_LOW_WATER}\n` +
          `[evict] triggered=${r.triggered} evicted=${r.evicted} freed=${r.freedBytes} ` +
          `before=${r.before} after=${r.after}\n`,
      );
      return closePool();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      process.stderr.write(`[evict] fatal: ${(err as Error).message}\n`);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
