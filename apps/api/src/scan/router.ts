import { Router, raw, type RequestHandler } from 'express';
import { cardImages, q } from '../db.js';
import { ApiError, asyncHandler, badRequest, clampInt, notFound, oneOf, toBuffer } from '../http.js';
import { ALGO, hashQueryCandidates, hashToHex } from './phash.js';
import { scanEmbedGate } from './embedGate.js';
import { CURRENT_STAMP, buildResponse, parseEmbedding, pgNeighbours } from './embedMatch.js';

/**
 * Offline card scanner (Phase 8) — image → card matcher.
 *
 * POST /deckpal/api/scan
 *   Body: the raw bytes of a query image (JPEG/PNG/WebP…). Send the image as the
 *         request body with an image/* Content-Type — NOT multipart, NOT base64.
 *           curl --data-binary @photo.jpg -H 'Content-Type: image/jpeg' \
 *                http://127.0.0.1/deckpal/api/scan
 *   Query: ?k=<1..25> top matches to return (default 5)
 *          ?quality=low|high  which indexed hash set to match against (default low)
 *   Response 200:
 *     { query: { algo, hash }, matched: bool, threshold, indexSize,
 *       matches: [ { cardId, name, setId, setName, number, rarity,
 *                    images:{low,high}, distance, confidence } ] }
 *
 * How it matches: we compute the query image's 64-bit dHash (plus geometry
 * probes) and rank the whole indexed hash set by Hamming distance (0 = identical,
 * 64 = opposite). `matched` is true only when the best distance is within
 * CONFIDENT_MAX — an honest "no confident match" for a photo of nothing in the
 * catalog. Read-only.
 *
 * 🔴 The ranking happens in Postgres, not in this process. The original scanner
 * read all ~23k hashes into a module-level typed array at first use and kept them
 * for the process lifetime. That is the right shape for a self-host server that
 * boots once, and the wrong shape for a serverless function: there is no boot to
 * hang it off, instances are recycled constantly, and a cold start would pay a
 * 23k-row read before it could answer. `bit_count(a # b)` is native Postgres
 * (14+), the table is the index, and the whole ranking is one query — which also
 * means an indexer run is live immediately instead of after a restart (contract
 * B5). Measured against the live cloud index: 22,652 rows × 34 probes (770k
 * popcounts) is 69 ms of server time, 98 ms wall from this Pi including ~29 ms
 * of network round trip — and a self-match still lands at distance 0.
 */

export const scanRouter: Router = Router();

// dHash bit-distance below which we call it a real match. Re-measured against
// the live v3 cloud index (2026-08, 60 cards spread across the catalog × 7
// phone-style degradations = 389 scans: re-encode, JPEG noise, 4°/8° tilt on a
// mat, off-centre on a mat, 7.5% keystone, dim + glare). The correct card lands
// at p50=3, p90=8, p95=9, p99=12; five synthetic no-card frames (gradient,
// plasma, noise, bare mat, printed text) bottom out at 10, 15, 15, 15 and 13.
// So 9 sits in the gap: 96.9% of correct scans fire and every junk frame is
// rejected, with 10 already letting the plasma frame through. (Beyond junk
// rejection the threshold can't buy precision: the rare wrong top-1s are
// near-identical same-art reprints at distance 1–6.)
const CONFIDENT_MAX = 9;

// Vercel caps a serverless function's request body at 4.5 MB, and the platform
// rejects a larger POST before this handler ever runs — so accepting more here
// would only turn a clear 413 into a confusing one. The client downscales
// anything bigger before sending (apps/web/src/routes/Scan.tsx); 4 MB is far
// more than the ~40 KB JPEG the camera path produces per frame.
const MAX_UPLOAD = 4 * 1024 * 1024;

interface MatchRow {
  index_size: string;
  distance: number | null;
  tcgdex_id: string | null;
  name: string | null;
  local_id: string | null;
  rarity: string | null;
  set_tcgdex_id: string | null;
  set_name: string | null;
  series_tcgdex_id: string | null;
}

/**
 * Rank the whole index by MIN Hamming distance across the query probes, hydrate
 * the k winners' card metadata, and report the index size — all in one round
 * trip, so a scan costs the connection budget exactly one query (contract B2).
 *
 * The probe hashes go in as 16-char hex `$n` params and are converted to bit(64)
 * exactly once, inside a MATERIALIZED single-row CTE. Without the fence Postgres
 * inlines the conversion into the scan and re-runs it per row per probe, which
 * measured 3x slower (190 ms vs 64 ms) — the same trap the generated `hash_bits`
 * column exists to avoid on the other side of the XOR.
 *
 * The joins are LEFT so an empty index (or a query that matches nothing) still
 * returns the one `sz` row carrying `index_size`, rather than collapsing to no
 * rows and losing the reason there were no matches.
 */
