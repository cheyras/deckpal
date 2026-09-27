---
date: "2026-09-26"
title: "Exclude Pokémon TCG Pocket from every catalog-browsing query path"
decided_by: "Chey (via Claude)"
areas: ["data","catalog"]
supersedes: []
---
## 2026-09-26 — Exclude Pokémon TCG Pocket from every catalog-browsing query path

**Decided by:** Chey (via Claude)

**Decision:** Added migration `074_browsable_card.sql` (renumbered from an
initial `072` once the open-PR migration registry assigned 072 to
fix/postgrest-reach and 073 to feat/scanner-voice — this PR merges after
both), defining two views — `browsable_set` and `browsable_card` — as the
single shared predicate for "is this part of the browsable physical Pokémon
TCG catalog" (`series.tcgdex_id <> 'tcgp'`). Both are created
`WITH (security_invoker = true)` (Supabase advisor 0010, made structural by
072_postgrest_reach's migration lint) — a no-op for behavior here, since both
only touch `card`/`card_set`/`series`, which already carry a public
`USING (true)` SELECT policy, but verified directly against `anon` and
`authenticated` roles under a real Supabase-mode RLS setup rather than
assumed. Every read path that lists, searches or counts
cards/sets for browsing now selects `FROM` these views instead of
`card`/`card_set` directly: the search route and its facets
(`routes/search.ts`), the Pokédex/species insights (`dexCompletion`,
`speciesGrid`, `speciesDetail`, `dexCapturedCount` in `insights/pokedex.ts`)
and the separately-mounted legacy species route (`routes/dex.ts`, live at
`/api/dex`), the agent-tools card/set resolvers (`resolve.ts`'s `CARD_SELECT`
and `entities.ts`'s `SET_SELECT` — the shared choke point `get_card`,
`search_cards`, `log_cards`, `add_cards` and `edit_list` all route through),
the `search_cards` and `set_progress(all_sets)` MCP/Deck-E tools
(`tools/catalog.ts`), and `insights/collectionValue.ts`'s `topMovers` (defense
in depth — Pocket carries no price data today, so this makes the exclusion
true by construction rather than a side effect of an unrelated feed gap).
Left unchanged: `recomputeSetProgress` and any other query already scoped to
one known, already-resolved set (a set cannot mix Pocket and physical cards,
so nothing there needs the predicate), and the direct-by-id card/set detail
routes (`/api/cards/:id`, `/api/series/:slug`) — Pocket content stays
reachable by a direct URL but unlinked from every browsing surface, which is
the audit's own suggested default; returning 404 from those routes instead is
a separate product call this PR does not make.

**Why:** DECISIONS 2026-08-10 established that Pokémon TCG Pocket (a separate
digital game) "is not browsable anywhere in the product." The ux-catalog audit
(UXC-02, 2026-09-26) found 7 of 36 "charizard ex" search results were Pocket
cards, and that this inflated species `cardPool`, so a physical collection
could never reach a species' top LVL. The root cause: Pocket's one series
(`tcgdex_id` `'tcgp'`) is imported under the SAME `'en'` catalogue row as the
physical TCG — `apps/sync/src/catalog/import.ts`'s `CATALOGUE = 'en'` constant
never distinguishes them — so `catalogue.is_enabled` (already `FALSE` for the
dedicated `'pocket-en'` catalogue code) gives no protection here. Only
`series.tcgdex_id <> 'tcgp'` actually excludes it, and before this fix that
check existed only in the series list route (`routes/series.ts`), not in
search, the Pokédex, or any agent tool.

**Implications:** Species `cardPool` numbers shrink for the ~2,480 Pocket
cards previously counted; some users' species LVL will go UP after deploy,
which is correct but visible (the audit flagged this as a product-visible
change, not a regression). A future query that lists or counts cards for
browsing must select `FROM browsable_card`/`browsable_set` rather than
`card`/`card_set` directly, or the predicate has to be re-applied by hand at
that call site. New regression test:
`apps/api/src/__integration__/pocketExclusion.mjs`
(`pnpm --filter deckpal-api test:pocket-exclusion`) boots its own disposable
local Postgres, runs the real migrations (so it exercises the actual
`browsable_card`/`browsable_set` views, not a re-implementation of them),
seeds a physical card and a Pocket card sharing a name and a dex species, and
asserts the Pocket half never surfaces through any of the functions above.

