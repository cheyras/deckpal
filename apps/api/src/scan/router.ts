import { Router, raw, type RequestHandler } from 'express';
import { cardImages, q } from '../db.js';
import { ApiError, asyncHandler, badRequest, clampInt, oneOf, toBuffer } from '../http.js';
import { ALGO, hashQueryCandidates, hashToHex } from './phash.js';
import { pgCatalogPort } from './catalogPort.js';
import { resolveCard, type OcrFields, type PriorMatch, type RankedCard } from './resolve.js';

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
//
// Exported for POST /resolve, which passes it to the ladder rather than
// re-declaring it: there is one honest threshold for "phash is sure", and it
// belongs next to the measurement that produced it. /resolve does NOT reuse it
// as its own confidence bar — a printed-code hit is a different kind of
// evidence, not a better distance (CROSSWALK §7.4) — it uses it only to ask
// whether the phash priors are confident enough to argue back.
export const CONFIDENT_MAX = 9;

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
 * POST /api/scan/resolve — narrow a scan with what OCR could read off the card.
 *
 *   Body (application/json; every field optional):
 *     {
 *       "fields": {
 *         "name":        "Floragato",   // the title line, as read
 *         "number":      "014",         // the numerator; zero padding is ignored
 *         "denominator": "198",         // ABSENT IS MEANINGFUL — see below
 *         "setCode":     "SVIEN",       // the badge, language subscript and all
 *         "bodyLines":   ["Slash", …]   // ESCALATION ONLY — see below
 *       },
 *       "priorMatches": [ { "cardId": "sv01-014", "distance": 3 } ]
 *     }
 *
 *   Response 200:
 *     {
 *       "matched":    true,
 *       "confident":  true,
 *       "resolvedBy": "badge+number",
 *       "matches": [ { cardId, name, number, setId, setName, rarity,
 *                      images:{low,high}, distance, confidence } ]
 *     }
 *
 * `matches` is the same shape as POST /scan's, with one difference that matters
 * to a caller: `distance` and `confidence` are `number | null` here, not
 * `number`. They carry the phash evidence, and a card the ladder resolved by
 * its printed key was never nominated by phash and has none — null says "no
 * phash opinion", which is not the same as "distance 64".
 *
 * `resolvedBy` names the rung that answered (CROSSWALK §7.3):
 *   'badge+number'       rung 1 — the printed code plus the collector number.
 *                        20,444 keys, zero collisions; the strongest key there is.
 *   'number+denominator' rung 3 — 63.4% of these keys are unique. Also the
 *                        answer when several candidates survive with nothing to
 *                        separate them, in which case `confident` is false.
 *   'name+number'        rungs 4 and 5 — the name as a cross-check on a number.
 *                        99.6% unique with a denominator, 94.3% without. The
 *                        two share a label because they share a shape; the
 *                        distinction the caller cares about is `confident`.
 *   'family-text'        rung 9 — the text in the MIDDLE of the card. See the
 *                        escalation note below; this is the one rung that can
 *                        return `matched: false` WITH candidates.
 *   'prior-only'         OCR added no key, only a filter. The answer is the
 *                        existing phash path's, possibly narrowed to a set or a
 *                        number, and `confident` is always false.
 *
 * ── fields.bodyLines: WHEN TO SEND IT, AND WHAT COMES BACK ─────────────────
 *
 * Send it ONLY when the name and the number both failed to extract. It is the
 * whole-card text — attacks, ability, rules text, flavour line — as at most 24
 * lines of at most 200 characters, in reading order, and it is a last resort
 * rather than a bonus signal: it costs a large slow OCR region and everything
 * it can say is said better by the two small ones. Sending it alongside a good
 * read is harmless (rung 9 runs after every rung that resolves from a name, a
 * number or a badge, so it can never override one) and simply wasted.
 *
 * What comes back is a FAMILY, never a printing, because every printing of one
 * card carries the same words — that is what a reprint is. So:
 *
 *   - the family has exactly one printing → `matched: true`, `confident: true`,
 *     one match. This is the whole set of circumstances in which body text
 *     alone identifies a card.
 *   - the family has several → `matched: false` with every printing in
 *     `matches`. 🔴 Not an empty answer, and not a matched one: put those in
 *     front of a person to choose from, and never auto-add one.
 *   - nothing was decisive → the rung is silent and some other `resolvedBy`
 *     answers, exactly as it would have if `bodyLines` had not been sent.
 *
 * The rung is also silent — with no error and no change to any other rung — on
 * a deployment whose migrations or catalog sync have not run yet.
 *
 * `confident` is an IDENTITY claim — this is that card — and never a claim
 * about the printing. Which variant (reverse holo, first edition, jumbo) stays
 * a separate unresolved dimension and the two are never blended: a certain
 * identity must not launder a guess about the printing, and an unknown printing
 * must not drag down a certain identity.
 *
 * Two things a caller should not mistake for errors:
 *   - A MISSING `denominator` is a signal, not a failed read. The energy sets
 *     (SVE, MEE) and the promo sets (SVP, MEP) print none at all, and its
 *     absence is what separates `SVE 017` from `SVI 017`. Send it absent when
 *     the card printed none; send it absent when OCR could not read one; the
 *     ladder cannot tell those apart and treats neither as an error.
 *   - A numerator ABOVE the denominator is normal — `245/198` is a secret rare
 *     and there are 60 of them in sv01 alone. Nothing here validates one
 *     against the other.
 *
 * Read-only. No auth beyond whatever the mount point applies; it reads catalogue
 * rows a signed-out visitor can already browse.
 */

