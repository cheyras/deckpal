-- @supabase-only
-- 088 · Row-Level Security for recently deleted battle logs (087).
--
-- ONLY runs on Supabase (the runner skips this file unless SUPABASE_MODE is
-- set). Self-host has no auth schema; there, every query's own
-- `WHERE user_id = $1` is the access-control layer, as for every other table.
--
-- The same shape as battle_log's own policy (021) — full CRUD on own rows,
-- with the `(SELECT auth.uid())` initplan wrapper — plus the restrictive
-- suspended-account predicate 065 put on every per-user table.

ALTER TABLE public.battle_log_bin ENABLE ROW LEVEL SECURITY;

CREATE POLICY battle_log_bin_own ON public.battle_log_bin
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY admin_active_account ON public.battle_log_bin AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.admin_current_account_active())
  WITH CHECK (public.admin_current_account_active());
