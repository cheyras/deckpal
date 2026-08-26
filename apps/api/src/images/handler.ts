import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FAILURE_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  PLACEHOLDER_CONTENT_TYPE,
  PLACEHOLDER_WEBP,
  fetchSourceBytesWithExtensionFallback,
  fromUrl,
  getManifestRow,
  imageSubPathFromUrl,
  objectExists,
  parseImagePath,
  publicObjectUrl,
  putStorageAsset,
  putUnmanifestedObject,
  recordProvenanceIfUnknown,
  type ParsedImage,
} from '@deckpal/storage';

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

function sendRedirect(res: ServerResponse, location: string, cache: 'HIT' | 'FILLED'): void {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
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
 *  - set imagery has no derivable URL, so a missing source there is a dead end.
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
 * Trying the derivation costs a 404 against a fixed host for a card we have no
 * bytes for either way, and the failure answer carries a SHORT ttl, so nothing is
 * cached long on a miss. Nothing is written unless a fetch succeeded.
 */
async function resolveSourceUrl(
  asset: ParsedImage,
): Promise<{ url: string; provenanceWasUnknown: boolean } | null> {
  // Sprites carry no manifest row by design — their provenance is the pinned
  // PokeAPI SHA (see @deckpal/storage paths.ts SPRITES_SHA), so the URL is
  // fully determined by the request path and there is nothing to look up.
  if (asset.kind === 'sprite') {
    return { url: asset.canonicalSourceUrl, provenanceWasUnknown: false };
  }
  const row = await getManifestRow(asset.cacheKey);
  if (row?.source_url) return { url: row.source_url, provenanceWasUnknown: false };
  if (asset.kind === 'card') {
    // Missing row and NULL source_url are the same situation from here: no
    // recorded provenance, one documented derivation. `putStorageAsset` inserts
    // the manifest row before it publishes bytes, so a fill that starts from no
    // row still lands as row-then-bytes and never as an orphan (B1).
    return { url: asset.canonicalSourceUrl, provenanceWasUnknown: true };
  }
  // Set imagery has no derivable URL — the upstream path lives in card_set, and
  // every recorded set row carries it. A NULL here is a real dead end.
  return null;
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
  const attempt = await fetchSourceBytesWithExtensionFallback(source.url);
  const fetched = attempt.result;
  if (!fetched.ok) {
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
    });

    if (source.provenanceWasUnknown) {
      await recordProvenanceIfUnknown(asset.cacheKey, servedBy, fetched.etag);
    }
  }

  res.setHeader('X-Fill-Ms', String(Date.now() - started));
  sendRedirect(res, publicObjectUrl(asset.relativePath), 'FILLED');
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
    if (await objectExists(asset.relativePath)) {
      sendRedirect(res, publicObjectUrl(asset.relativePath), 'HIT');
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
