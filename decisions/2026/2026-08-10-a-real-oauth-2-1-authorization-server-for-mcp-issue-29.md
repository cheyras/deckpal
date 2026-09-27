---
date: "2026-08-10"
title: "a real OAuth 2.1 authorization server for /mcp (issue #29)"
decided_by: "Not recorded"
areas: ["security","agents","operations"]
supersedes: []
---
## 2026-08-10 — a real OAuth 2.1 authorization server for /mcp (issue #29)

Issue #29: adding the DeckPal connector in claude.ai's UI landed on
`/authorize?response_type=code&client_id=dsk_…&redirect_uri=https://claude.ai/
api/mcp/auth_callback&code_challenge=…` and just said "not found." Root cause,
confirmed with `curl` against the exact URL: `/authorize` matched no
`vercel.json` rewrite, fell through the SPA catch-all to `index.html`, and
TanStack Router's default 404 rendered inside it. `apps/mcp/SPEC.md` already
predicted the mechanism — claude.ai's connector flow attempts OAuth up front
for a "Connect" action, independent of the `WWW-Authenticate`-omission trick
`cloud.ts` used to discourage it — and had already named the fix: "a full
OAuth 2.1 authorization server… that is the eventual path, not this one."
Asked, the owner moved that path up: build it for real, not a friendlier error
page, and make it work for any MCP-spec client (claude.ai, ChatGPT, Gemini),
not just claude.ai's quirks.

**Design: a bridge onto the existing credential, not a parallel one.** Every
personal access token DeckPal has ever issued — `dsk_…`, migration 026 — is
already exactly what `/mcp` accepts and `resolveToken()` already verifies.
Building a second, OAuth-flavored credential type would have meant two things
to keep in sync forever. Instead the OAuth token endpoint's entire job, once a
code is verified, is to call the *same* `createToken()` Profile → Agent access
calls. The new tables (`oauth_client` migration 031, `oauth_code` 032) hold
only what the dance itself needs — registered clients and single-use codes —
and neither is user-facing; the credential a user actually sees afterward is a
token row indistinguishable from one they typed a name for by hand, revocable
from the same panel.

**Split by who's asking, not by file.** `apps/api/src/oauthServer.ts` holds the
four routes a client's own backend calls before any DeckPal session exists —
`.well-known/oauth-authorization-server`, `.well-known/oauth-protected-
resource` (RFC 8414/9728), `POST /register` (RFC 7591 dynamic client
registration, public clients only — PKCE is mandatory on every `/authorize`
call, which is what a confidential-client secret would have bought here, so
none is issued), and `POST /token`. All four are mounted at the bare origin,
deliberately, because a client that fails metadata discovery is exactly the
client that falls back to guessing conventional paths there — issue #29's
mechanism, now pointed at real endpoints instead of a 404. `routes/oauth.ts`
holds the two a signed-in browser calls — `GET /oauth/client` (what the
consent screen shows) and `POST /oauth/authorize/decision` (Allow/Deny) —
mounted under `/api` behind `requireSession`, the same guard `/tokens` and
`/avatar` already use, for the same reason: approving a connection mints a
credential, so a credential must never be able to approve minting another one.
`/authorize` itself is a **frontend** route (`apps/web/src/routes/
Authorize.tsx`), not a JSON endpoint — a human's browser lands on it, and it
already had a working destination in the SPA catch-all; the fix was giving
that catch-all something real to render instead of the default 404, plus a
`next=` param threaded through `/auth` so a signed-out visitor bounces through
sign-in and back without losing the request.

