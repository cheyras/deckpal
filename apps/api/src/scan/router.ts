import { Router, raw } from 'express';
import { cardImages, q } from '../db.js';
import { asyncHandler, badRequest, clampInt, oneOf } from '../http.js';
import { ALGO, hashQueryCandidates, hashToHex } from './phash.js';

/**
 * Offline card scanner (Phase 8) — image → card matcher.
 *
 * POST /deckscout/api/scan
 *   Body: the raw bytes of a query image (JPEG/PNG/WebP…). Send the image as the
 *         request body with an image/* Content-Type — NOT multipart, NOT base64.
 *           curl --data-binary @photo.jpg -H 'Content-Type: image/jpeg' \
 *                http://127.0.0.1/deckscout/api/scan
 *   Query: ?k=<1..25> top matches to return (default 5)
 *          ?quality=low|high  which indexed hash set to match against (default low)
 *   Response 200:
 *     { query: { algo, hash }, matched: bool, threshold, indexSize,
 *       matches: [ { cardId, name, setId, setName, number, rarity,
 *                    images:{low,high}, distance, confidence } ] }
 *
 * How it matches: we compute the query image's 64-bit dHash and rank the whole
 * indexed hash set by Hamming distance (0 = identical, 64 = opposite). `matched`
 * is true only when the best distance is within CONFIDENT_MAX — an honest "no
 * confident match" for a photo of nothing in the catalog. Read-only.
 */

export const scanRouter: Router = Router();

// dHash bit-distance below which we call it a real match. Re-measured for the
// multi-probe matcher (2026-07 benchmark, 150 cards × 10 degradations): a real
// phone-style capture's correct card lands ≤ 6 at p90 (≤ 9 at p99.6), while the
// min distance a NO-CARD frame reaches across all probes is 10–18 — so 9 keeps
// ~99.6% of correct scans firing and rejects every junk frame tested. (Beyond
// junk rejection the threshold can't buy precision: the rare wrong top-1s are
// near-identical same-art reprints at distance 1–6.)
const CONFIDENT_MAX = 9;
const MAX_UPLOAD = 15 * 1024 * 1024;

// The full hash set, loaded once and cached in memory (the index is static
// between indexer runs), as parallel typed arrays split into 32-bit halves so
// the multi-probe matching loop runs on number popcounts (~5 ns each) instead
// of bigint ops. ~23k entries × 26 query probes is still a few ms.
interface HashIndex {
  cardIds: Float64Array; // card ids fit doubles exactly; avoids Int32 overflow fuss
  hi: Uint32Array;
  lo: Uint32Array;
  size: number;
}
let cache: { quality: string; index: HashIndex } | null = null;

async function loadHashes(quality: string): Promise<HashIndex> {
  if (cache && cache.quality === quality) return cache.index;
  const rows = await q<{ card_id: string; hash: Buffer }>(
    'SELECT card_id, hash FROM card_image_phash WHERE quality = $1 AND algo = $2',
    [quality, ALGO],
  );
  const index: HashIndex = {
    cardIds: new Float64Array(rows.length),
    hi: new Uint32Array(rows.length),
    lo: new Uint32Array(rows.length),
    size: rows.length,
  };
  rows.forEach((r, i) => {
    index.cardIds[i] = Number(r.card_id);
    index.hi[i] = r.hash.readUInt32BE(0);
    index.lo[i] = r.hash.readUInt32BE(4);
  });
  cache = { quality, index };
  return index;
}

/** 32-bit popcount (Hacker's Delight); x must be a uint32. */
function pop32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

scanRouter.post(
  '/',
  // Accept the raw image body regardless of the declared image/* subtype. Mounted
  // only here so the app-wide express.json() is untouched.
  raw({ type: () => true, limit: MAX_UPLOAD }),
  asyncHandler(async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
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

    const index = await loadHashes(quality);
    if (index.size === 0) {
      res.json({
        query: { algo: ALGO, hash: hashToHex(queryHash) },
        matched: false,
        threshold: CONFIDENT_MAX,
        indexSize: 0,
        matches: [],
        note: `no '${quality}' hashes indexed yet — run the scan indexer`,
      });
      return;
    }

    // Rank by Hamming distance: for every entry, MIN over the query probes.
    // Linear over ~23k entries × ~26 probes of 32-bit XOR+popcount — a few ms.
    // Keep only the k smallest via a simple bounded insertion (avoids sorting all).
    const nq = queryHashes.length;
    const qhi = new Uint32Array(nq);
    const qlo = new Uint32Array(nq);
    queryHashes.forEach((h, i) => {
      qhi[i] = Number((h >> 32n) & 0xffffffffn);
      qlo[i] = Number(h & 0xffffffffn);
    });
    const top: Array<{ cardId: number; distance: number }> = [];
    let worstKept = 64;
    for (let i = 0; i < index.size; i++) {
      const ehi = index.hi[i]!;
      const elo = index.lo[i]!;
      let d = 64;
      for (let j = 0; j < nq; j++) {
        const dd = pop32(ehi ^ qhi[j]!) + pop32(elo ^ qlo[j]!);
        if (dd < d) d = dd;
      }
      if (top.length < k || d < worstKept) {
        top.push({ cardId: index.cardIds[i]!, distance: d });
        top.sort((a, b) => a.distance - b.distance);
        if (top.length > k) top.pop();
        worstKept = top[top.length - 1]!.distance;
      }
    }

    const best = top[0]?.distance ?? 64;
    const matched = best <= CONFIDENT_MAX;

    // Hydrate card metadata for the k winners in one query.
    const ids = top.map((t) => t.cardId);
    const meta = await q<{
      id: string;
      tcgdex_id: string;
      name: string;
      local_id: string;
      rarity: string | null;
      set_tcgdex_id: string;
      set_name: string;
      series_tcgdex_id: string;
    }>(
      `SELECT c.id, c.tcgdex_id, c.name, c.local_id, c.rarity,
              cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
              ser.tcgdex_id AS series_tcgdex_id
         FROM card c
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser  ON ser.id = cs.series_id
        WHERE c.id = ANY($1)`,
      [ids],
    );
    const byId = new Map(meta.map((m) => [Number(m.id), m]));

    const matches = top
      .map((t) => {
        const m = byId.get(t.cardId);
        if (!m) return null;
        return {
          cardId: m.tcgdex_id,
          name: m.name,
          number: m.local_id,
          setId: m.set_tcgdex_id,
          setName: m.set_name,
          rarity: m.rarity,
          images: cardImages(m.series_tcgdex_id, m.set_tcgdex_id, m.local_id),
          distance: t.distance,
          // Bit-similarity, honest and interpretable: 1.0 = identical hash.
          confidence: Math.round((1 - t.distance / 64) * 1000) / 1000,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    res.json({
      query: { algo: ALGO, hash: hashToHex(queryHash) },
      matched,
      threshold: CONFIDENT_MAX,
      indexSize: index.size,
      matches,
    });
  }),
);
