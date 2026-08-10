import { mkdir, rename, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  QUALITIES,
  cardCacheKey,
  cardRelativePath,
  hasStorageEnv,
  headObject,
  moveObject,
  setImageCacheKey,
  setImageRelativePath,
  type Quality,
  type SetImageKind,
} from '@deckscout/storage';
import type { Queryable } from '@deckscout/db';
import { CACHE_ROOT } from './config.js';
import { absoluteFromRelative } from './layout.js';
import { closePool, getPool } from './assets.js';

/**
 * rekey:set — re-address every cached image of a set whose upstream id changed.
 *
 * ── The problem this exists for ─────────────────────────────────────────────
 * TCGdex re-keys a set without renaming it. In 2026-08 the four SWSH Trainer
 * Gallery subsets went `swsh9.5tg` → `swsh9tg` (and 10/11/12 likewise). The
 * catalog importer now survives that and re-keys `card_set`/`card` in place
 * (DECISIONS.md 2026-08-10), but every cached image is addressed by the SET ID
 * under B6 — `images/en/swsh/<set>/<localId>.<q>.webp` on disk and in the bucket,
 * `card:<set>-<localId>:<q>` as the cache key. So the catalog moves and the art
 * does not, and 120 cards serve placeholders over bytes sitting right there under
 * the old address.
 *
 * ── Why this is a re-key and NOT a re-warm ──────────────────────────────────
 * The bytes are correct. Nothing about the images changed — upstream renamed a
 * directory. Re-fetching would be wrong twice over: it is 240 needless round
 * trips, and for these particular assets it is *impossible*, because both the old
 * and the new canonical TCGdex URLs 404 (verified 2026-08-10). These rows carry
 * `source_url IS NULL` precisely because they were warmed from another source
 * before launch and TCGdex has no copy. A "fix" that refetched would simply
 * delete 120 cards' art. So: move the bytes, move the rows, invent nothing.
 *
 * ── What it guarantees ──────────────────────────────────────────────────────
 * Provenance is carried across verbatim: `source_url`, `etag`, `kind`,
 * `content_type`, `byte_size`, `fetched_at`, `last_access_on` and `is_pinned` are
 * copied from the old row, never recomputed and never invented. A NULL
 * `source_url` stays NULL — an honest blank is the record, and re-addressing an
 * asset does not make its origin any more knowable (AGENTS.md B1).
 *
 * `image_asset.cache_key` DOES change, and it has to. The cache key is a pure
 * function of the request path (`@deckscout/storage` paths.ts `cardCacheKey`), so
 * a request for the renamed card derives `card:swsh9tg-TG01:low` and nothing will
 * ever look up the old key again. Leaving it would strand the row a second way:
 * the LRU (`touchLastAccess`, `evictionCandidates`) and the cloud fill's
 * `getManifestRow` all key on it, and the next lazy fill would try to INSERT the
 * new key against a `relative_path` UNIQUE the old row still held.
 *
 * `image_object` follows by identity — one row per physical copy, re-pointed to
 * the new key inside the same transaction. Its FK is `ON DELETE CASCADE` with no
 * `ON UPDATE` action, so `UPDATE image_asset SET cache_key = …` is rejected
 * outright (verified 2026-08-10: "still referenced from table image_object"). The
 * rows therefore move as insert-new → repoint-children → delete-old, which is the
 * same three statements an `ON UPDATE CASCADE` would have run, with every column
 * copied explicitly rather than defaulted.
 *
 * ── Tiers ───────────────────────────────────────────────────────────────────
 * Exactly like `manifest:check`, this is one command with two modes, because in
 * the cloud topology the two tiers live in different databases:
 *
 *   pnpm --filter deckscout-images rekey:set --rename swsh9.5tg:swsh9tg --dry-run
 *   pnpm --filter deckscout-images rekey:set --rename swsh9.5tg:swsh9tg
 *   (with .env.cloud loaded) … rekey:set --object-store --rename swsh9.5tg:swsh9tg
 *
 * Default mode moves FILES under IMAGE_CACHE_ROOT; `--object-store` moves OBJECTS
 * in the Supabase bucket (a server-side rename — see `moveObject`). Either way the
 * manifest rows in the connected database move with them, and the run refuses to
 * start if that database holds `image_object` rows for a tier whose bytes this run
 * is not moving — which would silently orphan the other tier's copy.
 *
 * IDEMPOTENT. A row already at the new address is counted and skipped, bytes
 * already moved are not moved again, and a run interrupted halfway is repaired by
 * re-running it. Connection budget: ONE connection, acquired once for the whole
 * run and released in a finally.
 */

