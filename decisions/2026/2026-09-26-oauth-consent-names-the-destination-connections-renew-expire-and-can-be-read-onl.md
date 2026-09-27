---
date: "2026-09-26"
title: "OAuth consent names the destination; connections renew, expire and can be read-only (SEC-07)"
decided_by: "Chey (via Claude)"
areas: ["security"]
supersedes: []
---
## 2026-09-26 — OAuth consent names the destination; connections renew, expire and can be read-only (SEC-07)

**Decided by:** Chey (via Claude)

**Decision:** Security audit SEC-07 found that anyone could register an OAuth
client called "Claude" through open dynamic client registration, and the
consent screen then led with that name in bold ("**Claude** wants to access your
account") while the host receiving the approval sat in a muted line below. The
token it minted never expired and could do everything a session could, including
reading Deck-E conversations and rewriting the public showcase, which the
consent screen said it could not. Migration 075 and this change:

- The consent screen leads with where the approval goes. `classifyRedirect`
  (server-side, one list) marks only Claude's exact documented callback
  (`https://claude.ai/api/mcp/auth_callback`, and the `claude.com` twin) as
  **Verified**, named by us. Everything else is **Unverified**, headed by its
  host, with the registered name quoted as a claim. Loopback redirects (Claude
  Code) are Unverified with the MCP spec's extra local-app warning. Exact URLs,
  not hosts, so a forwarding path on a trusted host is not badged. Profile names
  each connection after its destination (`Claude (OAuth · evil.example)`).
- An approval is still one `api_token` row, but its secrets rotate beneath it in
  `oauth_token`: one-hour access tokens and single-use 90-day refresh tokens.
  Each refresh moves the connection's `expires_at` 90 days out; a connection
  unused for 90 days lapses and stops holding a `MAX_ACTIVE_TOKENS` slot. A used
  refresh token presented again inside a minute is refused (a client racing its
  own renewal); presented later, it revokes the connection. One refresh token
  never yields two pairs, so a stolen one can never fork a second live chain
  (Astra's review caught the first version doing exactly that).
- The person chooses **Read and change** or **Read only**. Read-only is enforced
  three times: only `readOnlyHint` tools are served, the MCP transaction is
  `READ ONLY`, and the REST API refuses every non-GET with `403
  insufficient_scope`.
- `/decke`, `/me/showcase` and `/me/settings` now require a session.
- Client roles lose table-wide INSERT/UPDATE on `api_token` and keep only the
  columns the app writes as the user, so scope and expiry cannot be rewritten
  over PostgREST.

**Why:** The MCP authorization spec requires the redirect hostname to be shown
clearly, asks for short-lived access tokens, and requires public clients'
refresh tokens to rotate. Anthropic's connector docs confirm Claude refreshes
proactively and on any 401, sends refresh requests form-encoded, expects
`invalid_grant` for a dead refresh token, and asks for a refresh token when
`offline_access` is listed in `scopes_supported`. So an hour-long access token
costs a connected person nothing, while a leaked copy dies within the hour and
an abandoned connection ends by itself. Refresh was chosen over a long fixed
lifetime because a fixed lifetime would force every connector to reconnect by
hand when it ran out.

**Implications:**
- **Nothing that exists today changes.** Every token minted before 075,
  hand-made or OAuth (including Chey's claude.ai connector re-created
  2026-09-26), keeps `expires_at NULL` and full scope and resolves exactly as
  before. Nobody is asked to reconnect. Profile shows those rows as "No expiry";
  reconnecting replaces one with a renewing connection. A future sunset date for
  pre-075 OAuth tokens would be a separate, announced decision, because it would
  force one manual reconnect each.
- Hand-made tokens still never expire: the URL-pasting clients they exist for
  cannot renew.
- During a mixed-version deploy, the browser offers **Read only** only when
  `GET /oauth/client` includes the new server's `trust` field. An older API
  ignores `scope`, so its consent screen shows full access alone and makes no
  promise about renewal or routes that the older API has not yet restricted.
- Migrations run by hand and Vercel deploys on merge. Until 075 is applied, the
  code resolves tokens through their pre-075 statements (the 046 pattern) and
  refuses only *new* connections, with a 503. Apply 075 with the deploy.
- Merge after PR #204 (072). 075 composes with 072's trigger (token identity
  frozen, revocation final) and its DELETE revoke; verified by applying 072's
  `api_token` section before 075 and re-running #204's own assertions.
- `/token` refresh traffic from Claude arrives from Anthropic's shared egress,
  so PR #208's per-IP 30/min `/token` limit is per instance and shared by every
  claude.ai user. At an hourly refresh per active connection that is far below
  the limit at today's scale; revisit the key if DeckPal grows to hundreds of
  concurrently active connections.
- Deferred: refusing `purge: true` deletes to connector tokens (it changes an
  existing MCP tool's behaviour, so it is a product call); OAuth scope strings in
  metadata so a client can ask for read-only up front; Client ID Metadata
  Documents; verifying other clients' callbacks (ChatGPT's was not checked, so
  it shows as Unverified); an optional expiry for hand-made tokens; and the
  admin user projection's connector count, which still counts lapsed
  connections.

