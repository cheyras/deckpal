---
date: "2026-08-10"
title: "028: `user_set_progress` had RLS on and no write policy; every collection write 500'd on cloud"
decided_by: "agent on behalf of @cheyras (gap reported by the user through the"
areas: ["security","catalog"]
supersedes: []
---
## 2026-08-10 — 028: `user_set_progress` had RLS on and no write policy; every collection write 500'd on cloud
**Decided by:** agent on behalf of @cheyras (gap reported by the user through the
in-app bug reporter as issues #18 and #19).

**Decision:** migration **028_user_set_progress_write_rls** (`@supabase-only`)
adds the INSERT and UPDATE policies migration 021 never wrote.

```sql
CREATE POLICY user_set_progress_insert ON user_set_progress
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY user_set_progress_update ON user_set_progress
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
                              WITH CHECK ((SELECT auth.uid()) = user_id);
```

**Why it broke.** 021 enabled RLS on `user_set_progress` and gave it a SELECT
policy only — the table reads as derived cache, not user-authored data, so the
write side was never written. But the cache is rewritten *by the user's own
request*: `recomputeSetProgress()` (apps/api/src/db.ts) runs
`INSERT … ON CONFLICT DO UPDATE` on it inside the same transaction as every
collection mutation, and that transaction runs as `authenticated` (the
`SET LOCAL role` middleware in apps/api/src/index.ts). An RLS-enabled table with
no INSERT policy rejects the statement — SQLSTATE **42501**, *new row violates
row-level security policy* — so increment, decrement, set-quantity and the
have/need toggle all returned 500. The UI painted its optimistic count, the
request failed, the count reverted. Exactly what #18/#19 described.

WITH CHECK on both statements (not just INSERT) so a user can neither insert nor
retarget a progress row onto another `user_id`; the subselect form of
`auth.uid()` because that is 021's established pattern. No DELETE policy —
nothing in the app deletes progress rows.

**DB-only, no deploy.** Not assumed — checked: neither `vercel.json`'s build
command nor `api/index.mjs` runs the migration CLI, and `apps/api/src/db.ts` and
`apps/api/src/routes/collection.ts` are byte-identical to what was already
deployed during the outage. The fix is the two `CREATE POLICY` statements and
nothing else.

**Verification (production, throwaway confirmed Supabase user, real password-grant
JWT, deleted afterwards).** Every write path returned 2xx *and* was read back in a
separate request, because a 200 was never the thing in doubt: increment +1 → 1,
+2 → 3, −1 → 2 (variant 15); set-quantity 5 → 5 then 0 → 0 (variant 231);
have=true → 1 then have=false → 0 (card base1-25); a second variant of the same
card (16) → 1. `/sets/base1` then reported complete 1/102, master 1/103,
grandmaster 2/409, and `POST /collection/reconcile` returned 200. Three
`user_set_progress` rows (one per goal) confirmed in psql for that user — the
table that was failing. Browser (Playwright, 428×781, the `/series/mega-evolution/me05`
page from the report): signed in, tapped a variant counter, 200 on
`POST /api/collection/variants/37183/increment`, chip went 0 → **1** and stayed
through a hard reload; zero console errors, zero ≥400 responses on `/api/`.

**Counterfactual, run as `authenticated` inside rolled-back transactions:** an
INSERT into a table in exactly the pre-028 state (RLS on, SELECT policy only)
raises `new row violates row-level security policy`; an INSERT into
`user_set_progress` for *another* `user_id` is rejected; the same INSERT for the
caller's own id succeeds. The diagnosis is the mechanism, not a correlation.

**Sibling audit — RLS on, write policy missing, anywhere else?** The blast radius
is only code that runs as `authenticated`: the Express API's per-request RLS
context and the MCP server's identical `withUserContext`. Everything else (sync,
apps/images, the phash indexer, the migration runner) connects as `postgres`,
which is `rolbypassrls = t`. Findings: `collection_event` (INSERT+SELECT) is only
ever inserted — append-only holds. `bug_report` (INSERT+SELECT) *is* updated, to
stamp the GitHub issue number, and `routes/bugs.ts` already `RESET ROLE`s onto the
BYPASSRLS pool role on the same client to do it — deliberate, and correct.
`user_profile` (SELECT+UPDATE, no INSERT) and `app_user` (SELECT only) are never
inserted by application code at all; both rows come from the `handle_new_user`
signup trigger, which is SECURITY DEFINER owned by `postgres`. The
`price_observation_*` partitions carry RLS with no policies, but nothing queries a
partition directly — reads go through the parent, which has one. **No second live
instance of this bug; no further migration needed.** The latent shape to remember:
if a code path ever inserts a `user_profile` row outside the trigger, it will 42501
the same way this did.

