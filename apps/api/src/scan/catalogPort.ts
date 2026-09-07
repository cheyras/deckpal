/**
 * The Postgres half of the OCR resolution ladder: the six catalogue lookups
 * `resolve.ts` needs, and the dev-startup cross-check between the vendored
 * printed-code table and what the catalog sync last wrote.
 *
 * Kept apart from `resolve.ts` so the ladder itself stays pure and testable
 * without a database, and apart from `router.ts` so `index.ts` can run the
 * startup check without importing an express Router to get at it.
 */
import { q } from '../db.js';
import { CARD_TEXT_NORMALIZER_VERSION } from '@deckpal/db/cardText';
import type { CatalogCard, CatalogPort } from './resolve.js';
import { MAX_POOL_ROWS, type FamilyTextCard } from './familyText.js';
import { diffPrintedSetCodes, printedSetCodesAsOf, type CardSetAbbrevRow } from './printedSetCode.js';

interface CardRow {
  tcgdex_id: string;
  name: string;
  local_id: string;
  local_id_numeric: number | null;
  rarity: string | null;
  set_tcgdex_id: string;
  set_name: string;
  series_tcgdex_id: string;
}

interface CardTextRow extends CardRow {
  playable_fingerprint: string;
  tokens: string[];
}

function shape(r: CardRow): CatalogCard {
  return {
    cardId: r.tcgdex_id,
    name: r.name,
    number: r.local_id,
    numberNumeric: r.local_id_numeric,
    setId: r.set_tcgdex_id,
    setName: r.set_name,
    seriesId: r.series_tcgdex_id,
    rarity: r.rarity,
  };
}

function shapeText(r: CardTextRow): FamilyTextCard {
  return { ...shape(r), familyKey: r.playable_fingerprint, tokens: r.tokens };
}

// Every lookup shares this projection; only the WHERE differs. `c.lang = 'en'`
// is not currently selective — the sync only ever loads `data/catalog/en` and
// `catalogue.jp` is is_enabled = FALSE — but it is the exact scope of the claim
// this endpoint makes. A Japanese SV-era card prints a badge too: mixed-case,
// no `EN` subscript, and in an id space of its own (`SV1a`, `M-P`). If the jp
// catalogue is ever enabled, the right answer for such a card is "not in the
// English catalogue", and this predicate is what keeps that from silently
// becoming a confident wrong English guess instead.
const SELECT = `
  SELECT c.tcgdex_id, c.name, c.local_id, c.local_id_numeric, c.rarity,
         cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
         ser.tcgdex_id AS series_tcgdex_id
    FROM card c
    JOIN card_set cs ON cs.id = c.set_id
    JOIN series ser  ON ser.id = cs.series_id
   WHERE c.lang = 'en'`;

/**
 * Hard ceiling on any one lookup. `byNumber` is the only query here without a
 * naturally small result — a bare collector number means a mean of 66 cards and
 * a worst case of 183 — and the caller trims to MAX_MATCHES anyway. This exists
 * so a malformed number can never turn into a catalogue-wide scan.
 */
const ROW_LIMIT = 250;

/**
 * `card.name_normalized`, folded the rest of the way to what
 * `normalizeCardName` produces from a read: accents off (`unaccent`, migration
 * 017) and TCGdex's trailing disambiguating parenthetical off.
 *
 * `\s` and `\(` survive into Postgres as themselves because
 * `standard_conforming_strings` is on, which is the default and has been since
 * 9.1 — the doubling below is JavaScript's, not SQL's.
 */
const FOLDED_NAME = `regexp_replace(unaccent(c.name_normalized), '\\s*\\([^)]*\\)\\s*$', '')`;

/**
 * A LIKE prefix pattern out of a folded name.
 *
 * The escaping is not decoration: this string starts life as OCR output off a
 * photograph anyone can post to `/scan/resolve`, and an unescaped `%` would turn
 * a prefix filter into a full scan that returns the catalogue. Backslash is the
 * default LIKE escape character, so no ESCAPE clause is needed for it to mean
 * this.
 */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
}

