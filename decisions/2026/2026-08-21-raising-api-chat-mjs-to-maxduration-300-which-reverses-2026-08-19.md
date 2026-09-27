---
date: "2026-08-21"
title: "Raising `api/chat.mjs` to `maxDuration: 300`, which reverses 2026-08-19"
decided_by: "@cheyras, on Claude's argument. Recorded because it reverses a"
areas: ["agents"]
supersedes: []
---
## 2026-08-21 — Raising `api/chat.mjs` to `maxDuration: 300`, which reverses 2026-08-19
**Decided by:** @cheyras, on Claude's argument. Recorded because it reverses a
decision in this file and must not look like drift.

**What 2026-08-19 decided.** "Why not raise `maxDuration`. It moves the cliff
instead of removing it, and it makes correctness depend on a plan tier. The
binding budget is actually the API's own `PGRLS_MAX_HOLD_MS` (30 s), not the
function's 60."

**Why that still stands, and why this is not it.** That decision concerned
`log_cards` — a WRITE path whose work could be made cheap (99 items went from
~65 s to 177 ms by batching), and where the real budget was the database hold.
Both remain true, and the fix there was right.

A research-and-synthesis turn is a different workload. Its latency is
irreducible — it is a model thinking, not a loop that can be batched — and it
holds NO database connection while it runs, because `Ctx.db` is lazy and every
tool call opens and releases its own short session. So the cliff is not being
moved; a different workload is being given a different ceiling.

**Decision.** `api/chat.mjs` goes to `maxDuration: 300`. Every deep tool gets a
wall-clock budget BELOW the function's (`DECKE_DEEP_BUDGET_MS`, default 210 s)
and returns PARTIAL FINDINGS rather than being killed — it streams for exactly
that reason, since a call that is simply killed produced nothing and was billed
anyway.

**Implications.** Writes stay bound by `PGRLS_MAX_HOLD_MS`; a deep tool's writes
go through deckpal-api and are unaffected by this number. No deep tool may
bypass `log_cards`' idempotency key. **Needs Fluid Compute confirmed on the
Vercel project** — per B9 that is the maintainer's to verify, and the value is
inert without it.

