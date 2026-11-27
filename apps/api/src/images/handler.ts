import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FAILURE_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  SELF_SOURCED_CACHE_CONTROL,
  PLACEHOLDER_CONTENT_TYPE,
  PLACEHOLDER_WEBP,
  fetchSourceBytesWithExtensionFallback,
  fromUrl,
  getManifestRow,
  isSelfSourced,
  imageSubPathFromUrl,
  objectExists,
  parseImagePath,
  publicObjectUrl,
  putStorageAsset,
  putUnmanifestedObject,
  recordProvenanceIfUnknown,
  setImageFallbackUrl,
  isSetImageFallbackUrl,
  SET_IMAGE_FALLBACK_POLICY,
  type ParsedImage,
} from '@deckpal/storage';
import { selfSourceCardArt } from './selfSource.js';

/**
 * The cloud image tier: `/deckpal/images/*` on Vercel.
 *
 * Self-host serves these URLs from `apps/images` off a local WebP cache. The
 * cloud deployment has no such disk, so this function serves them out of the
 * public Supabase Storage bucket, filling it lazily:
 *
 *   HIT   → 302 to the public object URL, immutable long-cache. Bytes are never
 *           proxied through the function; the CDN caches the redirect, so a warm
 *           asset costs the function nothing after the first request per edge.
 *   MISS  → look the asset up in the `image_asset` manifest, fetch it from its
 *           RECORDED `source_url`, write bytes+row together through the choke
 *           point (`@deckpal/storage` put-asset), then 302 as above.
 *   FAIL  → the same ~1 KB placeholder WebP apps/images serves (cards) or a 404
 *           (set imagery, which the SPA already renders its own fallback for),
 *           with a SHORT TTL so it self-heals once the asset becomes fetchable.
 *
 * The rule that produced this file: an image URL must NEVER answer with HTML.
 * Before this existed, `/deckpal/images/*` fell through to the SPA catch-all
 * rewrite and every <img> got `200 text/html` — a silently broken page.
 */

const PLACEHOLDER_BODY: Buffer = PLACEHOLDER_WEBP;