interface Rename {
  from: string;
  to: string;
}

interface AssetRow {
  cache_key: string;
  kind: string;
  relative_path: string;
}

/** One asset's old and new addresses, both derived through paths.ts. */
interface Move {
  oldKey: string;
  oldPath: string;
  newKey: string;
  newPath: string;
}

export type Tier = 'disk' | 'object';

export interface RekeyOptions {
  renames: Rename[];
  tier: Tier;
  dryRun?: boolean;
}

export interface RekeyReport {
  tier: Tier;
  /** Manifest rows still addressed under an old set id. */
  candidates: number;
  /** Assets whose row and bytes both moved (or would, under --dry-run). */
  moved: number;
  /** Rows that were behind bytes an interrupted run had already moved. */
  rowsRepaired: number;
  /** Rows already addressed under the new set id before this run started. */
  alreadyAtNewId: number;
  /** Rows under the old id whose path does not round-trip through paths.ts. */
  unrecognised: string[];
  /** Both the old and the new key exist — a human has to decide. */
  conflicts: string[];
  failures: Array<{ cacheKey: string; error: string }>;
  ok: boolean;
}

// ── Address algebra ─────────────────────────────────────────────────────────
/**
 * Re-derive an asset's address under a different set id.
 *
 * The old `relative_path` is decomposed structurally and the NEW path and key are
 * rebuilt with the shared `@deckscout/storage` constructors — never by string
 * substitution on the old value. Then the OLD address is rebuilt the same way and
 * checked against what the row actually holds: a row that does not round-trip is
 * not a plain card/set asset (a `stale-duplicate:*` key, a hand-written path), and
 * this command refuses to guess at it.
 */
export function deriveMove(row: AssetRow, rename: Rename): Move | null {
  const segments = row.relative_path.split('/');

  // Card art: images/{lang}/{serie}/{set}/{localId}.{quality}.webp
  if (segments.length === 5 && segments[0] === 'images') {
    const [, , serie, set, file] = segments as [string, string, string, string, string];
    if (set !== rename.from) return null;
    const m = /^(.+)\.(low|high)\.webp$/.exec(file);
    if (!m) return null;
    const localId = m[1]!;
    const quality = m[2] as Quality;
    if (!(QUALITIES as readonly string[]).includes(quality)) return null;

    const oldRef = { serie, set: rename.from, localId };
    const newRef = { serie, set: rename.to, localId };
    if (
      cardRelativePath(oldRef, quality) !== row.relative_path ||
      cardCacheKey(oldRef, quality) !== row.cache_key
    ) {
      return null; // does not round-trip — not ours to move
    }
    return {
      oldKey: row.cache_key,
      oldPath: row.relative_path,
      newKey: cardCacheKey(newRef, quality),
      newPath: cardRelativePath(newRef, quality),
    };
  }

  // Set imagery: sets/{setId}/{logo|symbol}.webp
  if (segments.length === 3 && segments[0] === 'sets') {
    const [, setId, file] = segments as [string, string, string];
    if (setId !== rename.from) return null;
    const m = /^(logo|symbol)\.webp$/.exec(file);
    if (!m) return null;
    const kind = m[1] as SetImageKind;
    if (
      setImageRelativePath(rename.from, kind) !== row.relative_path ||
      setImageCacheKey(rename.from, kind) !== row.cache_key
    ) {
      return null;
    }
    return {
      oldKey: row.cache_key,
      oldPath: row.relative_path,
      newKey: setImageCacheKey(rename.to, kind),
      newPath: setImageRelativePath(rename.to, kind),
    };
  }

  return null;
}

