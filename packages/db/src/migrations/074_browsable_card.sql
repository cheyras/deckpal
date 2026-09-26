-- 074 · Browsable card/set: the single predicate for "is this part of the
-- browsable physical Pokémon TCG catalog", used everywhere a query lists,
-- searches or counts cards/sets for a human or an agent to browse.
--
-- Pokémon TCG Pocket is a separate digital game (DECISIONS 2026-08-10:
-- "not browsable anywhere in the product"), but its one series (tcgdex_id
-- 'tcgp', slug 'pokemon-tcg-pocket', 15 sets, ~2,480 cards) is imported under
-- the SAME 'en' catalogue row as the physical TCG -- apps/sync/src/catalog/
-- import.ts's `CATALOGUE = 'en'` constant never distinguishes them, so
-- `catalogue.is_enabled` (already FALSE for the 'pocket-en' catalogue code)
-- is no help here: Pocket's series row carries catalogue_code = 'en', same as
-- every physical series. The only real signal is the series id (issue: UXC-02).
--
-- Before this view, `s.tcgdex_id <> 'tcgp'` was applied ad hoc -- present in
-- the series list (routes/series.ts) and absent from search, the Pokédex, and
-- every agent tool, so Pocket cards leaked into all of those. One pair of
-- views now carries the rule; every read path that browses cards/sets joins
-- or selects FROM them instead of repeating the literal at each call site.
--
-- NOT needed where a query is already scoped to one known, already-resolved
-- set (e.g. `recomputeSetProgress`, `apps/api/src/routes/sets.ts`) -- a set
-- cannot mix Pocket and physical cards, so a card reached via its own set_id
-- is already exactly as browsable as that set. Direct-by-id card/set detail
-- routes (`/api/cards/:id`, `/api/series/:slug`) are also left alone here --
-- deep-linking into Pocket content is a separate product decision, tracked in
-- DECISIONS.md rather than folded into this predicate.
--
-- WITH (security_invoker = true) on both: Supabase advisor 0010 (structural
-- rule enforced from 074 on, per migration 072_postgrest_reach and its
-- migrationLint.test.ts -- a plain view runs with its OWNER's rights, and our
-- owner is the migration role, which is never subject to RLS). Both views
-- only ever touch card/card_set/series, which carry a public `USING (true)`
-- SELECT policy (021_rls_policies.sql), so this is a no-op for behavior here
-- -- catalog data was always meant to be world-readable -- but the rule is
-- structural, not case-by-case, and `browsable_card` selects FROM the OTHER
-- view here, so both need the option: an invoker view queries its own
-- sources as the invoker only as far down as the chain stays invoker.
CREATE VIEW browsable_set WITH (security_invoker = true) AS
  SELECT cs.*
    FROM card_set cs
    JOIN series s ON s.id = cs.series_id
   WHERE s.tcgdex_id <> 'tcgp';

COMMENT ON VIEW browsable_set IS
  'card_set rows outside Pokémon TCG Pocket (series.tcgdex_id <> ''tcgp''). Use in place of card_set when listing or resolving sets for browsing (search facets, the agent-tools set resolver, "every set in the catalog" listings).';

CREATE VIEW browsable_card WITH (security_invoker = true) AS
  SELECT c.*
    FROM card c
    JOIN browsable_set cs ON cs.id = c.set_id;

COMMENT ON VIEW browsable_card IS
  'card rows outside Pokémon TCG Pocket. Use in place of the card table in any query that lists, searches or counts cards for browsing -- search, the Pokédex/species insights, and the agent-tools card resolver (get_card, search_cards, log_cards, add_cards, edit_list all route through resolve.ts''s CARD_SELECT).';
