---
date: "2026-10-12"
title: "Read-only personal access tokens"
decided_by: "@cheyras (chose read-only tokens, 2026-10-12)"
areas: ["agents", "auth", "security"]
supersedes: []
---
## 2026-10-12 — Read-only personal access tokens
**Decided by:** @cheyras (chose read-only tokens, 2026-10-12): "Read-only tokens only". Built by Claude Opus 5.5.

**Decision:** Option B of "MCP demo and read-only access options" (same date). A personal access token made in Profile → Agent access can now be read-only.

- **UI.** **New token** offers the consent screen's choice and wording: **Read and change** (the default) or **Read only**. Both screens render one shared component (`ScopeChoice`) over `SCOPE_OPTIONS`, so they cannot drift. The token list already labelled a `read` row **Read only**; hand-made tokens now reach that label too.
- **API.** `POST /tokens` takes an optional `scope: "full" | "read"`.
  - Absent means `full`, so existing clients are unchanged.
  - Anything else present is a `400`, the rule the OAuth consent decision already used.
  - The `201` response's `token.scope` and every `GET /tokens` row carry the scope.
- **Database.** Migration `085_read_only_tokens.sql` grants `authenticated` INSERT on `api_token.scope`. 075 had granted only `(user_id, name, token_hash, prefix)`, and `POST /tokens` inserts as the signed-in user, so the column could only ever take its default.
  - **INSERT only.** UPDATE of `scope` stays revoked, so no token can be widened from read to full.
  - **Self-host.** The file is behind a `pg_roles` guard, like 075, and does nothing on plain Postgres, where the API inserts as the table's owner.
- **Enforcement.** Unchanged and shared with OAuth. A read token is `scope = 'read'` on its own `api_token` row, so the same three layers refuse its writes: only `readOnlyHint` tools are listed (`adapters/mcp.ts`), the MCP transaction is `BEGIN READ ONLY` (`rls.ts`), and the REST API answers `403 insufficient_scope` (`enforceTokenScope`). That refusal's sentence now names both ways back to full access: reconnect, or create a new token.
- **Never full in place of read.** Three guards keep a read-only request from ever minting full access:
  - `createToken` refuses `read` before 075 exists.
  - The route answers `503` and mints nothing until 085 is applied, and logs `migration 085_read_only_tokens is not applied` once per instance.
  - The web app revokes, without showing the secret, any token an older API mints full after it asked for read.

  A full token is inserted exactly as before, without naming `scope`, so it never depends on 085.

**Why:**
- **Strictly a reduction in risk.** It lets someone hand a client read access without handing it write access. Until now the only read-only path was OAuth, and OAuth is not available to header-only clients such as scripts, headless Claude Code, or claude.ai's *Request headers* beta.
- **The grant gives nobody anything new.** Inserting `'full'` is what an insert without the column already did; `'read'` is less; 075's CHECK refuses any third value. 027's own-row INSERT policy and 064's mint-boundary trigger still apply. `expires_at`, `oauth_client_id`, `oauth_redirect_uri` and `decke_improvement_read` stay ungranted.
- **It unblocks Option A.** A published demo token must be `read`, and this lets one be made through the product rather than by hand-written SQL against production.
- **Why a column grant.** It is the smallest change that works. A SECURITY DEFINER mint function would have moved the whole mint, including the MAX_ACTIVE_TOKENS cap and the improvement capability, out of the route that already serialises them.

**Implications:**
- **Deploy order.** Production needs 085 applied **before** this code merges. It changes no environment variable or infrastructure setting. Confirm it with `SELECT has_column_privilege('authenticated', 'public.api_token', 'scope', 'INSERT')`. If the code ships first, only read-only minting is refused (503); full tokens and every existing credential are unaffected.
- **Scope is fixed at mint.** To change it, create a new token and revoke the old one.
- **Hand-made tokens still never expire,** read-only included.
- **Tests:**
  - `apps/api/src/__tests__/tokens.test.ts` and `tokensRoute.test.ts` (pure): accepted, defaulted and refused scope; the pre-075 and pre-085 refusals; the list.
  - `apps/api/src/__integration__/oauth.mjs`, run by `admin.mjs` cloud mode on real PostgreSQL. Before 085 the route refuses a read token. After it, a read token minted through `POST /tokens` resolves `read` and is refused every REST write. The test also pins `authenticated`'s exact INSERT/UPDATE column grants on `api_token`.
  - `tests/browser/agentAccess.mts` (suite `agent-access`): the form and list at 1280 and 390px.
- **Docs.** `apps/mcp/README.md` (the Tokens table), `DEPLOYMENT.md` (the token steps and the 085 note), `SECURITY.md`, `apps/mcp/SPEC.md` §3b and `API.md` describe the new behaviour. The wiki was not touched in this change.
- **Still open.** Options A and C and the rate-limit finding in the options file are unchanged.
