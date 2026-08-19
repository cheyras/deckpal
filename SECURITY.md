# Security Policy

## Reporting a vulnerability

DeckPal is maintained by one person. If you find a security issue, please
report it privately:

- **Preferred:** [GitHub Security Advisory](https://github.com/cheyras/deckpal/security/advisories/new)
  on `cheyras/deckpal`.
- **Alternative:** Email cheyras@gmail.com with "DeckPal security" in the
  subject.

There is no bug bounty. I will respond on a best-effort basis -- typically
within a few days. Please do not open a public issue for security vulnerabilities.

## Security model

DeckPal has two deployment modes with different security models.

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

**Cloud MCP authentication.** `https://deckpal.app/mcp` accepts a personal
access token (`dsk_…`, table `api_token`) as `Authorization: Bearer <token>`
or as the URL's last path segment. Only a SHA-256 hash is stored; the raw
value is shown once, at creation, in Profile -> Agent access, and is
revocable there at any time. As of 2026-08-10 a token can also be minted
automatically via a real OAuth 2.1 authorization server (dynamic client
registration, RFC 7591; authorization-code + PKCE S256, RFC 6749/7636;
discovery metadata, RFC 8414/9728) -- `apps/api/src/oauthServer.ts` and
`apps/api/src/routes/oauth.ts`. Every OAuth-registered client is public (no
secret is issued; PKCE is mandatory instead), `redirect_uri` is exact-matched
against what the client registered (rejected requests never redirect, closing
the open-redirect path), authorization codes are single-use with a ~5 minute
TTL, and the token the flow ultimately mints is the exact same `api_token`
row the manual flow produces -- OAuth is a bridge onto the existing
credential, not a second one. `oauth_client` and `oauth_code` have RLS
enabled with zero grants (migration 033): only the server's RLS-bypassing
pool connection can ever read or write them.

### Self-host deployment

**Authentication:** The API has no built-in authentication. It is designed to
sit behind a reverse proxy that handles auth (e.g., nginx + an SSO gateway, Caddy
with SSO, or any auth-capable proxy). **Never expose the API directly to the
internet** without a proxy -- doing so makes your entire collection readable
and writable by anyone.

**The MCP server** (`apps/mcp`) authenticates requests via the `x-brain-key`
HTTP header, validated against the `DECKPAL_MCP_KEY` environment variable.
Allowed client hosts are configured via `MCP_ALLOWED_HOSTS`.

### Network binding (self-host)

Self-host deployments should bind all services to `127.0.0.1`. The reverse
proxy is the sole ingress point.

### Deployment checklist (self-host)

1. Place a reverse proxy with authentication in front of the API.
2. Keep all services bound to `127.0.0.1`.
3. Set `DECKPAL_MCP_KEY` to a strong random value if you use the MCP server.
4. Set `MCP_ALLOWED_HOSTS` to only the hosts that should reach the MCP server.
5. Never commit `.env` or other files containing credentials.

## Data retention: deleted lists and decks

Since 2026-08-19 (migration 038), deleting a list or a deck is **reversible and
therefore not immediate erasure**. The row is marked `deleted_at`, disappears
from every read, and is **kept indefinitely** until the owner purges it.

There is no automatic sweeper. That is a deliberate choice over an unenforced
"we keep it 30 days", which would read as *gone soon* while the rows sat there
forever — but it means a user who deletes something and expects it destroyed has
to say so:

- **Web:** *Recently deleted* on the Lists and Decks pages → **Delete forever**.
- **REST:** `DELETE /lists/:id?purge=true`, `DELETE /decks/:id?purge=true`.
- **MCP:** `delete_list(purge: true)`, `delete_deck(purge: true)`.

A purge is a real `DELETE` and cascades exactly as the old behaviour did — for a
deck that means its version history and every battle log. It is the one path in
the API with no undo, and it is the only one.

**Account deletion is unaffected.** Every one of these tables cascades from
`app_user`, so removing a user still removes their soft-deleted rows.

## The mutation log

Migration 036 records every change made through DeckPal — collection quantities,
lists, decks, strategy guides — with a `before` and an `after` snapshot. Two
properties are load-bearing:

- **It is per-user and RLS-enforced.** `mutation_batch` and `mutation_event`
  carry `user_id`, and migration 037 gives them own-row policies matching
  `collection_event`'s. Verified against a Supabase-shaped database under the
  real `authenticated` role: a second user sees none of another's rows and
  cannot insert one on their behalf.
- **It is append-only, including for its own owner.** `mutation_event` has
  SELECT and INSERT policies and no UPDATE policy, because RLS policies are not
  column-scoped and Supabase exposes every policied table through the Data API —
  an UPDATE policy would let a user rewrite their own `before`/`after` through
  PostgREST. An audit trail the audited party can edit is not an audit trail.
  "Was this reverted?" is therefore the presence of a later event pointing at
  it, not a mutable flag.

The snapshots contain card ids, quantities, list/deck names and strategy-guide
text — the same user data as the tables they describe, and no more.
