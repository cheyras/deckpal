-- 049 · Server-side UI preferences (2026-08-29 walkthrough, deferred item).
--
-- These five preferences lived in localStorage: Deck-E visibility, the skin,
-- the top-bar treatment, and the Series index's sort/grouping. The owner's
-- call: "I'd like this to not be remembered on this device only" — a settings
-- row per user, prep work for a proper settings page. `user_settings` (005)
-- already exists with RLS (021, policy `user_settings_own` is FOR ALL so new
-- columns are covered) and a row auto-created per signup, so this is columns,
-- not a table.
--
-- `skin` and `topbar` are NULLable on purpose: NULL means "no explicit
-- choice — follow the app default", which keeps DEFAULT_SKIN / DEFAULT_TOPBAR
-- (lib/skin.ts, lib/topbar.ts) flippable in code without a data migration.
-- The three series prefs get NOT NULL defaults because their defaults are
-- stable product behaviour, not a judged-in-flight visual pass.

ALTER TABLE user_settings
  ADD COLUMN decke_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN skin               TEXT CHECK (skin IN ('premium','classic')),
  ADD COLUMN topbar             TEXT CHECK (topbar IN ('cover','flat')),
  ADD COLUMN series_sort_key    TEXT NOT NULL DEFAULT 'recency'
                                CHECK (series_sort_key IN ('recency','az','pct')),
  ADD COLUMN series_sort_dir    TEXT NOT NULL DEFAULT 'desc'
                                CHECK (series_sort_dir IN ('asc','desc')),
  ADD COLUMN series_group_owned BOOLEAN NOT NULL DEFAULT TRUE;
