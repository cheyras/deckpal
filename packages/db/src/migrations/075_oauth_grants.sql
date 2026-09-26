-- 075 · OAuth connections that say where they went, renew, expire, and can be
-- read-only (security audit SEC-07).
--
-- Until now, approving the consent screen minted an ordinary personal access
-- token (api_token, 026): no expiry, no record of which client or which
-- redirect received it, and the full read/write reach of a signed-in session.
-- `oauth_client.client_name` is self-asserted (031), so an app that registered
-- itself as "Claude" and sent the approval to its own host got a credential
-- that worked until somebody noticed it in Profile.
--
-- The model after this file:
--   • An approval is still ONE api_token row: the connection a person sees in
--     Profile → Agent access and revokes there, and the row an administrator's
--     revoke-all, suspension and MAX_ACTIVE_TOKENS already govern. The bridge
--     design of 2026-08-10 stands: nothing new to list, nothing new to revoke.
--   • What changes is where that row's working secrets live: rotating pairs
--     in `oauth_token`, an access token (`dsk_…`, one hour) and a single-use
--     refresh token (`dsr_…`, 90 days). Every access token resolves THROUGH
--     its api_token row, so revoking the row ends every secret it ever issued.
--     The row's own token_hash is the hash of a secret generated and thrown
--     away at mint, so it can never be presented itself (072 fixes token_hash
--     at mint, so rotating it in place was never an option).
--   • `expires_at` is when a connection ends. NULL means never, and that is
--     every row that exists today: hand-made tokens and connections approved
--     before this file alike keep working exactly as they did.
--
-- Deliberately NOT `-- @supabase-only`: the columns are read on every
-- deployment. Role-specific statements sit behind `pg_roles` guards, the
-- shape 064/068/072 use, so the file applies to plain Postgres unchanged.
--
-- Depends on: 026, 027, 031, 032, 064. Applies after 072 (PR #204) and composes
-- with it: 072 freezes a token's identity columns and makes revocation final;
-- nothing here rewrites token_hash, and revoked_at is only ever set from NULL.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. What a connection is, on the row that already represents it
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.api_token
  ADD COLUMN expires_at         TIMESTAMPTZ,
  ADD COLUMN scope              TEXT NOT NULL DEFAULT 'full'
                                CONSTRAINT api_token_scope_check CHECK (scope IN ('full', 'read')),
  ADD COLUMN oauth_client_id    TEXT,
  ADD COLUMN oauth_redirect_uri TEXT;

COMMENT ON COLUMN public.api_token.expires_at IS
  'When the credential stops resolving. NULL = never (hand-made tokens, and every token minted before 075). An OAuth connection''s date slides forward on each refresh.';
COMMENT ON COLUMN public.api_token.scope IS
  '''full'' reads and writes; ''read'' is refused every non-GET REST call and is served only read-only MCP tools, inside a READ ONLY transaction.';
COMMENT ON COLUMN public.api_token.oauth_client_id IS
  'The oauth_client this connection was approved for; NULL for a hand-made token. Text, not a foreign key: a client registration can be swept without taking the connection with it.';
COMMENT ON COLUMN public.api_token.oauth_redirect_uri IS
  'Where the approval was sent. Its host is what the consent screen named and what Profile shows beside the connection.';

-- The consent decision records the scope on the code; the exchange copies it
-- onto the connection. Codes in flight at deploy time default to what every
-- code meant before this file.
ALTER TABLE public.oauth_code
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'
    CONSTRAINT oauth_code_scope_check CHECK (scope IN ('full', 'read'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. The rotating secrets
-- ══════════════════════════════════════════════════════════════════════════════
--
-- A used refresh token is not deleted: its expires_at is pulled in to one day
-- and it stays as a tripwire. Presented again inside a minute it is a network
-- retry and is answered; presented later, someone other than the client holds
-- it, and the whole connection is revoked (OAuth 2.1 §4.3.1). The token
-- endpoint sweeps anything past expires_at, so the table holds live secrets
-- and a day of tripwires, never history.
CREATE TABLE public.oauth_token (
  token_hash TEXT PRIMARY KEY,
  token_id   UUID NOT NULL REFERENCES public.api_token (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX oauth_token_token_id_idx   ON public.oauth_token (token_id);
CREATE INDEX oauth_token_expires_at_idx ON public.oauth_token (expires_at);

COMMENT ON TABLE public.oauth_token IS
  'Rotating OAuth access (dsk_) and refresh (dsr_) secrets, as SHA-256 hashes. Each resolves through its api_token row, so revoking that row ends them all.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Recording the scope at consent
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 064's five-argument function stays exactly as it is, so an API instance
-- still running the previous build keeps issuing codes while this deploys.
-- This one differs only in carrying the person's scope choice.
CREATE FUNCTION public.admin_connector_issue(p_code text, p_client text, p_redirect text, p_challenge text, p_resource text, p_scope text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := public.admin_actor_id();
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 IF NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501';
 END IF;
 IF p_code !~ '^dsac_[A-Za-z0-9_-]{43}$' OR p_challenge !~ '^[A-Za-z0-9_-]{43}$'
    OR length(COALESCE(p_resource, '')) > 2000 OR p_scope IS NULL OR p_scope NOT IN ('full', 'read') THEN
  RAISE EXCEPTION 'Invalid authorization request' USING ERRCODE = '22023';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.oauth_client WHERE client_id = p_client AND p_redirect = ANY (redirect_uris)) THEN
  RAISE EXCEPTION 'Redirect does not match registered client' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.oauth_code (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, expires_at)
 SELECT p_code, p_client, u.id, p_redirect, p_challenge, 'S256', p_resource, p_scope, now() + interval '5 minutes'
   FROM public.app_user u WHERE u.id::text = actor;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Who may touch what
-- ══════════════════════════════════════════════════════════════════════════════
--
-- oauth_token holds bearer secrets and belongs to the server alone, like
-- oauth_code (033): RLS on with no policy, and no client grant at all.
--
-- api_token keeps 027's own-row policies, but the new columns are the
-- server's. A user could otherwise PATCH their own read-only connection to
-- full, or push its expiry out, straight over PostgREST. Nothing in the app
-- writes api_token as the user except POST /tokens (these four columns) and
-- revoke (revoked_at), so the client role keeps exactly those, plus `name`
-- and `last_used_at`, which 072 also leaves writable. DELETE is 072's to
-- decide and is not touched here.
DO $acl$
DECLARE principal text;
BEGIN
 REVOKE ALL ON public.oauth_token FROM PUBLIC;
 REVOKE ALL ON FUNCTION public.admin_connector_issue(text, text, text, text, text, text) FROM PUBLIC;
 FOREACH principal IN ARRAY ARRAY['anon', 'authenticated'] LOOP
  CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal);
  EXECUTE format('REVOKE ALL ON public.oauth_token FROM %I', principal);
  EXECUTE format('REVOKE ALL ON FUNCTION public.admin_connector_issue(text, text, text, text, text, text) FROM %I', principal);
  EXECUTE format('REVOKE INSERT, UPDATE ON public.api_token FROM %I', principal);
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  ALTER TABLE public.oauth_token ENABLE ROW LEVEL SECURITY;
  GRANT EXECUTE ON FUNCTION public.admin_connector_issue(text, text, text, text, text, text) TO authenticated;
  GRANT INSERT (user_id, name, token_hash, prefix) ON public.api_token TO authenticated;
  GRANT UPDATE (name, last_used_at, revoked_at) ON public.api_token TO authenticated;
 END IF;
END $acl$;
