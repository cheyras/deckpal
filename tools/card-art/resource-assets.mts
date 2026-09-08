/**
 * resource-assets.mts — replace out-of-policy card-art bytes with bytes from the
 * approved fallback, and produce an exact, reviewable apply plan.
 *
 * UNTRACKED (Project Holo subtask 2c PREP). Run from the repo root.
 *
 * ── THIS SCRIPT NEVER TOUCHES THE DATABASE OR THE BUCKET ────────────────────
 *
 * That is a design constraint, not a limitation. It reads a JSON row dump
 * (`tools/card-art/dump-affected.sql`, run once by the operator), resolves each
 * row through the crosswalk, downloads bytes into a **staging tree shaped
 * exactly like IMAGE_CACHE_ROOT**, and emits SQL. Publishing those bytes is then
 * the SHIPPED command:
 *
 *     IMAGE_CACHE_ROOT=<stage> pnpm --filter deckpal-images storage:backfill \
 *        --prefix images --force
 *
 * which goes through `putStorageAssetFromFile` → `putStorageAsset`, the B1 choke
 * point, and therefore writes the `image_asset` and `image_object` rows the same
 * way every other byte in the bucket was written. A second upload implementation
 * here would be a second thing to keep in step with the provenance rules, which
 * is exactly the class of bug B1 exists to prevent (DECISIONS.md 2026-08-07:
 * 1,970 files on disk with no manifest row, from ad-hoc gap-fill scripts).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   # 1. dry run — resolves everything, downloads nothing, writes the plan
 *   npx tsx tools/card-art/resource-assets.mts
 *
 *   # 2. same, but HEAD-check every resolved URL (no bytes stored)
 *   npx tsx tools/card-art/resource-assets.mts --verify
 *
 *   # 3. for real: download + measure + stage + emit SQL
 *   npx tsx tools/card-art/resource-assets.mts --fetch
 *
 *   # narrow while iterating
 *   npx tsx tools/card-art/resource-assets.mts --fetch --sets swsh9tg,swsh10tg
 *   npx tsx tools/card-art/resource-assets.mts --fetch --limit 20
 *
 * Flags:
 *   --dump <file>       row dump from dump-affected.sql   (default tools/card-art/affected.json)
 *   --crosswalk <file>  from build-crosswalk.mts          (default tools/card-art/crosswalk.json)
 *   --out <dir>         plan + SQL + no-art list          (default tools/card-art/out)
 *   --stage <dir>       IMAGE_CACHE_ROOT-shaped bytes     (default tools/card-art/stage)
 *   --fetch             actually download and stage bytes. WITHOUT THIS, DRY RUN.
 *   --verify            HEAD every resolved URL (implied by --fetch)
 *   --encode webp|none  transcode to WebP (DEFAULT) or store verbatim — see below
 *   --sets a,b,c        restrict to these TCGdex set ids
 *   --limit <n>         stop after n assets
 *   --recheck           re-download assets already staged
 *
 * ── IDEMPOTENT AND RESUMABLE ────────────────────────────────────────────────
 *
 * A staged file that still measures correctly is not re-downloaded, so an
 * interrupted run resumes. The emitted SQL is guarded (`AND source_url IS NULL
 * OR host not approved`), so applying it twice is a no-op and it can never
 * overwrite provenance somebody else established. The upload is an upsert on a
 * key that is a pure function of the card ref, so re-running it is also a no-op.
 *
 * ── --encode: webp is the default, and what it costs ────────────────────────
 *
 * pokemontcg.io serves PNG. The tier's whole path algebra is WebP
 * (`cardRelativePath` hardcodes `.webp`), and the size difference is not
 * marginal — MEASURED over ten assets across five eras on 2026-08-31:
 *
 *   verbatim PNG   5.50 MB      →  WebP q82  0.58 MB     (9.5x)
 *   e.g. mcd16 hires 1,833 KB PNG  →  142 KB WebP at 600x837
 *
 * Extrapolated over ~1,850 affected rows that is roughly **800 MB of PNG versus
 * ~85 MB of WebP** in the bucket, plus the egress on every cold CDN fetch.
 *
 * The honesty cost is exactly one column. `image_asset.etag` is documented as
 * "the UPSTREAM validator we were given when the bytes were fetched" (migration
 * 025). After a re-encode it no longer validates OUR bytes, so it is written
 * **NULL** — the same "an honest blank beats a plausible lie" rule the
 * provenance columns already follow — and the plan records `encoded: 'webp'`
 * plus the measured dimensions of both the source and the stored file.
 * `source_url` stays exactly true either way: it is where the image came from.
 *
 *   --encode webp  (default) — resized DOWN to the slot width where larger,
 *                  never up. `etag` NULL.
 *   --encode none  — bytes stored byte-for-byte as served, `etag` is upstream's
 *                  and is TRUE of the stored bytes. ~9.5x the storage.
 *
 * The content type is SNIFFED from the bytes either way — a PNG stored under a
 * `.webp` key is recorded and served as `image/png`, which the tier already does
 * for the `me05` set logo (fetch-source.ts EXTENSION_LADDER).
 *
 * ── THE TRAP THIS SCRIPT REFUSES TO FALL INTO ───────────────────────────────
 *
 * Wrong art is worse than no art. Every candidate is checked three ways before a
 * byte is staged: the crosswalk's own name check (build-crosswalk.mts), a
 * measured pixel size at or above the slot it fills, and a magic-byte sniff. A
 * card that fails any of them goes on the no-art list with the reason, and is
 * never filled from a "close enough" neighbour.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
import { requestWithRetries } from './http.mts';

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (n: string): boolean => argv.includes(`--${n}`);
function opt(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : fallback;
}

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DUMP = resolve(opt('dump', join(HERE, 'affected.json')));
const CROSSWALK = resolve(opt('crosswalk', join(HERE, 'crosswalk.json')));
const OUT = resolve(opt('out', join(HERE, 'out')));
const STAGE = resolve(opt('stage', join(HERE, 'stage')));
const FETCH = has('fetch');
const VERIFY = has('verify') || FETCH;
const RECHECK = has('recheck');
const ENCODE = opt('encode', 'webp') as 'none' | 'webp';
const ONLY_SETS = opt('sets', '') ? new Set(opt('sets', '').split(',').map((s) => s.trim())) : null;
const LIMIT = Number(opt('limit', '0')) || Infinity;

if (ENCODE !== 'none' && ENCODE !== 'webp') {
  throw new Error(`--encode must be 'none' or 'webp', got ${JSON.stringify(ENCODE)}`);
}

// ── The two real resolutions ────────────────────────────────────────────────
/**
 * Mirrors `QUALITIES` in `packages/storage/src/paths.ts` and DATA-LAYER §3.4.
 *
 * TWO thresholds per slot, and the distinction is load-bearing:
 *
 *   `target*` — what `CardImage`'s `srcSet` advertises (`{low} 245w, {high}
 *               600w`). An asset below this is usable but softer than the markup
 *               claims, so it is stored AND flagged `undersized` in the plan.
 *   `min*`    — the hard floor. Below this it is not a card scan and is refused.
 *
 * MEASURED 2026-08-31, and it is why the two thresholds exist —
 * `CARD-ART-SOURCES.md` §2.2's "600×825 or better" holds across the 592-card
 * residue but NOT across the whole catalog:
 *
 *   swsh9tg TG01  hires 734×1024   low 245×342
 *   sv1 1         hires 734×1024   low 245×342
 *   mcd16 1       hires 734×1024   low 245×342
 *   base1 4       hires 600×825    low **240×330**  ← 5 px under the low target
 *   ex1 1         hires **400×550** low 245×342     ← well under the high target
 *
 * Refusing those two would put WOTC- and EX-era cards on the no-art list while
 * the only alternative on offer is the out-of-policy bytes this whole task
 * exists to remove. An in-policy 400×550 scan beats an out-of-policy 600×825
 * one, and the flag keeps the trade-off visible instead of silent.
 */