// ── Guards ──────────────────────────────────────────────────────────────────
/**
 * The same narrow test the catalog importer applies before it re-keys anything:
 * the NEW id must be a set this database actually holds, and the OLD id must not
 * be. Two live sets are not a rename, and neither is a typo. Refuse both.
 */
async function assertRenamesAreReal(client: Queryable, renames: Rename[]): Promise<void> {
  const ids = [...renames.map((r) => r.from), ...renames.map((r) => r.to)];
  const { rows } = await client.query<{ tcgdex_id: string }>(
    `SELECT tcgdex_id FROM card_set WHERE tcgdex_id = ANY($1::text[])`,
    [ids],
  );
  const live = new Set(rows.map((r) => r.tcgdex_id));
  for (const r of renames) {
    if (!live.has(r.to)) {
      throw new Error(
        `--rename ${r.from}:${r.to} — no card_set row has tcgdex_id '${r.to}'. Import the ` +
          `catalog first; the art follows the catalog, never the other way round.`,
      );
    }
    if (live.has(r.from)) {
      throw new Error(
        `--rename ${r.from}:${r.to} — '${r.from}' is still a live set in this database. That is ` +
          `two sets, not a rename; re-addressing its art would strand it.`,
      );
    }
  }
}

/**
 * Refuse to move rows whose OTHER tier's bytes this run cannot move.
 *
 * `image_object` is per physical copy but `image_asset` is shared identity, so
 * re-keying the identity moves every tier's row with it. If this database records
 * a copy in a tier we are not physically re-addressing, that copy would end up at
 * the old address with a row claiming the new one — exactly the drift this command
 * exists to remove. The Pi's database holds only `disk` rows and the Supabase one
 * only `object` rows, so this never fires in the real topology; it fires on a
 * single-box deployment that runs both, where the answer is to run both modes.
 */
async function assertNoForeignTierRows(
  client: Queryable,
  keys: string[],
  tier: Tier,
): Promise<void> {
  if (keys.length === 0) return;
  const { rows } = await client.query<{ tier: string; n: string }>(
    `SELECT tier, COUNT(*) AS n FROM image_object
      WHERE cache_key = ANY($1::text[]) AND tier <> $2 GROUP BY tier`,
    [keys, tier],
  );
  if (rows.length > 0) {
    const detail = rows.map((r) => `${r.n} row(s) in tier='${r.tier}'`).join(', ');
    throw new Error(
      `this database records copies in another tier (${detail}). Re-keying the shared ` +
        `image_asset row would move those rows too while their bytes stayed at the old address. ` +
        `Run this command once per tier (default = disk, --object-store = bucket).`,
    );
  }
}

// ── Physical re-addressing, per tier ────────────────────────────────────────
async function diskHas(relativePath: string): Promise<boolean> {
  const st = await stat(absoluteFromRelative(relativePath)).catch(() => null);
  return !!st && st.isFile() && st.size > 0;
}

/**
 * Does this tier hold the bytes at `relativePath`?
 *
 * The object tier asks over the network, and `headObject` returns null for BOTH
 * "not there" and "could not ask" — a timeout, a CDN blip, a throttle all look
 * identical to an absent object. That conflation is harmless for the lazy fill
 * (worst case it re-fetches) but not here, where the answer decides whether an
 * asset is skipped. Measured on the first --dry-run of this command: 5 of 480
 * HEADs came back as "missing" for objects that answer 200 on every subsequent
 * request. So a negative is only believed after it has been repeated — a positive
 * needs no retry, since nothing invents an object.
 */
const ABSENT_CONFIRMATIONS = 3;

