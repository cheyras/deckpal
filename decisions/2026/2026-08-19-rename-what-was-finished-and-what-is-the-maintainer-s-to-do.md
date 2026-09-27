---
date: "2026-08-19"
title: "Rename: what was finished, and what is the maintainer's to do"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["general"]
supersedes: []
---
## 2026-08-19 — Rename: what was finished, and what is the maintainer's to do
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** Fixed in code: the `health` tool's title was still
"Pokedex health & data freshness". Nothing else in application code says
DeckScout or rotom — the remaining hits are a real Pokémon card in a test
fixture ("Rotom V"), historical comments inside checksum-locked migrations, and
`CLAUDE.local.md`'s QA credentials.

**NOT changed, deliberately — these are the maintainer's calls:**
- **`deckscout.io` is not a redirect.** It returns HTTP 200 serving the app
  (title "DeckPal — …"), so the product is live on two apex domains. A redirect
  is one `vercel.json` entry, but `vercel.json` IS Vercel configuration and
  contract B9 has no in-repo carve-out — and a redirect DROPS the
  `Authorization` header, so any connector still pointed at
  `deckscout.io/mcp` would break silently. If it is wanted, it must be scoped to
  browser page routes and exclude `/mcp*`, `/api*`, `/.well-known/*` and
  `/deckpal/images/*`.
- **The claude.ai connector's display name** ("DeckScout") lives in the user's
  claude.ai account, not in this repo. The server advertises `deckpal-mcp` /
  "DeckPal — TCG collection assistant" already.
- **The SMTP sender** is `DeckPal <noreply@deckscout.io>`; the address is on the
  Resend-verified `deckscout.io` domain, so changing it means verifying
  `deckpal.app` with Resend first.

