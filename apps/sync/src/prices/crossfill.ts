// Reverse-holo cross-fill from TCGCSV products+prices (research/TCGCSV-VARIANTS.md, ARCHITECTURE §8.1).
//
// TCGdex is missing reverse-holo card_variant rows for Call of Legends / Black & White / XY /
// Sun & Moon, making those sets' Master/Grandmaster completion falsely high. TCGplayer's `subTypeName`
// on the prices endpoint carries a "Reverse Holofoil" printing for exactly the cards TCGdex is short.
// We detect those, join numerically (localId ↔ extendedData[Number]) with a cleanName fallback, and
// INSERT a reverse variant: source='tcgcsv', tcgdex_variant_id=NULL, variant_kind_code='reverse'
// (deterministic, standard-tier), keyed on the existing UNIQUE (card_id, variant_kind_code).
//
// SAFETY: we only fill cards that have NO reverse variant, and the upsert's WHERE clause refuses to
// touch a source='tcgdex' row — so a future TCGdex backfill promotes the row in place (ON CONFLICT
// DO UPDATE) and the control sets (sm3, sv03.5) that already carry curated reverse rows get ZERO
// additions. Numeric-join fills are fill_confidence=100 (count toward Master immediately);
// cleanName-fallback fills are flagged provisional (<100).

import { fetchJson } from './http.js';
import {
  cardNumberNumeric,
  type TcgcsvProductEnvelope, type TcgcsvProductRow, type TcgcsvPriceRow,
} from './types.js';
import { normalizeName } from '../catalog/transform.js';
import type { Queryable } from './db.js';
import { fetchGroupPrices, writeSetPrices, resolveSets } from './tcgcsv.js';

const BASE = 'https://tcgcsv.com/tcgplayer/3';
const REVERSE_KIND = 'reverse'; // variantKindCode({finish:'reverse', …}) — deterministic
const CONF_NUMERIC = 100;
const CONF_NAME = 70;

export async function fetchGroupProducts(groupId: number): Promise<TcgcsvProductRow[]> {
  const env = await fetchJson<TcgcsvProductEnvelope>(`${BASE}/${groupId}/products`);
  if (!env.success) throw new Error(`TCGCSV products ${groupId}: ${env.errors.join('; ') || 'success=false'}`);
  return env.results;
}

interface CardRow { id: number; num: number | null; name: string; hasReverse: boolean; maxSort: number }

async function loadSetCards(client: Queryable, setId: number): Promise<CardRow[]> {
  const { rows } = await client.query<{ id: string; num: number | null; name: string; hasrev: boolean; maxsort: number | null }>(
    `SELECT c.id, c.local_id_numeric AS num, c.name_normalized AS name,
            bool_or(cv.variant_kind_code = $2) AS hasrev,
            max(cv.sort_order) AS maxsort
       FROM card c
       LEFT JOIN card_variant cv ON cv.card_id = c.id
      WHERE c.set_id = $1
      GROUP BY c.id, c.local_id_numeric, c.name_normalized`,
    [setId, REVERSE_KIND],
  );
  return rows.map((r) => ({ id: Number(r.id), num: r.num == null ? null : Number(r.num), name: r.name, hasReverse: r.hasrev ?? false, maxSort: r.maxsort == null ? -1 : Number(r.maxsort) }));
}

function stripTrailingNumber(cleanName: string): string {
  return normalizeName(cleanName.replace(/\s+\S*\d\S*$/, '').trim());
}

export interface EraFill { series: string; sets: number; reverseProducts: number; filledNumeric: number; filledName: number; skippedHasReverse: number; unmatched: number }
export interface CrossFillResult { byEra: Record<string, EraFill>; totalFilled: number; controlAdditions: number; pricedObservations: number }

// The four affected series. sm3 (control) lives inside sun-moon and must net ZERO additions.
export const AFFECTED_SERIES = ['call-of-legends', 'black-white', 'xy', 'sun-moon'];

export interface CrossFillOpts { series?: string[]; writePrices?: boolean; capturedAt?: Date }

