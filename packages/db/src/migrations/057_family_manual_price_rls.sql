-- @supabase-only
-- 057 · Proposer/admin moderation visibility for family manual prices.

ALTER TABLE family_price_suggestion ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_price_suggestion_select ON family_price_suggestion FOR SELECT
  USING (
    (status = 'approved' AND is_active_family_member(family_id, (SELECT auth.uid())))
    OR proposed_by = (SELECT auth.uid())
    OR is_family_admin(family_id, (SELECT auth.uid()))
  );

CREATE POLICY family_price_suggestion_insert ON family_price_suggestion FOR INSERT
  WITH CHECK (
    proposed_by = (SELECT auth.uid())
    AND status = 'pending'
    AND is_active_family_member(family_id, (SELECT auth.uid()))
  );

-- No direct UPDATE/DELETE policy: decisions must pass through the validated
-- security-definer moderation function, preserving the audit trail.