**The security properties that matter got their own automated proof, not just
review.** Three scripted passes against a running instance (39 checks, all
green) before this was called done: the DB layer directly (client
registration's redirect_uri allowlist — https, or http on loopback only, never
a bare `javascript:` or arbitrary host; PKCE S256 verify/reject; single-use
code consumption via one atomic `UPDATE … WHERE used_at IS NULL RETURNING`, so
a replay race can only ever have one winner; expiry), the public HTTP surface
(`/register`, `/token` — both `application/x-www-form-urlencoded` and JSON
bodies, since real clients send either; wrong grant_type; mismatched
client_id/redirect_uri at exchange time), and the session-gated surface
(`/oauth/client`, `/oauth/authorize/decision` — critically, that an
unregistered `redirect_uri` gets a bare 400 with **no** `redirectTo` in the
response at all, never a redirect to an attacker-supplied host). The consent
screen itself was screenshotted end-to-end with a mocked signed-in session and
a mocked `/oauth/client` response — Allow posts the exact decision payload and
the browser lands on the exact `redirectTo` the server returned, `code` and
`state` intact.

**Migrations are additive only** (`CREATE TABLE`, no touch to `api_token` or
any existing table). Applied to the local dev database first, then — after the
review below and with the owner's explicit go-ahead — to production, followed
by a production deploy (`vercel --prod`, aliased to `deckpal.app`).

**An independent Opus review caught what the local test suite structurally
could not.** `routes/oauth.ts`'s two handlers originally read through
`rlsStore.getStore() ?? pool` — the same "use the per-request RLS client when
one exists" helper every other session-gated router in this file uses. Locally
that client never exists (033 is `@supabase-only`, so the local dev database
was never carrying the RLS policies), so every test passed. In production,
`SUPABASE_MODE` means one always exists, running as `authenticated` — exactly
the role 033 default-denies on `oauth_client`/`oauth_code`. `GET /oauth/client`
would have silently returned "unknown client" for every request; `POST
/oauth/authorize/decision` would have thrown on the `INSERT`. The whole
consent screen would 500/404 on first real use. Fixed by reading `pool`
directly in both handlers — the same bypass `applyApiToken`/`resolveToken`
already rely on, and the only path 033 was written to allow. The lesson,
not just the fix: a local database that never applies `@supabase-only`
migrations can pass every test while shipping something DOA on the one
schema that matters.

The same pass also caught a real (if lower-severity) open redirect: `next`
validation in `/auth` checked for a leading `//` but not a leading `/\`, and
browsers treat a leading backslash exactly like a forward slash when
resolving a URL — `/\evil.com` is `//evil.com` in disguise. `\` was never
tested because typing it never occurred to whoever wrote the check by hand
(that was this agent) — an actual attacker doesn't have that blind spot.
Both the write side (`main.tsx`'s `validateSearch`) and the read side
(`Auth.tsx`) now share one `isSafeNextPath` predicate in `lib/landingRoute.ts`
instead of two copies of the same regex-shaped judgment call that had already
drifted apart once.

**Verified live, on production, with the QA account — not just locally.**
After the fixes above, the same flow a real MCP client runs was driven
end-to-end against `https://deckpal.app`: `POST /register` (a fresh
`dscl_…` client), sign in as `qa@deckpal.app`, load the real `/authorize` URL
with a genuine PKCE pair, click the real Allow button, capture the real
redirect to `claude.ai` (sandboxed — never an actual network call to
claude.ai) with `code` and `state` intact, exchange the code at `POST /token`,
and call the live `/mcp` endpoint's `initialize` method with the resulting
token — a real 200 from `deckpal-mcp`, not a mock. The minted token appeared in
Profile → Agent access as `"DeckPal Prod Verification (OAuth)"`,
indistinguishable from a hand-created one. Revoking it through the real UI
(the Revoke button hides behind a native `confirm()` dialog Playwright must
explicitly accept, or the click silently no-ops) immediately 401'd it against
`/mcp`. A fresh manual token, created the old way with no OAuth involved, was
separately confirmed to still authenticate against `/mcp` exactly as before —
the one regression scenario worth checking given how much of the request path
changed. Every test credential and test OAuth-client registration created
during this pass was revoked/left as an inert row afterward; the QA account
ended the session with zero active tokens.

_Filed by agent on behalf of @cheyras — 2026-08-10._

