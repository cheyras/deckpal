-- 056 · Family-owned manual price suggestions and moderation history.
-- Automatic marketplace price tables remain untouched.

CREATE TABLE family_price_suggestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES family(id) ON DELETE CASCADE,
  card_variant_id BIGINT NOT NULL REFERENCES card_variant(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES app_user(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency_code CHAR(3) NOT NULL REFERENCES currency(code),
  source_name TEXT NOT NULL CHECK (length(trim(source_name)) BETWEEN 1 AND 80),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 1000),
  condition TEXT NOT NULL CHECK (condition IN ('NM','LP','MP','HP','DMG')),
  observed_on DATE NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','superseded')),
  decided_by UUID REFERENCES app_user(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((status = 'pending') = (decided_by IS NULL))
);

CREATE INDEX family_price_suggestion_inbox_idx
  ON family_price_suggestion (family_id, status, created_at DESC);
CREATE INDEX family_price_suggestion_card_idx
  ON family_price_suggestion (family_id, card_variant_id, observed_on DESC);
CREATE UNIQUE INDEX family_price_suggestion_one_approved
  ON family_price_suggestion (family_id, card_variant_id, condition, currency_code)
  WHERE status = 'approved';

CREATE FUNCTION moderate_family_price(
  p_suggestion_id UUID,
  p_actor UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS family_price_suggestion
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target family_price_suggestion%ROWTYPE;
  session_actor UUID;
BEGIN
  -- SECURITY DEFINER must never trust an identity supplied as an RPC argument.
  -- PostgREST and deckpal-api both bind the verified JWT subject in this
  -- transaction-local setting before an authenticated query runs.
  BEGIN
    session_actor := NULLIF(
      COALESCE(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'sub',
      ''
    )::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_auth_claims' USING ERRCODE = '42501';
  END;
  IF session_actor IS NULL OR session_actor <> p_actor THEN
    RAISE EXCEPTION 'moderation_actor_mismatch' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_price_decision' USING ERRCODE = 'P0001';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'decision_note_too_long' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO target FROM family_price_suggestion
   WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'price_suggestion_not_found' USING ERRCODE = 'P0001'; END IF;
  IF target.status <> 'pending' THEN RAISE EXCEPTION 'price_suggestion_already_decided' USING ERRCODE = 'P0001'; END IF;
  IF NOT is_family_admin(target.family_id, p_actor) THEN
    RAISE EXCEPTION 'family_admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'approved' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      target.family_id::text || ':' || target.card_variant_id::text || ':' || target.condition || ':' || target.currency_code,
      0
    ));
    UPDATE family_price_suggestion SET
      status = 'superseded', decided_by = p_actor, decided_at = now(),
      decision_note = COALESCE(decision_note, 'Replaced by a newer approved family price')
    WHERE family_id = target.family_id
      AND card_variant_id = target.card_variant_id
      AND condition = target.condition
      AND currency_code = target.currency_code
      AND status = 'approved';
  END IF;

  UPDATE family_price_suggestion SET
    status = p_decision, decided_by = p_actor, decided_at = now(), decision_note = NULLIF(trim(p_note), '')
  WHERE id = target.id
  RETURNING * INTO target;
  RETURN target;
END
$$;

REVOKE ALL ON FUNCTION moderate_family_price(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION moderate_family_price(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION moderate_family_price(UUID, UUID, TEXT, TEXT) TO service_role;
