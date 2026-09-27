---
date: "2026-08-10"
title: "MCP goes multi-user: per-user personal access tokens at /mcp"
decided_by: "user (owner) + agent."
areas: ["security","agents"]
supersedes: []
---
## 2026-08-10 — MCP goes multi-user: per-user personal access tokens at /mcp
**Decided by:** user (owner) + agent.

**Decision:** `deckpal-mcp` — 21 tools, previously a single-user process behind a
shared `x-brain-key` — is now served to **any signed-up user** from a Vercel
function at `https://deckpal.app/mcp`, authenticated per-user by a personal
access token. Self-host keeps the old process, unchanged.

### The auth model

Migration **026** adds `api_token` (portable Postgres) and **027** its
`@supabase-only` RLS companion — the 022/023 split, applied to a new table.
Columns: `user_id` FK `app_user` ON DELETE CASCADE, `name`, `token_hash`,
`prefix`, `created_at`, `last_used_at`, `revoked_at`.

The raw token never touches the database. It is `dsk_` + 32 bytes of CSPRNG
output (base64url, 256 bits), and only its hex SHA-256 is stored. **SHA-256, not
bcrypt/argon2**, on purpose: the secret is machine-generated, so there is no
dictionary to stretch against, and the lookup sits on the hot path of every tool
call — it has to be one indexed equality, not a per-row KDF. The raw value is
returned exactly once, in the response to `POST /tokens`, and is unrecoverable
afterwards; the UI says so in as many words.

Request path:

```
Authorization: Bearer dsk_…   (or the last path segment of /mcp/dsk_…)
      → sha256 → api_token row (revoked_at IS NULL) → user_id
      → withUserContext(user_id): BEGIN; request.jwt.claims.sub = user_id;
                                  SET LOCAL role = 'authenticated'
      → one McpServer, one exchange, close, COMMIT
```

Every tool therefore has **two independent locks**: the `WHERE user_id = $1`
bind parameter it already had, and migration 021's row-level policies firing
underneath it. API-backed tools forward the same token in their own
`Authorization` header, so `deckpal-api` re-resolves the identity rather than
trusting anything the MCP layer asserts.

Token *verification* lives in `@deckpal/db` (`src/tokens.ts`) rather than in
either server, because the minting side (API) and the checking side (MCP edge)
must agree byte for byte about the hashing rule. `withUserContext` is
deliberately restated in `apps/mcp/src/rls.ts` instead: the two apps are separate
functions with separate pools, and importing across an app boundary to save 35
lines would have dragged express/helmet/pdfkit into the MCP bundle.

The API gained a second credential kind as a side effect: `dsk_…` works as a
Bearer token against the REST API too. Token *management* does not — `/tokens`
sits behind `requireSession`, so a leaked token can use the API but can never
mint a second credential or revoke the one that would cut it off (403,
"Personal access tokens cannot manage tokens").

### Why the token can also live in the URL path

Researched against current Anthropic docs rather than memory
(claude.com/docs/connectors/building/authentication, /custom/remote-mcp,
code.claude.com/docs/en/mcp-quickstart, modelcontextprotocol.io 2025-11-25
authorization spec):

