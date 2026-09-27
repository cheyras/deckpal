import type pg from 'pg';
import { computeFingerprints } from './db.js';
import { identicalPrintGroup } from './identicalPrints.js';

export interface IdenticalPrintIndexResult {
  scanned: number;
  grouped: number;
  excludedPromo: number;
  tooThin: number;
  updated: number;
}

/** Populate safe ordinary-print groups after fingerprints have been refreshed. */
export async function indexIdenticalPrints(pool: pg.Pool, chunkSize = 500): Promise<IdenticalPrintIndexResult> {
  const { rows } = await pool.query<{ id: string; is_promo: boolean }>(
    `SELECT c.id, s.is_promo
       FROM card c JOIN card_set s ON s.id = c.set_id
      WHERE c.lang = 'en'
      ORDER BY c.id`,
  );
  const out: IdenticalPrintIndexResult = {
    scanned: rows.length,
    grouped: 0,
    excludedPromo: rows.filter((r) => r.is_promo).length,
    tooThin: 0,
    updated: 0,
  };

  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = rows.slice(i, i + chunkSize);
    const fps = await computeFingerprints(pool, batch.map((r) => Number(r.id)));
    const values: Array<[number, string | null]> = [];
    for (const row of batch) {
      const fp = fps.get(Number(row.id)) ?? null;
      const group = identicalPrintGroup(fp, row.is_promo);
      if (!row.is_promo && !fp) out.tooThin += 1;
      if (group) out.grouped += 1;
      values.push([Number(row.id), group]);
    }
    if (!values.length) continue;
    const sqlValues = values.map((_, n) => `($${n * 2 + 1}::bigint, $${n * 2 + 2}::char(64))`).join(',');
    const result = await pool.query(
      `UPDATE card SET identical_print_group = v.group_id
         FROM (VALUES ${sqlValues}) AS v(id, group_id)
        WHERE card.id = v.id AND card.identical_print_group IS DISTINCT FROM v.group_id`,
      values.flat(),
    );
    out.updated += result.rowCount ?? 0;
  }
  return out;
}