function hardenHeaders(res: ServerResponse): void {
  // Defensive: nothing downstream should ever turn our answer into a document.
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendPlaceholder(res: ServerResponse, status: 200 | 400, reason: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', PLACEHOLDER_CONTENT_TYPE);
  res.setHeader('Content-Length', String(PLACEHOLDER_BODY.length));
  res.setHeader('Cache-Control', FAILURE_CACHE_CONTROL);
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Placeholder', '1');
  res.setHeader('X-Image-Reason', reason.slice(0, 120));
  hardenHeaders(res);
  res.end(PLACEHOLDER_BODY);
}

function sendNotFound(res: ServerResponse, reason: string): void {
  res.statusCode = 404;
  res.setHeader('Cache-Control', FAILURE_CACHE_CONTROL);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Image-Reason', reason.slice(0, 120));
  hardenHeaders(res);
  res.end('not found');
}

function sendRedirect(
  res: ServerResponse, location: string, cache: 'HIT' | 'FILLED', cacheControl = IMMUTABLE_CACHE_CONTROL,
): void {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Cache', cache);
  hardenHeaders(res);
  res.end();
}

/**
 * A failure answer, shaped by asset kind, matching what apps/images does on a
 * miss: cards get the placeholder WebP (the grid must not collapse), set imagery
 * and sprites get a 404 (the SPA already renders its own set mark / dex tile).
 */
function sendFailure(res: ServerResponse, asset: ParsedImage, reason: string): void {
  if (asset.kind === 'card') sendPlaceholder(res, 200, reason);
  else sendNotFound(res, reason);
}

/**
 * Resolve the upstream URL to fill a cold asset from.
 *
 * Provenance rules (see @deckpal/storage put-asset.ts):
 *  - a recorded `source_url` is authoritative and always wins;
 *  - CARD art otherwise falls back to the canonical TCGdex URL, which is a
 *    documented *derivation* of the requested path (DATA-LAYER §5.3), not a
 *    guess — and it is only ever written to the manifest after a fetch from it
 *    actually succeeded;
 *  - SET imagery has no *derivable* URL (the upstream path lives in `card_set`,
 *    not in the request path), so a missing source there WAS a dead end — until
 *    the approved crosswalk (`setImageFallbackUrl` in @deckpal/storage: 43
 *    curated (setId, kind) → sourceUrl pairs, a literal table approved
 *    2026-08-29, never read from a file at runtime). It is now ONE more thing to
 *    try before giving up: a recorded `source_url` still wins, and a (setId,
 *    kind) the crosswalk does not know still resolves to null — the honest dead
 *    end. The provenance written is the URL actually fetched (never the assumed
 *    crosswalk entry), exactly as for the card derivation below.
 *
 * THE MISSING-ROW CASE USED TO BE A DEAD END TOO, and that was a bug worth naming
 * because it failed silently and permanently. The rule was "no row at all → we do
 * not know this asset exists and we do not invent a URL", which sounds careful and
 * is wrong for cards specifically: the request path is not user-supplied trivia,
 * it is what OUR OWN api emits from OUR OWN catalog (`cardImages()` in db.ts), and
 * `canonicalSourceUrl` is a pure function of it. So a card whose manifest row was
 * never created — the promo/trainer-kit/e-card sets TCGdex's compiled datas.json
 * omits, which is how the manifest was seeded — served the placeholder on every
 * request forever, and no amount of re-viewing or re-warming could heal it,
 * because the fill declined to try the one URL that might have worked. Found by
 * sweeping the catalog on 2026-08-26: 585 cards in that state, of which the
 * derivation does in fact recover `svp/500`. The other 584 genuinely 404 upstream
 * and still answer the placeholder — which is the honest outcome, reached by
 * asking rather than by assuming.
 *
 * The same bug class — a dead end that was never a dead end — applied to set
 * imagery until 2026-08-29. The 43 (setId, kind) pairs the crosswalk covers are
 * exactly the ones whose `card_set.logo_url` / `symbol_url` are NULL, so the cloud
 * tier answered the placeholder for them on every view forever, no matter how
 * many times anyone looked at the page. The crosswalk is the approved source for
 * those pairs; it is not a derivation and it is not a guess (every URL was fetched
 * and confirmed). A (setId, kind) NOT in the crosswalk still resolves to null, and
 * the failure answer still carries a SHORT ttl so it self-heals if a source is
 * added later.
 *
 * Trying the derivation costs a 404 against a fixed host for a card we have no
 * bytes for either way, and the failure answer carries a SHORT ttl, so nothing is
 * cached long on a miss. Nothing is written unless a fetch succeeded.
 */

/**
 * The manifest row fields the resolution logic reads. A minimal slice of
 * `ManifestRow` so `resolveSourceFromManifest` is testable without a network
 * call — the full row has seven columns, only `source_url` is needed here.
 */
interface ManifestSource {
  source_url: string | null;
}

export interface ResolvedSource {
  url: string;
  provenanceWasUnknown: boolean;
  /** Set only for a crosswalk URL, which fetches under its own tighter policy. */
  viaFallback?: boolean;
  /**
   * The row records a SELF-SOURCED card (@deckpal/storage `self-source.ts`), so this is the
   * TCGdex derivation tried first, and a success replaces the row's provenance.
   */
  replacesSelfSourced?: boolean;
}

/**
 * The pure resolution core: given an asset and its manifest row (or null), decide
 * which upstream URL to fetch from, or null when none exists. Exported so the
 * resolution order is unit-testable without a PostgREST call (`getManifestRow`).
 *
 * Order: sprite (pinned SHA) → recorded source_url → card derivation → set
 * crosswalk → null. A recorded source always wins; the crosswalk is the last
 * resort for set imagery and only for the 43 approved pairs.
 */
export function resolveSourceFromManifest(
  asset: ParsedImage,
  row: ManifestSource | null,
): ResolvedSource | null {
  // Sprites carry no manifest row by design — their provenance is the pinned
  // PokeAPI SHA (see @deckpal/storage paths.ts SPRITES_SHA), so the URL is
  // fully determined by the request path and there is nothing to look up.
  if (asset.kind === 'sprite') {
    return { url: asset.canonicalSourceUrl, provenanceWasUnknown: false };
  }
  // A self-sourced card is never refetched from where it came from: those bytes were re-encoded
  // to our slot, and TCGdex is preferred whenever it has the card. So it resolves like a card with
  // no recorded source — the TCGdex derivation, with the self-source fallback behind it in `fill`.
  if (asset.kind === 'card' && isSelfSourced(row?.source_url)) {
    return { url: asset.canonicalSourceUrl, provenanceWasUnknown: false, replacesSelfSourced: true };
  }
  if (row?.source_url) {
    return { url: row.source_url, provenanceWasUnknown: false };
  }
  if (asset.kind === 'card') {
    // Missing row and NULL source_url are the same situation from here: no
    // recorded provenance, one documented derivation. `putStorageAsset` inserts
    // the manifest row before it publishes bytes, so a fill that starts from no
    // row still lands as row-then-bytes and never as an orphan (B1).
    return { url: asset.canonicalSourceUrl, provenanceWasUnknown: true };
  }
  if (asset.kind === 'set') {
    // The crosswalk is the approved source for 43 (setId, kind) pairs whose
    // `card_set` columns are NULL. It is NOT a derivation — it is a literal table
    // of confirmed URLs. A pair not in the table resolves to null (the honest dead
    // end); provenance recorded after a successful fetch is the URL that actually
    // served bytes, never the crosswalk entry we started from.
    const fallback = setImageFallbackUrl(asset.setId, asset.image);
    if (fallback) return { url: fallback, provenanceWasUnknown: true, viaFallback: true };
    return null;
  }
  return null;
}

async function resolveSourceUrl(asset: ParsedImage): Promise<ResolvedSource | null> {
  // Sprites carry no manifest row by design, so the lookup is skipped — the
  // pure function handles the decision for every other kind after the row is
  // fetched.
  if (asset.kind === 'sprite') {
    return { url: asset.canonicalSourceUrl, provenanceWasUnknown: false };
  }
  const row = await getManifestRow(asset.cacheKey);
  return resolveSourceFromManifest(asset, row);
}

async function fill(res: ServerResponse, asset: ParsedImage): Promise<void> {
  const started = Date.now();
  const source = await resolveSourceUrl(asset);
  if (!source) {
    sendFailure(res, asset, 'no manifest row / no recorded source');
    return;
  }

  // A 404 on the recorded URL only rules out that *extension* — TCGdex serves the
  // same base as .webp/.png/.jpg and does not keep all three forever.
  // A crosswalk URL fetches under SET_IMAGE_FALLBACK_POLICY, not the tier's
  // default: the default allow-lists only the hosts a CARD path can derive, so
  // every crosswalk fetch would be refused and the table would be inert here.
  // The scoped policy is strictly tighter, not looser — `isSetImageFallbackUrl`
  // pins the URL to a literal in the compiled-in table before it is used.
  const viaFallback = source.viaFallback === true && isSetImageFallbackUrl(source.url);
  const attempt = viaFallback
    ? await fetchSourceBytesWithExtensionFallback(source.url, 15_000, SET_IMAGE_FALLBACK_POLICY)
    : await fetchSourceBytesWithExtensionFallback(source.url);
  const fetched = attempt.result;
  if (!fetched.ok) {
    // CARD art no approved upstream has: self-source it (our own encode of the linked product's
    // image). Anything else keeps the honest placeholder.
    if (asset.kind === 'card') {
      const self = await selfSourceCardArt(asset.ref, asset.quality);
      if (self.ok) {
        await putStorageAsset({
          cacheKey: asset.cacheKey,
          kind: asset.assetKind,
          relativePath: asset.relativePath,
          bytes: self.bytes,
          provenance: fromUrl(self.sourceUrl, self.etag),
          contentType: 'image/webp',
          cacheControl: SELF_SOURCED_CACHE_CONTROL,
          replace: true,
        });
        res.setHeader('X-Fill-Ms', String(Date.now() - started));
        sendRedirect(res, publicObjectUrl(asset.relativePath), 'FILLED');
        return;
      }
      sendFailure(res, asset, `upstream ${fetched.httpStatus}: ${fetched.reason}; ${self.reason}`);
      return;
    }
    sendFailure(res, asset, `upstream ${fetched.httpStatus}: ${fetched.reason}`);
    return;
  }
  // Provenance is the URL that ACTUALLY served the bytes, never the one we asked
  // for first. Content type is the sniffed one, so a PNG served under a .webp
  // name is stored and served as image/png rather than as a lie.
  const servedBy = attempt.url;

  if (asset.kind === 'sprite') {
    await putUnmanifestedObject({
      objectPath: asset.relativePath,
      bytes: fetched.bytes,
      provenance: fromUrl(servedBy, fetched.etag),
      tierProvenanceReason:
        'sprite tree is pinned to one PokeAPI/sprites commit SHA (paths.ts SPRITES_SHA / ' +
        'scripts/fetch-sprites.sh); per-file rows would also make self-host manifest:check ' +
        'report every sprite as a missing file',
      contentType: fetched.contentType,
    });
  } else {
    await putStorageAsset({
      cacheKey: asset.cacheKey,
      kind: asset.assetKind,
      relativePath: asset.relativePath,
      bytes: fetched.bytes,
      provenance: fromUrl(servedBy, fetched.etag),
      contentType: fetched.contentType,
      replace: source.replacesSelfSourced === true,
    });

    if (source.provenanceWasUnknown) {
      await recordProvenanceIfUnknown(asset.cacheKey, servedBy, fetched.etag);
    }
  }

  res.setHeader('X-Fill-Ms', String(Date.now() - started));
  sendRedirect(res, publicObjectUrl(asset.relativePath), 'FILLED');
}

/** The one host whose card art replaces every other source. */
const TCGDEX_HOST = 'assets.tcgdex.net';

/**
 * `?refresh=tcgdex`: swap a card's art for TCGdex's, in place, once TCGdex has it.
 *
 * Only a card whose recorded source is NOT TCGdex is touched (self-sourced, pokemontcg.io,
 * anything else). TCGdex's own derivation is the only URL fetched, under the default policy, and
 * the bytes are written only if it served a real image. Anything else falls through to the
 * ordinary HIT/fill. The weekly catalog refresh sends this for every such card
 * (`pnpm --filter deckpal-api art:upgrade`). It costs anyone who sends it one manifest read and
 * at most one TCGdex fetch, and can only ever write TCGdex's art.
 *
 * Answers `no-store`: a cached answer would stop next week's check from reaching this function.
 */
async function refreshFromTcgdex(res: ServerResponse, asset: ParsedImage & { kind: 'card' }): Promise<boolean> {
  const row = await getManifestRow(asset.cacheKey);
  if (!row?.source_url) return false;
  let host: string | null = null;
  try { host = new URL(row.source_url).hostname; } catch { /* a note, not a URL: self-sourced */ }
  if (host === TCGDEX_HOST) return false;
  const attempt = await fetchSourceBytesWithExtensionFallback(asset.canonicalSourceUrl);
  if (!attempt.result.ok) {
    res.setHeader('X-Image-Refresh', 'kept');
    return false;
  }
  await putStorageAsset({
    cacheKey: asset.cacheKey,
    kind: asset.assetKind,
    relativePath: asset.relativePath,
    bytes: attempt.result.bytes,
    provenance: fromUrl(attempt.url, attempt.result.etag),
    contentType: attempt.result.contentType,
    replace: true,
  });
  res.setHeader('X-Image-Refresh', 'swapped');
  sendRedirect(res, publicObjectUrl(asset.relativePath), 'FILLED', 'no-store');
  return true;
}

function wantsTcgdexRefresh(url: string | undefined): boolean {
  try {
    return new URL(url ?? '', 'http://local').searchParams.get('refresh') === 'tcgdex';
  } catch {
    return false;
  }
}

/**
 * Node-style handler (no Express) — the shape Vercel's Node runtime expects, and
 * cheap enough to cold-start on the first view of an unwarmed card.
 */
export async function handleImageRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    hardenHeaders(res);
    res.end('method not allowed');
    return;
  }

  const subPath = imageSubPathFromUrl(req.url);
  if (subPath === null) {
    sendNotFound(res, 'not an image path');
    return;
  }

  const parsed = parseImagePath(subPath);
  if (!parsed.ok) {
    // 'bad-request' is a card-shaped path with a language/quality we don't serve
    // (apps/images answers 400 + placeholder); everything else — including every
    // traversal attempt and the sprite routes the cloud tier doesn't carry — 404s.
    if (parsed.reason === 'bad-request') sendPlaceholder(res, 400, 'unsupported lang/quality');
    else sendNotFound(res, 'invalid image path');
    return;
  }
  const asset = parsed.asset;

  try {
    const refresh = asset.kind === 'card' && wantsTcgdexRefresh(req.url);
    if (refresh) {
      if (await refreshFromTcgdex(res, asset)) return;
      res.setHeader('Cache-Control', 'no-store');
    }
    if (await objectExists(asset.relativePath)) {
      sendRedirect(res, publicObjectUrl(asset.relativePath), 'HIT', refresh ? 'no-store' : undefined);
      return;
    }
    await fill(res, asset);
  } catch (err) {
    // Any unexpected failure still answers with an IMAGE (or an honest 404) —
    // never a 500 HTML page, never the SPA shell.
    console.error('[images] %s: %s', asset.relativePath, (err as Error).message);
    if (!res.headersSent) sendFailure(res, asset, 'internal error');
    else res.end();
  }
}

export default handleImageRequest;