const SLOTS = {
  low: { targetWidth: 245, targetHeight: 337, minWidth: 200, minHeight: 275 },
  high: { targetWidth: 600, targetHeight: 825, minWidth: 400, minHeight: 550 },
} as const;
type Quality = keyof typeof SLOTS;

/**
 * The one host these bytes may come from. Asserted before every fetch, because
 * the crosswalk's URLs are copied from an upstream response rather than composed
 * here — and a value copied from a response is exactly the kind of thing an
 * allow-list is for (packages/storage/src/upstream.ts).
 */
const IMAGE_HOST = 'images.pokemontcg.io';

/** Hosts an `image_asset.source_url` may name after this work lands. */
const APPROVED_HOSTS = [
  'assets.tcgdex.net',
  'raw.githubusercontent.com',
  'images.pokemontcg.io',
  'archives.bulbagarden.net',
];

// ── Shapes ───────────────────────────────────────────────────────────────────
interface DumpRow {
  cacheKey: string;
  kind: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  sourceUrl: string | null;
  sourceHost: string | null;
  etag: string | null;
  affectedReason: string;
  quality: string;
  cardTcgdexId: string | null;
  localId: string | null;
  cardName: string | null;
  setTcgdexId: string | null;
  setName: string | null;
  seriesTcgdexId: string | null;
  objectTiers: Record<string, unknown> | null;
}
interface Dump {
  generatedAt: string;
  summary: Record<string, number>;
  manifestTotals?: Record<string, number>;
  rows: DumpRow[];
  cardsWithNoAssetRow?: Array<{
    cardTcgdexId: string;
    localId: string;
    cardName: string;
    setTcgdexId: string;
    seriesTcgdexId: string;
  }>;
}
interface CardLink {
  id: string;
  number: string;
  name: string;
  low: string | null;
  high: string | null;
  via: string;
}
interface CrosswalkSet {
  tcgdexSetId: string;
  ptcgioSetId: string | null;
  ptcgioName: string | null;
  match: string;
  review: boolean;
  numbering: {
    map: Record<string, CardLink>;
    numbers: string[];
    unmatched: Array<{ localId: string; reason: string; detail?: string }>;
  } | null;
}
interface Crosswalk {
  generated: string;
  sets: Record<string, CrosswalkSet>;
}

