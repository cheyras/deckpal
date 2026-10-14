---
date: "2026-10-13"
title: "OAuth token limits keyed on the verified grant"
decided_by: "@cheyras (\"the OAuth rate limit to be fixed\", 2026-10-12), design after three Astra review rounds, by Claude Opus 5.5"
areas: ["auth", "security"]
supersedes: []
---
## 2026-10-13 — OAuth token limits keyed on the verified grant
**Decided by:** @cheyras ("the OAuth rate limit to be fixed", 2026-10-12), design after three Astra review rounds, by Claude Opus 5.5. This is finding 1 of `2026-10-12-mcp-demo-and-read-only-access-options.md`, which is left as it was.

**Decision:** `/token` is limited in two layers, and the budget that matters is keyed on the grant being presented, not on the sender. `/register` and discovery stay per source IP. Limits are in `OAUTH_LIMITS` (`apps/api/src/rateLimit.ts`), mounted in `apps/api/src/oauthServer.ts`.

| Where | Limit, per instance |
|---|---|
| `/token`, layer 1: per source IP, first, before any body parser | 6,000 a minute (a ceiling) |
| `/token`, layer 2: a live grant | 30 a minute per connection (or per authorization code) |
| `/token`, layer 2: a secret that matches nothing | 120 a minute per source IP |
| `/register` | 60 a minute per source IP |
| both `.well-known` documents, one bucket | 1,200 a minute per source IP |

Layer 1 bounds the database work one address can cause. It is not the budget a client normally meets: 6,000 is ten times the busiest minute of 12,000 connections refreshing hourly behind one IP. Layer 2 runs in the handler after the grant schema check and before either grant transaction. `peekGrantKey` (`packages/db/src/grants.ts`) does a read-only SELECT of the presented secret, with no lock and no write. A live refresh token gives `connection:<api_token id>` (a used refresh token still gives its key, so reuse detection in `refreshConnection` still runs). A live unused authorization code gives `code:<first 32 hex of its hash>`. Anything else gives null. `oauthGrantWait` then charges a live grant against its own budget, and a null against the source IP's invalid-grant bucket. A refusal happens before the transaction, so nothing is rotated or consumed and the client's retry with the same refresh token still works.

Three details came from Astra's third round. The lookup keys only LIVE grants: a refresh token whose connection is revoked, expired or suspended gives null, because revoked connections' unused refresh tokens stay stored and could otherwise be presented by the thousand as distinct keys. A USED refresh token on a live connection always passes, whatever the budget, because presenting one is the reuse signal `refreshConnection` revokes the connection on, and a spent budget must not suppress that tripwire. And a full grant store admits a new key instead of refusing it: its keys can only be presented by their holders, so a full map must not lock out everyone else's valid grants.

There is no global ceiling and no per-`client_id` budget. A refused request gets `429`, `Retry-After`, `Cache-Control: no-store` and an RFC 6749 §5.2 body: `{"error":"temporarily_unavailable","error_description":"Too many requests. Try again in N seconds."}`. Token lifetimes, grants and consent are as they were, and every other route keeps DeckPal's own error shape.

**Why:**
- **The bug.** Until 2026-10-12 all four routes shared 30 a minute per IP. Hosted MCP connectors (claude.ai, ChatGPT) do discovery, registration, the code exchange and every refresh from the provider's own egress IPs. An access token lasts an hour, so every connection refreshes about once an hour, and a few dozen users in the same minute used up the bucket for everyone behind that IP. The refusal was `{"error":{"code":"rate_limited"}}`, which no OAuth client can parse, so it read as a failed refresh and the user saw a disconnect.
- **The bar.** Nothing may let one party lock out other clients more easily than the old per-IP limit did. Astra reviewed three designs, and each reproduced as a lockout:
  1. **A global `/token` ceiling** (3,000 a minute per instance). It is one bucket that any sender can empty for everybody, even with requests a later limiter refuses.
  2. **A per-`client_id` budget** (600 a minute). A `client_id` is public, so anyone can empty a named client's budget without holding a grant, and that client is then refused from every IP.
  3. **A per-IP budget at hosted-connector size** (600 a minute). Any other sender behind the same egress IP can empty it: 600 unsupported-grant requests naming client A refused client B's first request from the same IP.
- **The verified grant fixes all three.** A refresh token or code is a secret. Only its holder can present one that matches a live grant, so only the holder can spend that grant's 30 a minute. A guess matches nothing and is counted only against the sender's IP in a bucket that refuses requests that were going to fail as `invalid_grant` anyway, so a neighbour's garbage on the same IP cannot refuse a valid grant. 30 a minute per connection is far above the one refresh an hour a client makes.
- **`temporarily_unavailable`.** RFC 6749 §5.2 lists no rate-limit code for the token endpoint. `temporarily_unavailable` is RFC 6749's own code for "temporary overloading or maintenance". It is defined for the authorization endpoint, but `/token` already answers its own 503 with it, so a client that handles one handles both. `slow_down` belongs to device-flow polling (RFC 8628), and `too_many_requests` is the MCP SDK's own non-standard code. It is not `invalid_grant` or `invalid_client`, the codes that tell a client to throw its tokens or registration away.

**Implications:**
- **Accepted limit.** One sender can still refuse others on its own egress IP by exceeding the 6,000 a minute ceiling there. A flood spread across many IPs can load the database, as it always could. There is deliberately no global ceiling, because a global ceiling hands a lockout lever to any one sender. Per instance, like every limiter in this codebase: each serverless instance counts for itself, and the figures are sized as if one instance served everything.
- **One extra read.** Every `/token` request that passes layer 1 does one indexed SELECT before its transaction.
- **Stores of their own.** Each bucket keeps its keys in its own bounded store (10,000 keys, refusing new keys rather than evicting live ones), so a flood at one endpoint cannot fill the map another needs.
- **Still maintained middleware.** The per-IP limiters are `express-rate-limit` on the existing bounded store, the same choice `2026-09-13-use-maintained-express-limiters-before-request-rls-acquisition.md` made. No new environment variable.
- **Verified locally.** `apps/api/src/__tests__/rateLimit.test.ts` pins it:
  - A 3,000-request garbage flood from one IP naming client B leaves B answered by the handler on the same IP and on another IP.
  - One IP is refused on request 6,001. `/register` and discovery limits hold at their numbers.
  - Every limiter runs before the parsers.
  - `oauthGrantWait` gives a connection 30 a minute without touching another connection behind the same IP, and an IP's 120 invalid grants never refuse a live grant from that IP.
  - `peekGrantKey` only SELECTs, never locks or writes, keys a refresh token on its connection and hashes a code.
  - The handler calls `peekGrantKey` then `oauthGrantWait` before any `withTx`.
- **Not verified.** Whether claude.ai's and ChatGPT's clients retry a `temporarily_unavailable` 429 after `Retry-After` or show a disconnect. Their real egress-pool sizes. Nothing here contacted production.
- **Docs:** SECURITY.md, DEPLOYMENT.md, ARCHITECTURE.md, API.md and apps/mcp/SPEC.md describe these limits.