// The rung-9 lookups need two columns the four above do not — `tokens` and the
// family key — and they enter from `card_text` rather than from `card`, so they
// compose their own statement out of these three pieces instead of extending
// SELECT. Same English-only scope, plus 047's rule that a NULL fingerprint is
// not a family of nulls.
const PROJECTION = `
  SELECT c.tcgdex_id, c.name, c.local_id, c.local_id_numeric, c.rarity,
         c.playable_fingerprint, t.tokens,
         cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
         ser.tcgdex_id AS series_tcgdex_id`;
const JOINS = `
  JOIN card c      ON c.id = t.card_id
  JOIN card_set cs ON cs.id = c.set_id
  JOIN series ser  ON ser.id = cs.series_id`;
const SCOPE = `c.lang = 'en' AND c.playable_fingerprint IS NOT NULL`;

export const pgCatalogPort: CatalogPort = {
  // Rung 1. Joins on `local_id_numeric`, never on `local_id` text: TCGdex zero
  // padding is per-set inconsistent (`sv09-001` but `swsh9-100`), so a text
  // join would miss on the padding alone (CROSSWALK §7.2 step 2).
  async bySetAndNumber(setId, numeric) {
    const rows = await q<CardRow>(
      `${SELECT} AND cs.tcgdex_id = $1 AND c.local_id_numeric = $2 LIMIT ${ROW_LIMIT}`,
      [setId, numeric],
    );
    return rows.map(shape);
  },

  // Rung 3. `card_count_official` is the PRINTED set size — the 165 in
  // "#006/165" — which is exactly the number OCR reads off the strip. It is
  // emphatically not a completion denominator and 003's own COMMENT ON COLUMN
  // says so; this is the one read for which it is the right column.
  async byNumberAndDenominator(numeric, denominator) {
    const rows = await q<CardRow>(
      `${SELECT} AND c.local_id_numeric = $1 AND cs.card_count_official = $2 LIMIT ${ROW_LIMIT}`,
      [numeric, denominator],
    );
    return rows.map(shape);
  },

  async byNumber(numeric) {
    const rows = await q<CardRow>(
      `${SELECT} AND c.local_id_numeric = $1 LIMIT ${ROW_LIMIT}`,
      [numeric],
    );
    return rows.map(shape);
  },

  async byIds(cardIds) {
    if (cardIds.length === 0) return [];
    const rows = await q<CardRow>(
      `${SELECT} AND c.tcgdex_id = ANY($1::text[]) LIMIT ${ROW_LIMIT}`,
      [[...cardIds]],
    );
    return rows.map(shape);
  },

  // Rung 5b. A SUPERSET generator: the tiers are `nameTier`'s and are applied to
  // these rows in `resolve.ts`, so nothing about what counts as the same name is
  // decided in SQL. Two predicates, because they catch two different things and
  // neither subsumes the other:
  //
  //   FOLDED_NAME LIKE 'charizard%'   the exact and suffix-dropped reads
  //     (tiers 0 and 1), in BOTH directions — a read of "Charizard" has to find
  //     "Charizard ex" and a read of "Charizard ex" has to find "Charizard", and
  //     a prefix of the suffix-stripped read is the one predicate that does
  //     both. This is the guaranteed half: it cannot miss a name the ladder
  //     would have accepted at tier 0 or 1.
  //   name_normalized % 'floragato'   the MISREAD (tier 2). pg_trgm's `%`, the
  //     operator index I6 (`card_name_trgm`, migration 012) exists for, at its
  //     default 0.3 similarity floor. Heuristic on purpose — it is a
  //     neighbourhood, and the edit budget that actually decides is applied in
  //     JS afterwards.
  //
  // FOLDED_NAME re-folds `name_normalized`, which the importer only casefolds
  // and apostrophe-folds (`normalizeName`, apps/sync). The two divergences §5
  // names are the accents (492 cards PRINT them) and TCGdex's trailing
  // parenthetical (13 cards, printed by none of them), so both are folded here
  // to match what `normalizeCardName` did to the read.
  //
  // 🔴 THIS ONE SCANS `card`, and that is a considered trade rather than an
  // oversight. The prefix half is a functional expression, so no index can serve
  // it (017 declines to index unaccent() for the same reason), and an OR with an
  // indexable half is still a scan. It is 23.5k rows of three cheap functions,
  // it runs ONLY on a request where every printed key has already failed, and
  // the alternative — trusting the trigram floor alone — would make an exact
  // name read depend on a similarity heuristic. Correctness on the rung's own
  // key beats a scan the capture path never waits for.
  //
  // ORDER BY similarity, for the same reason `byTextTokens` orders by overlap:
  // an unordered LIMIT discards an arbitrary subset, and the subset it must
  // never discard is the family that would have won.
  async byName(probe) {
    const rows = await q<CardRow>(
      `${SELECT}
         AND (${FOLDED_NAME} LIKE $1 OR c.name_normalized % $2::text)
       ORDER BY similarity(c.name_normalized, $2::text) DESC, c.name_normalized, c.tcgdex_id
       LIMIT ${ROW_LIMIT}`,
      [likePrefix(probe.prefix), probe.normalized],
    );
    return rows.map(shape);
  },

  // Rung 9's prefilter. `t.tokens && $1` is the GIN-indexable half (049's
  // card_text_tokens_idx); the intersection count is the selective half and
  // runs on the rows the index already narrowed to. Both halves are needed:
  // `&&` alone matches on one common word, and the count alone is a sequential
  // scan of 23.5k arrays.
  //
  // Two filters that look like belt-and-braces and are not:
  //   - `c.playable_fingerprint IS NOT NULL` — 047 is explicit that NULL is
  //     "too little gameplay data to hash" and NOT an equality with the other
  //     NULLs. A row with no family key cannot be grouped and must not arrive
  //     here pretending to be a family of one.
  //   - `t.normalizer_version = $n` — a bag folded by an older normaliser is
  //     not comparable with a read folded by this one, and a half-migrated
  //     table is the single state in which this rung could match the wrong
  //     family quietly. Mismatched rows are skipped, the pool comes back short
  //     or empty, and the rung declines. The fix is always a re-sync.
  //
  // 🔴 ORDER BY overlap DESC is not cosmetic and must not be dropped to save a
  // sort. The LIMIT exists so a pathological read cannot pull the catalogue
  // into memory, and an unordered LIMIT discards an ARBITRARY subset — which
  // could be the family that would have won, leaving a rival to be scored top
  // of a pool it only leads because the real answer was truncated away. Ordered,
  // the rows the cap keeps are the rows most worth scoring.
  //
  // Measured on the 378-card corpus the thresholds were sized against: pool p50
  // 10 rows, p90 72, max 246, and across 988 accepted reads at four noise
  // levels the prefilter dropped the winning family twice — both under heavy
  // degradation, and both times the result was a REFUSAL rather than a wrong
  // answer, which is the direction a lossy prefilter is allowed to fail in.
  //
  // `minOverlap` is the caller's, not a constant, because a probe made of words
  // half the game shares needs a proportionally larger overlap to be a filter
  // at all — see `planProbe`.
  async byTextTokens(probeTokens, minOverlap) {
    if (probeTokens.length === 0) return [];
    return textQuery(
      `WITH hit AS (
         SELECT t.card_id, t.tokens,
                cardinality(ARRAY(SELECT unnest(t.tokens) INTERSECT SELECT unnest($1::text[]))) AS overlap
           FROM card_text t
          WHERE t.tokens && $1::text[] AND t.normalizer_version = $2
       )
       ${PROJECTION}
         FROM hit t
         ${JOINS}
        WHERE ${SCOPE} AND t.overlap >= $3
        ORDER BY t.overlap DESC, c.tcgdex_id
        LIMIT ${MAX_POOL_ROWS}`,
      [[...probeTokens], CARD_TEXT_NORMALIZER_VERSION, minOverlap],
    );
  },

  // Rung 9's second half: every printing of one family. An equality on the
  // column 047 indexed, and the reason the confident/not-confident split is
  // allowed to say "exactly one printing" at all.
  async byFamilyKey(familyKey) {
    return textQuery(
      `${PROJECTION}
         FROM card_text t
         ${JOINS}
        WHERE ${SCOPE} AND c.playable_fingerprint = $1 AND t.normalizer_version = $2
        ORDER BY c.tcgdex_id
        LIMIT ${MAX_POOL_ROWS}`,
      [familyKey, CARD_TEXT_NORMALIZER_VERSION],
    );
  },
};

