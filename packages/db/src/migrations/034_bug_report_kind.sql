-- 034 · Add `kind` to bug_report — bug vs feature request (issue #32).
-- Default 'bug' preserves the meaning of existing rows and of any client
-- (self-host, or a stale cached frontend bundle) that doesn't send the field
-- at all — this is an additive classification, not a breaking requirement.
--
-- Depends on: 022_bug_report (bug_report table exists).
-- No RLS changes needed: 023_bug_report_rls policies are row-scoped
-- (user_id = auth.uid()), not column-scoped — a new column is visible under
-- the existing SELECT/INSERT policies without modification.

ALTER TABLE bug_report
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'bug'
    CHECK (kind IN ('bug', 'feature'));
