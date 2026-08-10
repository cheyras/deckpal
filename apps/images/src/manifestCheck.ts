import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { hasStorageEnv, listObjectsRecursive } from '@deckscout/storage';
import { CACHE_ROOT } from './config.js';
import {
  closePool,
  getPool,
  imageObjectCounts,
  imageObjectRows,
  tierDivergences,
  type TierDivergence,
} from './assets.js';
import { sniffFile } from './store.js';

/**
 * manifest:check — reconcile the on-disk image cache against `image_asset`, both
 * directions, and exit non-zero on drift so it can be cronned.
 *
 * The manifest is the record of WHERE EVERY CACHED IMAGE CAME FROM. It only stays
 * true if every writer goes through store.ts; this command is the tripwire that
 * catches the writer that didn't. Bytes on disk with no manifest row are a defect,
 * not a curiosity (DECISIONS.md 2026-08-07).
 *
 * NOT wired into CI — CI deliberately excludes live-DB tests. Run it by hand after
 * any warm/gap-fill, or from cron.
 *
 *   pnpm --filter deckscout-images manifest:check            # reconcile (fast)
 *   pnpm --filter deckscout-images manifest:check --deep     # + verify content_type
 *   pnpm --filter deckscout-images manifest:check --strict   # also fail on unknown provenance
 *   pnpm --filter deckscout-images manifest:check --json     # machine-readable
 *   pnpm --filter deckscout-images manifest:check --object-store   # the CLOUD tier
 *
 * ── Two tiers, two modes ────────────────────────────────────────────────────
 * The default mode reconciles the DISK tier: files under CACHE_ROOT against
 * `image_asset` + `image_object(tier='disk')`. That is the self-host tripwire and
 * it is unchanged in what it fails on.
 *
 * `--object-store` reconciles the OBJECT tier instead: `image_object(tier='object')`
 * in the connected database against the objects actually in the Supabase bucket.
 * It is a separate mode rather than an extra section because the two tiers live in
 * different databases in the cloud topology — the Pi's DB owns the disk tier, the
 * Supabase DB owns the object tier — so asking one connection about both would
 * report thousands of phantom failures. Point PG* at whichever database you are
 * auditing. A single-box deployment that runs both tiers can run both modes.
 *
 * Either way the default mode still PRINTS the per-tier row counts it can see, so
 * a missing backfill is visible without having to know the flag exists.
 *
 * Exit: 0 clean · 1 drift · 2 could not run (DB down, cache root missing).
 *
 * Connection budget: ONE connection, opened late, closed in a finally (CLAUDE.md).
 */

// Subtrees under CACHE_ROOT that hold cached IMAGE assets. Anything else at the
// cache root (catalog/datas.json, *.log) is not an image asset and is not tracked.
const IMAGE_SUBTREES = ['images', 'sets'];

export interface DriftReport {
  cacheRoot: string;
  diskFiles: number;
  manifestRows: number;
  orphans: string[]; // bytes on disk, no manifest row  → DEFECT
  missingFiles: string[]; // manifest row, no bytes on disk → DEFECT
  sizeMismatches: Array<{ relativePath: string; recorded: number; actual: number }>;
  typeMismatches: Array<{ relativePath: string; recorded: string; actual: string }>;
  tempFiles: string[]; // leftover *.tmp from a torn write
  unknownProvenance: number; // rows with source_url IS NULL (documented, not a defect)
  unknownByKind: Record<string, number>;
  bySource: Record<string, number>;
  /**
   * Rows keyed `stale-duplicate:*` — recorded files sitting under a serie
   * directory the catalog disagrees with, so nothing serves them. Documented, not
   * drift; dead weight that can be deleted once a human confirms.
   */
  staleDuplicates: number;
  /**
   * Files on disk with an `image_asset` row but NO `image_object(tier='disk')`
   * row — the manifest knows the asset but nothing recorded this copy's size.
   * A DEFECT, and on an existing deployment the expected state until
   * `manifest:backfill --disk-tier` has been run once.
   */
  diskTierMissing: string[];
  /** Per-tier row counts visible in the connected database. */
  tierRowCounts: Record<string, number>;
  /**
   * Assets whose disk and object copies differ in size or type. NOT drift — this
   * is the fact `image_object` exists to record (upstream re-encodes). Only ever
   * non-empty when both tiers live in the same database.
   */
  tierDivergence: TierDivergence[];
  ok: boolean;
}

