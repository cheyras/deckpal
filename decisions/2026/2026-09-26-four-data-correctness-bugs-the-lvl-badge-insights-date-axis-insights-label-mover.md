---
date: "2026-09-26"
title: "Four data-correctness bugs: the LVL badge, Insights' date axis, Insights' label/movers/error handling, and Pokédex paging"
decided_by: "Chey (via Claude)"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Four data-correctness bugs: the LVL badge, Insights' date axis, Insights' label/movers/error handling, and Pokédex paging

**Decided by:** Chey (via Claude)

**Decision:**
1. **QUAL-05 (LVL badge).** `ProgressCluster.tsx` and `SeriesDetail.tsx`
   now read the server's own `setLevel`/`c.setLevel` field, falling back to a new `setLevelFromCounts()`
   (truncating integer math, mirroring the DB's generated `set_level` column)
   instead of deriving a level from the already-rounded display percentage.
   `format.ts`'s `setLevelLabel()` now takes a level (0–5), matching the API's
   own function of the same name, instead of a pct. After merging main's shared
   collection write lane, the old `CardDetail.tsx` optimistic progress helper
   was removed because the live card route no longer calls it.
2. **QUAL-07 (Insights date axis).** `insightsCaption.ts`'s `isoDate()` now
   builds the window-boundary string from the Date's own LOCAL fields
   (`getFullYear`/`getMonth`/`getDate`) instead of `toISOString()`, and
   `rangeWindowStart()` uses local setters throughout. This is a deliberate,
   documented split from the server: `collection_value_point.observed_on` is a
   UTC calendar day (the daily snapshot cron runs once, on a fixed UTC clock —
   Supabase and GitHub Actions both run `timezone = UTC`), which is correct
   for a once-a-day, all-accounts write; the chart's axis boundary is instead
   anchored to the viewer's own local day, which is correct for something a
   human is looking at right now. The two can disagree by up to a day at the
   edges, same as the pre-existing month/year calendar slop this function
   already tolerated — immaterial, since the chart never invents a point.
3. **UXC-07 (Insights label/movers/error).** The delta card's heading now
   reads `rangeLabel(range)` from a shared `VALUE_RANGES` list (in
   `insightsCaption.ts`) instead of a hardcoded "Last 30 Days" literal.
   `collectionValue.ts`'s `topMovers()` now falls back to a self-derived
   30-day average of daily best `price_observation.market_minor` (the last ~30 days of
   daily rows the retention tiers already guarantee) when
   `price_current.avg30_minor` is absent — which it always is for USD/TCGCSV,
   since only Cardmarket's feed supplies that metric — instead of silently
   requiring a field one whole currency can never have. The vendor value is
   still preferred when present. `Insights.tsx` now distinguishes a failed
   `/insights/value` fetch (`ErrorState`) from a genuinely empty one ("No value
   snapshots recorded yet"), across the chart, delta and movers cards.
4. **Pokédex paging.** `PokedexIndex.tsx` and `Profile.tsx` now call a new
   `api.dexAll()` (in `apps/web/src/lib/api.ts`) instead of `api.dex()`
   directly. It follows `pagination.pageCount` past whatever `pageSize` was
   requested, using a new local `apps/web/src/lib/pagePlan.ts` — the identical
   shape (`PagePosition`/`remainingPages`) as PR #205's `pagePlan.ts` for
   `api.setAllCards()` (`GET /sets/:setId`'s equivalent fix), reimplemented
   locally because #205 (`fix/set-page-all-cards`) was still open/unmerged as
   of this branch. Both `PokedexIndex.tsx` and `Profile.tsx` request
   `pageSize: '1025'`, which today equals both the API's own cap
   (`clampInt(…, 1, 1025)`, `apps/api/src/routes/insights.ts`) and the current
   National Dex size (`NATIONAL_DEX_SIZE`, `apps/api/src/insights/pokedex.ts`)
   — so today's single request happens to be complete, and silently would not
   be the day a new generation pushes species past #1025. If #205 merges
   first, `apps/web/src/lib/pagePlan.ts` here should be deleted in favor of
   importing its copy — the two are deliberately identical so that merge is a
   rename, not a rewrite.

**Why:** All four are the "silently correct today, silently wrong the day a
number crosses a threshold" shape: a rounded percentage crossing a level
boundary a card early (QUAL-05, reproduced directly: 1999/2000 owned → "MAX"
with a card still missing); a UTC "today" reading as tomorrow for any US
evening viewer (QUAL-07); a metric only one of two price sources ever
supplies, making the default-currency Top Movers card permanently empty
(UXC-07); and a page-size literal that happens to equal both the server's cap
and today's species count (Pokédex paging, flagged as a follow-up in PR #205's
own DECISIONS.md entry for the equivalent set-page bug).

**Implications:** `apps/web/src/lib/format.ts`'s `setLevelLabel` signature
changed (pct → level) — its only callers were updated in the same commit.
`insightsCaption.ts` gained `VALUE_RANGES`/`rangeLabel`, which `Insights.tsx`
now imports instead of keeping its own copy of the range list.
`collectionValue.ts`'s `topMovers()` query changed shape (a `WITH` CTE over
`price_observation`). An independent review found that archive replay and live
ingestion can create multiple observations for one UTC day; the query now
collapses each day to its best market quote before averaging and requires two
distinct days. It was hand-verified against a disposable local Postgres
instance before the pause, and now has a regression case in the Linux-only
`test:integration` runner for derived USD, duplicate same-day observations,
sparse USD, vendor-preferred EUR, and user isolation. The fixture schema is focused rather than a migration of
the production schema. `pnpm -r
--workspace-concurrency=1 exec tsc --noEmit` and `pnpm --filter deckpal-web
build` are clean. New/updated unit tests: `format.ts`'s level math (7 cases,
`setLevel.test.ts`), `insightsCaption.ts`'s date window and range label (14
cases, updated `insightsCaption.test.ts`, TZ-pinned via `withTz`), and
`pagePlan.ts` (6 cases). `pnpm --filter deckpal-web test:insights` passes (120
tests). A deterministic fixture and headless Chromium at 390/1440 verified
the rightmost chart tick is 9/25 for a Denver viewer at 2026-09-26 05:30 UTC;
with the former UTC window code restored only for the comparison build, it is
9/26. The fixture's newest price-history point is two days earlier, so
`ValueChart.tsx`'s separate "never clip real data" union does not control this
boundary. The delta label and Top Movers also render at both widths.

