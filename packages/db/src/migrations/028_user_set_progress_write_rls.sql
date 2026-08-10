-- @supabase-only
-- ─────────────────────────────────────────────────────────────────────────────
-- 028 — user_set_progress: add the missing INSERT/UPDATE policies.
--
-- Migration 021 enabled RLS on every per-user table but gave
-- user_set_progress only a SELECT policy. That table is not user-authored in
-- the usual sense — it is a derived cache that recomputeSetProgress()
-- (apps/api/src/db.ts) rewrites with INSERT … ON CONFLICT DO UPDATE inside
-- every collection mutation. Under RLS with no INSERT/UPDATE policy Postgres
-- rejected that write with 42501, so EVERY collection write (increment,
-- decrement, set-quantity, have-toggle) returned 500 on the cloud deployment
-- while the UI painted an optimistic count and then reverted.
--
-- Found by a production audit on 2026-08-10; see DECISIONS.md. The shape below
-- mirrors collection_item's own-row policy: the subselect form of auth.uid()
-- (021's established pattern, ~95% faster than the bare call), and WITH CHECK
-- on both statements so a user can neither insert nor retarget a row onto
-- another user_id.
--
-- Self-host is unaffected (no RLS, no auth schema) — hence @supabase-only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY user_set_progress_insert ON user_set_progress
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY user_set_progress_update ON user_set_progress
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- No DELETE policy on purpose: nothing in the app deletes progress rows; the
-- recompute path only upserts. Add one deliberately if that ever changes.