/** `--object-store`: the object tier's own reconciliation report. */
export interface ObjectDriftReport {
  bucketObjects: number;
  objectRows: number;
  /** Objects in the bucket with no `image_object(tier='object')` row → DEFECT. */
  unrecordedObjects: string[];
  /** Rows claiming an object that is not in the bucket → DEFECT. */
  missingObjects: string[];
  sizeMismatches: Array<{ cacheKey: string; recorded: number; actual: number }>;
  typeMismatches: Array<{ cacheKey: string; recorded: string; actual: string }>;
  /** Objects whose stored etag disagrees with the bucket's → the bytes changed. */
  etagMismatches: string[];
  /** Sprite objects, excluded by design (no manifest row — see paths.ts SPRITES_SHA). */
  spritesSkipped: number;
  ok: boolean;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // subtree absent is fine (a fresh cache has no sets/ yet)
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
}

export async function checkManifest(opts: { deep?: boolean } = {}): Promise<DriftReport> {
  // ── disk side ──
  const absFiles: string[] = [];
  for (const sub of IMAGE_SUBTREES) await walk(join(CACHE_ROOT, sub), absFiles);

  const tempFiles: string[] = [];
  const diskByRel = new Map<string, string>(); // relPath → absPath
  for (const abs of absFiles) {
    const rel = relative(CACHE_ROOT, abs).split(sep).join('/');
    if (rel.endsWith('.tmp')) {
      tempFiles.push(rel);
      continue;
    }
    diskByRel.set(rel, abs);
  }

  // ── manifest side (ONE connection, opened here, closed by the caller) ──
  const { rows } = await getPool().query<{
    cache_key: string;
    relative_path: string;
    byte_size: number;
    content_type: string;
    source_url: string | null;
    kind: string;
  }>(`SELECT cache_key, relative_path, byte_size, content_type, source_url, kind FROM image_asset`);

  const manifestByRel = new Map(rows.map((r) => [r.relative_path, r]));

  // The disk tier's own record of what it stored (migration 025). Where it
  // exists it is what we compare the file against, because it describes THIS
  // copy; `image_asset.byte_size` describes whichever copy was recorded first and
  // in the cloud topology that may be the bucket's.
  const diskTier = new Map((await imageObjectRows('disk')).map((r) => [r.cache_key, r]));
  const tierRowCounts = await imageObjectCounts();
  const tierDivergence = await tierDivergences();

  const orphans: string[] = [];
  for (const rel of diskByRel.keys()) if (!manifestByRel.has(rel)) orphans.push(rel);

  const missingFiles: string[] = [];
  const diskTierMissing: string[] = [];
  const sizeMismatches: DriftReport['sizeMismatches'] = [];
  const typeMismatches: DriftReport['typeMismatches'] = [];

  for (const [rel, row] of manifestByRel) {
    const abs = diskByRel.get(rel);
    if (!abs) {
      missingFiles.push(rel);
      continue;
    }
    const tier = diskTier.get(row.cache_key);
    if (!tier) diskTierMissing.push(rel);

    const expectedSize = tier ? tier.byte_size : row.byte_size;
    const expectedType = tier ? tier.content_type : row.content_type;

    const s = await stat(abs);
    if (s.size !== expectedSize) {
      sizeMismatches.push({ relativePath: rel, recorded: expectedSize, actual: s.size });
    }
    if (opts.deep) {
      const actual = await sniffFile(abs, s.size);
      if (actual !== expectedType) {
        typeMismatches.push({ relativePath: rel, recorded: expectedType, actual });
      }
    }
  }

  const unknownByKind: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let unknownProvenance = 0;
  let staleDuplicates = 0;
  for (const r of rows) {
    if (r.cache_key.startsWith('stale-duplicate:')) staleDuplicates++;
    if (r.source_url === null) {
      unknownProvenance++;
      unknownByKind[r.kind] = (unknownByKind[r.kind] ?? 0) + 1;
      bySource['(unknown)'] = (bySource['(unknown)'] ?? 0) + 1;
    } else {
      let host = '(unparseable)';
      try {
        host = new URL(r.source_url).host;
      } catch {
        /* keep the marker */
      }
      bySource[host] = (bySource[host] ?? 0) + 1;
    }
  }

  return {
    cacheRoot: CACHE_ROOT,
    diskFiles: diskByRel.size,
    manifestRows: rows.length,
    orphans: orphans.sort(),
    missingFiles: missingFiles.sort(),
    sizeMismatches,
    typeMismatches,
    tempFiles: tempFiles.sort(),
    unknownProvenance,
    unknownByKind,
    bySource,
    staleDuplicates,
    diskTierMissing: diskTierMissing.sort(),
    tierRowCounts,
    tierDivergence,
    ok:
      orphans.length === 0 &&
      missingFiles.length === 0 &&
      sizeMismatches.length === 0 &&
      typeMismatches.length === 0 &&
      diskTierMissing.length === 0,
  };
}

