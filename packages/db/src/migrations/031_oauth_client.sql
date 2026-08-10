-- 031 · OAuth 2.1 dynamic client registration (`oauth_client`).
--
-- Backs a real "Connect" flow for MCP clients (claude.ai, ChatGPT, Gemini, or
-- any client speaking the MCP Authorization spec) as an alternative to the
-- manual personal-access-token URL (migration 026). A client self-registers
-- once via POST /register (RFC 7591), gets back an opaque `client_id`, and
-- from then on drives the standard authorization_code + PKCE dance.
--
-- Every registered client is a PUBLIC client: no `client_secret` is issued or
-- stored, because DeckScout requires PKCE (S256) on every /authorize request
-- regardless, which is the modern replacement for a confidential-client
-- secret in exactly this kind of browser/native-app flow.
--
-- Works on any Postgres 15+; does not reference auth.users (RLS is 033), so
-- self-host deployments could carry the same table even though the OAuth
-- routes themselves are only mounted when SUPABASE_MODE is set.

CREATE TABLE oauth_client (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL UNIQUE,
  client_name   TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The auth hot path at both /authorize and /token is `WHERE client_id = $1`,
-- already served by the UNIQUE constraint's index.

COMMENT ON TABLE  oauth_client IS 'Dynamically registered OAuth 2.1 clients (RFC 7591) for the /mcp connect flow. Public clients only — no secret is ever issued.';
COMMENT ON COLUMN oauth_client.client_id IS 'Opaque public identifier, "dscl_" + CSPRNG. Not a secret — the redirect_uri exact-match and PKCE are the actual security controls.';
COMMENT ON COLUMN oauth_client.redirect_uris IS 'Exact-match allowlist. /authorize and /token both reject a redirect_uri that is not byte-identical to one of these.';
COMMENT ON COLUMN oauth_client.client_name IS 'Self-asserted display name shown on the consent screen. Untrusted — never used for any access-control decision.';
