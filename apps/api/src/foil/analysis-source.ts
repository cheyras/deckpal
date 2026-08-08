// foil/analysis-source.ts — the ANALYSIS-ONLY read path for card art.
//
// Chey, 2026-08-08: "Yeah wire that in. We don't need to cache pngs but it
// would be great for agents analyzing card art to have the uncompressed source
// on hand."
//
// The image cache holds LOSSY WebP. The mask generators (edge-trace, line-snap,
// region-learn, vector-template) localise edges to ~0.2px and fit sub-pixel
// ridge peaks, so what they are actually fitting to matters. This module gives
// them the upstream LOSSLESS PNG for the same asset, on demand, and — when it
// can't — hands back the cached WebP with a flag saying so. A caller must never
// be able to believe it got lossless pixels when it didn't.
//
// ── THREE HARD RULES ───────────────────────────────────────────────────────
//
// 1. NOTHING IS EVER WRITTEN. No PNG cache on disk, no temp file, nothing in
//    <IMAGE_CACHE_ROOT>, nothing in the repo. Fetch → decode through a pipe →
//    keep in an in-process memo for the lifetime of the run → drop. The image
//    cache is a contract (CLAUDE.md, DECISIONS 2026-08-07 image_asset
//    manifest); a fetched PNG must never be written into it or used to
//    "correct" a cached asset. TCGdex re-encodes assets over time, so a PNG
//    fetched today may not correspond byte-for-byte to the WebP cached months
//    ago. Fine for edge analysis. Not fine as cache truth.
//
// 2. NO URL IS EVER FABRICATED. The PNG url is derived from the asset's
//    RECORDED `image_asset.source_url` by a pure extension swap, and only for a
//    host whose lossless convention we actually know (assets.tcgdex.net serves
//    the same base as `<quality>.png`). `source_url IS NULL` — 1,854 of 47,924
//    assets today, the honestly-unknown-provenance value established on
//    2026-08-07 — means we fall back. It does not mean we guess.
//
// 3. FALLBACKS ARE LOUD. Every result carries `lossless`, `source`,
//    `fallbackReason` and a one-line `note` meant to be copied verbatim into a
//    generator's params/notes, so provenance survives into the sidecar.
//
// ── WHAT WE ACTUALLY MEASURED (read this before assuming PNG = better) ─────
//
// TCGdex's PNGs are **8-bit PALETTE** (colour type 3, 256 colours, Adam7
// interlaced) at the SAME dimensions as the WebP — 600x825 for high. There is
// no resolution gain upstream, and "lossless" describes the FILE FORMAT, not
// the image content: the WebP for me05-001 carries 125,662 distinct RGB values,
// the PNG 251. Measured on me05-001 at mask resolution (490x674), opaque pixels
// only, luminance Sobel:
//
//     MAE(webp, png)          4.36/255   (0.0171)   PSNR 31.6 dB
//     mean |grad|             webp 17.73   png 19.49   → the PNG is +9.9%
//     flat regions, |grad|>=3 webp  3.8%   png 24.2%   → 6.4x more banding
//
// i.e. the surplus high-frequency structure at mask resolution is the PNG's,
// and it is palette banding — contours in areas the WebP renders smooth.
// Quantising the WebP to 256 colours ourselves reproduces ~60% of the total
// webp-vs-png difference (MAE 2.60/255) and 12.4% flat-region stepping, which
// is what pins the cause on the palette rather than on WebP's ringing.
//
// So this module does NOT default to the PNG. `prefer` defaults to
// `'cached'`; a caller that wants the lossless bytes asks for them, gets an
// honest `palette` flag telling it the content is quantised, and records which
// source it used. See DECISIONS.md 2026-08-08 for the full numbers.

import { execFileSync } from 'node:child_process';
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, type RgbaImage } from './png.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type Quality = 'low' | 'high';
export type AnalysisSourceKind = 'lossless-png' | 'cached-webp';

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 PALETTE, 4 grey+alpha, 6 RGBA. */
  colorType: number;
  interlaced: boolean;
  /** colour type 3 — lossless bytes, but colour-quantised content. */
  palette: boolean;
}