/**
 * `--object-store`: reconcile `image_object(tier='object')` against the bucket.
 *
 * This is B1's tripwire for the cloud tier, which until now had none: the disk
 * tier could prove "no byte without a row" by walking a directory, while the
 * object tier could only take the manifest's word for it. Listing the bucket is
 * what makes the claim falsifiable.
 *
 * Sprites are excluded, exactly as the disk walk excludes the sprite tree: the
 * whole tree is bulk-cloned from one pinned upstream SHA and its provenance is
 * that SHA (paths.ts `SPRITES_SHA`), so it has no per-file rows by design and
 * counting it would turn a clean tripwire into permanent false drift.
 */
export async function checkObjectStore(): Promise<ObjectDriftReport> {
  const objects = await listObjectsRecursive();
  const byPath = new Map(
    objects.filter((o) => !o.path.startsWith('sprites/')).map((o) => [o.path, o]),
  );
  const spritesSkipped = objects.length - byPath.size;

  // cache_key ⇄ relative_path, so the bucket (keyed by path) and image_object
  // (keyed by cache_key) can be joined.
  const { rows: assetRows } = await getPool().query<{ cache_key: string; relative_path: string }>(
    `SELECT cache_key, relative_path FROM image_asset`,
  );
  const pathByKey = new Map(assetRows.map((r) => [r.cache_key, r.relative_path]));

  const tierRows = await imageObjectRows('object');

  const missingObjects: string[] = [];
  const sizeMismatches: ObjectDriftReport['sizeMismatches'] = [];
  const typeMismatches: ObjectDriftReport['typeMismatches'] = [];
  const etagMismatches: string[] = [];
  const recordedPaths = new Set<string>();

  for (const row of tierRows) {
    const path = pathByKey.get(row.cache_key);
    // Unreachable while the FK holds; treated as a missing object rather than
    // thrown, because a checker that crashes tells you nothing.
    if (!path) {
      missingObjects.push(`(no image_asset row) ${row.cache_key}`);
      continue;
    }
    recordedPaths.add(path);
    const obj = byPath.get(path);
    if (!obj) {
      missingObjects.push(path);
      continue;
    }
    if (obj.byteSize !== row.byte_size) {
      sizeMismatches.push({ cacheKey: row.cache_key, recorded: row.byte_size, actual: obj.byteSize });
    }
    if (obj.contentType !== row.content_type) {
      typeMismatches.push({
        cacheKey: row.cache_key,
        recorded: row.content_type,
        actual: obj.contentType,
      });
    }
    if (row.etag && obj.etag && row.etag !== obj.etag) etagMismatches.push(path);
  }

  const unrecordedObjects: string[] = [];
  for (const path of byPath.keys()) if (!recordedPaths.has(path)) unrecordedObjects.push(path);

  return {
    bucketObjects: byPath.size,
    objectRows: tierRows.length,
    unrecordedObjects: unrecordedObjects.sort(),
    missingObjects: missingObjects.sort(),
    sizeMismatches,
    typeMismatches,
    etagMismatches: etagMismatches.sort(),
    spritesSkipped,
    ok:
      unrecordedObjects.length === 0 &&
      missingObjects.length === 0 &&
      sizeMismatches.length === 0 &&
      typeMismatches.length === 0 &&
      etagMismatches.length === 0,
  };
}

