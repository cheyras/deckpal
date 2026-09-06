-- @supabase-only
-- 062 · Dedupe and bound what an account can write into the experiment.
--
-- Two changes to `billing_record_ab_event`, both closing holes 058 left open.
--
-- ── 1. THE DEDUPE KEY (see 061) ────────────────────────────────────────────
--
-- Events that name a specific Stripe object carry its id, and a second write of
-- the same id is dropped rather than raising. `ON CONFLICT DO NOTHING` is
-- deliberate: the caller is `/one-time/confirm`, which is retried by the
-- browser after a network wobble, and a retry that already succeeded should look
-- like success. The route's own response does not depend on the insert.
--
-- ── 2. A DAILY CEILING ─────────────────────────────────────────────────────
--
-- 058 capped the AMOUNT one event may claim; it did not cap how MANY an account
-- may write. Since the function is `GRANT EXECUTE … TO authenticated` and
-- therefore reachable at `/rest/v1/rpc/…` with the anon key the SPA ships, one
-- account could post ten thousand `shown` events and move its arm's denominator
-- at will.
--
-- 200 a day is roughly two orders of magnitude above what the product itself
-- generates: a real reader produces an exposure and an answer per prompt, and
-- prompts are monthly. The ceiling is not a security boundary — a determined
-- account can still post 200 — it is the difference between noise a human would
-- notice in the data and silent, unbounded fabrication.
--
-- The ceiling DROPS the event rather than raising. A raise would abort the
-- caller's transaction, which in SUPABASE_MODE is the whole request — the API
-- swallows the JavaScript error but Postgres does not un-abort, so a gift could
-- be charged at Stripe and have its database side rolled back behind a 502.
-- (`store.ts` also takes a savepoint around the call, which covers the two
-- guards above, both of which do raise and should: they can only be reached by
-- a caller sending something the API itself would never send.)
--
-- ── WHY THE OLD SIGNATURE IS DROPPED ───────────────────────────────────────
--
-- ⚠️ `CREATE OR REPLACE FUNCTION` with a different argument count creates an
-- OVERLOAD, not a replacement. Leaving the 3-argument version in place would
-- leave it granted to `authenticated` and would leave BOTH new guards trivially
-- bypassable by calling the older name. It is dropped first, and the API's
-- three-positional-argument call resolves to the new function through its
-- default.

DROP FUNCTION IF EXISTS public.billing_record_ab_event(text, text, integer);

CREATE OR REPLACE FUNCTION public.billing_record_ab_event(
  p_kind    text,
  p_context text,
  p_amount  integer DEFAULT NULL,
  p_dedupe  text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     uuid := (SELECT auth.uid());
  v_arm   text;
  v_today integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'billing_record_ab_event: no authenticated user';
  END IF;

  -- Mirrors SUPPORT_MAX_CENTS. See 058: refused, not clamped.
  IF p_amount IS NOT NULL AND (p_amount < 0 OR p_amount > 50000) THEN
    RAISE EXCEPTION 'billing_record_ab_event: amount % is outside 0..50000', p_amount;
  END IF;

  IF p_kind NOT IN ('shown', 'chose', 'dismissed', 'chose_one_time') THEN
    RAISE EXCEPTION 'billing_record_ab_event: unknown kind %', p_kind;
  END IF;

  SELECT count(*) INTO v_today
    FROM public.billing_ab_event
   WHERE user_id = uid AND created_at > now() - interval '1 day';
  IF v_today >= 200 THEN
    -- ⚠️ RETURN, NOT RAISE. A raise here aborts the caller's whole transaction
    -- (25P02), and in SUPABASE_MODE that transaction is the entire request —
    -- so an account that had deliberately spammed itself past the ceiling could
    -- then make a gift, have Stripe charge it, and have every database write in
    -- that request rolled back behind a 502. The API takes a savepoint around
    -- this call as well; both are wanted, because the two guards above DO raise
    -- and should, and this one is the only ceiling a legitimate caller could
    -- ever brush against.
    RAISE WARNING 'billing_record_ab_event: ceiling reached, dropping event';
    RETURN;
  END IF;

  SELECT ab_presets INTO v_arm FROM public.billing_account WHERE user_id = uid;
  IF v_arm IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.billing_ab_event (user_id, variant, kind, amount_cents, context, dedupe_key)
  VALUES (uid, v_arm, p_kind, p_amount, left(coalesce(p_context, 'unknown'), 40), left(p_dedupe, 80))
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_record_ab_event(text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_record_ab_event(text, text, integer, text) TO authenticated;