export interface AnalysisImage {
  /** Decoded RGBA at the requested size. Never null — this is the payload. */
  image: RgbaImage;
  width: number;
  height: number;
  /** Which bytes this came from. */
  source: AnalysisSourceKind;
  /** TRUE only for a verified upstream PNG. Callers MUST report this. */
  lossless: boolean;
  /**
   * TRUE when the lossless bytes are colour-quantised (PNG colour type 3).
   * Lossless format, lossy content — see the header. Null when not applicable.
   */
  palette: boolean | null;
  /** The url actually fetched. Null when we used the cache. */
  url: string | null;
  /** The cached asset's path on disk (what we would have used / did use). */
  cachePath: string | null;
  /** Image type sniffed from MAGIC BYTES, never from the extension. */
  contentType: string;
  /** Native dimensions of the bytes we decoded, before any resize. */
  nativeWidth: number;
  nativeHeight: number;
  bytes: number;
  /** Non-null whenever `lossless` is false. Says exactly what went wrong. */
  fallbackReason: string | null;
  /** One honest line, meant to be copied into generator params/notes. */
  note: string;
}

export interface ManifestRow {
  cacheKey: string;
  relativePath: string;
  contentType: string;
  byteSize: number;
  sourceUrl: string | null;
}

export interface FetchResult {
  status: number;
  bytes: Buffer | null;
  error?: string;
}

/** Every side effect this module can have, in one injectable bag. */
export interface AnalysisDeps {
  /** `SELECT … FROM image_asset WHERE cache_key = $1`, or null if absent. */
  lookupAsset(cacheKey: string): Promise<ManifestRow | null>;
  /** HTTP GET. Must not throw; report failures in `error`. */
  fetchUrl(url: string, timeoutMs: number): Promise<FetchResult>;
  /** Decode bytes to RGBA, optionally resampled. Throws on undecodable input. */
  decode(bytes: Buffer, width: number | null, height: number | null): RgbaImage;
  /** Absolute path for a cached asset's manifest-relative path. */
  cacheAbsolute(relativePath: string): string;
  /** First `n` bytes of a file on disk, or null when it does not exist. */
  head(path: string, n: number): Buffer | null;
  /** Existence check, kept injectable so tests never touch the real cache. */
  exists(path: string): boolean;
}

export interface AnalysisRequest {
  quality?: Quality;
  /** Resample to this size. Omit both for native size. */
  width?: number;
  height?: number;
  /**
   * `'cached'` (default) — use the WebP already on disk; do not touch the
   * network. `'lossless'` — try the upstream PNG first, fall back honestly.
   */
  prefer?: 'cached' | 'lossless';
  /**
   * Series slug, used ONLY to locate the cached file when the manifest has no
   * row for this asset (the cache path is a pure function of the card id +
   * serie — apps/images/src/layout.ts).
   */
  serie?: string;
}

export interface AnalysisSourceConfig {
  deps?: Partial<AnalysisDeps>;
  /** Max simultaneous upstream fetches. Be a good citizen. Default 3. */
  concurrency?: number;
  /** Per-attempt timeout. Default 15s. */
  timeoutMs?: number;
  /** Backoff before the single retry. Default 750ms. */
  retryDelayMs?: number;
  /** Decoded images held in the run memo. Default 16 (~21 MB at 490x674). */
  memoLimit?: number;
  /** Fetched PNG buffers held in the run memo. Default 32. */
  byteMemoLimit?: number;
  userAgent?: string;
}

// ── Pure helpers (no I/O — these are what the tests lock down) ─────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF = Buffer.from('RIFF', 'latin1');
const WEBP = Buffer.from('WEBP', 'latin1');

/**
 * Sniff an image type from MAGIC BYTES. Never from the extension: the manifest
 * backfill on 2026-08-07 found 30 files that are PNG bytes living under a
 * `.webp` name, so an extension is a hint, not a fact.
 */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).equals(RIFF) && buf.subarray(8, 12).equals(WEBP)) return 'image/webp';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  return null;
}

/**
 * Validate PNG magic bytes and read IHDR. Returns null when the bytes are NOT
 * a PNG — a 404 body, an HTML error page, and a WebP served under a `.png`
 * name all land here, and all mean "fall back", never "decode and hope".
 */
export function inspectPng(buf: Buffer): PngInfo | null {
  if (buf.length < 8 + 8 + 13) return null;
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  // The first chunk of a valid PNG is IHDR, length 13.
  if (buf.readUInt32BE(8) !== 13) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  const bitDepth = buf[24]!;
  const colorType = buf[25]!;
  const interlaced = buf[28]! !== 0;
  return { width, height, bitDepth, colorType, interlaced, palette: colorType === 3 };
}

