---
date: "2026-09-26"
title: "Fold /mcp, /api, /register, /token and /.well-known/* into the deckscout.io redirect"
decided_by: "Claude Sonnet 5, on behalf of @cheyras"
areas: ["security","agents","decks"]
supersedes: []
---
## 2026-09-26 — Fold /mcp, /api, /register, /token and /.well-known/* into the deckscout.io redirect

**Decided by:** Claude Sonnet 5, on behalf of @cheyras

**Decision:** `vercel.json`'s `deckscout.io` → `deckpal.app` redirect (2026-08-19,
b9731af) carved out five paths — `/mcp`, `/api`, `/register`, `/token`,
`/.well-known/*` — with a negative lookahead, specifically so an MCP connector
or API client still pointed at the old host would keep working instead of
getting silently 401'd by a cross-origin redirect that drops `Authorization`.
That carve-out is now gone: the redirect's `source` is a bare `/:path(.*)`, so
every path on `deckscout.io` 308s to the matching `deckpal.app` path, no
exceptions.

**Why now.** The carve-out's own exit condition ("once the connectors are
known to have moved," per b9731af's commit message) is met: Chey's own
claude.ai connector was re-created at `https://deckpal.app/mcp` on 2026-09-26,
and the old `deckscout.io/mcp` connector is being removed. `deckscout.io/mcp`
answering live is exactly the situation the carve-out existed to protect — and
per B9, closing it is a call for the maintainer to make once that protection is
no longer needed, not one this change makes unilaterally: it changes only the
in-repo redirect rule, not the Vercel `MCP_ALLOWED_HOSTS` environment variable.

**Evidence gathered (read-only, no credentials sent):**
- Live, unauthenticated `curl -sI` against `deckscout.io` today: `/mcp` → 401
  (a real, working endpoint, not a 404), `/api/health` → 200,
  `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`
  → 200, `/` and `/pokedex` → 308 to `deckpal.app` (already redirected before
  this change, since they were never in the carve-out).
- The OAuth discovery metadata (`apps/api/src/oauthServer.ts`'s `originFor()`)
  is derived entirely from the request's `Host` header: querying
  `deckscout.io/.well-known/oauth-authorization-server` returns
  `"issuer":"https://deckscout.io"` and a matching `token_endpoint` /
  `registration_endpoint`; the same query against `deckpal.app` returns its own
  host throughout. So a brand-new client discovering via `deckscout.io` today
  can still complete an entire OAuth registration against that host.
- Nothing in that flow binds the RESULT to a host, which is why folding the
  carve-out in cannot invalidate an existing credential: `oauth_client.redirect_uris`
  is the *client's own* callback (e.g. claude.ai's), never a DeckPal host; the
  optional `resource` recorded on an auth code is never re-checked at `/token`;
  and the `api_token` row the exchange ultimately mints (`packages/db/src/tokens.ts`)
  is a bare secret scoped only to `user_id` — identical whether it was issued
  via `deckscout.io/token` or `deckpal.app/token`, and accepted at `/mcp`
  regardless of which allowed host received the request. The only thing this
  change can break is a client whose *transport URL* (or cached discovery
  metadata) is still literally `deckscout.io/...` — exactly Chey's own
  connector, now moved.
- No code default anywhere assumes `deckscout.io` is an allowed MCP host:
  `apps/mcp/src/cloud.ts` and `apps/api/src/oauthServer.ts` both fall back to
  `deckpal.app,www.deckpal.app,localhost,127.0.0.1` (`apps/mcp/SPEC.md`
  documents the same list), and a repo-wide case-insensitive grep for
  `deckscout` outside `vercel.json` turns up only historical comments (a PDF
  brand-rename note, a retired-brand test fixture) — nothing to update there.
- No current-instructions doc points at `deckscout.io/mcp`: `DEPLOYMENT.md`,
  `SECURITY.md`, `apps/mcp/SPEC.md`, `README.md`, `ARCHITECTURE.md` and the wiki's
  [MCP Setup](https://github.com/cheyras/deckpal/wiki/MCP-Setup) page already
  say `deckpal.app/mcp` exclusively; the only remaining `deckscout` hits in
  `DECISIONS.md` and the wiki's Decision-Log/Contribution-Record/Foil-Branch-Log
  are dated history and were left untouched.
- This agent cannot see Vercel's traffic logs. Chey can check
  Vercel dashboard → Logs, filtered to host `deckscout.io`, path `/mcp`, over
  the last 30 days, to see whether anyone besides him has hit the old
  connector recently.

**Verification:** `scripts/check-redirects.mjs` (new; wired into `ci.yml` as an
early, install-free step and into `package.json` as `test:redirects`) parses
the live regex out of `vercel.json`'s `source` and asserts it matches `/mcp`,
`/api`, `/register`, `/token`, `/.well-known/*` and ordinary app paths, and
that no `(?!...)` carve-out syntax remains. Run against the pre-change file it
fails immediately (the carve-out assertion); against the post-change file it
passes on all 14 sampled paths. Full build/typecheck
(`tsc --noEmit` across all workspaces) and `scripts/check-functions.mjs` (all 4
serverless functions load) both pass unchanged, since this PR touches only
`vercel.json`, the new check script, and CI/CD wiring — no application code.

**Implications:** `MCP_ALLOWED_HOSTS` on Vercel still lists `deckscout.io`.
That entry is now dead weight rather than a real exposure — the edge-level
redirect intercepts every path on `deckscout.io` before any function runs, so
the host allowlist check in `apps/mcp/src/cloud.ts` / `apps/api/src/oauthServer.ts`
can no longer be reached with `Host: deckscout.io` at all — but removing it
from the Vercel dashboard is still Chey's action under B9, and should happen
after confirming (via the traffic-log check above) that nothing legitimate is
still relying on it. Merge checklist: (1) remove the old `deckscout.io/mcp`
connector from claude.ai (Chey — in progress), (2) check Vercel logs for
recent `deckscout.io` traffic on the five affected paths, (3) merge this PR,
(4) then remove `deckscout.io` from `MCP_ALLOWED_HOSTS` in Vercel.
