-- @supabase-only
-- 050 · Row-Level Security for card_text (049).
--
-- ONLY runs on Supabase (the runner skips this file unless SUPABASE_MODE is
-- set). Self-host has no `authenticated`/`anon` roles and no RLS to enable;
-- there, the table is readable because the connection is trusted, exactly as
-- every other catalogue table is.
--
-- Depends on: 049_card_text.
--
-- Shape is copied from 021's CATALOG TABLES block, including its reasoning:
-- world-readable, service-role-writable, no write policy needed because
-- service_role has BYPASSRLS. This is derived catalogue data — the same words
-- printed on cards a signed-out visitor can already browse — so `USING (true)`
-- is the correct policy and not a shortcut.
--
-- 🔴 It matters that this is not forgotten rather than merely tidy. On Supabase
-- a table with RLS never enabled is reachable by the anon key with no policy
-- governing it at all; enabling RLS and then declaring the read is what makes
-- "everyone may read this" a decision in a reviewable diff instead of an
-- omission. And the failure mode of getting it wrong is silent in the other
-- direction too: with RLS on and no policy, the scanner's prefilter returns
-- zero rows on production and the family-text rung looks exactly like a rung
-- whose table has not been populated yet.

ALTER TABLE card_text ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_text_read ON card_text FOR SELECT USING (true);
