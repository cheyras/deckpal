import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { CACHE_ROOT } from './config.js';
import { closePool, getPool } from './assets.js';
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

  const orphans: string[] = [];
  for (const rel of diskByRel.keys()) if (!manifestByRel.has(rel)) orphans.push(rel);

  const missingFiles: string[] = [];
  const sizeMismatches: DriftReport['sizeMismatches'] = [];
  const typeMismatches: DriftReport['typeMismatches'] = [];

  for (const [rel, row] of manifestByRel) {
    const abs = diskByRel.get(rel);
    if (!abs) {
      missingFiles.push(rel);
      continue;
    }
    const s = await stat(abs);
    if (s.size !== row.byte_size) {
      sizeMismatches.push({ relativePath: rel, recorded: row.byte_size, actual: s.size });
    }
    if (opts.deep) {
      const actual = await sniffFile(abs, s.size);
      if (actual !== row.content_type) {
        typeMismatches.push({ relativePath: rel, recorded: row.content_type, actual });
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
    ok:
      orphans.length === 0 &&
      missingFiles.length === 0 &&
      sizeMismatches.length === 0 &&
      typeMismatches.length === 0,
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

// ── CLI ─────────────────────────────────────────────────────────────────────
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('manifestCheck.js') || entryPath.endsWith('manifestCheck.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const deep = argv.includes('--deep');
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');

  let code = 2;
  try {
    const report = await checkManifest({ deep });
    const failed = !report.ok || (strict && report.unknownProvenance > 0);
    if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else process.stdout.write(formatReport(report, strict) + '\n');
    code = failed ? 1 : 0;
  } catch (err) {
    process.stderr.write(`[manifest:check] could not run: ${(err as Error).message}\n`);
    code = 2;
  } finally {
    await closePool().catch(() => undefined);
  }
  process.exit(code);
}
