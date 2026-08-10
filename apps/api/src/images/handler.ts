import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FAILURE_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  PLACEHOLDER_CONTENT_TYPE,
  PLACEHOLDER_WEBP,
  fetchSourceBytes,
  fromUrl,
  getManifestRow,
  imageSubPathFromUrl,
  objectExists,
  parseImagePath,
  publicObjectUrl,
  putStorageAsset,
  recordProvenanceIfUnknown,
  type ParsedImage,
} from '@deckscout/storage';

/**
 * The cloud image tier: `/deckscout/images/*` on Vercel.
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
 *           point (`@deckscout/storage` put-asset), then 302 as above.
 *   FAIL  → the same ~1 KB placeholder WebP apps/images serves (cards) or a 404
 *           (set imagery, which the SPA already renders its own fallback for),
 *           with a SHORT TTL so it self-heals once the asset becomes fetchable.
 *
 * The rule that produced this file: an image URL must NEVER answer with HTML.
 * Before this existed, `/deckscout/images/*` fell through to the SPA catch-all
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

/** A failure answer, shaped by asset kind: cards get a placeholder, sets a 404. */
function sendFailure(res: ServerResponse, asset: ParsedImage, reason: string): void {
  if (asset.kind === 'card') sendPlaceholder(res, 200, reason);
  else sendNotFound(res, reason);
}

/**
 * Resolve the upstream URL to fill a cold asset from.
 *
 * Provenance rules (see @deckscout/storage put-asset.ts):
 *  - a recorded `source_url` is authoritative and always wins;
 *  - a card row with NULL provenance may fall back to the canonical TCGdex URL,
 *    which is a documented *derivation* of the requested path (DATA-LAYER §5.3),
 *    not a guess — and it is only ever written back to the manifest after a fetch
 *    from it actually succeeded;
 *  - no row at all → we do not know this asset exists and we do not invent a URL.
 */
async function resolveSourceUrl(
  asset: ParsedImage,
): Promise<{ url: string; provenanceWasUnknown: boolean } | null> {
  const row = await getManifestRow(asset.cacheKey);
  if (!row) return null;
  if (row.source_url) return { url: row.source_url, provenanceWasUnknown: false };
  if (asset.kind === 'card') {
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

  const fetched = await fetchSourceBytes(source.url);
  if (!fetched.ok) {
    sendFailure(res, asset, `upstream ${fetched.httpStatus}: ${fetched.reason}`);
    return;
  }

  await putStorageAsset({
    cacheKey: asset.cacheKey,
    kind: asset.assetKind,
    relativePath: asset.relativePath,
    bytes: fetched.bytes,
    // We fetched from this exact URL and got these exact bytes — attested, not assumed.
    provenance: fromUrl(source.url, fetched.etag),
    contentType: fetched.contentType,
  });

  if (source.provenanceWasUnknown) {
    await recordProvenanceIfUnknown(asset.cacheKey, source.url, fetched.etag);
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