- **Claude Code** takes arbitrary headers at add time (`--header`) — no gate.
- **claude.ai custom connectors** expose headers only through a *Request headers*
  section that is explicitly **beta** ("being slowly rolled out to customers;
  contact Anthropic for early access"), with an allowlist of header names
  (`authorization` is on it) and max four. Its non-beta alternatives are a full
  OAuth 2.1 authorization server (RFC 9728 protected-resource metadata + DCR or
  CIMD + mandatory PKCE + RFC 8707 resource indicators) or no auth at all.

Standing up an authorization server is the correct long-term answer and is not
this change. Shipping unauthenticated is not an option. So the endpoint accepts
the same token in **either** position, and the UI hands out both an
`Authorization: Bearer` recipe and a personal connector URL
`https://deckpal.app/mcp/<token>`.

The token is in the **path**, never the query string. Both the MCP spec
("Access tokens **MUST NOT** be included in the URI query string") and
Anthropic's guidance name the query string specifically; the path case is
undocumented territory in both, and the stated rationale (URLs land in logs and
history) is honestly disclosed in the UI, which labels the whole URL a password.
It is revocable, scoped to exactly one user, and carries no more authority than
the header form. `www.deckpal.app` 308-redirects to the apex and a cross-host
redirect silently drops `Authorization`, so every string the UI emits is
apex-only.

### Tool audit — all 21 enabled, none disabled

Every tool already derived its identity from `ctx.userId` or from a REST call;
none had a "the one user" assumption baked in beyond that. `health` and
`search_cards` also read catalog/sync tables, which are world-readable by design
(021 grants `USING (true)`), so their global counts are correct, not a leak.
Nothing was disabled.

Two real bugs surfaced while auditing:

1. `ctx.userId` was `Number(app_user.id)` — **NaN on every deployment since
   migration 020** made that column a UUID. It has been a `string` since.
2. `Ctx.pool` typed as `pg.Pool` prevented running tools on a checked-out RLS
   client. It is now `Ctx.db: Queryable` (`{ query() }`), which is what lets one
   set of tools serve a process pool and a per-request transaction unchanged.

### Isolation proof (production, 2026-08-10)

Throwaway Supabase user `mcp-probe`, token created through the real UI on
deckpal.app; owner `cheyras` holds 426 collection items, 7 decks, 30 battle logs
in the same database.

Read tools, called with the throwaway token:
`collection_summary` → "owned: 0 distinct cards · 0 total copies"; `decks` →
"No decks yet"; `lists` → "No lists yet"; `health` → "owned: 0 distinct cards"
while still reporting the shared catalog (23,444 cards). Zero owner strings in
any response.

**Hostile cross-user writes** — the throwaway token calling every write tool with
the owner's real ids explicitly passed as arguments (deck
`9f6692fd-…`/`47333f45-…`, battle log `14`, variant `392`): `save_deck` rename,
`save_deck` add-card, `deck_strategy` overwrite, `add_battle_log`,
`edit_battle_log`, `delete_battle_log`, `delete_deck`, plus the reads
`decks`/`deck_history`/`battle_logs`. **All ten failed closed** with
`isError: true, "No deck '…'"` — the row is not merely unwritable, it is
invisible. `log_cards` setting quantity 999 on `card_variant` 392 (the owner
holds 33) wrote the probe's own row: afterwards `cheyras` still had 33 and
`mcp-probe` had 999, two rows, no crossing. Owner totals after the run:
7 decks (names intact, no "PWNED by probe"), 30 battle logs, 426 items,
`battle_log` 14 still present with empty notes.

Rejection paths: no header → 401; garbage `dsk_…` → 401; a JWT-shaped string →
401; revoked token → 401 with no `WWW-Authenticate`; a second, unrevoked token
of the same user still 200 (revocation is per-token). A personal access token
against `GET /api/tokens` → 403.

**Verification:** workspace typecheck clean; 49 deck + 14 auth + 6 bug + 33 image
+ 14 new token tests pass; all builds green. Migrations proven 001→028 on two
fresh scratch databases — plain Postgres (021/023/027/028 correctly skipped) and
`SUPABASE_MODE=1` with auth stubs (all 28 applied), both dropped afterwards, plus
a two-user RLS test on `api_token` showing Alice sees 1 row not 2, cannot find
Bob's by hash, her UPDATE of his row affects 0 rows, and her INSERT for his
`user_id` raises "new row violates row-level security policy". `claude mcp add
--transport http deckpal https://deckpal.app/mcp --header "Authorization:
Bearer …"` verified verbatim: `claude mcp list` reports
`deckpal: https://deckpal.app/mcp (HTTP) - ✔ Connected`. Token UI
screenshotted at 1440 and 390 on the deployed site. Throwaway user and both its
tokens deleted afterwards.

**Implications:** `apps/mcp` is now two entry points from one tool set —
`index.ts` (self-host, shared key, process pool) and `cloud.ts` (per-token, per-
request RLS). A tool added to `server.ts` reaches both. Anything that assumes a
process-wide user, a `pg.Pool` specifically, or a numeric `app_user.id` will
break the cloud path. When `Request headers` leaves beta for everyone, or an
OAuth 2.1 server exists, the path-token form can be demoted to a fallback; it
cannot be removed without breaking every connector already configured with it.

