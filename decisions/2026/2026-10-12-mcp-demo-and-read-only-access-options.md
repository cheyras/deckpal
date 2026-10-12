---
date: "2026-10-12"
title: "MCP demo and read-only access options"
decided_by: "Open — options for @cheyras; written by Claude Opus 5.5 during the MCP surface audit"
areas: ["agents", "auth", "security"]
supersedes: []
---
## 2026-10-12 — MCP demo and read-only access options
**Decided by:** Open — options for @cheyras; written by Claude Opus 5.5 during the MCP surface audit. Nothing in auth was changed.

**Decision:** None yet. This records what it costs today to go from nothing to a first successful tool call, where that path breaks, and three ways to make DeckPal tryable without an account of one's own, each with its security cost. The recommendation is at the end; the owner decides.

### What trying it costs today
Read from code. Error texts marked † were produced by running `createCloudApp()` locally against an unreachable database.

- **Cloud, Claude (claude.ai / Desktop):** create an account (email and password, then an email confirmation link) → Customize → Connectors → Add custom connector, URL `https://deckpal.app/mcp` → Connect → sign in → consent (Read and change / Read only) → Allow → enable DeckPal in the chat. Five steps for an existing user, about eight for a new one (`AgentAccess.tsx:391-413`, `DEPLOYMENT.md` "Connect an AI assistant").
- **Claude Code:** `claude mcp add --transport http deckpal https://deckpal.app/mcp`, then `/mcp` → authenticate in the browser. Three steps; the loopback redirect cannot complete on a headless or SSH machine.
- **ChatGPT:** no ChatGPT-specific instructions existed anywhere in the repo before `apps/mcp/README.md`. Dynamic client registration should accept its https redirect, but the consent screen labels the redirect host Unverified ("It calls itself “…”, which DeckPal can't confirm"), because only the claude.ai/claude.com callbacks are on the verified list (`packages/db/src/oauth.ts:82-85`). Not verified end to end.
- **Any client, personal access token:** Profile → Agent access → New token → copy once → send `Authorization: Bearer dsk_…`. A personal token is always full scope and never expires (`packages/db/src/tokens.ts:14-16`). OAuth access tokens last one hour, with 90-day rotating refresh tokens (`packages/db/src/grants.ts:36-37`).
- **Self-host:** Postgres with pg_trgm, unaccent and pgvector; migrations; a catalog import that needs `data/catalog/en`, which is not in the repo (it comes from `scripts/refresh-catalog.sh`, which needs Docker and is only introduced in step 6 of the runbook); the API; the MCP server on 127.0.0.1:3704 with `DECKPAL_MCP_KEY` and the `x-brain-key` header; a TLS proxy for hosted clients. `pnpm mcp:audit --responses` now runs the database-to-tool-call half of this in one command on a disposable cluster. That makes it the cheapest self-host smoke test available.

**Where it breaks, in order of likely impact:**
1. `/register`, `/token` and the two `.well-known` documents are rate limited at 30 a minute per source IP (`apps/api/src/rateLimit.ts:360-362`). Hosted connectors (claude.ai, ChatGPT) do discovery, registration, code exchange and every hourly refresh from their own shared egress IPs. `apps/mcp/src/cloud.ts:156-161` already explains why IP-keyed limits are wrong for hosted connectors, but the OAuth endpoints never got the same treatment. The 429 body is DeckPal's `{"error":{"code":"rate_limited"}}`, not RFC 6749's shape, so a client is likely to show a refresh that hits it as a disconnect. **Not changed (auth).**
2. Reconnecting creates a new connection and never revokes the old one. After 20 active connections, `/token` returns `invalid_grant` "The account has the maximum number of active connectors." (`oauthServer.ts:210-211`), and the client shows that as a generic auth failure.
3. The consent page does not show which DeckPal account is signed in (`Authorize.tsx:206-281`), so connecting the wrong account goes unnoticed.
4. `Authorization: bearer …` with a lowercase scheme is treated as no credential at all† (`cloud.ts:117` matches `Bearer ` case-sensitively; RFC 7235 makes the scheme case-insensitive). **Not changed (auth).**
5. A wrong host gets `421 {"code":"bad_host","message":"Host not allowed"}`†, which names neither the host nor `MCP_ALLOWED_HOSTS`.
6. Two error texts are good and should stay as they are:
   - **No token†:** "No token. Connect with OAuth in your MCP client, or send Authorization: Bearer <token> with a token from DeckPal → Profile → Agent access."
   - **Expired or revoked token†:** a 401 with `error="invalid_token"`, which is what makes a client refresh.