type Outcome =
  | { status: 'resolved'; url: string }
  | { status: 'staged'; url: string }
  | { status: 'unavailable'; reason: string; detail?: string }
  | { status: 'skipped'; reason: string };

interface PlanEntry {
  cacheKey: string;
  relativePath: string;
  kind: string;
  quality: string;
  cardTcgdexId: string | null;
  cardName: string | null;
  setTcgdexId: string | null;
  seriesTcgdexId: string | null;
  localId: string | null;
  ptcgioSetId?: string | null;
  ptcgioNumber?: string | null;
  /** pokemontcg.io card id the URL belongs to, and which crosswalk rung matched it. */
  ptcgioId?: string;
  matchedVia?: string;
  sourceUrl?: string;
  /** Facts about the bytes we staged. Absent in a dry run. */
  stored?: {
    byteSize: number;
    contentType: string;
    width: number;
    height: number;
    /** True when the stored asset is smaller than the srcSet width the app advertises. */
    undersized: boolean;
    /** Supabase Storage's etag for the object is the MD5 of its content. */
    md5: string;
    sha256: string;
    /** Upstream's validator. NULL when we re-encoded and it no longer applies. */
    upstreamEtag: string | null;
    encoded: 'verbatim' | 'webp';
  };
  outcome: Outcome;
  previous: { sourceUrl: string | null; sourceHost: string | null; byteSize: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const sqlStr = (v: string | null): string =>
  v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;

function sniff(bytes: Buffer): string {
  const b = bytes;
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return 'application/octet-stream';
}

async function loadJson<T>(file: string, what: string): Promise<T> {
  if (!existsSync(file)) {
    throw new Error(
      `[resource] ${what} not found at ${file}. ` +
        (what === 'row dump'
          ? 'Produce it with: psql "$DATABASE_URL" -X -A -t -f tools/card-art/dump-affected.sql > tools/card-art/affected.json'
          : 'Produce it with: npx tsx tools/card-art/build-crosswalk.mts'),
    );
  }
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

// ── Resolution ───────────────────────────────────────────────────────────────
/**
 * Decide the approved URL for one affected row, or say why there is none.
 * PURE — no network. Every rejection carries a machine-readable reason code that
 * ends up verbatim in the published no-art list.
 */
export function resolveRow(
  row: DumpRow,
  crosswalk: Crosswalk,
):
  | { url: string; ptcgioSetId: string; ptcgioId: string; number: string; via: string }
  | { reason: string; detail?: string } {
  if (row.kind !== 'card') {
    return {
      reason: 'not-card-art',
      detail:
        `kind='${row.kind}' — set logos and symbols are sourced by the owner-approved ` +
        `crosswalk in packages/storage/src/setImageFallback.ts, not by this pipeline`,
    };
  }
  if (!row.setTcgdexId || !row.localId) {
    return {
      reason: 'orphan-row',
      detail: `no catalog card matches cache_key '${row.cacheKey}'`,
    };
  }
  const quality = row.quality as Quality;
  if (!(quality in SLOTS)) {
    return { reason: 'unknown-quality', detail: `quality='${row.quality}'` };
  }

  const set = crosswalk.sets[row.setTcgdexId];
  if (!set) {
    return {
      reason: 'set-not-in-crosswalk',
      detail: `TCGdex set '${row.setTcgdexId}' was not in the catalog the crosswalk was built from; rebuild it`,
    };
  }
  if (!set.ptcgioSetId || !set.numbering) {
    return {
      reason: set.match === 'known-absent' ? 'set-not-carried' : 'set-unmapped',
      detail: `no pokemontcg.io counterpart for TCGdex set '${row.setTcgdexId}'`,
    };
  }

  const unmatched = set.numbering.unmatched.find((u) => u.localId === row.localId);
  if (unmatched) {
    return {
      reason: `number-${unmatched.reason}`,
      detail:
        unmatched.detail ??
        `local id '${row.localId}' has no unambiguous counterpart in ${set.ptcgioSetId}`,
    };
  }

  const link = set.numbering.map[row.localId];
  if (!link) {
    return {
      reason: 'number-no-such-number',
      detail: `local id '${row.localId}' has no counterpart in pokemontcg.io set ${set.ptcgioSetId}`,
    };
  }

  // The URL is the one pokemontcg.io reported for THIS card, never a template.
  // See build-crosswalk.mts `CardLink` for the cel25c evidence that a template
  // silently serves the wrong art.
  const url = quality === 'high' ? link.high : link.low;
  if (!url) {
    return {
      reason: 'no-image-url',
      detail: `${link.id} carries no ${quality}-slot image upstream`,
    };
  }

  // Destination control. The crosswalk's URLs come from an upstream response, so
  // they are checked here rather than trusted — same principle as
  // packages/storage/src/upstream.ts, one layer out.
  let host: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:') throw new Error('not https');
  } catch {
    return { reason: 'bad-source-url', detail: `crosswalk URL is not a usable https URL: ${url}` };
  }
  if (host !== IMAGE_HOST) {
    return { reason: 'bad-source-url', detail: `host '${host}' is not the approved image host` };
  }

  return {
    url,
    ptcgioSetId: set.ptcgioSetId,
    ptcgioId: link.id,
    number: link.number,
    via: link.via,
  };
}

// ── Fetch + measure + stage ──────────────────────────────────────────────────
async function stageAsset(
  entry: PlanEntry,
  url: string,
  quality: Quality,
): Promise<{ ok: true } | { ok: false; reason: string; detail: string }> {
  const abs = join(STAGE, entry.relativePath);

  if (!RECHECK && existsSync(abs)) {
    // Resume: trust a staged file only after re-measuring it. A truncated
    // download from an interrupted run is exactly what this catches.
    try {
      const bytes = await readFile(abs);
      const meta = await sharp(bytes).metadata();
      const slot = SLOTS[quality];
      if ((meta.width ?? 0) >= slot.minWidth && (meta.height ?? 0) >= slot.minHeight) {
        entry.stored = {
          byteSize: bytes.length,
          contentType: sniff(bytes),
          width: meta.width!,
          height: meta.height!,
          undersized:
            (meta.width ?? 0) < slot.targetWidth || (meta.height ?? 0) < slot.targetHeight,
          md5: createHash('md5').update(bytes).digest('hex'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          upstreamEtag: entry.stored?.upstreamEtag ?? null,
          encoded: ENCODE === 'webp' ? 'webp' : 'verbatim',
        };
        return { ok: true };
      }
    } catch {
      /* fall through and refetch */
    }
  }

  const res = await requestWithRetries(url, 'GET');
  if (!res.ok) {
    return { ok: false, reason: 'upstream-miss', detail: `HTTP ${res.status} for ${url}` };
  }
  const declared = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!declared.startsWith('image/')) {
    return {
      ok: false,
      reason: 'upstream-not-an-image',
      detail: `content-type '${declared || '(none)'}' from ${url} (soft-404 trap)`,
    };
  }
  let bytes = res.bytes;
  const sniffed = sniff(bytes);
  if (sniffed === 'application/octet-stream') {
    return {
      ok: false,
      reason: 'upstream-not-an-image',
      detail: `magic bytes are not a recognised raster image (${bytes.length} bytes) from ${url}`,
    };
  }

  // MEASURE. The slot floor is a pixel fact, not a promise from the source.
  let meta: SharpMetadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch (err) {
    return { ok: false, reason: 'undecodable', detail: `${(err as Error).message} for ${url}` };
  }
  const slot = SLOTS[quality];
  if ((meta.width ?? 0) < slot.minWidth || (meta.height ?? 0) < slot.minHeight) {
    return {
      ok: false,
      reason: 'below-slot',
      detail:
        `${meta.width}×${meta.height} from ${url} is under the hard floor for the ${quality} slot ` +
        `(${slot.minWidth}×${slot.minHeight}); that is a thumbnail, not a card scan.`,
    };
  }
  const undersized =
    (meta.width ?? 0) < slot.targetWidth || (meta.height ?? 0) < slot.targetHeight;

  const upstreamEtag = res.headers.get('etag');
  let encoded: 'verbatim' | 'webp' = 'verbatim';
  if (ENCODE === 'webp') {
    // Resize DOWN only, and only to the ADVERTISED width. Upscaling would
    // manufacture detail and then record it as a measurement, which is the same
    // lie as an invented source_url.
    const pipeline = sharp(bytes);
    if ((meta.width ?? 0) > slot.targetWidth) pipeline.resize({ width: slot.targetWidth });
    bytes = await pipeline.webp({ quality: 82, effort: 5 }).toBuffer();
    meta = await sharp(bytes).metadata();
    encoded = 'webp';
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);

  entry.stored = {
    byteSize: bytes.length,
    contentType: sniff(bytes),
    width: meta.width!,
    height: meta.height!,
    undersized,
    md5: createHash('md5').update(bytes).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    // Upstream's validator is true of upstream's bytes. After a re-encode it is
    // not true of ours, so it is dropped rather than carried.
    upstreamEtag: encoded === 'verbatim' ? upstreamEtag : null,
    encoded,
  };
  return { ok: true };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const dump = await loadJson<Dump>(DUMP, 'row dump');
  const crosswalk = await loadJson<Crosswalk>(CROSSWALK, 'crosswalk');
  await mkdir(OUT, { recursive: true });

  const rows = dump.rows.filter((r) => !ONLY_SETS || (r.setTcgdexId && ONLY_SETS.has(r.setTcgdexId)));
  const plan: PlanEntry[] = [];
  let processed = 0;

  for (const row of rows) {
    const entry: PlanEntry = {
      cacheKey: row.cacheKey,
      relativePath: row.relativePath,
      kind: row.kind,
      quality: row.quality,
      cardTcgdexId: row.cardTcgdexId,
      cardName: row.cardName,
      setTcgdexId: row.setTcgdexId,
      seriesTcgdexId: row.seriesTcgdexId,
      localId: row.localId,
      outcome: { status: 'skipped', reason: 'not-reached' },
      previous: { sourceUrl: row.sourceUrl, sourceHost: row.sourceHost, byteSize: row.byteSize },
    };
    plan.push(entry);

    const resolved = resolveRow(row, crosswalk);
    if ('reason' in resolved) {
      entry.outcome = { status: 'unavailable', reason: resolved.reason, detail: resolved.detail };
      continue;
    }
    entry.ptcgioSetId = resolved.ptcgioSetId;
    entry.ptcgioNumber = resolved.number;
    entry.ptcgioId = resolved.ptcgioId;
    entry.matchedVia = resolved.via;
    entry.sourceUrl = resolved.url;

    if (processed >= LIMIT) {
      entry.outcome = { status: 'skipped', reason: 'past --limit' };
      continue;
    }

    processed++;
    if (!VERIFY) {
      entry.outcome = { status: 'resolved', url: resolved.url };
      continue;
    }

    if (!FETCH) {
      const head = await requestWithRetries(resolved.url, 'HEAD');
      entry.outcome = head.ok
        ? { status: 'resolved', url: resolved.url }
        : { status: 'unavailable', reason: 'upstream-miss', detail: `HEAD ${head.status}` };
      if (processed % 25 === 0) console.log(`[resource] verified ${processed}…`);
      continue;
    }

    // One bad asset must never abort a 1,850-asset run: a thrown error is
    // recorded against the row and the run continues, so the plan still names
    // every card and a re-run picks up exactly what is missing.
    let staged: Awaited<ReturnType<typeof stageAsset>>;
    try {
      staged = await stageAsset(entry, resolved.url, row.quality as Quality);
    } catch (err) {
      staged = { ok: false, reason: 'stage-error', detail: (err as Error).message };
    }
    entry.outcome = staged.ok
      ? { status: 'staged', url: resolved.url }
      : { status: 'unavailable', reason: staged.reason, detail: staged.detail };
    if (processed % 25 === 0) console.log(`[resource] staged ${processed}/${rows.length}…`);
  }

  await writeArtifacts(plan, dump, crosswalk);
}

// ── Artifacts ────────────────────────────────────────────────────────────────
async function writeArtifacts(plan: PlanEntry[], dump: Dump, crosswalk: Crosswalk): Promise<void> {
  const ok = plan.filter((p) => p.outcome.status === 'staged' || p.outcome.status === 'resolved');
  const staged = plan.filter((p) => p.outcome.status === 'staged');
  const unavailable = plan.filter((p) => p.outcome.status === 'unavailable');
  const skipped = plan.filter((p) => p.outcome.status === 'skipped');

  const byReason: Record<string, number> = {};
  for (const p of unavailable) {
    const r = (p.outcome as { reason: string }).reason;
    byReason[r] = (byReason[r] ?? 0) + 1;
  }

  await writeFile(
    join(OUT, 'plan.json'),
    `${JSON.stringify(
      {
        generated: new Date().toISOString(),
        mode: FETCH ? 'fetch' : VERIFY ? 'verify' : 'dry-run',
        encode: ENCODE,
        dumpGeneratedAt: dump.generatedAt,
        crosswalkGenerated: crosswalk.generated,
        stageDir: STAGE,
        counts: {
          rows: plan.length,
          resolved: ok.length,
          staged: staged.length,
          unavailable: unavailable.length,
          skipped: skipped.length,
          stagedBytes: staged.reduce((n, p) => n + (p.stored?.byteSize ?? 0), 0),
          replacedBytes: staged.reduce((n, p) => n + p.previous.byteSize, 0),
        },
        unavailableByReason: byReason,
        entries: plan,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // ── apply-source-urls.sql ──────────────────────────────────────────────────
  // The guard is the whole safety story: it re-states the dump's own predicate,
  // so a row somebody else has since given honest provenance is never clobbered,
  // and running the file twice is a no-op.
  const guard =
    `(source_url IS NULL\n       OR lower(substring(source_url from '^[a-z]+://([^/:?#]+)')) NOT IN (` +
    APPROVED_HOSTS.map((h) => `'${h}'`).join(', ') +
    `))`;

  const updates = staged.map((p) => {
    const s = p.stored!;
    return (
      `-- ${p.cardTcgdexId} ${p.cardName ?? ''} (${p.quality}) ` +
      `${s.width}x${s.height} ${s.byteSize}B md5=${s.md5}\n` +
      `UPDATE image_asset SET\n` +
      `    source_url   = ${sqlStr(p.sourceUrl!)},\n` +
      `    etag         = ${sqlStr(s.upstreamEtag)},\n` +
      `    content_type = ${sqlStr(s.contentType)},\n` +
      `    byte_size    = ${s.byteSize},\n` +
      `    fetched_at   = now()\n` +
      `  WHERE cache_key = ${sqlStr(p.cacheKey)}\n    AND ${guard};`
    );
  });

  await writeFile(
    join(OUT, 'apply-source-urls.sql'),
    [
      '-- apply-source-urls.sql — GENERATED by tools/card-art/resource-assets.mts.',
      '-- Do not hand-edit; regenerate.',
      '--',
      '-- RUN THIS **AFTER** THE STAGED BYTES ARE UPLOADED, NOT BEFORE.',
      '--',
      '-- Ordering matters and only one order has a safe failure mode. If the',
      '-- upload fails after this file has run, the manifest claims a',
      '-- pokemontcg.io origin for bytes that are still the old ones — a row that',
      '-- lies. If this file fails after a successful upload, the manifest merely',
      '-- still says NULL for bytes that are now correctly sourced — a row that is',
      '-- silent. Silent beats lying, so: upload, then attribute.',
      '--',
      '-- (Provenance is not lost by uploading first. `putStorageAssetFromFile`',
      '--  calls `insertManifestRow`, which reports 409 as "exists" and does not',
      "--  touch the existing row's columns — so the upload never overwrites what",
      '--  this file is about to write. It does refresh the per-tier image_object',
      '--  row, which is a measurement of the new bytes and should follow them.)',
      '--',
      '-- Every statement is guarded on the row still being unattributed, so this',
      '-- file is idempotent and cannot overwrite provenance established elsewhere.',
      '--',
      `-- byte_size / content_type are updated too: migration 025 keeps those`,
      `-- columns on image_asset as "the historical record of the first copy", and`,
      `-- after this work the first copy IS the pokemontcg.io fetch. image_object`,
      `-- still carries the per-tier measurement and is written by the upload.`,
      '',
      'BEGIN;',
      '',
      ...updates,
      '',
      'COMMIT;',
      '',
      '-- Verification: this must return 0 for the sets covered by this run.',
      'SELECT count(*) AS still_unattributed',
      '  FROM image_asset',
      ` WHERE kind = 'card' AND ${guard.replace(/\n {7}/g, '\n       ')};`,
      '',
    ].join('\n'),
    'utf8',
  );

  // ── apply-unavailable.sql + delete-objects.json ────────────────────────────
  // For a REPLACED asset there is nothing to delete: the object key is a pure
  // function of the card ref, so the upload overwrites the old bytes in place
  // (`x-upsert`, object-store.ts uploadObject). Deletion is only for assets with
  // no approved replacement — there the out-of-policy bytes have to GO, and the
  // honest end state is "no object, no row, on the published no-art list".
  const deletable = unavailable.filter((p) => p.kind === 'card');
  await writeFile(
    join(OUT, 'delete-objects.json'),
    `${JSON.stringify(
      {
        generated: new Date().toISOString(),
        note:
          'Objects to remove from the card-art bucket: assets with no approved source. ' +
          'Replaced assets are NOT here — their bytes are overwritten in place by the upload.',
        howToRun:
          'set -a && . ./.env && set +a; node --import tsx -e "' +
          "import {deleteObject} from '@deckpal/storage';" +
          "import {readFileSync} from 'node:fs';" +
          "for (const o of JSON.parse(readFileSync('tools/card-art/out/delete-objects.json','utf8')).objects) " +
          'console.log(o.relativePath, await deleteObject(o.relativePath));"',
        objects: deletable.map((p) => ({
          cacheKey: p.cacheKey,
          relativePath: p.relativePath,
          reason: (p.outcome as { reason: string }).reason,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await writeFile(
    join(OUT, 'apply-unavailable.sql'),
    [
      '-- apply-unavailable.sql — GENERATED by tools/card-art/resource-assets.mts.',
      '--',
      '-- RUN THIS **AFTER** the objects in delete-objects.json are gone from the',
      '-- bucket. Deleting the row first would leave bytes in the bucket that no',
      '-- manifest row accounts for — the exact drift B1 forbids, one tier up.',
      '--',
      '-- Deleting the image_asset row CASCADEs to image_object (migration 025 FK).',
      '-- The card then serves the placeholder, which is the honest answer, and it',
      '-- appears in research/card-art-unavailable.json with the measured reason.',
      '',
      'BEGIN;',
      '',
      ...(deletable.length === 0
        ? ['-- (nothing unavailable in this run)']
        : [
            'DELETE FROM image_asset WHERE cache_key IN (',
            deletable.map((p) => `  ${sqlStr(p.cacheKey)}`).join(',\n'),
            ');',
          ]),
      '',
      'COMMIT;',
      '',
    ].join('\n'),
    'utf8',
  );

  // ── the published no-art list ──────────────────────────────────────────────
  await writeFile(join(OUT, 'card-art-unavailable.json'), `${buildNoArtList(plan, dump)}\n`, 'utf8');

  // ── human report ───────────────────────────────────────────────────────────
  const bySet: Record<string, { resolved: number; unavailable: number }> = {};
  for (const p of plan) {
    const k = p.setTcgdexId ?? '(unknown)';
    bySet[k] ??= { resolved: 0, unavailable: 0 };
    if (p.outcome.status === 'unavailable') bySet[k]!.unavailable++;
    else bySet[k]!.resolved++;
  }
  const lines = [
    `# Card-art re-sourcing plan`,
    ``,
    `Mode: **${FETCH ? 'fetch' : VERIFY ? 'verify' : 'dry-run'}** · encode: \`${ENCODE}\` · crosswalk ${crosswalk.generated}`,
    ``,
    `| | rows |`,
    `|---|---|`,
    `| affected rows in dump | ${dump.rows.length} |`,
    `| considered this run | ${plan.length} |`,
    `| resolved to an approved URL | ${ok.length} |`,
    `| bytes staged | ${staged.length} |`,
    `| no approved source | ${unavailable.length} |`,
    `| skipped (--limit) | ${skipped.length} |`,
    `| **undersized** (smaller than the srcSet width the app advertises) | ${staged.filter((p) => p.stored?.undersized).length} |`,
    `| matched by card name rather than number | ${plan.filter((p) => p.matchedVia === 'name').length} |`,
    ``,
    `Staged bytes: ${(staged.reduce((n, p) => n + (p.stored?.byteSize ?? 0), 0) / 1e6).toFixed(1)} MB ` +
      `(replacing ${(staged.reduce((n, p) => n + p.previous.byteSize, 0) / 1e6).toFixed(1)} MB)`,
    ``,
    `## Why assets have no approved source`,
    ``,
    `| reason | rows |`,
    `|---|---|`,
    ...Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `| \`${r}\` | ${n} |`),
    ``,
    `## Per set`,
    ``,
    `| set | resolved | unavailable |`,
    `|---|---|---|`,
    ...Object.entries(bySet)
      .sort((a, b) => b[1].unavailable - a[1].unavailable)
      .map(([s, v]) => `| \`${s}\` | ${v.resolved} | ${v.unavailable} |`),
    ``,
  ];
  await writeFile(join(OUT, 'report.md'), `${lines.join('\n')}\n`, 'utf8');

  console.log(
    `\n[resource] ${plan.length} rows: ${ok.length} resolved (${staged.length} staged), ` +
      `${unavailable.length} unavailable, ${skipped.length} skipped\n` +
      `[resource] artifacts in ${OUT}\n` +
      `[resource] staged bytes in ${STAGE}`,
  );
}

/**
 * The published no-art list. One entry per CARD (not per asset row), because
 * that is the unit a reader cares about — "this card has no art and here is the
 * measured reason" — and because the 2c checklist is phrased per card.
 */
function buildNoArtList(plan: PlanEntry[], dump: Dump): string {
  type Card = {
    cardTcgdexId: string;
    localId: string | null;
    cardName: string | null;
    setTcgdexId: string | null;
    seriesTcgdexId: string | null;
    missingQualities: string[];
    reason: string;
    detail?: string;
    /**
     * True when the card was being served from bytes with no approved
     * provenance — i.e. this list entry is the OUTCOME of removing them, not a
     * pre-existing gap.
     */
    hadUnattributedBytes: boolean;
  };
  const cards = new Map<string, Card>();

  for (const p of plan) {
    if (p.outcome.status !== 'unavailable' || !p.cardTcgdexId) continue;
    const o = p.outcome;
    const existing = cards.get(p.cardTcgdexId);
    if (existing) {
      if (!existing.missingQualities.includes(p.quality)) existing.missingQualities.push(p.quality);
      continue;
    }
    cards.set(p.cardTcgdexId, {
      cardTcgdexId: p.cardTcgdexId,
      localId: p.localId,
      cardName: p.cardName,
      setTcgdexId: p.setTcgdexId,
      seriesTcgdexId: p.seriesTcgdexId,
      missingQualities: [p.quality],
      reason: o.reason,
      detail: o.detail,
      hadUnattributedBytes: true,
    });
  }

  // Cards with no image_asset row at all — the `research/card-art-residue.json`
  // population. They belong on the same published list: from a reader's side
  // "this card has no art" is one fact, however it came about.
  for (const c of dump.cardsWithNoAssetRow ?? []) {
    if (cards.has(c.cardTcgdexId)) continue;
    cards.set(c.cardTcgdexId, {
      cardTcgdexId: c.cardTcgdexId,
      localId: c.localId,
      cardName: c.cardName,
      setTcgdexId: c.setTcgdexId,
      seriesTcgdexId: c.seriesTcgdexId,
      missingQualities: ['low', 'high'],
      reason: 'never-sourced',
      detail:
        'no image_asset row has ever existed for this card: TCGdex serves nothing for it at any ' +
        'extension and no approved fallback covers it (research/CARD-ART-SOURCES.md §1)',
      hadUnattributedBytes: false,
    });
  }

  const list = [...cards.values()].sort(
    (a, b) =>
      (a.setTcgdexId ?? '').localeCompare(b.setTcgdexId ?? '') ||
      (a.localId ?? '').localeCompare(b.localId ?? ''),
  );
  const bySet: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  for (const c of list) {
    bySet[c.setTcgdexId ?? '(unknown)'] = (bySet[c.setTcgdexId ?? '(unknown)'] ?? 0) + 1;
    byReason[c.reason] = (byReason[c.reason] ?? 0) + 1;
  }

  return JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      note:
        'Cards DeckPal cannot show art for, and the measured reason for each. This is the ' +
        'published no-art list Project Holo 2c requires: every image_asset row now carries an ' +
        'approved source_url, or its card is here. An honest gap beats art we have no right to ' +
        'serve, and it beats art that might be the wrong printing.',
      policy:
        'Approved sources are TCGdex (primary) and pokemontcg.io (fallback). See ' +
        'research/CARD-ART-SOURCES.md — §2.3 records why TCGplayer is ruled out and §2.4 why the ' +
        'Bulbagarden card-scan crosswalk is unresolved. Adding a source needs a DECISIONS.md ' +
        'entry and an IMAGE_SOURCE_HOSTS change (packages/storage/src/upstream.ts).',
      reasons: {
        'set-not-carried': "pokemontcg.io's set list does not include this set at all",
        'set-unmapped':
          'no pokemontcg.io set could be matched to this TCGdex set with enough confidence to be safe',
        'number-ambiguous':
          'the collector number maps to more than one pokemontcg.io printing, so choosing one would be guessing which art it is',
        'number-no-such-number':
          'the set matched but this collector number does not exist in it upstream',
        'number-name-mismatch':
          'the number matched but the two catalogs name different cards at it — refused rather than served as the wrong card',
        'number-no-image-url':
          'the card matched upstream but pokemontcg.io reports no image file for it',
        'no-image-url': 'upstream has no image for this quality slot',
        'set-not-in-crosswalk':
          'the crosswalk predates this set; rebuild it with tools/card-art/build-crosswalk.mts',
        'unknown-quality': 'the manifest row names a quality this tier does not serve',
        'bad-source-url':
          'the crosswalk URL was not a usable https URL on the approved image host',
        'stage-error': 'the download or measurement threw; see plan.json for the message',
        'below-slot':
          'the only approved image measures smaller than the slot it would fill; storing it would advertise a resolution we do not have',
        'upstream-miss': 'the approved URL did not serve an image when asked',
        'upstream-not-an-image':
          'the approved URL answered, but not with a raster image (soft-404)',
        undecodable: 'the bytes returned could not be decoded as an image',
        'orphan-row': 'the manifest row names a card that is not in the catalog',
        'not-card-art':
          'not card art — set imagery is sourced by packages/storage/src/setImageFallback.ts',
        'never-sourced':
          'no image_asset row has ever existed for this card; nothing approved covers it',
      },
      counts: { cards: list.length, bySet, byReason },
      cards: list,
    },
    null,
    2,
  );
}

await main();