function sample(list: string[], n = 10): string {
  return list
    .slice(0, n)
    .map((s) => `      ${s}`)
    .concat(list.length > n ? [`      … and ${list.length - n} more`] : [])
    .join('\n');
}

export function formatReport(r: DriftReport, strict: boolean): string {
  const L: string[] = [];
  L.push(`image-cache manifest check — ${r.cacheRoot}`);
  L.push(`  files on disk : ${r.diskFiles}`);
  L.push(`  manifest rows : ${r.manifestRows}`);
  L.push('');
  L.push(`  orphans (bytes, no row)        : ${r.orphans.length}${r.orphans.length ? '  ← DEFECT' : ''}`);
  if (r.orphans.length) L.push(sample(r.orphans));
  L.push(`  missing files (row, no bytes)  : ${r.missingFiles.length}${r.missingFiles.length ? '  ← DEFECT' : ''}`);
  if (r.missingFiles.length) L.push(sample(r.missingFiles));
  L.push(`  byte_size mismatches           : ${r.sizeMismatches.length}${r.sizeMismatches.length ? '  ← DEFECT' : ''}`);
  if (r.sizeMismatches.length) {
    L.push(sample(r.sizeMismatches.map((m) => `${m.relativePath} recorded=${m.recorded} actual=${m.actual}`)));
  }
  L.push(`  content_type mismatches        : ${r.typeMismatches.length}${r.typeMismatches.length ? '  ← DEFECT' : ''}`);
  if (r.typeMismatches.length) {
    L.push(sample(r.typeMismatches.map((m) => `${m.relativePath} recorded=${m.recorded} actual=${m.actual}`)));
  }
  L.push(`  leftover *.tmp                 : ${r.tempFiles.length}`);
  if (r.tempFiles.length) L.push(sample(r.tempFiles));
  L.push(
    `  no disk-tier row (025)         : ${r.diskTierMissing.length}${r.diskTierMissing.length ? '  ← DEFECT' : ''}`,
  );
  if (r.diskTierMissing.length) {
    L.push(sample(r.diskTierMissing));
    L.push('      These files are recorded in image_asset but nothing recorded THIS copy.');
    L.push('      Expected once, on an existing cache, until you run:');
    L.push('          pnpm --filter deckscout-images manifest:backfill --disk-tier');
  }
  L.push('');
  L.push(`  image_object rows in this DB:`);
  const tiers = Object.entries(r.tierRowCounts);
  if (tiers.length === 0) L.push('      (none — migration 025 applied but never backfilled)');
  for (const [tier, n] of tiers.sort()) L.push(`      ${String(n).padStart(6)}  tier=${tier}`);
  if (r.tierDivergence.length) {
    L.push('');
    L.push(
      `  ${r.tierDivergence.length} asset(s) differ between the disk and object tiers. NOT drift —`,
    );
    L.push(
      `  upstream re-encodes, so the two copies are genuinely different bytes and each row is`,
    );
    L.push(`  correct about its own copy. This is what image_object exists to record. e.g.:`);
    for (const d of r.tierDivergence.slice(0, 5)) {
      L.push(
        `      ${d.cache_key}  disk=${d.disk_bytes}B/${d.disk_type}  object=${d.object_bytes}B/${d.object_type}`,
      );
    }
    if (r.tierDivergence.length > 5) L.push(`      … and ${r.tierDivergence.length - 5} more`);
  }
  L.push('');
  L.push(`  provenance by source host:`);
  for (const [host, n] of Object.entries(r.bySource).sort((a, b) => b[1] - a[1])) {
    L.push(`      ${String(n).padStart(6)}  ${host}`);
  }
  if (r.staleDuplicates) {
    L.push('');
    L.push(
      `  ${r.staleDuplicates} recorded file(s) are stale duplicates — a set cached under a serie`,
    );
    L.push(
      `  directory the catalog disagrees with, so nothing serves them. Dead weight, safe to delete`,
    );
    L.push(`  once confirmed; recorded so the manifest stays complete. Not drift.`);
  }
  if (r.unknownProvenance) {
    L.push('');
    L.push(
      `  ${r.unknownProvenance} row(s) have source_url NULL — provenance honestly unknown ` +
        `(${Object.entries(r.unknownByKind).map(([k, v]) => `${k}=${v}`).join(', ')}).`,
    );
    L.push(
      `  That is a documented state, not drift${strict ? ' — but --strict was passed, so it fails.' : '.'}`,
    );
  }
  L.push('');
  const failed = !r.ok || (strict && r.unknownProvenance > 0);
  L.push(failed ? '  RESULT: DRIFT' : '  RESULT: CLEAN');
  return L.join('\n');
}

