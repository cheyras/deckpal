import { stat } from 'node:fs/promises';
import {
  fromUrl,
  hasStorageEnv,
  headObject,
  listObjectsRecursive,
  putStorageAssetFromFile,
  unknownProvenance,
  upsertImageObjectRow,
  type ImageAssetKind,
  type Provenance,
} from '@deckpal/storage';
import { absoluteFromRelative } from './layout.js';
import { closePool, getPool } from './assets.js';

/**
 * storage:backfill — mirror part of the local image cache into the cloud object
 * tier, THROUGH the choke point.
 *
 * Why this exists as a command in the images app rather than a script under
 * `scripts/`: AGENTS.md B1 says bulk fills belong where the contract lives, and
 * the reason is not tidiness. A direct upload publishes bytes without an
 * `image_asset` row (provenance) or an `image_object` row (this copy's size,
 * type and etag). That is how the disk cache came to hold 1,970 files nobody
 * could account for (DECISIONS.md 2026-08-07), and a direct upload to the bucket
 * reproduces it one tier up. Everything here goes through
 * `putStorageAssetFromFile`, which is `putStorageAsset` with the bytes read off
 * local disk — same required provenance, same rows, same ordering.
 *
 * What the lazy cloud fill cannot do: it recovers only what upstream still
 * serves. 1,854 card rows carry `source_url IS NULL` because their canonical
 * TCGdex URL 404s — they were warmed from another source before launch — so
 * there is no URL to fetch and they serve the placeholder forever. Their bytes
 * exist only in this cache. Those are what `--missing-source` targets.
 *
 *   pnpm --filter deckpal-images storage:backfill --missing-source --dry-run
 *   pnpm --filter deckpal-images storage:backfill --missing-source
 *   pnpm --filter deckpal-images storage:backfill --prefix sets
 *   pnpm --filter deckpal-images storage:backfill --reconcile
 *
 * Flags:
 *   --missing-source   work-list = rows with source_url IS NULL (the unrecoverable set)
 *   --prefix <p>       work-list = rows whose relative_path starts `<p>/`
 *   --reconcile        walk the BUCKET and record a per-tier row for every object
 *                      already there. Repairs objects published out of band.
 *   --dry-run          report, write nothing
 *   --force            re-upload even when the object already exists
 *   --limit <n>        stop after n uploads
 *   --concurrency <n>  parallel uploads (default 3; Supabase throttles above ~5)
 *
 * IDEMPOTENT AND RESUMABLE. An object that is already in the bucket is not
 * re-uploaded — but its per-tier row IS still recorded, from the object's own
 * metadata. That is what makes a re-run repair a previous partial run, and what
 * regularises bytes some other writer put there. `--reconcile` does the same for
 * the whole bucket without a work-list, for objects no work-list would name.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the object tier; PG* for the
 * work-list, which comes from the manifest database. Connection budget: ONE
 * connection (the shared images pool), closed in a finally.
 */

interface WorkItem {
  cacheKey: string;
  kind: ImageAssetKind;
  relativePath: string;
  sourceUrl: string | null;
  etag: string | null;
}

export interface CloudBackfillOptions {
  missingSource?: boolean;
  prefix?: string;
  reconcile?: boolean;
  dryRun?: boolean;
  force?: boolean;
  limit?: number;
  concurrency?: number;
}

export interface CloudBackfillReport {
  workItems: number;
  uploaded: number;
  bytesSent: number;
  skippedExisting: number;
  /** Per-tier rows written for objects that were already in the bucket. */
  rowsRepaired: number;
  missingFiles: number;
  reconciledObjects: number;
  failures: Array<{ relativePath: string; error: string }>;
}

/**
 * Provenance for a mirrored file — decided from the manifest, never invented.
 *
 * A row that already records a `source_url` recorded it because THIS project
 * fetched the bytes from there; copying that file to another tier does not make
 * the origin less true, so the URL carries over. A row with NULL provenance has
 * none to carry, and the honest statement is why — never a plausible URL, which
 * would make `manifest:check` report full coverage over a fiction.
 *
 * Either way, the target row already exists in the cloud manifest, so this value
 * is what WOULD be written for a fresh row rather than an overwrite of someone
 * else's attestation (`insertManifestRow` treats a duplicate as 'exists').
 */
