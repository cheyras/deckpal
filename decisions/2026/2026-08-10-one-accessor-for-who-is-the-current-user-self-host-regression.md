---
date: "2026-08-10"
title: "One accessor for \"who is the current user\" (self-host regression)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-10 — One accessor for "who is the current user" (self-host regression)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** Request identity now has exactly one seam, `apps/api/src/identity.ts`.
A middleware (`resolveIdentity`, built by `makeResolveIdentity`) settles identity once
per request ahead of every user-scoped router, and routes read it only through
`currentUserId(req)`. All 50 `req.user!.id` call sites across 10 route modules are
gone, as is the private `userId ?? defaultUserId()` fallback that `routes/tokens.ts`
was carrying. Resolution order, identical in both deployments:

1. a credential already verified by `authMiddleware` — Supabase JWT or personal
   access token — wins;
2. no credential **and** any Supabase environment configured → **401**, no fallback;
3. no credential and no Supabase environment → the single local user
   (`defaultUserId()`, lowest `app_user.id`), which is the pre-pivot behaviour and the
   same rule `apps/mcp/src/ctx.ts` applies.

**Why the `!` pattern was unsafe.** The cloud pivot (730339c) rewrote ~30 routes from
`await defaultUserId()` to `req.user!.id`. That is correct in cloud. In self-host
`authMiddleware` is deliberately a no-op — the reverse proxy is the auth boundary
(SECURITY.md) — so `req.user` is `undefined`, the non-null assertion erases at compile
time, and `undefined` went straight into `WHERE user_id = $1`. `/insights/overview`
and every collection and deck write 500'd. The open-core promise was broken at HEAD
and nothing caught it: CI runs only the pure suites (contract B7), and the one route
that kept a fallback — `/tokens` — kept working, which made the breakage look partial.

**Why a non-optional type is not the fix.** `!` applied to a non-optional type is a
silent no-op, so retyping `req.user` would have left the same keystroke compiling and
would additionally have lied about `/health`, `/search` and the anonymous bug reporter,
which legitimately have no user. The fix is that the value routes consume is **total**:
`currentUserId()` returns `string` or throws `identity_unresolved` (500). There is
nothing for `!` to assert and no `undefined` to reach SQL. `AuthedRequest` (non-optional
`user`) is exported for handlers that want the narrowed type.

**Cloud isolation is unchanged.** Identity in cloud still derives from the verified JWT
subject and nothing else. The self-host branch is gated on `SUPABASE_CONFIGURED`, which
is deliberately *wider* than auth.ts's `AUTH_ENABLED`: `SUPABASE_MODE` alone (RLS wired
up, no verifiable credential) is a broken cloud deployment and must 401 rather than hand
an anonymous caller the first row of `app_user`. The fallback is unreachable under
Supabase twice over — the injected `localUserId` rejects, and `makeResolveIdentity`
re-asserts the invariant before it would call it. Self-host gains no authentication it
never had: an unauthenticated request is served, exactly as before.

**Second, unrelated defect found while verifying.** 14 of the 18 failing tests were not
the `!` bug. Migration 020 added `deck_version.user_id` and `battle_log.user_id` as
`NOT NULL` (no default) for direct RLS scoping and backfilled them from the owning deck,
but no writer was updated to keep supplying the column — so `INSERT INTO deck_version
(…)` violated the constraint on **every** deck create, card edit, revert and battle-log
write. This one is not self-host-specific: the cloud database has the same NOT NULL
columns and no default, so cloud deck writes were equally broken; the cloud rows all
predate the migration, so it had simply never been exercised there. `recordDeckChange`
now reads `user_id` off the owning deck row — the migration's own backfill rule, and
under RLS that SELECT only ever sees the caller's decks — rather than threading a fourth
argument through seven call sites. A workspace-wide audit confirms every remaining
`INSERT` into a NOT NULL `user_id` table supplies it.

**The CI guard.** `apps/api/src/__tests__/identity.test.ts` is pure — no database, no
network, no environment mutation — and runs in CI via `test:auth`. `makeResolveIdentity`
takes its configuration as an argument precisely so all three branches are reachable
from a unit test: cloud-with-credential resolves to the JWT subject, cloud-without
returns 401 and never calls the local-user lookup, self-host resolves to the local user.
A final block scans the route sources and fails if any route reaches for `req.user`
again (`bugs.ts` excepted — it wants the optional field). That scan is the real guard,
because `!` is the escape hatch the type checker cannot close; it was mutation-tested by
reintroducing `req.user!.id` into `routes/insights.ts` and confirming CI goes red.

**Implications:** Live-DB suites stay out of CI by contract B7, so this pure suite is
the compensating control for that whole class of deployment-split bug — if you add a
mode-dependent behaviour, add it to `identity.ts` behind injected config so it can be
proven without a Postgres. New user-scoped routers must be mounted **after**
`api.use(resolveIdentity)` in `index.ts`; mounted before it, `currentUserId()` throws a
loud 500 rather than writing a NULL row. `test:collection` went 34/52 passing to 66/66
(the 14 new tests are the identity suite). The deck-write fix changes cloud behaviour —
from a 500 to a working write — so it warrants a production deploy.

