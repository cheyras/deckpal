-- @supabase-only
-- 058 · Cap what an account can write into the experiment.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE HOLE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `billing_record_ab_event` is `GRANT EXECUTE … TO authenticated` (056), and on
-- Supabase that means it is reachable at `/rest/v1/rpc/billing_record_ab_event`
-- by anyone holding the anon key — which is compiled into the SPA by design —
-- plus their own JWT.
--
-- 056 was careful about the one input that would be catastrophic: the ARM is
-- read from the caller's own row and is not a parameter, so nobody can label
-- themselves into the other side. But `amount_cents` was passed straight
-- through to a column whose only constraint is `>= 0` (055), so any account
-- could post `kind='chose', amount_cents=2147483647` and single-handedly
-- decide the experiment. That is not a money hole — no charge results — but it
-- destroys the measurement 056's own header says it exists to protect, and it
-- keeps working in LIVE mode, where the UI-level testing override is off.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE CAP IS THE PRODUCT'S OWN CEILING, NOT AN ARBITRARY NUMBER
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 50000 (i.e. $500) is `SUPPORT_MAX_CENTS` in `apps/api/src/billing/stripe.ts`:
-- the most this product will ever charge anybody in a month. An event claiming
-- more than the API would accept cannot correspond to a real answer, so it is
-- refused rather than clamped — a clamped value looks like data and a rejected
-- call looks like what it is.
--
-- The function still cannot be trusted to be called only by our own API, which
-- is exactly why the check lives HERE and not in the route.

CREATE OR REPLACE FUNCTION public.billing_record_ab_event(
  p_kind    text,
  p_context text,
  p_amount  integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     uuid := (SELECT auth.uid());
  v_arm   text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'billing_record_ab_event: no authenticated user';
  END IF;

  -- Mirrors SUPPORT_MAX_CENTS. See the header: refused, not clamped.
  IF p_amount IS NOT NULL AND (p_amount < 0 OR p_amount > 50000) THEN
    RAISE EXCEPTION 'billing_record_ab_event: amount % is outside 0..50000', p_amount;
  END IF;

  -- The kinds 055/057 define, checked here as well as by the column constraint
  -- so an unknown kind fails with a sentence rather than a constraint name.
  IF p_kind NOT IN ('shown', 'chose', 'dismissed', 'chose_one_time') THEN
    RAISE EXCEPTION 'billing_record_ab_event: unknown kind %', p_kind;
  END IF;

  SELECT ab_presets INTO v_arm FROM public.billing_account WHERE user_id = uid;
  IF v_arm IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.billing_ab_event (user_id, variant, kind, amount_cents, context)
  VALUES (uid, v_arm, p_kind, p_amount, left(coalesce(p_context, 'unknown'), 40));
END;
$$;

REVOKE ALL ON FUNCTION public.billing_record_ab_event(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_record_ab_event(text, text, integer) TO authenticated;
