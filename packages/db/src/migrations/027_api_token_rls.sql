-- @supabase-only
-- 027 · RLS policies for api_token.
--
-- Own-rows-only for authenticated users; service_role has BYPASSRLS so the
-- server-side token *lookup* (which necessarily runs before any user identity
-- is known) still works on the base pool connection.
--
-- Depends on: 026_api_token (table exists).
-- Policy style matches 021_rls_policies / 023_bug_report_rls: auth.uid() is
-- always wrapped in (SELECT ...) so the planner treats it as an initplan
-- constant rather than a per-row function call.
--
-- Note there is deliberately NO policy granting a user read of another user's
-- row by token_hash: an authenticated session can only ever see the tokens it
-- owns, and even then the API never selects token_hash back out.

ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_token_select ON api_token
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY api_token_insert ON api_token
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- UPDATE covers both revoke (revoked_at) and the last_used_at touch performed
-- while already inside the token owner's RLS context.
CREATE POLICY api_token_update ON api_token
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY api_token_delete ON api_token
  FOR DELETE USING (user_id = (SELECT auth.uid()));
