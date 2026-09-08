-- @supabase-only
-- 059 · Stop an account repointing its own row at somebody else's Stripe
--       customer, and give the API a way to create its row under RLS.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE HOLE, AND WHY 054's REASONING WAS WRONG
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 054 wrote, of `billing_apply_stripe`:
--
--   "The caller can pass whatever Stripe state it likes and it will only ever
--    land on its own row."
--
-- That is true and it is not sufficient, which is the whole lesson. The
-- function is `GRANT EXECUTE … TO authenticated`, so on Supabase it is callable
-- directly at `/rest/v1/rpc/billing_apply_stripe` with the anon key (compiled
-- into the SPA by design) and any user's JWT. Landing on your own row sounds
-- harmless until you notice what one of those columns IS.
--
-- `stripe_customer_id` is a pointer into somebody's money. Plant a stranger's
-- `cus_…` in your own row and the WEBHOOK — which resolves the account purely
-- by `WHERE stripe_customer_id = $1` — will, on that customer's next event,
-- sync THEIR card brand, last four, expiry and subscription state onto YOUR
-- row, where you can read it. Customer ids are not secrets: they appear in
-- support threads, screenshots and dashboards.
--
-- The routes were never exposed to this (`ensureCustomer` refuses a customer
-- whose `metadata.deckpal_user_id` does not name the caller), which is exactly
-- what made it easy to miss: the guard was in the code path nobody was
-- attacking.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- TWO FIXES, IN TWO PLACES, ON PURPOSE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- This migration is the database half: `stripe_customer_id` may be set ONCE,
-- while it is NULL, and after that only re-asserted to the same value.
--
-- ⚠️ TWO CORRECTIONS TO WHAT THIS HEADER ORIGINALLY CLAIMED. It is unapplied,
-- so B4 permits fixing it in place rather than leaving a wrong sentence for
-- somebody to act on:
--
--   • "the gone case is rare enough to be worth a manual UPDATE by the owner"
--     — no. `ensureCustomer` takes that path by itself when Stripe says the
--     stored customer is deleted, and with only this migration applied it
--     raised "cannot be repointed" on EVERY request while minting a fresh
--     orphan customer each time. Migration 060 adds `billing_release_customer`
--     for exactly that, and `customerFor` calls it.
--
--   • "either fix alone closes the disclosure" — no. 060 permits releasing the
--     column to NULL, so release-then-set is two permitted calls that together
--     reach any customer id no other row holds. The control that closes the
--     disclosure is the ownership check `syncCustomer` and `ensureCustomer` ask
--     of Stripe; THIS PIN IS DEPTH BEHIND IT, making a repoint deliberate,
--     two-step, card-summary-wiping and logged rather than a single silent
--     write. SECURITY.md and `webhook.ts` carry the same account.
--
-- Besides the pin, this migration also clamps `support_cents` to the product's
-- own ceiling; everything else about the function is unchanged.

CREATE OR REPLACE FUNCTION public.billing_apply_stripe(p jsonb)
RETURNS public.billing_account
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  row public.billing_account;
  existing_customer text;
  wanted_customer text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'billing_apply_stripe: no authenticated user';
  END IF;

  INSERT INTO public.billing_account (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- Write-once. A repoint is refused loudly rather than ignored: a caller that
  -- believes it changed the customer and did not would be a worse bug than an
  -- error, and no legitimate flow asks for this.
  IF p ? 'stripe_customer_id' THEN
    SELECT stripe_customer_id INTO existing_customer
      FROM public.billing_account WHERE user_id = uid;
    wanted_customer := NULLIF(p->>'stripe_customer_id', '');
    IF existing_customer IS NOT NULL
       AND wanted_customer IS NOT NULL
       AND wanted_customer <> existing_customer THEN
      RAISE EXCEPTION 'billing_apply_stripe: stripe_customer_id is already set and cannot be repointed';
    END IF;
  END IF;

  UPDATE public.billing_account b SET
    stripe_customer_id   = CASE WHEN p ? 'stripe_customer_id'
                                THEN COALESCE(NULLIF(p->>'stripe_customer_id', ''), b.stripe_customer_id)
                                ELSE b.stripe_customer_id END,
    subscription_id      = CASE WHEN p ? 'subscription_id'
                                THEN NULLIF(p->>'subscription_id', '')
                                ELSE b.subscription_id END,
    subscription_status  = CASE WHEN p ? 'subscription_status'
                                THEN NULLIF(p->>'subscription_status', '')
                                ELSE b.subscription_status END,
    support_cents        = CASE WHEN p ? 'support_cents'
                                -- Clamped to the product's real ceiling
                                -- (SUPPORT_MAX_CENTS). 053's CHECK allows ten
                                -- times that, which a direct RPC caller could
                                -- otherwise use to display a fictional amount
                                -- and suppress the re-ask for ever.
                                THEN LEAST(GREATEST(COALESCE((p->>'support_cents')::int, 0), 0), 50000)
                                ELSE b.support_cents END,
    currency             = CASE WHEN p ? 'currency'
                                THEN COALESCE(upper(p->>'currency'), b.currency)
                                ELSE b.currency END,
    current_period_end   = CASE WHEN p ? 'current_period_end'
                                THEN (p->>'current_period_end')::timestamptz
                                ELSE b.current_period_end END,
    cancel_at_period_end = CASE WHEN p ? 'cancel_at_period_end'
                                THEN COALESCE((p->>'cancel_at_period_end')::boolean, false)
                                ELSE b.cancel_at_period_end END,
    card_brand           = CASE WHEN p ? 'card_brand'
                                THEN NULLIF(p->>'card_brand', '')
                                ELSE b.card_brand END,
    card_last4           = CASE WHEN p ? 'card_last4'
                                THEN NULLIF(p->>'card_last4', '')
                                ELSE b.card_last4 END,
    card_exp_month       = CASE WHEN p ? 'card_exp_month'
                                THEN (p->>'card_exp_month')::smallint
                                ELSE b.card_exp_month END,
    card_exp_year        = CASE WHEN p ? 'card_exp_year'
                                THEN (p->>'card_exp_year')::smallint
                                ELSE b.card_exp_year END,
    stripe_synced_at     = now(),
    updated_at           = now()
  WHERE b.user_id = uid
  RETURNING b.* INTO row;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_apply_stripe(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_apply_stripe(jsonb) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- billing_ensure_row() — the row, without counting a visit
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `store.ts`'s `ensureRow` issues a plain `INSERT … ON CONFLICT DO NOTHING`,
-- which 054 revoked from `authenticated`. Its call site carries a comment
-- calling the failure path "genuinely unreachable rather than merely unlikely"
-- — and on Supabase, the only deployment that matters, it raises `42501` the
-- moment a row is actually missing. Rows CAN be missing: an account created
-- before 053, or any gap in the signup trigger.
--
-- `billing_touch_visit` would have created it, but it also counts a session,
-- and a read must not.

CREATE OR REPLACE FUNCTION public.billing_ensure_row()
RETURNS public.billing_account
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  row public.billing_account;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'billing_ensure_row: no authenticated user';
  END IF;

  INSERT INTO public.billing_account (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO row FROM public.billing_account WHERE user_id = uid;
  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_ensure_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_ensure_row() TO authenticated;
