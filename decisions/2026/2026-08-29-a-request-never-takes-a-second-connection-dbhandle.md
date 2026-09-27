---
date: "2026-08-29"
title: "A request never takes a second connection: `dbHandle()`"
decided_by: "Claude (Fable 5) on behalf of @cheyras, from six production stack traces"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — A request never takes a second connection: `dbHandle()`

**Decided by:** Claude (Fable 5) on behalf of @cheyras, from six production stack traces
**Decision:** `dbHandle()` in `apps/api/src/db.ts` returns the request's RLS-held
client (`rlsStore.getStore()`) or falls back to the pool; the deck adapters in
`apps/api/src/deck/db.ts` and `export.ts` take `Queryable` instead of `pg.Pool`;
every in-request call site (`routes/decks.ts`, `routes/cards.ts`) passes it.
`makePool` warns at boot when a pooled `request` pool is sized below its role
default, and `PGPOOL_MAX_API` is documented in `DEPLOYMENT.md` (B11).
**Why:** All six 500s in the 2026-08-29 Deck-E transcript ("battle_logs failed:
Internal server error" ×4, decks ×2) were one bug: `pg-pool` connect timeouts.
`validate()` passed the module `pool` to `buildReprintOracle`, whose implicit
connect→query→release is a SECOND checkout taken while the SUPABASE_MODE RLS
middleware already holds one client for the whole request — N concurrent
requests want 2N connections, and production's request pool was pinned to 2 by
a stale `PGPOOL_MAX_API` override (a self-host value; `.env.example` un-pinned
it on 2026-08-11, the Vercel env never followed). Two concurrent `GET /decks`
deadlocked until `connectionTimeoutMillis`. PR #138 did not introduce the call
site (it predates it, `07405e7`); it raised the arrival rate. `battle_logs`
failed alongside because its deck-name resolution rides the same `/decks` call.
**Implications:** These catalog reads now run inside the request's RLS
transaction instead of on a BYPASSRLS connection — strictly tighter. The stale
Production `PGPOOL_MAX_API` override still needs removing by the maintainer
(B9); until then the boot warning names it. `deckeHistory.ts`'s own
pool write is deliberate (escapes the `authenticated` role per migration 044)
and was left alone. A unit test pins both the helper and the no-second-checkout
call shape, and fails with the production stack frame if regressed.

