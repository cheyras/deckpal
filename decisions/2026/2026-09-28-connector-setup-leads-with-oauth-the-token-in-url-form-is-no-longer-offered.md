---
date: "2026-09-28"
title: "Connector setup leads with OAuth; the token-in-URL form is no longer offered"
decided_by: "Chey (via Claude)"
areas: ["security", "agents", "frontend"]
supersedes: ["2026-08-10 MCP goes multi-user: the UI hands out a personal connector URL https://deckpal.app/mcp/<token>"]
---
## 2026-09-28 — Connector setup leads with OAuth; the token-in-URL form is no longer offered
**Decided by:** Chey (via Claude). Chey asked for the fix on 2026-09-28.

**Decision:** Profile → Agent access now leads with OAuth: paste the bare
`https://deckpal.app/mcp` as the connector URL, press Connect, sign in to
DeckPal and approve on the consent screen (`/authorize`). A personal access
token stays available as the advanced route, sent only as an
`Authorization: Bearer` header — claude.ai's *Request headers* beta, or Claude
Code's `--header`. The *personal connector URL* (`/mcp/dsk_…`, the token as the
last path segment) is gone from the page, from the one-time token reveal, from
the MCP server's 401 message, and from `DEPLOYMENT.md`, `SECURITY.md`,
`apps/mcp/SPEC.md` and the landing page. `tokenFrom()` in `apps/mcp/src/cloud.ts`
still **accepts** the path form, so connectors people already set up that way
keep working.

**Why:** A request path is written to the hosting provider's request logs, so a
token in the path ends up stored in those logs. The path form was a stopgap
from 2026-08-10, when claude.ai's connector dialog took only a URL and DeckPal
had no authorization server yet ("the correct long-term answer and is not this
change"). The OAuth server landed the same day and claude.ai connects through
it at the bare URL, so the client the stopgap was added for no longer needs it.
Refusing the path form outright would break working connectors; the harm worth
stopping is handing out new ones.

**Implications:** Nothing new should display or document the path form.
`apps/mcp/src/__tests__/cloud.test.ts` pins both halves: the path is still
accepted, and neither the 401 nor the browser endpoint card mentions it.
Existing path-form connectors keep putting their token in request logs until
their owner reconnects with OAuth and revokes the old token; the Agent access
page and `DEPLOYMENT.md` §2 say how. Removing path acceptance entirely would be
a separate decision, since it breaks those connectors. The Agent access
subtitle now counts "connections" rather than "tokens", since the list holds
both.
