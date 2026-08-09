-- @supabase-only
-- 023 · RLS policies for bug_report.
-- Own-row SELECT + INSERT for authenticated users; service_role has BYPASSRLS
-- so no explicit write policies are needed for the API's server-side token path.
--
-- Depends on: 022_bug_report (bug_report table exists).
-- Policy style matches 021_rls_policies (auth.uid() wrapped in (SELECT ...)).

ALTER TABLE bug_report ENABLE ROW LEVEL SECURITY;

CREATE POLICY bug_report_select ON bug_report
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY bug_report_insert ON bug_report
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
