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

**Deck-E (the AI assistant, `POST /api/chat`).** Entitlement is decided on the
server, not the browser. `entitlement.ts`'s browser-side gate only decides
whether to draw a button — verified against the deployed endpoint before this
was fixed, an ordinary signed-in account got a full model turn, billed to the
owner's Gateway key, by asking for one (DECISIONS.md 2026-08-21, "`/api/chat`
had no server-side entitlement, rate limit or spend cap"). The route now
checks `DECKE_ENTITLED_USER_IDS` plus the owner before the request body is
parsed, and every account is metered against a durable daily cap in Postgres
(`decke_usage`, migrations 039/040) — conversational turns and deep-tier calls
capped separately, since the two differ roughly 250x in price. The cap is
enforced by a single `INSERT … ON CONFLICT DO UPDATE … WHERE` statement so the
check and the charge cannot race under concurrent requests; migration 040
grants `authenticated` a SELECT policy on that table and nothing else, since an
UPDATE policy would let a signed-in user zero their own counter through
Supabase's Data API. `GET /api/health` reports `deckeEntitlement` (a status —
`nobody` / `owner-only` / `owner-plus-list` / `self-host` — never the ids, since
`/health` is unauthenticated) and `deckeLimits`.

Deck-E holds **no credential of his own**. He carries the caller's own
Supabase JWT — the same one the browser sent — and forwards it to deckpal-api
for every write, so Row-Level Security applies to him exactly as it does to
the person he is talking to, and there is no service-role key anywhere on this
path. His database reads run the same per-request RLS session shape as the
REST API and the MCP server (`BEGIN` + `set_config('request.jwt.claims', …)` +
`SET LOCAL role = 'authenticated'`), opened lazily per tool call and released
— destroyed, not pooled, on a timeout or an abort — the instant the call
returns, so a dropped connection can never be handed to the next request still
carrying a stranger's claims.

**Only read tools are reachable from the conversational model today.** Of the
23 tools in `packages/agent-tools`, the adapter Deck-E uses
(`apps/api/src/decke/adapters/aisdk.ts`) filters to `annotations.readOnlyHint`
by default — never on the verb in a tool's name, because a name can mislead in
either direction (`set_cart` sounds like a write and only composes an outbound
URL; `deck_history` sounds like a read and can roll a deck back). The write
half exists in the shared package but is not exposed to him: it is gated on an
approval round-trip that has not been built yet, because a write tool
reachable from a conversational model before that exists is a tool that gets
called by accident. One write reaches him regardless, deliberately: the
`write_strategy_guide` deep tool (below) is allowed to call `deck_strategy`,
which is dumb, idempotent storage — "replace the whole guide" — not a general
write capability.

**The deep tier and live research.** Four sub-agent tools
(`apps/api/src/decke/deep.ts`) give Deck-E an escalation path rather than
answering everything with the fast conversational model. `research_meta` is
the one that leaves the perimeter: it sends query text — card and archetype
names only, and its own description instructs it to never include anything
about the user, their collection or their account — to a third-party model,
`openai/o3-deep-research`, on the Vercel AI Gateway's US-frontier-labs
allowlist. That sub-agent is given **no tools at all**, which is the actual
control: text fetched from the open web is the least trustworthy input in this
system, and the only way to guarantee it cannot become an action is to hand
the thing that reads it no actions to take. Its findings are inserted back
into the conversation labelled as fetched data, into a model already
instructed never to treat instructions found in data as commands. (Recorded
honestly in DECISIONS.md 2026-08-21, "Deck-E's model routing": the
domain-allowlist control available on this Gateway for other research tools —
`include_domains` — is not available for `o3-deep-research`, since it searches
provider-side; the compensating controls here are structural rather than that
allowlist.)

**What the browser persists.** Besides Supabase's own session (its
`sb-<ref>-auth-token` key), the SPA writes two of its own `localStorage` keys,
neither of which is a credential and neither of which is ever read as one:
`deckpal:skin` (the visual skin preference) and `deckpal.returning` (a single
bit, set once a session has existed in this browser, cleared by the explicit
Sign out control). `deckpal.returning` exists only so `/` can send a visitor
whose session has lapsed to the sign-in form instead of the marketing page
(`lib/returningVisitor.ts`); it carries no email, user id or token, and no
authorization decision anywhere consults it. Clearing site data resets both.

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
