-- @supabase-only
-- 090 · Row-Level Security for knowledge notes (089).
--
-- ONLY runs on Supabase (the runner skips this file unless SUPABASE_MODE is set). Self-host has no auth schema;
-- there, every query's own `status = 'approved' OR proposed_by = $1` is the access-control layer.
--
-- Every signed-in account reads APPROVED notes, and its own proposals in any state. It may insert only its own,
-- pending, unreviewed note. Nobody updates or deletes through a table policy: a decision goes through
-- knowledge_note_review() (089), which checks the knowledge.review permission. Plus the restrictive
-- suspended-account predicate 065 put on every per-user table.

ALTER TABLE public.knowledge_note ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_note_read ON public.knowledge_note FOR SELECT TO authenticated
  USING (status = 'approved' OR proposed_by = (SELECT auth.uid())::text);

CREATE POLICY knowledge_note_propose ON public.knowledge_note FOR INSERT TO authenticated
  WITH CHECK (proposed_by = (SELECT auth.uid())::text AND status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL);

CREATE POLICY admin_active_account ON public.knowledge_note AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.admin_current_account_active())
  WITH CHECK (public.admin_current_account_active());