async function rankMatches(hashesHex: string[], quality: string, k: number): Promise<MatchRow[]> {
  // $1 quality, $2 algo, $3 k, then one param per probe.
  const probeParams = hashesHex.map((_, i) => `('x' || $${i + 4})::bit(64) AS p${i}`);
  const perProbe = hashesHex.map((_, i) => `bit_count(ph.hash_bits # probe.p${i})`);
  // 🔴 `bit_count` returns BIGINT, and node-pg hands BIGINT back as a *string* to
  // avoid precision loss. Without this cast `distance` reaches the client as
  // "0" instead of 0 — the API's own contract says number, and `<= threshold`
  // only kept working by accident of JS coercion. It is a 0–64 count; ::int.
  const distance = `(${perProbe.length === 1 ? perProbe[0]! : `LEAST(${perProbe.join(', ')})`})::int`;

  const sql = `
    WITH probe AS MATERIALIZED (SELECT ${probeParams.join(', ')}),
    sz AS (
      SELECT count(*)::text AS n FROM card_image_phash WHERE quality = $1 AND algo = $2
    ),
    ranked AS (
      SELECT ph.card_id, ${distance} AS distance
        FROM card_image_phash ph CROSS JOIN probe
       WHERE ph.quality = $1 AND ph.algo = $2
       ORDER BY distance
       LIMIT $3
    )
    SELECT sz.n AS index_size, r.distance, c.tcgdex_id, c.name, c.local_id, c.rarity,
           cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
           ser.tcgdex_id AS series_tcgdex_id
      FROM sz
      LEFT JOIN ranked r    ON true
      LEFT JOIN card c      ON c.id = r.card_id
      LEFT JOIN card_set cs ON cs.id = c.set_id
      LEFT JOIN series ser  ON ser.id = cs.series_id
     ORDER BY r.distance`;

  return q<MatchRow>(sql, [quality, ALGO, k, ...hashesHex]);
}

// Accept the raw image body regardless of the declared image/* subtype. Mounted
// only here so the app-wide express.json() is untouched. body-parser signals an
// oversize body with a plain Error whose `type` is 'entity.too.large' — left
// alone it reaches errorMiddleware as an unknown error and the caller is told
// "Internal server error", which is both wrong and unactionable.
//
// The Vercel body-consumption dance (see avatar.ts for the full explanation):
// save `req.body` before express.raw() can overwrite a valid Buffer with an
// empty one from a drained stream.
const rawImageBody = raw({ type: () => true, limit: MAX_UPLOAD });
const readImageBody: RequestHandler = (req, res, next) => {
  const preExisting = req.body;

  rawImageBody(req, res, (err?: unknown) => {
    if (err && (err as { type?: string }).type === 'entity.too.large') {
      next(
        new ApiError(
          413,
          'payload_too_large',
          `that image is over the ${MAX_UPLOAD / (1024 * 1024)} MB scan limit — send a smaller or downscaled photo`,
        ),
      );
      return;
    }
    if (err) { next(err); return; }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      const restored = toBuffer(preExisting);
      if (restored && restored.length > 0) {
        if (restored.length > MAX_UPLOAD) {
          next(
            new ApiError(
              413,
              'payload_too_large',
              `that image is over the ${MAX_UPLOAD / (1024 * 1024)} MB scan limit — send a smaller or downscaled photo`,
            ),
          );
          return;
        }
        req.body = restored;
      }
    }

    next();
  });
};