/**
 * Hosts whose lossless convention we KNOW, and the derivation for each.
 * TCGdex: the asset base is shared and the extension selects the encoding, so
 * `…/<localId>/<quality>.webp` → `…/<localId>/<quality>.png` (DATA-LAYER §5.3,
 * apps/images/src/layout.ts). Any other host: we do not know, so we do not try.
 */
const LOSSLESS_CONVENTION: Record<string, (u: URL) => string | null> = {
  'assets.tcgdex.net': (u) => (u.pathname.endsWith('.webp') ? `${u.origin}${u.pathname.slice(0, -5)}.png` : null),
};

export type LosslessUrl = { url: string; reason: null } | { url: null; reason: string };

/**
 * Derive the lossless PNG url from a RECORDED source url. Pure. Never invents
 * a url: every failure path returns a reason a human can act on.
 */
export function losslessUrlFrom(sourceUrl: string | null | undefined): LosslessUrl {
  if (!sourceUrl) {
    return {
      url: null,
      reason: 'image_asset.source_url IS NULL — this asset\'s provenance is honestly unknown (see DECISIONS 2026-08-07), so no upstream url can be derived',
    };
  }
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    return { url: null, reason: `image_asset.source_url is not a parsable absolute url (${sourceUrl})` };
  }
  if (u.protocol !== 'https:') {
    return { url: null, reason: `recorded source_url is not https (${u.protocol}//) — refusing to fetch` };
  }
  const derive = LOSSLESS_CONVENTION[u.hostname];
  if (!derive) {
    return { url: null, reason: `no known lossless-asset convention for host ${u.hostname} — refusing to guess a url` };
  }
  const png = derive(u);
  if (!png) {
    return { url: null, reason: `recorded source_url does not end in .webp (${u.pathname}) — the .png sibling cannot be derived from it` };
  }
  return { url: png, reason: null };
}

/** `card:<setId>-<localId>:<quality>` — image_asset's key (layout.ts). */
export function cardCacheKey(cardId: string, quality: Quality): string {
  return `card:${cardId}:${quality}`;
}

/** setId for a TCGdex card id: everything before the LAST '-'. */
export function setIdOf(cardId: string): string | null {
  const i = cardId.lastIndexOf('-');
  return i > 0 ? cardId.slice(0, i) : null;
}

/** The cache-relative path, derived the same way apps/images/src/layout.ts does. */
export function cardRelativePath(cardId: string, serie: string, quality: Quality): string | null {
  const setId = setIdOf(cardId);
  if (!setId) return null;
  const localId = cardId.slice(setId.length + 1);
  if (!localId) return null;
  return join('images', 'en', serie, setId, `${localId}.${quality}.webp`);
}

// ── Real dependencies ──────────────────────────────────────────────────────

export const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';

export const DEFAULT_USER_AGENT =
  'pokedex-foil-analysis/1.0 (self-hosted TCG collection tracker; analysis-only, not cached or redistributed)';

function decodeWithMagick(bytes: Buffer, width: number | null, height: number | null): RgbaImage {
  const args = ['-'];
  if (width && height) args.push('-resize', `${width}x${height}!`);
  args.push('png32:-');
  // Decoded through a PIPE on purpose: no temp file, nothing on disk.
  return decodePng(execFileSync('magick', args, { input: bytes, maxBuffer: 256 * 1024 * 1024 }));
}

function decodeFileWithMagick(path: string, width: number | null, height: number | null): RgbaImage {
  const args = [path];
  if (width && height) args.push('-resize', `${width}x${height}!`);
  args.push('png32:-');
  return decodePng(execFileSync('magick', args, { maxBuffer: 256 * 1024 * 1024 }));
}

function headBytes(path: string, n: number): Buffer | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

