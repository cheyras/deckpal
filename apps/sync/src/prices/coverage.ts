// Recompute user_set_progress catalog-derived denominators for the cross-filled sets, so the new
// reverse rows raise Master/Grandmaster denominators (catalog_variant_count / total_required).
// This mirrors the catalog importer's step-4 query (apps/sync/src/catalog/import.ts) but scoped to a
// set list, and — like it — ONLY writes catalog-derived columns; ownership/reconciliation columns are
// never touched, so a re-run cannot clobber user progress. SCHEMA §9.2/§9.3.

import type { Queryable } from './db.js';

export async function recomputeCoverage(client: Queryable, setIds: number[]): Promise<number> {
  if (!setIds.length) return 0;
  const { rows } = await client.query<{ n: string }>(
    `WITH v AS (
       SELECT c.set_id, c.id AS card_id, cv.id AS cv_id, cv.is_primary, (tr.tier='standard') AS is_std
       FROM card c
       JOIN card_variant cv ON cv.card_id = c.id
       JOIN variant_tier_resolved tr ON tr.card_variant_id = cv.id
       WHERE c.set_id = ANY($1::bigint[])
     ),
     card_std AS (SELECT set_id, card_id, bool_or(is_std) AS has_std FROM v GROUP BY set_id, card_id),
     master AS (
       SELECT v.set_id,
              count(*) FILTER (WHERE v.is_std)
              + count(*) FILTER (WHERE NOT cs.has_std AND v.is_primary) AS master_req
       FROM v JOIN card_std cs ON cs.set_id = v.set_id AND cs.card_id = v.card_id
       GROUP BY v.set_id
     ),
     agg AS (SELECT c.set_id, count(DISTINCT c.id) AS cards, count(cv.id) AS variants
             FROM card c JOIN card_variant cv ON cv.card_id = c.id
             WHERE c.set_id = ANY($1::bigint[]) GROUP BY c.set_id)
     INSERT INTO user_set_progress
       (user_id, set_id, goal, owned_required, total_required, total_quantity, catalog_variant_count, recomputed_at)
     SELECT u.id, s.id, g.goal, 0,
            CASE g.goal WHEN 'complete' THEN a.cards
                        WHEN 'grandmaster' THEN a.variants
                        ELSE m.master_req END,
            0, a.variants, now()
     FROM card_set s
     JOIN agg a ON a.set_id = s.id
     JOIN master m ON m.set_id = s.id
     CROSS JOIN app_user u
     CROSS JOIN (VALUES ('complete'),('master'),('grandmaster')) AS g(goal)
     ON CONFLICT (user_id, set_id, goal) DO UPDATE SET
       total_required = EXCLUDED.total_required,
       catalog_variant_count = EXCLUDED.catalog_variant_count,
       recomputed_at = now()
     RETURNING 1 AS n`,
    [setIds],
  );
  return rows.length;
}