export function formatObjectReport(r: ObjectDriftReport): string {
  const L: string[] = [];
  L.push('image object-store manifest check — Supabase Storage bucket');
  L.push(`  objects in bucket   : ${r.bucketObjects}   (+${r.spritesSkipped} sprites, not tracked)`);
  L.push(`  image_object rows   : ${r.objectRows}   (tier='object')`);
  L.push('');
  L.push(
    `  objects with no row            : ${r.unrecordedObjects.length}${r.unrecordedObjects.length ? '  ← DEFECT' : ''}`,
  );
  if (r.unrecordedObjects.length) {
    L.push(sample(r.unrecordedObjects));
    L.push('      Bytes were published without going through packages/storage put-asset.ts.');
    L.push('      Almost always a direct upload — scripts/storage-backfill.mjs writes objects');
    L.push('      but cannot write per-tier rows, and so produces exactly this. Repair with:');
    L.push('          pnpm --filter deckscout-images storage:backfill --reconcile');
    L.push('      and prefer that command over any direct upload from now on (AGENTS.md B1).');
  }
  L.push(
    `  rows with no object            : ${r.missingObjects.length}${r.missingObjects.length ? '  ← DEFECT' : ''}`,
  );
  if (r.missingObjects.length) {
    L.push(sample(r.missingObjects));
    L.push('      The manifest claims a copy the bucket does not have — an object was deleted');
    L.push('      out of band, or an upload was rolled back after its row was written.');
  }
  L.push(
    `  byte_size mismatches           : ${r.sizeMismatches.length}${r.sizeMismatches.length ? '  ← DEFECT' : ''}`,
  );
  if (r.sizeMismatches.length) {
    L.push(sample(r.sizeMismatches.map((m) => `${m.cacheKey} recorded=${m.recorded} actual=${m.actual}`)));
  }
  L.push(
    `  content_type mismatches        : ${r.typeMismatches.length}${r.typeMismatches.length ? '  ← DEFECT' : ''}`,
  );
  if (r.typeMismatches.length) {
    L.push(sample(r.typeMismatches.map((m) => `${m.cacheKey} recorded=${m.recorded} actual=${m.actual}`)));
  }
  L.push(
    `  etag mismatches (bytes changed): ${r.etagMismatches.length}${r.etagMismatches.length ? '  ← DEFECT' : ''}`,
  );
  if (r.etagMismatches.length) L.push(sample(r.etagMismatches));
  L.push('');
  L.push(r.ok ? '  RESULT: CLEAN' : '  RESULT: DRIFT');
  return L.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('manifestCheck.js') || entryPath.endsWith('manifestCheck.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const deep = argv.includes('--deep');
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const objectStore = argv.includes('--object-store');

  let code = 2;
  try {
    if (objectStore) {
      if (!hasStorageEnv()) {
        throw new Error(
          '--object-store needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and PG* pointed at ' +
            'the database that owns the object tier (the cloud one). Load .env.cloud.',
        );
      }
      const report = await checkObjectStore();
      if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      else process.stdout.write(formatObjectReport(report) + '\n');
      code = report.ok ? 0 : 1;
    } else {
      const report = await checkManifest({ deep });
      const failed = !report.ok || (strict && report.unknownProvenance > 0);
      if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      else process.stdout.write(formatReport(report, strict) + '\n');
      code = failed ? 1 : 0;
    }
  } catch (err) {
    process.stderr.write(`[manifest:check] could not run: ${(err as Error).message}\n`);
    code = 2;
  } finally {
    await closePool().catch(() => undefined);
  }
  process.exit(code);
}