export function mirrorProvenance(item: WorkItem): Provenance {
  if (item.sourceUrl) return fromUrl(item.sourceUrl, item.etag);
  return unknownProvenance(
    `mirrored from the self-host disk cache at ${item.relativePath}; this asset has no ` +
      `resolvable upstream URL — its canonical TCGdex URL 404s and manifest:backfill ` +
      `therefore left source_url NULL rather than guessing. The bytes are attested only ` +
      `as "the copy this project has held since before launch".`,
  );
}

async function loadWorkList(opts: CloudBackfillOptions): Promise<WorkItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.missingSource) where.push('source_url IS NULL');
  if (opts.prefix) {
    params.push(`${opts.prefix}/%`);
    where.push(`relative_path LIKE $${params.length}`);
  }
  // Stale duplicates sit at a path nothing serves (see manifestBackfill.ts); the
  // cloud tier has no reason to carry dead weight.
  where.push(`cache_key NOT LIKE 'stale-duplicate:%'`);

  const { rows } = await getPool().query<{
    cache_key: string;
    kind: ImageAssetKind;
    relative_path: string;
    source_url: string | null;
    etag: string | null;
  }>(
    `SELECT cache_key, kind, relative_path, source_url, etag
       FROM image_asset
      WHERE ${where.join(' AND ')}
      ORDER BY relative_path`,
    params,
  );
  return rows.map((r) => ({
    cacheKey: r.cache_key,
    kind: r.kind,
    relativePath: r.relative_path,
    sourceUrl: r.source_url,
    etag: r.etag,
  }));
}

/**
 * Record per-tier rows for objects ALREADY in the bucket, from the bucket's own
 * metadata (size, mimetype, MD5 etag) rather than from the local file — because
 * the question being answered is "what does the object tier hold", and only the
 * bucket can answer that.
 *
 * Sprites are skipped: they carry no `image_asset` row by design (one pinned
 * upstream SHA is the provenance for the whole tree — paths.ts `SPRITES_SHA`), so
 * `image_object.cache_key`'s foreign key cannot reference them.
 */
async function reconcileBucket(
  report: CloudBackfillReport,
  dryRun: boolean,
): Promise<void> {
  const { rows } = await getPool().query<{ cache_key: string; relative_path: string }>(
    `SELECT cache_key, relative_path FROM image_asset`,
  );
  const keyByPath = new Map(rows.map((r) => [r.relative_path, r.cache_key]));

  await listObjectsRecursive('', async (objects) => {
    for (const obj of objects) {
      if (obj.path.startsWith('sprites/')) continue;
      const cacheKey = keyByPath.get(obj.path);
      if (!cacheKey) {
        report.failures.push({
          relativePath: obj.path,
          error: 'object has no image_asset row — cannot record a per-tier row for it',
        });
        continue;
      }
      report.reconciledObjects++;
      if (dryRun) continue;
      try {
        await upsertImageObjectRow({
          cacheKey,
          tier: 'object',
          byteSize: obj.byteSize,
          contentType: obj.contentType,
          etag: obj.etag,
        });
        report.rowsRepaired++;
        if (report.rowsRepaired % 500 === 0) {
          process.stderr.write(`[storage:backfill] reconciled ${report.rowsRepaired} rows …\n`);
        }
      } catch (err) {
        report.failures.push({ relativePath: obj.path, error: (err as Error).message });
      }
    }
  });
}

