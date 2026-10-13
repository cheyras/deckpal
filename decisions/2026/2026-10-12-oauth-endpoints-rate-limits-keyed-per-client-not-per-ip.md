---
date: "2026-10-12"
title: "OAuth endpoints: rate limits keyed per client, not per IP"
decided_by: "@cheyras (approved the fix, 2026-10-12)"
areas: ["auth", "security"]
supersedes: []
---
## 2026-10-12 — OAuth endpoints: rate limits keyed per client, not per IP
**Decided by:** @cheyras (approved the fix, 2026-10-12: "Fix it"). Written by Claude Opus 5.5. This is finding 1 of `2026-10-12-mcp-demo-and-read-only-access-options.md`, which is left as it was.

**Decision:** The public OAuth endpoints no longer count requests per source IP. `oauthPublicRateLimit`, 30 a minute per IP on all four routes, is gone. In its place (`apps/api/src/rateLimit.ts`, `OAUTH_LIMITS`, mounted in `apps/api/src/oauthServer.ts`):

| Endpoint | Limit | Key | Checked |
|---|---|---|---|
| `/token` | 3,000 a minute | one per instance | first, before the body is read |
| `/token` | 600 a minute | `client_id` from the form or JSON body; a missing or malformed one falls back to the source IP | after the body parsers, before any database work |
| `/register` | 120 a minute | source IP | first |
| `/register` | 300 a minute | one per instance | second, before the body is read |
| both `.well-known` documents | 12,000 a minute | one per instance, shared | first |

A refused request gets `429`, `Retry-After`, `Cache-Control: no-store` and an RFC 6749 §5.2 body: `{"error":"temporarily_unavailable","error_description":"Too many requests. Try again in N seconds."}`. Nothing else about auth changed: what is accepted, token lifetimes, grants and consent are as they were, and every other route keeps DeckPal's own error shape.

**Why:**
- **The bug.** Hosted MCP connectors (claude.ai, ChatGPT) do discovery, registration, the code exchange and every refresh from the provider's own egress IPs, which all of its users share. An access token lasts an hour, so every connection refreshes about once an hour. At 30 a minute per IP, a few dozen DeckPal users refreshing through claude.ai in the same minute used up the bucket for everyone behind that IP. The refusal was `{"error":{"code":"rate_limited"}}`, which no OAuth client can parse, so it read as a failed refresh and the user saw a disconnect. `apps/mcp/src/cloud.ts` already explained why IP keys are wrong behind hosted connectors; this applies the same reasoning here.
- **`/token`.** The request names its client, so the client is the key. A `client_id` is not a credential (every client is public), and anyone can send any string. That is how `/mcp`'s first per-credential limiter was filled with 10,000 fabricated values. What makes it safe here is the order cloud.ts settled on: a global ceiling first, keyed on nothing, then the per-client budget. A per-client key is only created for a request the ceiling already admitted. The per-client store has its own room for 10,000 keys and never holds more than two windows of admissions (6,000), or three counting keys that have expired but not yet been swept (9,000). So a garbage flood can't fill it, and because a full store refuses new keys rather than evicting live ones, a real client's bucket can't be pushed out. Malformed ids can't match a registered client: anything but `dscl_` + 32 base64url characters, the only shape `generateClientId` has ever minted. They get no key of their own and share the source-IP fallback, which also keeps keys short; one test sends a 10 KB id.
- **The numbers.** 600 a minute per client is 36,000 refreshes an hour on one instance. That is about 12,000 users connected through one client_id, if the busiest minute is three times the average. The ceiling is five clients' worth: 50 short transactions a second on a 12-connection pool. Both are per instance. Vercel runs more than one under load, so real capacity is higher, never lower.
- **`/register`.** No client exists yet, so the budget is global. 300 a minute is 18,000 registrations an hour, each one INSERT, which is enough for thousands of people reconnecting at once. A per-IP limit (120 a minute, four times the old one) runs before it, because it does add something: one stuck client re-registering in a loop is cut off before it spends the budget everyone else registers from. The order matters. Checked the other way round, its refusals would already have spent the global budget.
- **Discovery.** These are static JSON with no database work. A refusal costs the instance as much as an answer, so a limit protects nothing and only risks refusing a real client. It stays only so no bare-origin route is unbounded. It is global, at 12,000 a minute, which is twice what clients that rediscover before each refresh would send at the `/token` ceiling. It has no per-IP rule, because that traffic comes from the same shared egress IPs. The other option offered was to leave these under `preAuthFloodGuard` alone, but that guard never ran for them: it is mounted on the `/api` router, and these routes are mounted ahead of it. Using it would also have meant keying on the IP again, at 600 a minute.
- **`temporarily_unavailable`.** RFC 6749 §5.2 lists no rate-limit code for the token endpoint. `temporarily_unavailable` is RFC 6749's own code for "temporary overloading or maintenance". It is defined for the authorization endpoint, but `/token` already answers its own 503 with it, so a client that handles one handles both. `slow_down` belongs to device-flow polling (RFC 8628), and `too_many_requests` is the MCP SDK's own non-standard code; both it and `temporarily_unavailable` are in the SDK's `OAuthErrorCode` list. The important property is what it is not: it is not `invalid_grant` or `invalid_client`, the codes that tell a client to throw its tokens or its registration away.

**Implications:**
- **What it does not stop.** A `client_id` is public, so someone who knows a client's id can spend that client's 600 a minute on an instance, and anyone can spend the global ceilings. These limits bound floods and stop one client crowding out another; they are not an authentication boundary. A deliberate flood is a platform-level problem, as it already is for every per-instance limiter here.
- **Stores of their own.** The OAuth limiters keep their keys in three stores of their own, not the shared one, so a flood on the `/api` router can't fill the maps they need, and the reverse.
- **Still maintained middleware.** Each layer is genuine `express-rate-limit` 8.7.0 on the existing bounded store, the same choice `2026-09-13-use-maintained-express-limiters-before-request-rls-acquisition.md` made for ingress, admin and wallet. No new environment variable.
- **Verified locally.** `test:ratelimit` drives the real exported middleware over HTTP at the real numbers:
  - 1,000 refreshes from one IP with different client_ids all pass;
  - one client_id is refused on its 601st, with the OAuth body and `Retry-After`, while another client on the same IP passes;
  - 2,000 garbage requests leave a real client's remaining budget at exactly 10;
  - the `/token`, `/register` and discovery ceilings refuse the next request from any IP;
  - unparseable JSON past the `/token` ceiling gets 429, not 400.

  A store-level test runs a ten-minute flood at four times the ceiling, and no new key is ever refused; the same flood without the ceiling is the failing control. Keying `/token`'s per-client budget on the IP instead fails three of the HTTP tests. The admin/OAuth integration suite (`admin.mjs` in cloud mode, real Postgres 16) passes through the new middleware chain.
- **Not verified.** How claude.ai's and ChatGPT's own clients treat a `temporarily_unavailable` 429 on refresh: whether they retry after `Retry-After` or still show a disconnect. Nothing here contacted production.
- **Docs:** SECURITY.md, DEPLOYMENT.md, ARCHITECTURE.md, API.md and apps/mcp/SPEC.md describe the new limits.
