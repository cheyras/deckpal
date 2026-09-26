/**
 * Which page numbers are still missing after reading ONE page's `pagination`
 * block.
 *
 * ── WHY THIS EXISTS (UXC-01) ─────────────────────────────────────────────────
 *
 * `GET /sets/:setId` and `GET /search` cap `pageSize` server-side (250 —
 * `clampInt` in `apps/api/src/routes/sets.ts` / `routes/search.ts`) to protect
 * the endpoint, and the set page fetched exactly one page and read `.cards` as
 * if it were the whole set. That is silently correct for every set at or
 * under the cap and silently WRONG for the 9 that aren't (Ascended Heroes has
 * 295 cards; the highest 45 numbers — its chase rares — never rendered).
 * `pagination.total`/`pageCount` in the response were always right; nothing
 * ever asked for page 2.
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
 * row — `[]` when `page` already was the last one, which covers every query
 * that fits under the server's per-page cap.
 */
export function remainingPages({ page, pageCount }: PagePosition): number[] {
  if (!Number.isFinite(page) || !Number.isFinite(pageCount) || pageCount <= page) return []
  return Array.from({ length: pageCount - page }, (_, i) => page + 1 + i)
}