/**
 * The two rung-9 lookups share a projection, a join and a failure mode.
 *
 * 🔴 THE FAILURE MODE IS THE POINT. `card_text` ships in migration 049 and is
 * filled by the next catalog sync, and production will spend some window with
 * neither having happened. A missing table (42P01) or a missing column (42703)
 * must therefore mean "this rung is not available yet", not a 500 on an
 * endpoint whose other eight rungs work perfectly — so those two SQLSTATEs are
 * swallowed to an empty pool, which `resolve.ts` reads as a graceful skip.
 *
 * Nothing else is swallowed. A connection failure, a timeout or a syntax error
 * is a real fault and still throws.
 */
async function textQuery(sql: string, params: unknown[]): Promise<FamilyTextCard[]> {
  try {
    const rows = await q<CardTextRow>(sql, params);
    return rows.map(shapeText);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01' || code === '42703') {
      warnTextUnavailable(code);
      return [];
    }
    throw err;
  }
}

/** Once per process. A per-request warning for a known, expected state is noise. */
let warnedTextUnavailable = false;
function warnTextUnavailable(code: string): void {
  if (warnedTextUnavailable) return;
  warnedTextUnavailable = true;
  console.warn(
    `[scan] card_text is not available (SQLSTATE ${code}) — the family-text rung is skipped and the ` +
      'ladder behaves as it did before migration 049. Run the migrations, then the catalog sync.',
  );
}

