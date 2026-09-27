---
date: "2026-08-27"
title: "Self-host no longer offers a Deck-E button it cannot answer"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-27 — Self-host no longer offers a Deck-E button it cannot answer

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** `deckeEntitled()` returns **false** on self-host. Previously it
returned true.

**Why the old answer was defensible and still wrong.** The comment reasoned that
self-host has exactly one user behind their own reverse proxy — the same
reasoning `/dev/decke`'s route guard uses — so gating them out would be absurd.
That is a correct statement about **permission**, and it is not the question the
function answers. It decides whether to draw the button, and a button has to
lead somewhere.

Deck-E's turn endpoint is `POST /api/chat`, which exists **only** as the Vercel
serverless function `api/chat.mjs`. `apps/api` has no Express route for it, so
on self-host `useDeckeChat`'s `fetch('/api/chat')` falls through to the SPA
rewrite and comes back as `200 text/html` — the identical failure shape issue
#89 produced for Purchase Set, and one that surfaces only after the reader has
opened the chat and typed something.

Found while fixing #89, whose sweep for other cloud/self-host path assumptions
turned this up as the mirror image: not a client calling the wrong path, but a
client correctly calling a path that does not exist on that tier.

**Pinned by a coupling test rather than a comment.** Three facts had to stay
true together and nothing compared them: `api/chat.mjs` exists, `apps/api`
serves no `/chat`, and the gate is shut. `__tests__/selfHostGate.test.ts` checks
all three, and if someone adds an Express `/chat` route the failure message says
to reopen the gate — and to write the condition as *"does the endpoint exist"*
rather than *"is this cloud"*.

**Implications.**
- Self-host loses nothing it had: the button never worked there.
- `DEPLOYMENT.md`'s self-host path now says so, so nobody configures `DECKE_*`
  on that tier expecting it to do something.
---

