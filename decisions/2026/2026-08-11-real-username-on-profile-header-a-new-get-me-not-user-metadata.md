---
date: "2026-08-11"
title: "real username on Profile/header: a new `GET /me`, not `user_metadata`"
decided_by: "user (on behalf of @cheyras), after an agent stopped mid-fix to"
areas: ["general"]
supersedes: []
---
## 2026-08-11 — real username on Profile/header: a new `GET /me`, not `user_metadata`

**Decided by:** user (on behalf of @cheyras), after an agent stopped mid-fix to
report a blocker.

**Decision:** issue #25 ("this page just says 'Trainer'") is fixed with a new
authenticated endpoint, `GET /me` (`apps/api/src/routes/me.ts`), returning
`{ username }` read straight from `app_user.username`. `Profile.tsx` and
`AppShell.tsx`'s `ProfileChip` both call it (`api.me()`, sharing the `['me']`
query key) in cloud mode only; self-host keeps the literal `'Trainer'`
fallback unchanged, exactly as before.

**Why:** the obvious-looking fix — read `session.user.user_metadata.username`
straight from the Supabase client, the same way `ChangePassword.tsx` reads
`session.user.email` — turned out to be wrong. Verified against the live
Supabase DB: of 4 real `auth.users` rows, only **1** has
`raw_user_meta_data->>'username'` set at all, and that one is the QA account,
created directly through the Admin API with explicit metadata. The other 3 —
everyone who actually signed up through `/auth?mode=signup`
(`Auth.tsx:93`, `supabase.auth.signUp({ email, password })`, no `options.data`)
— have it empty, because nothing in this codebase has ever written that
metadata key. Shipping the metadata-read version would have passed the QA
account's own browser check (its metadata happens to be set) while showing
blank/`'Trainer'` for real users — a false positive baked into the one
verification step the fix was supposed to prove itself with.

The DB-side value is never empty: migration 021's `handle_new_user()` trigger
does `COALESCE(raw_user_meta_data->>'username', split_part(email, '@', 1))`,
so `app_user.username` is always populated. That fallback only ever ran
server-side, though — it was never echoed back into the JWT/session object the
frontend can read, so the frontend had no way to see it without a route.

**Two fixes were possible; the endpoint was chosen over a direct client
read.** `supabase.from('app_user').select('username')...` would have worked
today, licensed by the existing `app_user_select` RLS policy (migration 021)
— zero backend changes. It was rejected: `apps/api` is this codebase's
explicit shared abstraction layer between cloud (Supabase) and self-host
(plain Postgres) — every other cloud/self-host difference (images, DB
connection, auth) is hidden behind it, never branched on in the frontend
(AGENTS.md's architecture table). A direct `supabase.from(...)` call would
have been the first of its kind in `apps/web/src` (confirmed zero existing
call sites) and is meaningless on self-host, which has no Supabase at all.

**Implications:**
- Any future "read identity from the client" instinct should check
  `app_user.username` (via an API route) rather than Supabase auth metadata —
  the metadata key is decorative, not a source of truth, for any account that
  signed up through this app's own form.
- Verifying this locally against the real cloud DB needed a working `/api/*`
  path, which `pnpm --filter deckpal-web dev` alone does not provide (no
  Vite proxy for `/api`, only `/deckpal/api`). `vercel dev` is the
  documented way, but its local function runtime resolves DB credentials
  opaquely (Preview/Production env vars are marked Sensitive and unreadable
  even via `vercel env pull`; "development"-scoped vars were empty) and a
  `SET LOCAL role = 'anon'` call that succeeds identically via `psql` on the
  same credentials failed inside it with `permission denied to set role
  "anon"` for reasons that were not resolved. Verification instead ran
  `apps/api` standalone (`API_BASE_PATH=/api`, explicit `.env.cloud` PG*
  vars) behind a temporary (reverted before commit) Vite proxy.
- **A separate, pre-existing bug surfaced during that verification, out of
  scope here and not fixed:** `routes/insights.ts:31`'s `/insights/overview`
  handler runs `Promise.all([currentCollectionValue(userId),
  dexCompletion(userId)])` — two queries concurrently on the one
  `PoolClient` a request's AsyncLocalStorage-scoped RLS transaction holds
  (`index.ts`'s per-request middleware). `pg` logs "Calling client.query()
  when the client is already executing a query is deprecated" for this, and
  under a persistent single-process local run it wedged the pool permanently
  (every subsequent request timed out acquiring a connection, even minutes
  later, even for unrelated routes). Confirmed a real race and not a testing
  artifact: a single, isolated, sequential `GET /me` request against the same
  fresh process succeeded cleanly every time, which is what isolated the
  cause to that one route. Worth a look at whether Vercel's Fluid Compute
  warm-instance reuse can hit the same race in production under concurrent
  load from one user.

_Filed by agent on behalf of @cheyras — 2026-08-11._