async function bytesExist(relativePath: string, tier: Tier): Promise<boolean> {
  if (tier === 'disk') return diskHas(relativePath);
  for (let attempt = 0; attempt < ABSENT_CONFIRMATIONS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    if ((await headObject(relativePath)) !== null) return true;
  }
  return false;
}

async function moveBytes(from: string, to: string, tier: Tier): Promise<void> {
  if (tier === 'disk') {
    const dst = absoluteFromRelative(to);
    await mkdir(dirname(dst), { recursive: true });
    await rename(absoluteFromRelative(from), dst); // same filesystem ⇒ atomic
    return;
  }
  const res = await moveObject(from, to);
  if (!res.ok) throw new Error(`storage move failed: HTTP ${res.status} ${res.error ?? ''}`);
}

// ── The re-key ──────────────────────────────────────────────────────────────
/** The three statements that move an asset's identity. Caller owns the transaction. */
async function moveRows(client: Queryable, mv: Move): Promise<void> {
  // Every column copied verbatim. fetched_at is NOT refreshed: it records when
  // these bytes were fetched, and they were not fetched again.
  const { rowCount } = await client.query(
    `INSERT INTO image_asset
       (cache_key, kind, relative_path, content_type, byte_size, source_url, etag,
        fetched_at, last_access_on, is_pinned)
     SELECT $2, kind, $3, content_type, byte_size, source_url, etag,
            fetched_at, last_access_on, is_pinned
       FROM image_asset WHERE cache_key = $1`,
    [mv.oldKey, mv.newKey, mv.newPath],
  );
  if (rowCount !== 1) throw new Error(`old row ${mv.oldKey} vanished mid-run`);

  await client.query(`UPDATE image_object SET cache_key = $2 WHERE cache_key = $1`, [
    mv.oldKey,
    mv.newKey,
  ]);
  // Children are re-pointed, so ON DELETE CASCADE has nothing left to take.
  await client.query(`DELETE FROM image_asset WHERE cache_key = $1`, [mv.oldKey]);
}

/**
 * Move ONE asset: rows first inside a transaction, bytes last, commit only once
 * the bytes have actually moved.
 *
 * The order is the opposite of `putAsset`'s, on purpose. `putAsset` records before
 * it publishes because the bytes are NEW and must never become visible unrecorded.
 * Here the bytes and their record already exist and already agree; the only
 * question is whether both ends of the move land. Doing the rows in an open
 * transaction and the byte move last means the overwhelmingly likely failure
 * (Storage says no, the file is gone) rolls the rows back and leaves the asset
 * exactly as it was — still served from the old address, still fully recorded. The
 * residual window is a crash between a successful byte move and COMMIT, which
 * leaves visible, repairable drift that re-running this command finishes.
 */
async function rekeyOne(
  client: Queryable,
  mv: Move,
  tier: Tier,
  report: RekeyReport,
): Promise<void> {
  await client.query('BEGIN');
  let bytesMoved = false;
  try {
    await moveRows(client, mv);
    await moveBytes(mv.oldPath, mv.newPath, tier);
    bytesMoved = true;
    await client.query('COMMIT');
    report.moved++;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (bytesMoved) {
      // COMMIT itself failed after the bytes landed. Put them back so the asset
      // still matches the rows we just restored, and say so if that fails too.
      await moveBytes(mv.newPath, mv.oldPath, tier).catch(() => {
        report.failures.push({
          cacheKey: mv.oldKey,
          error:
            `bytes moved to ${mv.newPath} but the row commit failed AND the move could not be ` +
            `undone — re-run this command to finish the re-key`,
        });
      });
    }
    report.failures.push({ cacheKey: mv.oldKey, error: (err as Error).message });
  }
}

/** The bytes already moved on an earlier, interrupted run; move only the rows. */
async function rekeyRowsOnly(client: Queryable, mv: Move, report: RekeyReport): Promise<void> {
  await client.query('BEGIN');
  try {
    await moveRows(client, mv);
    await client.query('COMMIT');
    report.rowsRepaired++;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    report.failures.push({ cacheKey: mv.oldKey, error: (err as Error).message });
  }
}

