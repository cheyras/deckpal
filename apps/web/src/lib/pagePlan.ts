/**
 * Which page numbers are still missing after reading ONE page's `pagination`
 * block.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The same "request one page, trust it's everything" shape shows up wherever a
 * client asks a paginated endpoint for a page sized to match today's known
 * total and then reads that one response as if it were the whole collection.
 * It is silently correct for as long as the total stays at or under that page
 * size, and silently WRONG the day it doesn't — the rows that vanish are
 * always the ones past the edge nobody re-checked.
 *
 * Set pages hit this first (UXC-01, PR #205). `GET /sets/:setId` and
 * `GET /search` cap `pageSize` server-side (250 — `clampInt` in
 * `apps/api/src/routes/sets.ts` / `routes/search.ts`) to protect the endpoint,
 * and the set page fetched exactly one page and read `.cards` as if it were
 * the whole set. That was silently WRONG for the 9 sets over the cap
 * (Ascended Heroes has 295 cards; the highest 45 numbers — its chase rares —
 * never rendered).
 *
 * The Pokédex/dex index has the same shape (PR #235): `PokedexIndex.tsx` and
 * `Profile.tsx` request `pageSize: '1025'`, which happens to equal both
 * `GET /insights/pokedex`'s own server-side cap
 * (`clampInt(req.query.pageSize, 200, 1, 1025)`,
 * `apps/api/src/routes/insights.ts`) and the current National Dex size
 * (`NATIONAL_DEX_SIZE`, `apps/api/src/insights/pokedex.ts`) — so today's single
 * request happens to be complete, and the day a new generation adds species
 * #1026+, it silently won't be.
 *
 * In both cases `pagination.total`/`pageCount` in the response were always
 * right; nothing ever asked for page 2.
 *
 * Kept in its own module, with no imports, so the fix is unit-testable without
 * dragging in `lib/api.ts` → `lib/supabase.ts` → `import.meta.env`, which the
 * `node --import tsx --test` harness cannot load (see `jsonContentType.ts`,
 * which documents the same constraint).
 */

export interface PagePosition {
  /** The page just fetched (1-based, matching the API's `?page=`). */
  page: number
  /** How many pages exist in total for this query, per the server response. */
  pageCount: number
}

/**
 * The page numbers beyond `page` that a caller must also fetch to have every
 * row, in ascending order. Empty when `page` already covers everything, which
 * covers every query that fits under the server's per-page cap.
 *
 * Fails closed (returns `[]`, never loops) on a malformed `PagePosition` —
 * NaN, an infinite `pageCount`, or `page` already past `pageCount` — because
 * asking for zero extra pages is always safe, while trusting a bad number
 * enough to fire an unbounded run of requests is not.
 */
export function remainingPages(pos: PagePosition): number[] {
  if (!Number.isFinite(pos.page) || !Number.isFinite(pos.pageCount)) return []
  if (pos.pageCount <= pos.page) return []
  const out: number[] = []
  for (let p = pos.page + 1; p <= pos.pageCount; p++) out.push(p)
  return out
}
