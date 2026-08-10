-- @supabase-only
-- 033 · RLS lockdown for the OAuth tables.
--
-- Unlike api_token (027), neither table here gets a single policy — on
-- purpose. Both are touched exclusively by the server's RLS-bypassing pool
-- connection (db.ts: the pool connects as `postgres`, which owns every table
-- in `public`), the same path applyApiToken/resolveToken already use to read
-- api_token before any user identity exists. A browser's own Supabase session
-- has no legitimate reason to see a row in either table directly:
--
--   • oauth_client rows are DCR client registrations, not owned by any one
--     user — there is no `user_id = auth.uid()` policy that would even make
--     sense.
--   • oauth_code rows ARE user-scoped, but a code is a bearer credential for
--     the few seconds it is alive; a policy letting the owning user SELECT
--     their own row would just be a second way to read a secret meant to
--     flow through exactly one redirect and nowhere else.
--
-- ENABLE ROW LEVEL SECURITY with zero policies is default-deny for every
-- non-bypassing role (anon, authenticated) — belt-and-braces in case this
-- schema is ever exposed through PostgREST directly instead of only through
-- deckscout-api.
--
-- Depends on: 031_oauth_client, 032_oauth_code.

ALTER TABLE oauth_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_code ENABLE ROW LEVEL SECURITY;
