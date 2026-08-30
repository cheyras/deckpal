-- @supabase-only
-- 053 · Family visibility with owner-only collection writes preserved.

CREATE FUNCTION is_active_family_member(target_family UUID, candidate UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM family_member
    WHERE family_id = target_family
      AND user_id = candidate
      AND status = 'active'
  )
$$;

CREATE FUNCTION is_family_admin(target_family UUID, candidate UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM family_member
    WHERE family_id = target_family
      AND user_id = candidate
      AND role = 'admin'
      AND status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION is_active_family_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_family_admin(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_active_family_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_family_admin(UUID, UUID) TO authenticated;

CREATE FUNCTION activate_family_membership()
RETURNS TABLE (family_id UUID, role TEXT, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE family_member fm
     SET status = 'active', joined_at = COALESCE(joined_at, now())
   WHERE fm.user_id = caller AND fm.status = 'invited';

  UPDATE family_invitation fi
     SET status = 'accepted', accepted_at = COALESCE(accepted_at, now())
   WHERE fi.invited_user_id = caller AND fi.status = 'pending';

  RETURN QUERY
  SELECT fm.family_id, fm.role, fm.status
    FROM family_member fm
   WHERE fm.user_id = caller AND fm.status = 'active';
END
$$;

REVOKE ALL ON FUNCTION activate_family_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_family_membership() TO authenticated;

ALTER TABLE family ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_invitation ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_select ON family FOR SELECT
  USING (is_active_family_member(id, (SELECT auth.uid())));
CREATE POLICY family_insert ON family FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid()));
CREATE POLICY family_admin_update ON family FOR UPDATE
  USING (is_family_admin(id, (SELECT auth.uid())))
  WITH CHECK (is_family_admin(id, (SELECT auth.uid())));

CREATE POLICY family_member_select ON family_member FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR same_active_family((SELECT auth.uid()), user_id)
    OR is_family_admin(family_id, (SELECT auth.uid()))
  );
CREATE POLICY family_member_bootstrap_insert ON family_member FOR INSERT
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'admin'
    AND status = 'active'
    AND EXISTS (
      SELECT 1 FROM family
      WHERE family.id = family_id
        AND family.created_by = (SELECT auth.uid())
    )
  );
CREATE POLICY family_member_admin_insert ON family_member FOR INSERT
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));
CREATE POLICY family_member_admin_update ON family_member FOR UPDATE
  USING (is_family_admin(family_id, (SELECT auth.uid())))
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));

CREATE POLICY family_invitation_admin_select ON family_invitation FOR SELECT
  USING (is_family_admin(family_id, (SELECT auth.uid())));
CREATE POLICY family_invitation_admin_insert ON family_invitation FOR INSERT
  WITH CHECK (
    invited_by = (SELECT auth.uid())
    AND is_family_admin(family_id, (SELECT auth.uid()))
  );
CREATE POLICY family_invitation_admin_update ON family_invitation FOR UPDATE
  USING (is_family_admin(family_id, (SELECT auth.uid())))
  WITH CHECK (is_family_admin(family_id, (SELECT auth.uid())));

-- Existing owner-only ALL/INSERT policies remain in force for writes. These
-- additional policies expand SELECT only.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_user_family_select ON app_user FOR SELECT
  USING (same_active_family((SELECT auth.uid()), id));

ALTER TABLE collection_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_item_family_select ON collection_item FOR SELECT
  USING (same_active_family((SELECT auth.uid()), user_id));

ALTER TABLE collection_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_event_family_select ON collection_event FOR SELECT
  USING (same_active_family((SELECT auth.uid()), user_id));

ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY user_profile_read ON user_profile;
CREATE POLICY user_profile_family_select ON user_profile FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR same_active_family((SELECT auth.uid()), user_id)
  );

ALTER TABLE user_showcase ENABLE ROW LEVEL SECURITY;
DROP POLICY user_showcase_read ON user_showcase;
CREATE POLICY user_showcase_family_select ON user_showcase FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR same_active_family((SELECT auth.uid()), user_id)
  );

ALTER TABLE graded_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY graded_card_family_select ON graded_card FOR SELECT
  USING (same_active_family((SELECT auth.uid()), user_id));

ALTER TABLE card_note ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_note_family_select ON card_note FOR SELECT
  USING (same_active_family((SELECT auth.uid()), user_id));

ALTER TABLE user_set_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_set_progress_family_select ON user_set_progress FOR SELECT
  USING (same_active_family((SELECT auth.uid()), user_id));

ALTER TABLE collection_value_point ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_value_point_family_select ON collection_value_point FOR SELECT
  USING (same_active_family((SELECT auth.uid()), user_id));
