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
 * `GET /sets/:setId` hit this first (UXC-01, PR #205, `fix/set-page-all-cards`,
 * still open as of this writing — see that PR/DECISIONS.md 2026-09-26 for the
 * full incident: 9 sets over the API's 250-card page cap silently lost their
 * highest-numbered cards, chase rares included). This module is the SAME
 * shape, implemented locally for the Pokédex/dex index rather than imported,
 * because #205 hadn't merged yet: `PokedexIndex.tsx` and `Profile.tsx` request
 * `pageSize: '1025'`, which happens to equal both `GET /insights/pokedex`'s own
 * server-side cap (`clampInt(req.query.pageSize, 200, 1, 1025)`,
 * `apps/api/src/routes/insights.ts`) and the current National Dex size
 * (`NATIONAL_DEX_SIZE`, `apps/api/src/insights/pokedex.ts`) — so today's single
 * request happens to be complete, and the day a new generation adds species
 * #1026+, it silently won't be. `pagination.total`/`pageCount` in the response
 * are already correct regardless; nothing has ever asked for page 2.
 *
 * If #205 merges before this lands, prefer importing `remainingPages` from
 * its `apps/web/src/lib/pagePlan.ts` instead of keeping two copies — the
 * shape here is deliberately identical so that merge is a no-op rename, not a
 * rewrite.
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
 * row, in ascending order. Empty when `page` already covers everything.
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