async function httpGet(url: string, timeoutMs: number, userAgent: string): Promise<FetchResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': userAgent, accept: 'image/png,image/*;q=0.8' },
      redirect: 'follow',
    });
    if (!res.ok) return { status: res.status, bytes: null, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes: buf };
  } catch (e) {
    return { status: 0, bytes: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ── The DB seam ────────────────────────────────────────────────────────────
//
// One connection, opened lazily, only if someone actually asks for lossless
// pixels. The connection budget is 4 across the whole box (CLAUDE.md); these
// are CLI dev tools, so this is the "one-off script uses ONE connection" case.
// A DB that is unreachable is a FALLBACK, not a crash.

interface MinimalPool {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

let poolPromise: Promise<MinimalPool | null> | null = null;
let poolBroken: string | null = null;

async function getPool(): Promise<MinimalPool | null> {
  if (poolBroken) return null;
  poolPromise ??= (async (): Promise<MinimalPool | null> => {
    try {
      const { makePool } = await import('@pokedex/db');
      return makePool(1) as unknown as MinimalPool;
    } catch (e) {
      poolBroken = e instanceof Error ? e.message : String(e);
      return null;
    }
  })();
  return poolPromise;
}

async function lookupAssetInDb(cacheKey: string): Promise<ManifestRow | null> {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      'SELECT cache_key, relative_path, content_type, byte_size, source_url FROM image_asset WHERE cache_key = $1',
      [cacheKey],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      cacheKey: String(r['cache_key']),
      relativePath: String(r['relative_path']),
      contentType: String(r['content_type']),
      byteSize: Number(r['byte_size']),
      sourceUrl: r['source_url'] == null ? null : String(r['source_url']),
    };
  } catch (e) {
    poolBroken = e instanceof Error ? e.message : String(e);
    return null;
  }
}

const REAL_DEPS: AnalysisDeps = {
  lookupAsset: lookupAssetInDb,
  fetchUrl: (url, timeoutMs) => httpGet(url, timeoutMs, DEFAULT_USER_AGENT),
  decode: decodeWithMagick,
  cacheAbsolute: (rel) => join(CACHE_ROOT, rel),
  head: headBytes,
  exists: existsSync,
};

// ── The source ─────────────────────────────────────────────────────────────

export interface AnalysisSourceStats {
  requests: number;
  losslessHits: number;
  fallbacks: number;
  fetches: number;
  fetchFailures: number;
  memoHits: number;
  /** cardId → why it fell back, deduped. The run's honest provenance ledger. */
  fallbackReasons: Record<string, string>;
}

interface MemoEntry<T> {
  key: string;
  value: T;
}

class Fifo<T> {
  private readonly entries: MemoEntry<T>[] = [];
  constructor(private readonly limit: number) {}
  get(key: string): T | undefined {
    return this.entries.find((e) => e.key === key)?.value;
  }
  set(key: string, value: T): void {
    if (this.limit <= 0) return;
    this.entries.push({ key, value });
    while (this.entries.length > this.limit) this.entries.shift();
  }
}

