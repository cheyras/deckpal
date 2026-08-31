-- 052 · Invitation-only family boundary.
-- A user belongs to at most one family. Collection visibility is added by 053;
-- this platform-neutral migration only defines data and helper semantics.

CREATE TABLE family (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_by UUID NOT NULL UNIQUE REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE family_member (
  family_id UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status    TEXT NOT NULL DEFAULT 'invited'
            CHECK (status IN ('invited', 'active', 'disabled')),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id),
  UNIQUE (user_id)
);

CREATE TABLE family_invitation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  invited_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  email           TEXT NOT NULL CHECK (length(trim(email)) BETWEEN 3 AND 320),
  role            TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by      UUID NOT NULL REFERENCES app_user(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

CREATE INDEX family_member_user_status_idx
  ON family_member (user_id, status);
CREATE INDEX family_invitation_family_status_idx
  ON family_invitation (family_id, status);
CREATE UNIQUE INDEX family_invitation_one_pending_email_idx
  ON family_invitation (family_id, lower(email)) WHERE status = 'pending';

CREATE FUNCTION same_active_family(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM family_member left_member
    JOIN family_member right_member
      ON right_member.family_id = left_member.family_id
    WHERE left_member.user_id = a
      AND right_member.user_id = b
      AND left_member.status = 'active'
      AND right_member.status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION same_active_family(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION same_active_family(UUID, UUID) TO authenticated;
