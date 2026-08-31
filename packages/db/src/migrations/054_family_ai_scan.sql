-- 054 · Metered, per-member AI card recognition.
-- Events store usage metadata and validated candidate summaries only.

CREATE TABLE family_ai_setting (
  family_id UUID PRIMARY KEY REFERENCES family(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_daily_limit SMALLINT NOT NULL DEFAULT 5
    CHECK (default_daily_limit BETWEEN 0 AND 100),
  warning_percent SMALLINT NOT NULL DEFAULT 80
    CHECK (warning_percent BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE member_ai_limit (
  family_id UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  daily_limit SMALLINT CHECK (daily_limit BETWEEN 0 AND 100),
  bonus_remaining SMALLINT NOT NULL DEFAULT 0
    CHECK (bonus_remaining BETWEEN 0 AND 1000),
  PRIMARY KEY (family_id, user_id),
  UNIQUE (user_id)
);

CREATE TABLE ai_scan_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  family_id UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed')),
  used_bonus BOOLEAN NOT NULL DEFAULT FALSE,
  model TEXT,
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  estimated_cost_microusd BIGINT CHECK (estimated_cost_microusd >= 0),
  failure_code TEXT,
  candidate_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX ai_scan_event_user_day_idx
  ON ai_scan_event (user_id, usage_day, status, created_at DESC);
CREATE INDEX ai_scan_event_family_day_idx
  ON ai_scan_event (family_id, usage_day, status);

CREATE FUNCTION reserve_ai_scan(
  p_family_id UUID,
  p_user_id UUID,
  p_request_id UUID DEFAULT gen_random_uuid()
)
RETURNS TABLE (
  reservation_id UUID,
  request_id UUID,
  event_status TEXT,
  quota_limit INTEGER,
  used INTEGER,
  bonus_remaining INTEGER,
  remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_enabled BOOLEAN;
  v_limit INTEGER;
  v_bonus INTEGER;
  v_used INTEGER;
  v_use_bonus BOOLEAN := FALSE;
  v_existing ai_scan_event%ROWTYPE;
  v_stale_bonus INTEGER;
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_day::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM family_member
     WHERE family_id = p_family_id AND user_id = p_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'inactive_family_member' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(fas.enabled, TRUE),
         COALESCE(mal.daily_limit, fas.default_daily_limit, 5),
         COALESCE(mal.bonus_remaining, 0)
    INTO v_enabled, v_limit, v_bonus
    FROM (SELECT 1) seed
    LEFT JOIN family_ai_setting fas ON fas.family_id = p_family_id
    LEFT JOIN member_ai_limit mal
      ON mal.family_id = p_family_id AND mal.user_id = p_user_id;

  IF NOT v_enabled THEN
    RAISE EXCEPTION 'family_ai_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM ai_scan_event WHERE ai_scan_event.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.family_id <> p_family_id OR v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'request_id_conflict' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*)::INTEGER INTO v_used
      FROM ai_scan_event
     WHERE user_id = p_user_id AND usage_day = v_day
       AND (status = 'succeeded' OR (status = 'reserved' AND created_at > now() - interval '5 minutes'));
    RETURN QUERY SELECT v_existing.id, v_existing.request_id, v_existing.status,
      v_limit, v_used, v_bonus, GREATEST(v_limit - v_used, 0) + v_bonus;
    RETURN;
  END IF;

  WITH stale AS (
    UPDATE ai_scan_event
       SET status = 'failed', failure_code = 'reservation_expired', finished_at = now()
     WHERE user_id = p_user_id AND usage_day = v_day AND status = 'reserved'
       AND created_at <= now() - interval '5 minutes'
     RETURNING used_bonus
  ) SELECT count(*) FILTER (WHERE used_bonus)::INTEGER INTO v_stale_bonus FROM stale;

  IF COALESCE(v_stale_bonus, 0) > 0 THEN
    INSERT INTO member_ai_limit (family_id, user_id, bonus_remaining)
    VALUES (p_family_id, p_user_id, v_stale_bonus)
    ON CONFLICT (family_id, user_id) DO UPDATE
      SET bonus_remaining = member_ai_limit.bonus_remaining + EXCLUDED.bonus_remaining;
    v_bonus := v_bonus + v_stale_bonus;
  END IF;

  SELECT count(*)::INTEGER INTO v_used
    FROM ai_scan_event
   WHERE user_id = p_user_id AND usage_day = v_day
     AND (status = 'succeeded' OR (status = 'reserved' AND created_at > now() - interval '5 minutes'));

  IF v_used >= v_limit THEN
    IF v_bonus <= 0 THEN
      RAISE EXCEPTION 'quota_exhausted' USING ERRCODE = 'P0001';
    END IF;
    UPDATE member_ai_limit SET bonus_remaining = bonus_remaining - 1
     WHERE family_id = p_family_id AND user_id = p_user_id;
    v_bonus := v_bonus - 1;
    v_use_bonus := TRUE;
  END IF;

  INSERT INTO ai_scan_event
    (request_id, family_id, user_id, usage_day, status, used_bonus)
  VALUES
    (p_request_id, p_family_id, p_user_id, v_day, 'reserved', v_use_bonus)
  RETURNING id INTO v_id;

  v_used := v_used + 1;
  RETURN QUERY SELECT v_id, p_request_id, 'reserved'::TEXT, v_limit, v_used,
    v_bonus, GREATEST(v_limit - v_used, 0) + v_bonus;
END
$$;

CREATE FUNCTION finish_ai_scan(
  p_reservation_id UUID,
  p_model TEXT,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_estimated_cost_microusd BIGINT,
  p_candidate_summary JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH changed AS (
    UPDATE ai_scan_event SET
      status = 'succeeded', model = p_model,
      input_tokens = GREATEST(p_input_tokens, 0),
      output_tokens = GREATEST(p_output_tokens, 0),
      estimated_cost_microusd = GREATEST(p_estimated_cost_microusd, 0),
      candidate_summary = p_candidate_summary,
      finished_at = now()
    WHERE id = p_reservation_id AND status = 'reserved'
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM changed)
$$;

CREATE FUNCTION fail_ai_scan(p_reservation_id UUID, p_failure_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family UUID;
  v_user UUID;
  v_bonus BOOLEAN;
BEGIN
  UPDATE ai_scan_event SET
    status = 'failed', failure_code = left(p_failure_code, 80), finished_at = now()
  WHERE id = p_reservation_id AND status = 'reserved'
  RETURNING family_id, user_id, used_bonus INTO v_family, v_user, v_bonus;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_bonus THEN
    UPDATE member_ai_limit SET bonus_remaining = bonus_remaining + 1
     WHERE family_id = v_family AND user_id = v_user;
  END IF;
  RETURN TRUE;
END
$$;

REVOKE ALL ON FUNCTION reserve_ai_scan(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION finish_ai_scan(UUID, TEXT, INTEGER, INTEGER, BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_ai_scan(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_ai_scan(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION finish_ai_scan(UUID, TEXT, INTEGER, INTEGER, BIGINT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fail_ai_scan(UUID, TEXT) TO service_role;