export async function rekeySets(opts: RekeyOptions): Promise<RekeyReport> {
  const report: RekeyReport = {
    tier: opts.tier,
    candidates: 0,
    moved: 0,
    rowsRepaired: 0,
    alreadyAtNewId: 0,
    unrecognised: [],
    conflicts: [],
    failures: [],
    ok: true,
  };

  const client = await getPool().connect();
  try {
    await assertRenamesAreReal(client, opts.renames);

    for (const rename of opts.renames) {
      // Loose match first, then a structural check per row — a LIKE with '%'
      // spans separators, so it is a candidate filter and never the decision.
      const { rows } = await client.query<AssetRow>(
        `SELECT cache_key, kind, relative_path FROM image_asset
          WHERE relative_path LIKE '%' || $1 || '%' ORDER BY relative_path`,
        [rename.from],
      );

      const moves: Move[] = [];
      for (const row of rows) {
        const mv = deriveMove(row, rename);
        if (mv) {
          moves.push(mv);
          continue;
        }
        // Only report rows that genuinely sit under the old id; the LIKE also
        // catches unrelated paths that merely contain the string.
        if (row.relative_path.split('/').includes(rename.from)) {
          report.unrecognised.push(`${row.cache_key} → ${row.relative_path}`);
        }
      }

      // Informational: how much of this rename a previous run already landed.
      // Anchored on the segment the set id occupies in each layout, so it cannot
      // count a set whose id merely contains the new one as a substring.
      const { rows: already } = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM image_asset
          WHERE relative_path LIKE 'images/%/' || $1 || '/%'
             OR relative_path LIKE 'sets/' || $1 || '/%'`,
        [rename.to],
      );
      report.alreadyAtNewId += Number(already[0]?.n ?? 0);

      report.candidates += moves.length;
      if (moves.length === 0) continue;

      await assertNoForeignTierRows(
        client,
        moves.map((m) => m.oldKey),
        opts.tier,
      );

      // Which new keys are taken already? Both-exist is a conflict a human owns.
      const { rows: taken } = await client.query<{ cache_key: string }>(
        `SELECT cache_key FROM image_asset WHERE cache_key = ANY($1::text[])`,
        [moves.map((m) => m.newKey)],
      );
      const existingNew = new Set(taken.map((r) => r.cache_key));

      process.stderr.write(
        `[rekey:set] ${rename.from} → ${rename.to}: ${moves.length} asset(s), tier=${opts.tier}\n`,
      );

      for (const mv of moves) {
        if (existingNew.has(mv.newKey)) {
          report.conflicts.push(`${mv.oldKey} and ${mv.newKey} both exist`);
          continue;
        }
        // The OLD address is asked about first, and it is the only question worth
        // paying the confirmation cost on: a positive answers in one HEAD and is
        // the overwhelmingly common case, and only its negative is load-bearing
        // (it is what makes this asset give up rather than move). The new address
        // is consulted solely to recognise a run that was interrupted after the
        // bytes moved but before the rows did.
        if (await bytesExist(mv.oldPath, opts.tier)) {
          if (opts.dryRun) report.moved++;
          else await rekeyOne(client, mv, opts.tier, report);
          if (report.moved > 0 && report.moved % 50 === 0) {
            process.stderr.write(`[rekey:set] ${report.moved} re-keyed …\n`);
          }
          continue;
        }
        if (await bytesExist(mv.newPath, opts.tier)) {
          // Bytes are already at the new address and only the row is behind —
          // the crash-after-move window. Finish the row half.
          if (opts.dryRun) report.rowsRepaired++;
          else await rekeyRowsOnly(client, mv, report);
          continue;
        }
        report.failures.push({
          cacheKey: mv.oldKey,
          error:
            `no bytes at ${mv.oldPath} in tier '${opts.tier}' — the manifest row claims a copy ` +
            `this tier does not have; nothing to re-address`,
        });
      }

      if (!opts.dryRun && opts.tier === 'disk') await pruneEmptyDirs(moves);
    }
  } finally {
    client.release();
  }

  report.ok = report.failures.length === 0 && report.conflicts.length === 0;
  return report;
}

/**
 * Remove the emptied set directory on the disk tier. Cosmetic — `manifest:check`
 * walks files, not directories — but an empty `swsh9.5tg/` sitting next to a
 * populated `swsh9tg/` is exactly the sort of thing that gets mistaken for a
 * second copy. `rmdir` fails on a non-empty directory, which is the behaviour we
 * want: anything left behind stays visible. Object storage has no directories.
 */
async function pruneEmptyDirs(moves: Move[]): Promise<void> {
  const dirs = new Set(moves.map((m) => dirname(join(CACHE_ROOT, m.oldPath))));
  for (const dir of dirs) await rmdir(dir).catch(() => undefined);
}

export function formatRekeyReport(r: RekeyReport, dryRun: boolean): string {
  const L: string[] = [];
  L.push(`set re-key — tier='${r.tier}'${dryRun ? '   (DRY RUN, nothing written)' : ''}`);
  L.push(`  rows under the old id   : ${r.candidates}`);
  L.push(`  re-keyed (rows + bytes) : ${r.moved}`);
  L.push(`  rows repaired (bytes were already moved) : ${r.rowsRepaired}`);
  L.push(`  rows already at the new id (before this run) : ${r.alreadyAtNewId}`);
  L.push(
    `  conflicts               : ${r.conflicts.length}${r.conflicts.length ? '  ← needs a human' : ''}`,
  );
  for (const c of r.conflicts.slice(0, 10)) L.push(`      ${c}`);
  L.push(
    `  unrecognised paths      : ${r.unrecognised.length}${r.unrecognised.length ? '  ← left alone' : ''}`,
  );
  for (const u of r.unrecognised.slice(0, 10)) L.push(`      ${u}`);
  L.push(`  failures                : ${r.failures.length}`);
  for (const f of r.failures.slice(0, 20)) L.push(`      ${f.cacheKey}: ${f.error}`);
  L.push('');
  L.push(r.ok ? '  RESULT: OK' : '  RESULT: INCOMPLETE');
  return L.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
// Anchored on the whole filename, not a suffix: `src/__tests__/rekeySet.test.ts`
// ends with 'rekeySet.ts' under a plain endsWith, and importing this module from
// its own test would then run the CLI (and exit the test process).
const isMain = /(?:^|[\\/])rekeySet\.(?:ts|js)$/.test(entryPath);
if (isMain) {
  const argv = process.argv.slice(2);
  const renames: Rename[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--rename') continue;
    const spec = argv[i + 1] ?? '';
    const [from, to] = spec.split(':');
    if (!from || !to) {
      process.stderr.write(`[rekey:set] --rename wants <old-set-id>:<new-set-id>, got '${spec}'\n`);
      process.exit(2);
    }
    renames.push({ from, to });
  }
  const tier: Tier = argv.includes('--object-store') ? 'object' : 'disk';
  const dryRun = argv.includes('--dry-run');

  let code = 2;
  try {
    if (renames.length === 0) {
      throw new Error(
        'nothing to do — pass at least one --rename <old>:<new>. There is no default and no ' +
          'auto-detection: the catalog no longer holds the old id, so only the operator (or the ' +
          'importer log line that warned about the rename) knows what it was.',
      );
    }
    if (tier === 'object' && !hasStorageEnv()) {
      throw new Error(
        '--object-store needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and PG* pointed at the ' +
          'database that owns the object tier (the cloud one). Load .env.cloud.',
      );
    }
    const report = await rekeySets({ renames, tier, dryRun });
    process.stdout.write(formatRekeyReport(report, dryRun) + '\n');
    code = report.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(`[rekey:set] could not run: ${(err as Error).message}\n`);
    code = 2;
  } finally {
    await closePool().catch(() => undefined);
  }
  process.exit(code);
}
