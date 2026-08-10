-- 032 · OAuth 2.1 authorization codes (`oauth_code`).
--
-- One row per in-flight authorization_code + PKCE exchange (RFC 6749 §4.1,
-- PKCE RFC 7636). Created when a signed-in user approves the consent screen
-- at /authorize; consumed exactly once at /token, which is also where the
-- code becomes a real personal access token (api_token, migration 026) — the
-- OAuth layer is a bridge onto that existing credential, not a parallel one.
--
-- Depends on: 026_api_token (app_user must exist), 031_oauth_client.

CREATE TABLE oauth_code (
  code                  TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  resource              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ
);

-- /token's consuming query is `WHERE code = $1 AND used_at IS NULL AND
-- expires_at > now()`, served by the primary key; a periodic sweep of dead
-- rows (used or expired) is a plain `DELETE ... WHERE expires_at < now() -
-- interval '1 day'`, cheap enough to run inline rather than via an index.

COMMENT ON TABLE  oauth_code IS 'Single-use OAuth 2.1 authorization codes, ~5 minute TTL. Consuming one mints a real api_token row.';
COMMENT ON COLUMN oauth_code.code IS 'Opaque CSPRNG value, the credential itself — treated like a secret in transit and at rest.';
COMMENT ON COLUMN oauth_code.code_challenge IS 'PKCE S256 challenge from /authorize. /token recomputes SHA-256(code_verifier) and compares.';
COMMENT ON COLUMN oauth_code.resource IS 'RFC 8707 resource indicator, if the client sent one. Advisory only — DeckScout has exactly one protected resource (/mcp).';
COMMENT ON COLUMN oauth_code.used_at IS 'Set atomically by the consuming UPDATE. A second exchange attempt sees this set and fails closed — no replay.';