### Option A — a seeded, shared demo account
A synthetic account whose data is the MCP audit's seed (`apps/mcp/audit/seed.mjs`: 640 collection rows, 30 decks, 120 real Live logs, lists), reached through one published read-scoped token.
- **Security:**
  - **The token must be `read` scope**, because it is public. Writes are then refused at three separate layers:
    - not listed (`adapters/mcp.ts`);
    - `BEGIN READ ONLY` (`rls.ts`);
    - the REST scope gate (`auth.ts`).
  - **The data must be synthetic.** It must never include a real person's battle logs, because opponent screen names are third-party data.
  - **Abuse is DoS, not data loss:**
    - every demo user shares one 60-a-minute token bucket (`cloud.ts` `mcpRateOk`);
    - the pre-resolution global gate (300 a minute per instance) is shared with real users.
- **Gap:** a read-scoped personal token cannot be minted today. `POST /tokens` takes no scope, and migration 075 grants clients only `INSERT (user_id, name, token_hash, prefix)` on `api_token`. The owner would have to mint it by hand in SQL (a production write, so B9 applies), or option B comes first.
- **Cost of trying:** one header in a client config. It does not work with claude.ai's OAuth "Connect" button without sharing a password, so it serves Claude Code, other header-capable clients and scripts, not the claude.ai path.

### Option B — read-only personal access tokens
Let the Agent access page mint a token with `scope = 'read'`, the scope that OAuth connections can already choose on the consent screen (migration 075).
- **Change:**
  - a scope field on `POST /tokens`;
  - a radio in `AgentAccess.tsx`;
  - a migration adding `scope` to the column grant (or a security-definer function).

  Small.
- **Security:** strictly a reduction in risk for anyone who uses it; nothing new is exposed. Option A needs it too.
- **Limit:** it lowers the risk of trying, not the cost. An account is still required.

### Option C — unauthenticated, catalog-only tools
A separate endpoint (for example `/mcp/catalog`; `vercel.json` already routes `/mcp/(.*)`) serving only tools that read no user data. It runs under `BEGIN READ ONLY; SET LOCAL role = 'anon'`, the same RLS posture the public catalog routes already use (`apps/api/src/index.ts:483-499`).
- **Which tools qualify (read in code):**
  - `card_price_history` is purely catalog (public `GET /cards/:id/prices`).
  - `search_cards` and `get_card` overlay ownership through `ctx.userId`, so they would need a NULL-safe path.
  - `check_deck`, `deck_odds` and `set_cart` sit behind user identity on the REST side today.
  - `simulate_battles` must stay out: up to 25 seconds of CPU per call, rate-limited per account.
- **It must be its own URL.** An anonymous 200 on `/mcp` would stop clients from ever starting OAuth.
- **Security and cost:**
  - Nothing private is reachable, but it creates the first unauthenticated path to the database through MCP.
  - Requests with no credential are currently free (an immediate 401, no database). This tier would make each one hold a pooled connection for the whole exchange, against a 2-connection serverless pool (`cloud.ts:88-95`).
  - Per-IP limits do not work behind hosted connectors, so the only lever is a global budget. That makes the anonymous tier a DoS target that starves signed-in users unless it gets its own function, pool and concurrency cap.
  - Supabase connection count and Vercel spend scale with it.

### Recommendation
1. **B first.** It is small, strictly safer, and a prerequisite for A.
2. **Then A**, for a no-signup try-it path in header-capable clients.
3. **Defer C.** The catalog alone is not what DeckPal is for, and C is the only option that adds an unauthenticated load path to production.

Separately, and regardless of which option is chosen: re-key the OAuth endpoints' rate limit away from source IP (finding 1), because it can break claude.ai connections for everyone at once.

**Why:** the request was to find out whether a demo or read-only path is feasible without changing auth or exposing user data, and to lay out the options with their security implications rather than pick one unilaterally (B9).

**Implications:** this file changed no code. Findings 1–5 are candidates for follow-up work; 1 and 4 change auth and need the owner's yes.
