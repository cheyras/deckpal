-- @supabase-only
-- 055 · Members see their own metering; family admins see aggregate usage.

ALTER TABLE family_ai_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_ai_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scan_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_ai_setting_select ON family_ai_setting FOR SELECT
  USING (is_active_family_member(family_id, (SELECT auth.uid())));
CREATE POLICY family_ai_setting_admin_insert ON family_ai_setting FOR INSERT
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));
CREATE POLICY family_ai_setting_admin_update ON family_ai_setting FOR UPDATE
  USING (is_family_admin(family_id, (SELECT auth.uid())))
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));

CREATE POLICY member_ai_limit_select ON member_ai_limit FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR is_family_admin(family_id, (SELECT auth.uid()))
  );
CREATE POLICY member_ai_limit_admin_insert ON member_ai_limit FOR INSERT
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));
CREATE POLICY member_ai_limit_admin_update ON member_ai_limit FOR UPDATE
  USING (is_family_admin(family_id, (SELECT auth.uid())))
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));

CREATE POLICY ai_scan_event_select ON ai_scan_event FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR is_family_admin(family_id, (SELECT auth.uid()))
  );

-- Writes are intentionally absent. Only the service-role RPCs from migration
-- 054 may reserve or finalize paid calls.