export async function crossFillReverse(client: Queryable, opts: CrossFillOpts = {}): Promise<CrossFillResult> {
  const series = opts.series ?? AFFECTED_SERIES;
  // resolve every set in the affected series that has a groupId
  const { rows: setRows } = await client.query<{ id: string; tcgdex_id: string; g: number; series: string }>(
    `SELECT s.id, s.tcgdex_id, s.tcgplayer_group_id AS g, se.slug AS series
       FROM card_set s JOIN series se ON se.id = s.series_id
      WHERE se.slug = ANY($1) AND s.tcgplayer_group_id IS NOT NULL
      ORDER BY se.slug, s.tcgplayer_group_id`,
    [series],
  );

  const byEra: Record<string, EraFill> = {};
  let totalFilled = 0, controlAdditions = 0, pricedObservations = 0;

  for (const s of setRows) {
    const era = byEra[s.series] ?? (byEra[s.series] = { series: s.series, sets: 0, reverseProducts: 0, filledNumeric: 0, filledName: 0, skippedHasReverse: 0, unmatched: 0 });
    era.sets++;
    const setId = Number(s.id);
    const groupId = Number(s.g);

    const products = await fetchGroupProducts(groupId);
    const prices = await fetchGroupPrices(groupId);

    // products that TCGplayer prices with a "Reverse Holofoil" printing
    const reverseProductIds = new Set<number>();
    for (const p of prices) if (p.subTypeName === 'Reverse Holofoil') reverseProductIds.add(p.productId);
    const productById = new Map<number, TcgcsvProductRow>(products.map((p) => [p.productId, p]));

    // this set's cards, indexed for the numeric join + cleanName fallback
    const cards = await loadSetCards(client, setId);
    const byNum = new Map<number, CardRow[]>();
    const byName = new Map<string, CardRow[]>();
    for (const c of cards) {
      if (c.num != null) (byNum.get(c.num) ?? byNum.set(c.num, []).get(c.num)!).push(c);
      (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)!).push(c);
    }

    era.reverseProducts += reverseProductIds.size;
    const inserts: { card: CardRow; productId: number; url: string | null; conf: number; source: 'number_match' | 'name_match' }[] = [];
    const queued = new Set<number>();

    for (const pid of reverseProductIds) {
      const product = productById.get(pid);
      if (!product) { era.unmatched++; continue; }
      let card: CardRow | undefined;
      let source: 'number_match' | 'name_match' = 'number_match';
      let conf = CONF_NUMERIC;

      const num = cardNumberNumeric(product);
      const numCands = num != null ? byNum.get(num) : undefined;
      if (numCands && numCands.length === 1) {
        card = numCands[0];
      } else {
        const nn = stripTrailingNumber(product.cleanName ?? product.name);
        const nameCands = byName.get(nn);
        if (nameCands && nameCands.length === 1) { card = nameCands[0]; source = 'name_match'; conf = CONF_NAME; }
      }
      if (!card) { era.unmatched++; continue; }
      if (card.hasReverse) { era.skippedHasReverse++; continue; } // control-safe: never duplicate a curated reverse
      if (queued.has(card.id)) continue;
      queued.add(card.id);
      inserts.push({ card, productId: pid, url: product.url ?? null, conf, source });
    }

    if (inserts.length) {
      await client.query('BEGIN');
      const COLS = 15;
      const values: unknown[] = [];
      const ph = inserts.map((it, r) => {
        const b = r * COLS;
        values.push(
          it.card.id, REVERSE_KIND, it.card.maxSort + 1, false, false,
          it.productId, 'Reverse Holofoil', it.url, it.source, it.conf,
          'Reverse Holofoil', 'Found in Booster Packs', it.conf,
          null, 'tcgcsv', // tcgdex_variant_id = NULL, source = 'tcgcsv'
        );
        return `(${Array.from({ length: COLS }, (_, c) => `$${b + c + 1}`).join(',')})`;
      }).join(',');
      const { rows: back } = await client.query<{ id: string; card_id: string }>(
        `INSERT INTO card_variant
           (card_id, variant_kind_code, sort_order, is_primary, is_synthesized,
            tcgplayer_product_id, tcgplayer_printing, tcgplayer_url, id_source, id_confidence,
            display_name, provenance, fill_confidence, tcgdex_variant_id, source)
         VALUES ${ph}
         ON CONFLICT (card_id, variant_kind_code) DO UPDATE
           SET tcgplayer_product_id = EXCLUDED.tcgplayer_product_id,
               tcgplayer_printing   = EXCLUDED.tcgplayer_printing,
               tcgplayer_url        = EXCLUDED.tcgplayer_url,
               id_source            = EXCLUDED.id_source,
               id_confidence        = EXCLUDED.id_confidence,
               fill_confidence      = EXCLUDED.fill_confidence,
               last_synced_at       = now()
           WHERE card_variant.source = 'tcgcsv'
         RETURNING id, card_id`,
        values,
      );
      await client.query('COMMIT');
      for (const it of inserts) (it.source === 'number_match' ? era.filledNumeric++ : era.filledName++);
      totalFilled += back.length;
      // control accounting: sm3 / sv03.5 are the zero-addition proof sets
      if (s.tcgdex_id === 'sm3' || s.tcgdex_id === 'sv03.5') controlAdditions += back.length;
    }

    // optionally price the set now that reverse variants exist (reuses the fetched prices)
    if (opts.writePrices && opts.capturedAt) {
      await client.query('BEGIN');
      const r = await writeSetPrices(client, setId, prices, opts.capturedAt, null);
      await client.query('COMMIT');
      pricedObservations += r.observations;
    }
  }

  return { byEra, totalFilled, controlAdditions, pricedObservations };
}

// keep resolveSets imported so the CLI can share set resolution
export { resolveSets };