/**
 * Dev-startup divergence warning for the vendored printed-code table.
 *
 * CROSSWALK §8.2 item 5 wants this as a CI check that fails the build — "New
 * set -> CI turns red -> one reviewed line" — and that is still the right end
 * state. It needs a live catalogue, which CI here does not have, so this is the
 * half that can actually run: a log line at dev startup, log-only, never fatal.
 * The enforceable half is `__tests__/printedSetCode.test.ts`, which asserts the
 * file's internal consistency with no database at all.
 *
 * Never throws and never blocks the boot. A scanner that cannot warn about a
 * new expansion is a scanner with a stale table; an API that will not start
 * because a warning could not be computed is an outage.
 */
export async function warnOnPrintedSetCodeDivergence(): Promise<void> {
  try {
    const rows = await q<CardSetAbbrevRow>(
      `SELECT cs.tcgdex_id, cs.abbreviation, cs.prints_set_code, cs.released_on::text AS released_on
         FROM card_set cs
         JOIN series s ON s.id = cs.series_id
        WHERE s.catalogue_code = 'en'`,
    );
    const lines = diffPrintedSetCodes(rows);
    if (lines.length === 0) {
      console.log(`[scan] printed-set-code.json (as of ${printedSetCodesAsOf()}) agrees with card_set across ${rows.length} EN sets`);
      return;
    }
    console.warn(`[scan] printed-set-code.json diverges from card_set in ${lines.length} place(s):`);
    for (const line of lines) console.warn(`[scan]   ${line}`);
    console.warn('[scan] the FILE is the authority (apps/api/src/scan/data/_provenance.json); fix it there, not in the column');
  } catch (err) {
    console.warn(`[scan] printed-set-code cross-check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
