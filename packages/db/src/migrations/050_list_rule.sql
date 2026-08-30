-- 050 - Smart lists: a dynamic list can carry a saved query (2026-08-29
-- walkthrough, deferred item 1).
--
-- The original complaint, verbatim: "I satisfied the condition of owning
-- Growlithe, he should not be on the list anymore." Dynamic lists were
-- reference-sets by explicit prior decision (lists.ts doc block) - addMissing
-- materialised a query ONCE and the membership then aged. The owner decided
-- to change the design: a dynamic list MAY store the query itself and be
-- re-evaluated on every read.
--
-- `rule` is NULL for every existing list, and the read path falls back to
-- stored list_item rows when it is - nothing existing changes behaviour.
-- The JSONB mirrors the addMissing spec exactly (setId, goal, finishes,
-- rarity, rarityExclude, maxPriceUsd, pricedOnly) plus:
--   setName  - resolved at write time, display-only
--   exclude  - card_variant ids the user removed by hand ("remove" on a
--              rule-backed list is an exclusion, not a delete: the rule
--              would just put the card back on the next read)
--
-- `rule_evaluated_at` is bookkeeping for "evaluated just now" UI copy and
-- freshness debugging; it is updated lazily on read, never load-bearing.
--
-- CHECK rather than convention: only a dynamic list can be rule-backed.
-- static is an ordered bag and pokedex_binder is species slots - a saved
-- card query means nothing for either.

ALTER TABLE card_list
  ADD COLUMN rule JSONB,
  ADD COLUMN rule_evaluated_at TIMESTAMPTZ,
  ADD CONSTRAINT card_list_rule_dynamic_only CHECK (rule IS NULL OR kind = 'dynamic');
