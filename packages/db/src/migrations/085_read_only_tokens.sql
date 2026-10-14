-- 085 · A personal access token can be minted read-only.
--
-- 075 gave `api_token` its `scope` ('full' | 'read') and let the OAuth consent
-- screen choose it, but it granted client roles INSERT on (user_id, name,
-- token_hash, prefix) alone. POST /tokens inserts as the signed-in user, inside
-- the request's RLS transaction, so a token made in Profile → Agent access
-- could only ever take the column's default: 'full'. POST /tokens now accepts
-- `scope`, and the role it inserts as needs that one column too.
--
-- Why handing a client role INSERT (scope) gives nobody anything new:
--   • Both values are already within the user's own reach. Inserting 'full' is
--     what an insert without the column already does; 'read' is strictly less.
--     075's CHECK still refuses any third value.
--   • INSERT only. UPDATE (scope) stays revoked (075), so no token can be
--     PATCHed from read to full over PostgREST, a connection included.
--   • 027's own-row INSERT policy and 064's mint-boundary trigger still apply,
--     and the server-owned columns (expires_at, oauth_client_id,
--     oauth_redirect_uri, decke_improvement_read) stay ungranted.
--
-- Deliberately NOT `-- @supabase-only`, like 075: the grant sits behind a
-- `pg_roles` guard, so on plain Postgres (self-host, where the API inserts as
-- the table's owner and needs no grant) the file applies and changes nothing.
--
-- Depends on: 026, 027, 075.
DO $acl$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  GRANT INSERT (scope) ON public.api_token TO authenticated;
 END IF;
END $acl$;