export async function cloudBackfill(opts: CloudBackfillOptions): Promise<CloudBackfillReport> {
  const report: CloudBackfillReport = {
    workItems: 0,
    uploaded: 0,
    bytesSent: 0,
    skippedExisting: 0,
    rowsRepaired: 0,
    missingFiles: 0,
    reconciledObjects: 0,
    failures: [],
  };

  if (opts.reconcile) {
    await reconcileBucket(report, !!opts.dryRun);
    return report;
  }

  const work = await loadWorkList(opts);
  report.workItems = work.length;
  process.stderr.write(`[storage:backfill] work-list: ${work.length} manifest rows\n`);

  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  const concurrency = Math.max(1, Math.min(16, opts.concurrency ?? 3));
  const queue = work.slice();

  const worker = async (): Promise<void> => {
    for (;;) {
      if (report.uploaded >= limit) return;
      const item = queue.shift();
      if (!item) return;
      const abs = absoluteFromRelative(item.relativePath);
      try {
        // Already published? Do not re-send 65 KB to prove it — but DO record the
        // per-tier row from the object's OWN metadata, which is what makes a
        // re-run repair a partial one (and regularise bytes some other writer
        // published). The existence check is a HEAD either way, so asking for the
        // metadata at the same time costs nothing and saves a second sweep.
        const existing = opts.force ? null : await headObject(item.relativePath);
        if (existing) {
          report.skippedExisting++;
          if (!opts.dryRun) {
            await upsertImageObjectRow({
              cacheKey: item.cacheKey,
              tier: 'object',
              byteSize: existing.byteSize,
              contentType: existing.contentType,
              etag: existing.etag,
            });
            report.rowsRepaired++;
          }
          continue;
        }
        const st = await stat(abs).catch(() => null);
        if (!st || !st.isFile() || st.size === 0) {
          report.missingFiles++;
          continue;
        }
        if (opts.dryRun) {
          report.uploaded++;
          report.bytesSent += st.size;
          continue;
        }
        const res = await putStorageAssetFromFile({
          cacheKey: item.cacheKey,
          kind: item.kind,
          relativePath: item.relativePath,
          absolutePath: abs,
          provenance: mirrorProvenance(item),
        });
        report.uploaded++;
        report.bytesSent += res.byteSize;
        if (!res.objectRecorded) {
          report.failures.push({
            relativePath: item.relativePath,
            error: 'uploaded but image_object row was not recorded — re-run with --reconcile',
          });
        }
        if (report.uploaded % 200 === 0) {
          process.stderr.write(
            `[storage:backfill] ${report.uploaded} uploaded ` +
              `(${(report.bytesSent / 1024 / 1024).toFixed(1)} MB) …\n`,
          );
        }
      } catch (err) {
        report.failures.push({ relativePath: item.relativePath, error: (err as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return report;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('cloudBackfill.js') || entryPath.endsWith('cloudBackfill.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const val = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const opts: CloudBackfillOptions = {
    missingSource: argv.includes('--missing-source'),
    prefix: val('prefix'),
    reconcile: argv.includes('--reconcile'),
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    limit: Number(val('limit') ?? 0) || undefined,
    concurrency: Number(val('concurrency') ?? 0) || undefined,
  };

  let code = 2;
  try {
    if (!hasStorageEnv()) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (load .env.cloud)');
    }
    if (!opts.reconcile && !opts.missingSource && !opts.prefix) {
      throw new Error(
        'choose a work-list: --missing-source, --prefix <sets|images>, or --reconcile. ' +
          'There is no default, because the full mirror is 2.1 GB.',
      );
    }
    const r = await cloudBackfill(opts);
    process.stdout.write(
      [
        '',
        `storage backfill${opts.dryRun ? ' — DRY RUN, nothing written' : ''}`,
        `  work-list rows         : ${r.workItems}`,
        `  uploaded               : ${r.uploaded} (${(r.bytesSent / 1024 / 1024).toFixed(2)} MB)`,
        `  already in bucket      : ${r.skippedExisting}`,
        `  per-tier rows recorded : ${r.rowsRepaired}   (objects reconciled: ${r.reconciledObjects})`,
        `  files absent on disk   : ${r.missingFiles}`,
        `  failures               : ${r.failures.length}`,
        ...r.failures.slice(0, 20).map((f) => `      ${f.relativePath}: ${f.error}`),
        '',
      ].join('\n'),
    );
    code = r.failures.length ? 1 : 0;
  } catch (err) {
    process.stderr.write(`[storage:backfill] fatal: ${(err as Error).message}\n`);
    code = 2;
  } finally {
    await closePool().catch(() => undefined);
  }
  process.exit(code);
}
