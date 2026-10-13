---
date: "2026-10-12"
title: "OAuth endpoints: per-IP rate limits sized for hosted connectors, no shared bucket"
decided_by: "@cheyras (approved the fix, 2026-10-12)"
areas: ["auth", "security"]
supersedes: []
---
## 2026-10-12 — OAuth endpoints: per-IP rate limits sized for hosted connectors, no shared bucket
**Decided by:** @cheyras (approved the fix, 2026-10-12: "Fix it"). Written by Claude Opus 5.5. This is finding 1 of `2026-10-12-mcp-demo-and-read-only-access-options.md`, which is left as it was. The design was revised on PR #339 after Astra's review (below).

**Decision:** The public OAuth endpoints keep a per-source-IP limit with far more room, and nothing else. `oauthPublicRateLimit`, 30 a minute per IP shared by all four routes, is replaced by one limiter per endpoint (`apps/api/src/rateLimit.ts`, `OAUTH_LIMITS`, mounted in `apps/api/src/oauthServer.ts`). Each runs first, before any body parser:

| Endpoint | Limit per source IP, per instance |
|---|---|
| `/token` | 600 a minute |
| `/register` | 60 a minute |
| both `.well-known` documents, one bucket | 1,200 a minute |

There is no global ceiling and no per-`client_id` budget. A refused request gets `429`, `Retry-After`, `Cache-Control: no-store` and an RFC 6749 §5.2 body: `{"error":"temporarily_unavailable","error_description":"Too many requests. Try again in N seconds."}`. Nothing else about auth changed. What is accepted, token lifetimes, grants and consent are as they were, and every other route keeps DeckPal's own error shape.

**Why:**
- **The bug.** Hosted MCP connectors (claude.ai, ChatGPT) do discovery, registration, the code exchange and every refresh from the provider's own egress IPs. An access token lasts an hour, so every connection refreshes about once an hour. At 30 a minute per IP, a few dozen DeckPal users refreshing through claude.ai in the same minute used up the bucket for everyone behind that IP. The refusal was `{"error":{"code":"rate_limited"}}`, which no OAuth client can parse, so it read as a failed refresh and the user saw a disconnect.
- **The numbers.** 600 a minute on `/token` is 36,000 refreshes an hour through one egress IP. That is about 12,000 users behind it, if the busiest minute is three times the average. Providers send from pools of egress IPs, so the room per provider is a multiple of that; this is the coordinator's premise, not measured here. Either way it is far beyond DeckPal's current scale. `/register` is once per connection, not per refresh, so 60 a minute is double the old figure. Discovery gets two requests for every `/token` request, since a client may fetch both documents before each refresh.
- **Why no shared bucket.** The first version of this fix (commit 6d4cd8e4, never merged) gave `/token` a global ceiling of 3,000 a minute per instance plus 600 a minute per `client_id`. It also put a global budget behind `/register`'s per-IP limit. Astra reviewed PR #339 and returned NOT READY with two P1s, both reproduced against the real route:
  1. The global counter was spent by requests the per-client limiter then refused. 3,000 unsupported-grant requests from one IP and client got 600 × 400 and 2,400 × 429, and then an unrelated client on another IP got 429.
  2. A `client_id` is public. Anyone can drain a named client's 600 without holding a grant, and that client is then refused from every IP.

  The old per-IP limit kept a sender's flood to the sender. The bar is that nothing may let one party lock out other clients more easily than before. Any bucket an outsider can fill fails it, so every public OAuth limit is keyed on the source IP. A per-IP bucket fills only from its own IP.
- **`temporarily_unavailable`.** RFC 6749 §5.2 lists no rate-limit code for the token endpoint. `temporarily_unavailable` is RFC 6749's own code for "temporary overloading or maintenance". It is defined for the authorization endpoint, but `/token` already answers its own 503 with it, so a client that handles one handles both. `slow_down` belongs to device-flow polling (RFC 8628), and `too_many_requests` is the MCP SDK's own non-standard code. The important property is what it is not: `invalid_grant` or `invalid_client`, the codes that tell a client to throw its tokens or registration away.

**Implications:**
- **Accepted limit.** A flood spread across many IPs can still load the database through `/token` and `/register`, as it always could. It is not solved with a global ceiling, because a global ceiling hands a lockout lever to any one sender. Per instance, as every limiter in this codebase is.
- **Stores of their own.** Each endpoint keeps its keys in its own bounded store (10,000 keys, refusing new keys rather than evicting live ones). So a flood of distinct addresses at one endpoint, or at the `/api` router, cannot fill the map another needs.
- **Still maintained middleware.** Each limiter is genuine `express-rate-limit` 8.7.0 on the existing bounded store, the same choice `2026-09-13-use-maintained-express-limiters-before-request-rls-acquisition.md` made. No new environment variable.
- **Verified locally.** `test:ratelimit` drives the real routes (`mountOAuthServer`) at the real numbers, using only requests the handlers refuse before any database work.
  - **Cross-client regression:** 3,000 requests from one IP, naming another client's id, with unsupported grants, incomplete code exchanges, a 10 KB client_id and unparseable JSON, get exactly 600 handler answers and 2,400 × 429. The named client on its own IP then gets 600 handler answers and no 429. The same holds for `/register` and discovery.
  - One IP is refused on its 601st `/token` request whatever client_ids it sends, and on the 61st `/register` and 1,201st discovery request.
  - Past the budget, unparseable and oversized bodies get 429, not 400 or 413, so the limiter runs before the parsers. A source-order test checks the mounting too.
  - Mutations: keying `/token` or discovery on one global key, or mounting `/token`'s limiter after the parsers, each fails behavioural tests, not only the source-order one.
  - The admin/OAuth integration suite (`admin.mjs` in cloud mode, real Postgres 16) passes through the new chain.
- **Not verified.** Whether claude.ai's and ChatGPT's clients retry a `temporarily_unavailable` 429 after `Retry-After` or show a disconnect. Their real egress-pool sizes. Nothing here contacted production.
- **Docs:** SECURITY.md, DEPLOYMENT.md, ARCHITECTURE.md, API.md and apps/mcp/SPEC.md describe the new limits.
