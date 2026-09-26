import { cardImages, q, toMajor } from '../db.js';

/**
 * GET /me/cards — a bounded, paged page of the caller's OWN owned cards (one
 * row per card, any owned variant), for surfaces that used to derive this by
 * fanning out over the Pokédex.
 *
 * Why this exists (UXC-04): `Profile.tsx`'s `useOwnedCards()` built its "every
 * card I own" list by paging the captured-species grid and then firing
 * `GET /insights/pokedex/:speciesId` once PER captured species — 1 + N
 * requests on every Profile visit (867 for the audit's heavy persona), whether
 * or not the showcase picker that consumes the list was ever opened. One
 * failed species request threw the whole `Promise.all`, and the picker's
 * catch-all empty branch then told a collector with thousands of cards "You
 * don't own any cards yet." Trainers and Energy — which have no species — could
 * never be showcased either, since the derivation walked the dex.
 *
 * This is one SQL statement instead: aggregate `collection_item` by card,
 * carry the best-known USD market price for the "value" sort, and page it.
 * `packages/agent-tools/src/tools/collection.ts`'s `collection_summary` proves
 * the same join (collection_item → card_variant → card, plus the
 * best-price-per-variant CTE) is the right shape for "my owned cards" — this
 * mirrors it rather than re-deriving it from the dex.
 *
 * RLS: exactly the pattern every other `/me/*` and catalog route in this app
 * uses — `q()` runs on the per-request RLS-scoped connection when one is open
 * (SUPABASE_MODE; see db.ts), and the explicit `ci.user_id = $1` is the same
 * defense-in-depth every sibling route already carries (dex.ts, insights.ts).
 * `buildOwnedCardsQuery` is exported and unit-tested on its own (see
 * `__tests__/ownedCards.test.ts`) specifically so "does this always bind the
 * caller's own id, never anyone else's" is checkable without a database.
 */

export type OwnedCardsSort = 'value' | 'recent';

export interface OwnedCardsQueryOpts {
  /** Free-text filter on the card name. Empty/undefined means no filter. */
  q?: string;
  sort: OwnedCardsSort;
  limit: number;
  offset: number;
}

/**
 * Builds the parameterized SQL for one page of the caller's owned cards.
 * Pure — no I/O — so the query shape (and, above all, that `userId` is always
 * the FIRST bound parameter and the only thing gating `WHERE`) can be asserted
 * without a database.
 */
export function buildOwnedCardsQuery(userId: string, opts: OwnedCardsQueryOpts): { sql: string; params: unknown[] } {
  const params: unknown[] = [userId];
  const bind = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  const search = opts.q?.trim();
  const searchClause = search ? `AND c.name ILIKE ${bind(`%${search}%`)}` : '';
  // Both branches order by name as a stable tiebreaker, so paging never
  // reshuffles rows a caller has already seen.
  const orderBy =
    opts.sort === 'value' ? 'max(b.best_minor) DESC NULLS LAST, c.name ASC' : 'max(ci.updated_at) DESC, c.name ASC';
  const limitIdx = bind(opts.limit);
  const offsetIdx = bind(opts.offset);
  const sql = `
    WITH best AS (
      SELECT card_variant_id, max(market_minor) AS best_minor
        FROM price_current
       WHERE currency_code = 'USD' AND market_minor IS NOT NULL
       GROUP BY card_variant_id
    )
    SELECT c.tcgdex_id AS card_id, c.name,
           ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, c.local_id,
           sum(ci.quantity)::bigint AS total_qty,
           max(b.best_minor) AS best_minor,
           count(*) OVER() AS total_rows
      FROM collection_item ci
      JOIN card_variant cv ON cv.id = ci.card_variant_id
      JOIN card c          ON c.id = cv.card_id
      JOIN card_set cs     ON cs.id = c.set_id
      JOIN series ser      ON ser.id = cs.series_id
 LEFT JOIN best b          ON b.card_variant_id = cv.id
     WHERE ci.user_id = $1 AND ci.quantity > 0
           ${searchClause}
     GROUP BY c.tcgdex_id, c.name, ser.tcgdex_id, cs.tcgdex_id, c.local_id
     ORDER BY ${orderBy}
     LIMIT ${limitIdx} OFFSET ${offsetIdx}`;
  return { sql, params };
}

interface OwnedCardRow {
  card_id: string;
  name: string;
  serie: string;
  setcode: string;
  local_id: string;
  total_qty: string;
  best_minor: number | null;
  total_rows: string;
}

export interface OwnedCard {
  cardId: string;
  name: string;
  images: { low: string; high: string };
  quantity: number;
  price: { market: number | null; currency: string } | null;
}

export interface OwnedCardsPage {
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  cards: OwnedCard[];
}

const MAX_PAGE_SIZE = 100;

/** One bounded, paged slice of the caller's owned cards. */
export async function ownedCardsPage(
  userId: string,
  opts: { q?: string; sort?: OwnedCardsSort; page: number; pageSize: number },
): Promise<OwnedCardsPage> {
  const page = Math.max(1, Math.trunc(opts.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(opts.pageSize) || 1));
  const sort: OwnedCardsSort = opts.sort === 'value' ? 'value' : 'recent';

  const { sql, params } = buildOwnedCardsQuery(userId, {
    q: opts.q,
    sort,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const rows = await q<OwnedCardRow>(sql, params);
  const total = rows.length ? Number(rows[0]!.total_rows) : 0;

  return {
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
    cards: rows.map((r) => ({
      cardId: r.card_id,
      name: r.name,
      images: cardImages(r.serie, r.setcode, r.local_id),
      quantity: Number(r.total_qty),
      price: r.best_minor !== null ? { market: toMajor(r.best_minor, 'USD'), currency: 'USD' } : null,
    })),
  };
}