export class AnalysisSource {
  private readonly deps: AnalysisDeps;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly memo: Fifo<AnalysisImage>;
  private readonly byteMemo: Fifo<Buffer>;
  /** urls known to be unavailable — never re-requested in this run. */
  private readonly deadUrls = new Map<string, string>();
  private readonly manifestMemo = new Map<string, ManifestRow | null>();
  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];
  readonly stats: AnalysisSourceStats = {
    requests: 0,
    losslessHits: 0,
    fallbacks: 0,
    fetches: 0,
    fetchFailures: 0,
    memoHits: 0,
    fallbackReasons: {},
  };

  constructor(cfg: AnalysisSourceConfig = {}) {
    this.deps = { ...REAL_DEPS, ...(cfg.deps ?? {}) };
    this.concurrency = Math.max(1, cfg.concurrency ?? 3);
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
    this.retryDelayMs = cfg.retryDelayMs ?? 750;
    this.memo = new Fifo<AnalysisImage>(cfg.memoLimit ?? 16);
    this.byteMemo = new Fifo<Buffer>(cfg.byteMemoLimit ?? 32);
  }

  /**
   * Lossless pixels for a card's art if we can honestly get them, the cached
   * lossy WebP if we can't — and always a truthful account of which.
   *
   * Returns null ONLY when there is no usable image at all (nothing cached and
   * nothing fetchable); that is "this card has no art", not a silent fallback.
   *
   * NOTE ON `variant`: there is deliberately no variant parameter. Card imagery
   * is keyed per CARD in this catalog — the cache path is
   * `<lang>/<serie>/<set>/<localId>.<quality>.webp` and `card_variant` carries
   * no imagery of its own, so every variant of a card renders the same scan
   * (mask-pipeline SKILL, "artwork-keyed lookup"). `quality` is the only real
   * axis, and it is in `AnalysisRequest`.
   */
  async get(cardId: string, req: AnalysisRequest = {}): Promise<AnalysisImage | null> {
    const quality: Quality = req.quality ?? 'high';
    const prefer = req.prefer ?? 'cached';
    const width = req.width ?? null;
    const height = req.height ?? null;
    const memoKey = `${cardId}|${quality}|${prefer}|${width ?? 'n'}x${height ?? 'n'}|${req.serie ?? ''}`;
    this.stats.requests++;
    const hit = this.memo.get(memoKey);
    if (hit) {
      this.stats.memoHits++;
      return hit;
    }
    const result = await this.resolve(cardId, quality, prefer, width, height, req.serie ?? null);
    if (result) {
      this.memo.set(memoKey, result);
      if (result.lossless) this.stats.losslessHits++;
      else {
        this.stats.fallbacks++;
        if (result.fallbackReason) this.stats.fallbackReasons[cardId] = result.fallbackReason;
      }
    }
    return result;
  }

  private async manifest(cacheKey: string): Promise<ManifestRow | null> {
    if (this.manifestMemo.has(cacheKey)) return this.manifestMemo.get(cacheKey) ?? null;
    let row: ManifestRow | null = null;
    try {
      row = await this.deps.lookupAsset(cacheKey);
    } catch {
      row = null;
    }
    this.manifestMemo.set(cacheKey, row);
    return row;
  }

  private async resolve(
    cardId: string,
    quality: Quality,
    prefer: 'cached' | 'lossless',
    width: number | null,
    height: number | null,
    serie: string | null,
  ): Promise<AnalysisImage | null> {
    const cacheKey = cardCacheKey(cardId, quality);
    const row = prefer === 'lossless' || !serie ? await this.manifest(cacheKey) : null;
    const relative = row?.relativePath ?? (serie ? cardRelativePath(cardId, serie, quality) : null);
    const cachePath = relative ? this.deps.cacheAbsolute(relative) : null;
    const cacheExists = cachePath ? this.deps.exists(cachePath) : false;

    if (prefer === 'cached') {
      return this.fromCache(cachePath, cacheExists, width, height, null);
    }

    // ── lossless path ──
    let reason: string;
    if (!row) {
      reason = `no image_asset row for ${cacheKey} — the cached bytes have no recorded origin, so no upstream url can be derived`;
      return this.fromCache(cachePath, cacheExists, width, height, reason);
    }
    const derived = losslessUrlFrom(row.sourceUrl);
    if (!derived.url) return this.fromCache(cachePath, cacheExists, width, height, derived.reason);

    const dead = this.deadUrls.get(derived.url);
    if (dead) return this.fromCache(cachePath, cacheExists, width, height, dead);

    const bytes = await this.fetchPng(derived.url);
    if (typeof bytes === 'string') {
      this.deadUrls.set(derived.url, bytes);
      return this.fromCache(cachePath, cacheExists, width, height, bytes);
    }

    const info = inspectPng(bytes);
    if (!info) {
      const sniffed = sniffImageType(bytes) ?? 'unrecognised bytes';
      reason = `${derived.url} did not return a PNG (magic bytes say ${sniffed}, ${bytes.length} B) — never trusting the extension`;
      this.deadUrls.set(derived.url, reason);
      return this.fromCache(cachePath, cacheExists, width, height, reason);
    }

    // Aspect guard: a mask drawn on the cached scan is only comparable to art
    // with the same shape. A different aspect ratio upstream means the two are
    // not the same crop, and silently resampling one onto the other would move
    // every boundary. Bail honestly instead.
    if (cacheExists && cachePath) {
      const cached = this.cachedDims(cachePath);
      if (cached && Math.abs(info.width / info.height - cached.width / cached.height) > 0.01) {
        reason =
          `upstream PNG is ${info.width}x${info.height} but the cached scan is ${cached.width}x${cached.height} — ` +
          'different aspect, so they are not the same crop and the masks would not align';
        this.deadUrls.set(derived.url, reason);
        return this.fromCache(cachePath, cacheExists, width, height, reason);
      }
    }

    let image: RgbaImage;
    try {
      image = this.deps.decode(bytes, width, height);
    } catch (e) {
      reason = `upstream PNG at ${derived.url} could not be decoded (${e instanceof Error ? e.message : String(e)})`;
      this.deadUrls.set(derived.url, reason);
      return this.fromCache(cachePath, cacheExists, width, height, reason);
    }

    const quantised = info.palette
      ? ` PALETTE-${1 << info.bitDepth} (lossless bytes, colour-quantised content)`
      : '';
    return {
      image,
      width: image.width,
      height: image.height,
      source: 'lossless-png',
      lossless: true,
      palette: info.palette,
      url: derived.url,
      cachePath,
      contentType: 'image/png',
      nativeWidth: info.width,
      nativeHeight: info.height,
      bytes: bytes.length,
      fallbackReason: null,
      note: `analysis source: upstream LOSSLESS PNG ${derived.url} (${info.width}x${info.height}${quantised}); fetched on demand, never cached`,
    };
  }

  private cachedDims(path: string): { width: number; height: number } | null {
    try {
      const head = this.deps.head(path, 64);
      if (!head) return null;
      const png = inspectPng(head);
      if (png) return { width: png.width, height: png.height };
      // WebP (VP8L / VP8X / VP8) header dimensions.
      if (head.length >= 30 && head.subarray(0, 4).equals(RIFF) && head.subarray(8, 12).equals(WEBP)) {
        const fourcc = head.toString('latin1', 12, 16);
        if (fourcc === 'VP8X') return { width: (head.readUIntLE(24, 3) & 0xffffff) + 1, height: (head.readUIntLE(27, 3) & 0xffffff) + 1 };
        if (fourcc === 'VP8L') {
          const b = head.readUInt32LE(21);
          return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
        }
        if (fourcc === 'VP8 ') return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
      }
      return null;
    } catch {
      return null;
    }
  }

  private fromCache(
    cachePath: string | null,
    exists: boolean,
    width: number | null,
    height: number | null,
    reason: string | null,
  ): AnalysisImage | null {
    if (!cachePath || !exists) return null;
    const head = this.deps.head(cachePath, 64);
    const contentType = (head && sniffImageType(head)) ?? 'application/octet-stream';
    let image: RgbaImage;
    try {
      image = decodeFileWithMagick(cachePath, width, height);
    } catch {
      return null;
    }
    const dims = this.cachedDims(cachePath);
    const why = reason ?? 'caller asked for the cached scan (prefer: "cached")';
    return {
      image,
      width: image.width,
      height: image.height,
      source: 'cached-webp',
      lossless: false,
      palette: null,
      url: null,
      cachePath,
      contentType,
      nativeWidth: dims?.width ?? image.width,
      nativeHeight: dims?.height ?? image.height,
      bytes: 0,
      fallbackReason: why,
      note: `analysis source: CACHED LOSSY ${contentType} ${cachePath} — analysis ran on lossy input (${why})`,
    };
  }

  /** Fetch a PNG with one retry, or return the reason it failed, as a string. */
  private async fetchPng(url: string): Promise<Buffer | string> {
    const memo = this.byteMemo.get(url);
    if (memo) return memo;
    await this.acquire();
    try {
      this.stats.fetches++;
      let last: FetchResult = await this.deps.fetchUrl(url, this.timeoutMs);
      // Retry once, with backoff, ONLY for the transient classes. A 404 is an
      // answer, not a hiccup; hammering it would be rude and pointless.
      const transient = (r: FetchResult): boolean => r.status === 0 || r.status === 429 || r.status >= 500;
      if (!last.bytes && transient(last)) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
        last = await this.deps.fetchUrl(url, this.timeoutMs);
      }
      if (!last.bytes) {
        this.stats.fetchFailures++;
        return `upstream fetch of ${url} failed (${last.error ?? `HTTP ${last.status}`}) — no lossless source available`;
      }
      this.byteMemo.set(url, last.bytes);
      return last.bytes;
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.concurrency) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
    this.waiters.shift()?.();
  }

  /** A one-line summary of what the run actually analysed. Print it. */
  summary(): string {
    const s = this.stats;
    return (
      `analysis-source: ${s.requests} request(s), ${s.losslessHits} lossless, ${s.fallbacks} lossy fallback(s), ` +
      `${s.fetches} fetch(es) (${s.fetchFailures} failed), ${s.memoHits} memo hit(s)`
    );
  }
}

/** Close the shared DB connection this module may have opened. */
export async function closeAnalysisSource(): Promise<void> {
  const p = poolPromise;
  poolPromise = null;
  if (!p) return;
  try {
    const pool = await p;
    await pool?.end();
  } catch {
    /* nothing to close */
  }
}

/**
 * Process-wide default source. Its memo lives for the lifetime of the run,
 * which is exactly what a generator lane wants (it hits the same card many
 * times). Nothing it holds is ever written to disk.
 */
let shared: AnalysisSource | null = null;
export function analysisSource(cfg?: AnalysisSourceConfig): AnalysisSource {
  shared ??= new AnalysisSource(cfg);
  return shared;
}

/** Convenience wrapper over the shared source. See `AnalysisSource.get`. */
export function getAnalysisImage(cardId: string, req: AnalysisRequest = {}): Promise<AnalysisImage | null> {
  return analysisSource().get(cardId, req);
}
