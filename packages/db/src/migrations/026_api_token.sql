-- 026 · Personal access tokens (`api_token`).
--
-- Backs the multi-user MCP endpoint and the REST API's non-browser clients: a
-- user mints a long-lived bearer token in Profile → Agent access, points an MCP
-- client (claude.ai connector, Claude Code) at /mcp with it, and the server
-- resolves the token to that user's UUID before any query runs.
--
-- Works on any Postgres 15+; does NOT reference auth.users (RLS is in 027),
-- so self-host deployments get the same table and the same code paths.
--
-- Storage rule: the raw token NEVER touches the database. `token_hash` is the
-- hex SHA-256 of the raw token; `prefix` is the first 12 characters
-- ("dsk_" + 8 of the secret) and exists only so the UI can name a token the
-- user is looking at. A SHA-256 (not bcrypt/argon2) is the right primitive
-- here because the token is 256 bits of CSPRNG output, not a human-chosen
-- password: there is no dictionary to stretch against, and the lookup has to
-- be a single indexed equality on the hot path of every MCP call.

CREATE TABLE api_token (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- The listing query (own tokens, newest first).
CREATE INDEX api_token_user_created_idx ON api_token (user_id, created_at DESC);

-- The auth hot path is `WHERE token_hash = $1` — already served by the UNIQUE
-- constraint's index, so no second index is added for it.

COMMENT ON TABLE  api_token IS 'Personal access tokens for the MCP endpoint and non-browser API clients. Raw tokens are never stored.';
COMMENT ON COLUMN api_token.token_hash IS 'Hex SHA-256 of the raw token. The raw value is shown exactly once, at creation.';
COMMENT ON COLUMN api_token.prefix IS 'First 12 chars of the raw token (dsk_ + 8), for display only.';
COMMENT ON COLUMN api_token.revoked_at IS 'Set on revoke; a non-NULL value makes the token unusable. Rows are kept for audit.';
