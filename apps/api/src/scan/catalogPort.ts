/**
 * The Postgres half of the OCR resolution ladder: the four catalogue lookups
 * `resolve.ts` needs, and the dev-startup cross-check between the vendored
 * printed-code table and what the catalog sync last wrote.
 *
 * Kept apart from `resolve.ts` so the ladder itself stays pure and testable
 * without a database, and apart from `router.ts` so `index.ts` can run the
 * startup check without importing an express Router to get at it.
 */
import { q } from '../db.js';
import type { CatalogCard, CatalogPort } from './resolve.js';
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
};

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