/**
 * A hostile or buggy client could otherwise post thousands of ids and turn the
 * hydration query into a catalogue dump. POST /scan itself never returns more
 * than 25 matches, so 50 is already double any honest caller's output.
 */
const MAX_PRIORS = 50;

/** OCR output is short strings. Anything longer is not a card name. */
const MAX_FIELD_LEN = 128;

/**
 * `fields.bodyLines` is the one OCR field that is a LIST, and the one that
 * reaches an array-containment query, so it gets its own two bounds rather than
 * MAX_FIELD_LEN's.
 *
 * 24 lines is the owner's ruling, verbatim. 200 characters is deliberate
 * headroom rather than a target: the longest single line in the recorded
 * full-crop OCR reads is 65 characters, and a card does not print longer ones,
 * so anything approaching this bound is two lines a grouper glued together and
 * is still cheaper to accept than to argue about.
 *
 * The ladder clamps to the same two numbers on its own (`familyText.ts`).
 * These exist so a caller that overshoots gets a 400 naming the limit it hit,
 * instead of a silent truncation and an answer it cannot explain.
 */
const MAX_BODY_LINES = 24;
const MAX_BODY_LINE_LEN = 200;

function readBodyLines(fields: Record<string, unknown>): string[] | undefined {
  const v = fields.bodyLines;
  if (v == null) return undefined;
  if (!Array.isArray(v)) throw badRequest('fields.bodyLines must be an array of strings');
  if (v.length > MAX_BODY_LINES) throw badRequest(`fields.bodyLines holds at most ${MAX_BODY_LINES} lines`);
  const out: string[] = [];
  for (const [i, line] of v.entries()) {
    if (typeof line !== 'string') throw badRequest(`fields.bodyLines[${i}] must be a string`);
    if (line.length > MAX_BODY_LINE_LEN) {
      throw badRequest(`fields.bodyLines[${i}] is longer than ${MAX_BODY_LINE_LEN} characters`);
    }
    if (line.trim() !== '') out.push(line);
  }
  return out;
}

function readField(fields: Record<string, unknown>, key: string): string | undefined {
  const v = fields[key];
  if (v == null) return undefined;
  // Numbers are accepted for `number`/`denominator` because a client that has
  // already parsed them should not have to stringify them back.
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') throw badRequest(`fields.${key} must be a string`);
  if (v.length > MAX_FIELD_LEN) throw badRequest(`fields.${key} is longer than ${MAX_FIELD_LEN} characters`);
  return v;
}

function parseResolveBody(body: unknown): { fields: OcrFields; priorMatches: PriorMatch[] } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest(
      'POST a JSON object: { fields: { name?, number?, denominator?, setCode?, bodyLines? }, priorMatches?: [...] }',
    );
  }
  const b = body as Record<string, unknown>;

  let fields: OcrFields = {};
  if (b.fields != null) {
    if (typeof b.fields !== 'object' || Array.isArray(b.fields)) throw badRequest('`fields` must be an object');
    const f = b.fields as Record<string, unknown>;
    fields = {
      name: readField(f, 'name'),
      number: readField(f, 'number'),
      denominator: readField(f, 'denominator'),
      setCode: readField(f, 'setCode'),
      bodyLines: readBodyLines(f),
    };
  }

  const priorMatches: PriorMatch[] = [];
  if (b.priorMatches != null) {
    if (!Array.isArray(b.priorMatches)) throw badRequest('`priorMatches` must be an array');
    if (b.priorMatches.length > MAX_PRIORS) throw badRequest(`at most ${MAX_PRIORS} priorMatches`);
    for (const [i, entry] of b.priorMatches.entries()) {
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw badRequest(`priorMatches[${i}] must be { cardId, distance }`);
      }
      const p = entry as Record<string, unknown>;
      if (typeof p.cardId !== 'string' || p.cardId === '' || p.cardId.length > MAX_FIELD_LEN) {
        throw badRequest(`priorMatches[${i}].cardId must be a non-empty card id`);
      }
      // 0..64 because that is the range of a 64-bit Hamming distance. A value
      // outside it did not come from POST /scan.
      if (typeof p.distance !== 'number' || !Number.isFinite(p.distance) || p.distance < 0 || p.distance > 64) {
        throw badRequest(`priorMatches[${i}].distance must be a number from 0 to 64`);
      }
      priorMatches.push({ cardId: p.cardId, distance: p.distance });
    }
  }

  return { fields, priorMatches };
}

function shapeResolved(m: RankedCard): Record<string, unknown> {
  return {
    cardId: m.cardId,
    name: m.name,
    number: m.number,
    setId: m.setId,
    setName: m.setName,
    rarity: m.rarity,
    images: cardImages(m.seriesId, m.setId, m.number),
    distance: m.distance,
    // Same bit-similarity POST /scan reports, and null for the same reason
    // `distance` is: a card resolved by its printed key has no phash opinion
    // attached, and inventing 0.0 would read as "maximally dissimilar".
    confidence: m.distance == null ? null : Math.round((1 - m.distance / 64) * 1000) / 1000,
  };
}

scanRouter.post(
  '/resolve',
  asyncHandler(async (req, res) => {
    const { fields, priorMatches } = parseResolveBody(req.body);
    const outcome = await resolveCard(fields, priorMatches, pgCatalogPort, {
      phashConfidentMax: CONFIDENT_MAX,
    });
    res.json({
      matched: outcome.matched,
      confident: outcome.confident,
      resolvedBy: outcome.resolvedBy,
      matches: outcome.matches.map(shapeResolved),
    });
  }),
);
