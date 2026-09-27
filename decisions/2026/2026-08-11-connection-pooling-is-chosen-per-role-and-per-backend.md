---
date: "2026-08-11"
title: "Connection pooling is chosen per ROLE and per BACKEND"
decided_by: "user (\"make this work on whatever machine I clone to\"), agent."
areas: ["general"]
supersedes: []
---
## 2026-08-11 — Connection pooling is chosen per ROLE and per BACKEND
**Decided by:** user ("make this work on whatever machine I clone to"), agent.

**Problem.** The dev API returned 500s that looked like a dead database. It was
not. Measured: while the API was timing out, a raw `pg` client reached the same
Supabase pooler in 483ms, and instrumenting the pool showed
`total=2 idle=0 waiting=13` — the pool was saturated, not broken, and it
released connections correctly.

Two facts combined into a hard ceiling of **two concurrent requests**:
1. `makePool` clamped every pool to `HARD_CAP = 3`, and the API asked for 2.
   That cap was written for one specific co-hosted self-host box
   (max_connections=20, budget of 4 — DECISIONS.md 2026-07-29). It was applied
   unconditionally, including against a Supabase pooler where the reasoning is
   inverted: a pooler exists so clients need NOT ration connections.
2. In `SUPABASE_MODE`, the RLS middleware (apps/api/src/index.ts) checks out one
   pooled connection for the ENTIRE lifetime of every request. So the pool's
   `max` is literally the server's max concurrent requests.

One SPA page load issues well over two parallel calls — doubled again by React
StrictMode in dev — so the third onward waited out `connectionTimeoutMillis`
and 500'd. It presented as "the backend lost connection".

**Decision.** `makePool` now takes a ROLE, and resolves port + ceiling from the
role and the detected backend:

- `role: 'request'` (the API's pool) — may use TRANSACTION pooling. On a
  `*.pooler.supabase.com` host it is routed to 6543 automatically and sized for
  real concurrency (default 12 in SUPABASE_MODE, 2 self-host, ceiling 24).
- `role: 'worker'` (migrations, sync, MCP, CLIs) — ALWAYS the session port and a
  ceiling of 3, unchanged. This is not a preference: `pg_try_advisory_lock`
  (apps/sync/src/prices/db.ts) is released when the session ends and migration
  020 creates a TEMPORARY table. Transaction pooling breaks both SILENTLY,
  which is the worst possible failure mode for a cross-run lock.

Audited before switching: no LISTEN/NOTIFY, no named prepared statements, no
session-level `SET` anywhere in the API. Its RLS setup is `BEGIN` /
`SET LOCAL` / `COMMIT`, which is transaction-scoped by construction.

**Why detection by hostname rather than configuration:** portability was the
requirement. A plain self-hosted Postgres has no 6543 to move to, so it keeps
using `PGPORT` for every role and nothing about a fresh clone changes.

**Also, so a clone actually runs:**
- `pnpm dev` at the root (scripts/dev.mjs, dependency-free) starts api + web +
  the image shim together. The web app alone is not a working app — it proxies
  `/api` and `/deckpal/images` — and requiring three hand-started terminals
  is precisely how this presents as "the backend won't connect".
- That script loads `.env` and passes it to every child. The image shim reads
  `process.env` directly and does not call `loadEnv()`, so without this it
  started fine and then 500'd every image with "SUPABASE_URL ... required".
- `.env.example` no longer PINS `PGPOOL_MAX_API=2`. Shipping that value as a
  default is what would reproduce this bug on the next machine; the constrained
  box's numbers are documented as commented-out overrides instead.
- The request pool logs its resolved host/port/max once at startup, so "which
  backend did it actually pick" is answerable on a machine nobody has debugged.

**Verified:** 30/30 concurrent `/api/series` calls return 200 (previously the
3rd failed); six real page loads across four routes with zero API failures;
worker pools still land on 5432 with an advisory lock held across statements.

---

