---
date: "2026-09-26"
title: "Disclosure: every user's collection was readable with the anon key, from migration 020 until 072"
decided_by: "Chey (via Claude)"
areas: ["data"]
supersedes: []
---
## 2026-09-26 — Disclosure: every user's collection was readable with the anon key, from migration 020 until 072

**Decided by:** Chey (via Claude)

**Decision:** Treat `collection_dupe_predicate` as a data disclosure, not a
cleanup. Migration 072 drops the view, makes every remaining view
`security_invoker`, and closes two neighbouring holes of the same kind found by
the same audit (SEC-02 and SEC-10). The fastest mitigation, one
`DROP VIEW IF EXISTS public.collection_dupe_predicate;` in the Supabase SQL
editor, goes first, before the PR is merged, because the leak is live until
something removes the view.

**What leaked, to whom, since when.**
- *What:* for every account that owned a card, one row per card: `user_id`,
  `card_id`, and whether they owned two or more copies. No quantities beyond
  that, no variants, no emails. `user_id` joins to the world-readable
  `user_profile`, so a row maps to a display name and avatar.
- *To whom:* anyone holding the anon key. That key is public by design (the
  SPA bundle and `GET /api/public-config`), so in practice: anyone on the
  internet who looked at `/rest/v1/collection_dupe_predicate`.
- *Since when:* migration 020 (commit `3f4bb1fc`, 2026-08-09) recreated the
  view as a plain, owner-rights view over `collection_item`, and 021 put the
  project on Supabase with RLS and PostgREST in the same commit. The exposure
  starts when 020/021 were applied to production:
  `SELECT applied_at FROM schema_migrations WHERE version = '020_multi_user_uuid'`.
  It ends when the view is dropped.
- *Measured:* a count-only `HEAD` with the anon key, which returns a row count
  and never rows, on 2026-09-26 at 19:06 UTC: `collection_item` answered
  `*/0` (RLS working), `collection_dupe_predicate` answered `206` with
  `content-range: 0-999/1549`. That is 1,549 (user, card) rows across the 10
  accounts `user_profile` counted at the same moment.
- *Not known:* whether anyone read it. The Supabase API logs are the only
  record: Logs Explorer, the API/edge logs, filtered on a path containing
  `collection_dupe_predicate`, over the longest retention the plan keeps. A
  window shorter than the exposure can show that someone read it, never that
  nobody did.

**Why it happened.** A Postgres view runs with its owner's rights unless it
says `security_invoker = true`. The owner is the migration role, which owns
`collection_item` and is never subject to its RLS, and Supabase's default
privileges granted SELECT on the new view to `anon`. The view dated from the
single-user schema (009), where that did not matter. Nothing read it, and
ARCHITECTURE.md stated the opposite of the truth ("reads through the RLS'd
`collection_item` table and works correctly"), so it went unexamined for seven
weeks.

**The same question, answered badly twice more** (what can a user do directly
over PostgREST, around the API):
- **SEC-02.** `user_profile`'s own-row UPDATE policy had no column list, so a
  user could point their `avatar_path` at another user's object key and call
  `DELETE /api/avatar`, which deletes whatever the caller's row names with the
  service key. Fixed in the database: a partial unique index (a key belongs to
  one profile), and `authenticated` may write only the four avatar columns the
  API writes. The API needs no change, and the same grants stop a user
  rewriting their public stats or display name.
- **SEC-10.** A user could PATCH `api_token.revoked_at` back to NULL, undoing
  an administrator's revoke; a trigger now makes revocation final and a token's
  identity columns immutable for every writer. The independent review found
  the same result reachable by deleting the revoked row and inserting its hash
  again, so client roles also lose DELETE on `api_token` (nothing in the app
  deletes a token as the user; account deletion still cascades as the owner).
  And `deck_card`, `deck_version`,
  `battle_log` and `binder_placement` referenced their parent by id alone, and a
  foreign-key check ignores RLS, so a user who knew another user's deck or list
  item id could plant rows under it that the owner could neither see nor get
  past. They now reference `(id, user_id)`, the shape `list_item` has had since
  020. `binder_placement` was not in the audit; the new reach suite's
  enumeration found it.

**Why one migration, and not `@supabase-only`.** The runner skips
`@supabase-only` files when `SUPABASE_MODE` is unset and says only `SKIPPED`,
which is easy to read past on a production run. 072 is plain SQL plus
`pg_roles`-guarded grants (the 064/068 shape), so it applies everywhere and
cannot be passed over. It opens with a preflight that refuses, changing
nothing, if any row already violates the new constraints: such a row can only
come from someone using SEC-02 or SEC-10, so it is evidence to keep rather than
something a migration should clean away.

**How this class stays closed.**
- `packages/db/src/__tests__/migrationLint.test.ts` (CI, pure): any view created
  from 072 on must say `security_invoker = true`, no materialized views in
  `public`, and replaying every migration must leave no owner-rights view.
- `apps/api/src/__integration__/reach.mjs` (the disposable-cluster database
  job, B7): applies every migration with the real runner under Supabase's
  default grants, seeds one row for a user in every per-user table a client
  role can read (and fails if a new table is missing from the seed), then
  asserts that `anon` and a second user reach none of those rows in any table
  or view. A canary definer view proves the enumeration catches the SEC-01
  shape. It also runs the SEC-02/SEC-10 negative cases and the API's own
  avatar and token statements, and applies the whole chain on plain Postgres to
  prove 072 is safe for self-host.

**Implications:**
- A new view must be created `WITH (security_invoker = true)`; a
  `CREATE OR REPLACE VIEW` without the option silently resets it, and the lint
  catches that too.
- A new per-user table that a client role can read must get a row in
  `apps/api/src/__integration__/reach-fixture.sql`, or the database job fails.
- A new write the API makes to `user_profile` as the user needs its column
  added to 072's grant, in a new migration.
- Left as they are, deliberately: `mutation_event`, `collection_event` and
  `mutation_batch` also reference a parent by id alone, but no unique key there
  can be squatted and every reader filters on the caller's own rows, so a
  planted row can only point, not block. Price partitions have no RLS (catalog
  data, and PostgREST does not expose partitions).