scanRouter.post(
  '/',
  readImageBody,
  asyncHandler(async (req, res) => {
    const body = toBuffer(req.body);
    if (!body || body.length === 0) {
      throw badRequest('POST the raw image bytes as the request body (Content-Type: image/*).');
    }
    const k = clampInt(req.query.k, 5, 1, 25);
    const quality = oneOf(req.query.quality, ['low', 'high'] as const, 'low');

    // Candidate hashes for the same photo: whole frame, background-trimmed,
    // plus rotation/keystone probes (see hashQueryCandidates). We rank each
    // catalog entry by the MIN distance across candidates so an off-centre or
    // tilted card is still found without penalising a clean, full-bleed shot.
    let queryHashes: bigint[];
    try {
      queryHashes = await hashQueryCandidates(body);
    } catch (e) {
      throw badRequest(`could not decode the uploaded image: ${(e as Error).message}`);
    }
    // The reported hash is the whole-frame one — stable + comparable to the index.
    const queryHash = queryHashes[0]!;
    const hashesHex = queryHashes.map(hashToHex);

    const rows = await rankMatches(hashesHex, quality, k);
    const indexSize = Number(rows[0]?.index_size ?? 0);
    if (indexSize === 0) {
      res.json({
        query: { algo: ALGO, hash: hashToHex(queryHash) },
        matched: false,
        threshold: CONFIDENT_MAX,
        indexSize: 0,
        matches: [],
        note: `no '${quality}' hashes indexed for ${ALGO} yet — run the scan indexer`,
      });
      return;
    }

    const matches = rows
      .filter((m): m is MatchRow & { distance: number; tcgdex_id: string } => m.distance !== null && m.tcgdex_id !== null)
      .map((m) => ({
        cardId: m.tcgdex_id,
        name: m.name ?? '',
        number: m.local_id ?? '',
        setId: m.set_tcgdex_id ?? '',
        setName: m.set_name ?? '',
        rarity: m.rarity,
        images: cardImages(m.series_tcgdex_id ?? '', m.set_tcgdex_id ?? '', m.local_id ?? ''),
        distance: m.distance,
        // Bit-similarity, honest and interpretable: 1.0 = identical hash.
        confidence: Math.round((1 - m.distance / 64) * 1000) / 1000,
      }));

    res.json({
      query: { algo: ALGO, hash: hashToHex(queryHash) },
      matched: (matches[0]?.distance ?? 64) <= CONFIDENT_MAX,
      threshold: CONFIDENT_MAX,
      indexSize,
      matches,
    });
  }),
);

/**
 * POST /deckpal/api/scan/embed — the embedding matcher.
 *
 *   Body (JSON): { stamp: string, embedding: number[], k?: number }
 *   Response 200: { stamp, indexSize, identity, variant, matches: [...] }
 *
 * Behind `SCAN_EMBED_MATCH=true` and 404 otherwise, so merging this changes
 * nothing about the running product until an operator turns it on (see
 * ./embedGate.ts for why the switch exists and what else has to be true).
 *
 * 404 rather than 503 when the gate is closed: an unset feature flag means this
 * deployment does not have this endpoint, which is exactly what 404 says. 503
 * would promise it is coming back.
 *
 * The response deliberately carries no `matched` boolean and no single
 * `confidence` — see ./embedMatch.ts.
 */
scanRouter.post(
  '/embed',
  asyncHandler(async (req, res) => {
    if (scanEmbedGate() === 'off') throw notFound('the embedding matcher is not enabled on this deployment');

    const body = (req.body ?? {}) as { stamp?: unknown; embedding?: unknown; k?: unknown };
    // The stamp is checked BEFORE the vector, and it is checked for equality
    // rather than compatibility. A client on an older bundle is not "close
    // enough" — its vectors live in a different space, and comparing them
    // would return a confident wrong answer rather than an error.
    if (typeof body.stamp !== 'string' || body.stamp !== CURRENT_STAMP) {
      throw badRequest(
        `this deployment matches against '${CURRENT_STAMP}'; the request carried ` +
          `'${typeof body.stamp === 'string' ? body.stamp : '(none)'}'. Reload the app to pick up the current model.`,
      );
    }
    let embedding;
    try {
      embedding = parseEmbedding(body.embedding);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const k = clampInt(body.k, 5, 1, 25);

    const { indexSize, rows } = await pgNeighbours(embedding, CURRENT_STAMP, k);
    if (indexSize === 0) {
      // Same shape as the hash path's empty-index answer, and for the same
      // reason: "nothing is indexed" and "nothing matched" are different facts
      // and must not arrive looking identical.
      res.json({
        stamp: CURRENT_STAMP,
        indexSize: 0,
        identity: { level: 'none', cardId: null, similarity: 0, margin: null, modelId: CURRENT_STAMP },
        variant: { level: 'unknown', reason: 'no-variant-model', requiresUserChoice: false },
        matches: [],
        note: `no embeddings indexed for ${CURRENT_STAMP} yet — run tools/embed-catalog`,
      });
      return;
    }
    res.json(buildResponse(CURRENT_STAMP, indexSize, rows));
  }),
);
