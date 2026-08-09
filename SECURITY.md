# Security Policy

## Reporting a vulnerability

DeckScout is maintained by one person. If you find a security issue, please
report it privately:

- **Preferred:** [GitHub Security Advisory](https://github.com/cheyras/deckscout/security/advisories/new)
  on `cheyras/deckscout`.
- **Alternative:** Email cheyras@gmail.com with "DeckScout security" in the
  subject.

There is no bug bounty. I will respond on a best-effort basis -- typically
within a few days. Please do not open a public issue for security vulnerabilities.

## Security model

DeckScout has two deployment modes with different security models.

### Cloud deployment (Vercel + Supabase)

**Authentication:** Supabase Auth provides email + OAuth sign-in. The SPA
manages sessions via `@supabase/supabase-js`. API requests carry a Supabase
JWT as `Authorization: Bearer <token>`, verified by the API middleware.

**Authorization:** Row-Level Security (RLS) policies on every table. Catalog
data is world-readable. Per-user data (collection, decks, lists, battle logs)
is restricted to the owning user via `user_id = (SELECT auth.uid())`.

**Service role key:** The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is used
only server-side (sync jobs, catalog writes, storage uploads). It is set as a
Vercel environment variable and is never exposed to the client.

**Key handling rules:**
- The anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is safe to expose -- it is
  rate-limited and subject to RLS.
- The service role key must never appear in client-side code, browser
  `localStorage`, or git history.
- Vercel environment variables marked as server-side are not bundled into the
  SPA.

### Self-host deployment

**Authentication:** The API has no built-in authentication. It is designed to
sit behind a reverse proxy that handles auth (e.g., nginx + the SSO gate, Caddy
with SSO, or any auth-capable proxy). **Never expose the API directly to the
internet** without a proxy -- doing so makes your entire collection readable
and writable by anyone.

**The MCP server** (`apps/mcp`) authenticates requests via the `x-brain-key`
HTTP header, validated against the `ROTOM_MCP_KEY` environment variable.
Allowed client hosts are configured via `MCP_ALLOWED_HOSTS`.

### Network binding (self-host)

Self-host deployments should bind all services to `127.0.0.1`. The reverse
proxy is the sole ingress point.

### Deployment checklist (self-host)

1. Place a reverse proxy with authentication in front of the API.
2. Keep all services bound to `127.0.0.1`.
3. Set `ROTOM_MCP_KEY` to a strong random value if you use the MCP server.
4. Set `MCP_ALLOWED_HOSTS` to only the hosts that should reach the MCP server.
5. Never commit `.env` or other files containing credentials.
