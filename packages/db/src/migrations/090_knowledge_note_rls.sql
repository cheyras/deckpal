-- @supabase-only
-- 090 · Row-Level Security policies for knowledge notes (089, which already turned RLS on with no policy).
--
-- ONLY runs on Supabase (the runner skips this file unless SUPABASE_MODE is set). Self-host has no auth schema;
-- there, every query's own `status = 'approved' OR proposed_by = $1` is the access-control layer.
--
-- Every signed-in account reads APPROVED notes, and its own proposals in any state. There is no INSERT, UPDATE or
-- DELETE policy: a note is stored only by knowledge_note_propose() and decided only by knowledge_note_review() (089),
-- so a client calling Supabase directly cannot skip the limits and checks they enforce. Plus the restrictive
-- suspended-account predicate 065 put on every per-user table.

ALTER TABLE public.knowledge_note ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_note_read ON public.knowledge_note FOR SELECT TO authenticated
  USING (status = 'approved' OR proposed_by = (SELECT auth.uid())::text);

CREATE POLICY admin_active_account ON public.knowledge_note AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.admin_current_account_active())
  WITH CHECK (public.admin_current_account_active());
