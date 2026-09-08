-- @supabase-only
-- 054 · Row-Level Security and the write path for the billing row (053).
--
-- ONLY runs on Supabase, exactly as 021/040/042/044 do. Self-host has no
-- `authenticated` role and no `auth.uid()` — and no billing either: the
-- pay-what-you-want proposition belongs to the hosted product, so on self-host
-- the API answers `GET /me/billing` with `available: false` and the table sits
-- empty. Nothing here is needed there.
--
-- Depends on: 053_billing, 021_rls_policies, 020_multi_user_uuid.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- READ-ONLY TO ITS SUBJECT — AND THIS TIME IT REALLY MATTERS
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 040 and 042 made the Deck-E meter and credit balance SELECT-only with the
-- reasoning that "a meter its subject can edit is not a meter". The same shape
-- is used here, and the stakes are higher, because one of these columns is not
-- a number about a user — it is a POINTER INTO STRIPE.
--
-- Supabase exposes PostgREST at `/rest/v1` to anyone holding the anon key, and
-- the anon key is compiled into the SPA bundle by design. So "the API is the
-- only writer" is not a thing the API can decide; it is a thing the database
-- has to enforce. If `authenticated` could UPDATE its own row, an account could
-- write SOMEBODY ELSE'S `stripe_customer_id` into it — the row policy would be
-- satisfied, it is still their own row — and the billing routes would then
-- operate on that stranger's Stripe customer: read back the last four digits of
-- their card, and start a subscription billed to it. That is not a display bug.
--
-- Hence: no INSERT, no UPDATE, no DELETE policy. SELECT on your own row, and
-- that is the whole of what a browser may do with this table directly.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- SO HOW DOES ANYTHING WRITE? THREE SECURITY DEFINER FUNCTIONS, AND THE WEBHOOK
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The webhook (`POST /api/stripe/webhook`) is mounted on the bare Express app,
-- AHEAD of the `/api` router — so it never enters the RLS middleware, runs as
-- the connection's owning role, and writes these tables directly. It is the
-- primary writer and Stripe is its only input.
--
-- The billing ROUTES are a different situation: they run inside the RLS
-- transaction as `authenticated`, and they legitimately need to write — a
-- customer has just been created, a subscription has just been confirmed, and
-- making the page wait for a webhook to land before it can show what the reader
-- just did would be a worse product for no security gain.
--
-- The API cannot escape its own role for that, and it must not: the alternative
-- shapes were a second pooled connection (forbidden by contract B2 — one
-- request holding two connections is what exhausted the pool on 2026-08-29) or
-- a `RESET ROLE` / restore dance on the request's own client, where any early
-- return leaves the rest of the request running as the table owner with RLS
-- switched off. Neither is worth it when Postgres ships the right tool.
--
-- These three functions are that tool. Each is SECURITY DEFINER, so the body
-- runs as the owner for its own duration and no longer; each derives the row it
-- touches from `auth.uid()` and NEVER from an argument, so there is no user id
-- to forge; and each writes only the columns its name describes. `search_path`
-- is pinned and every reference is schema-qualified, so a function cannot be
-- redirected by a caller's search_path.
--
-- Note what is NOT a parameter of `billing_apply_stripe`: the account. The
-- caller can pass whatever Stripe state it likes and it will only ever land on
-- its own row. The values themselves come from a Stripe API response inside the
-- route, never from a request body — the client sends an AMOUNT, and the server
-- sends back what Stripe actually did with it.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE billing_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_event   ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_account_select ON billing_account
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- billing_event gets RLS enabled and NO policy at all: it is a webhook ledger
-- with no user column, nobody's own data, and nothing a browser has any
-- business reading. Enabled-with-no-policy is how you say "deny" out loud
-- rather than by omission.

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. The row exists from signup
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 021 created app_user + user_settings + user_profile on signup; billing joins
-- them. The functions below still upsert defensively (an account created before
-- this migration, or a self-host seed), but the trigger is what makes the
-- common case a plain UPDATE.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.app_user (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    )
  );
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
  INSERT INTO public.user_profile (user_id) VALUES (NEW.id);
  -- visit_count 0: a brand-new account has not been anywhere yet, and reaches
  -- the onboarding ask through `onboarded_at IS NULL`, not through the counter.
  INSERT INTO public.billing_account (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. billing_touch_visit() — count sessions, not page loads
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Called once per app boot by `GET /me/billing`. Returns the whole row so the
-- endpoint is a single round trip.
--
-- The six-hour floor is what makes `visit_count` mean "session" rather than
-- "render": a reload, a second tab, a deep link from a phone's home screen and
-- a PWA resume all happen within it and none of them spend budget. Six rather
-- than twenty-four so that morning and evening both count — the threshold is
-- "a few times", and a person who opens DeckPal twice a day on Saturday has
-- genuinely been here twice.
--
-- Counting here rather than in the browser is not paranoia about cheating; it
-- is that a client-side counter is per-device, and someone who signs in on a
-- laptop and a phone would be treated as two people who have each been here
-- once, forever.

CREATE OR REPLACE FUNCTION public.billing_touch_visit()
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
    RAISE EXCEPTION 'billing_touch_visit: no authenticated user';
  END IF;

  INSERT INTO public.billing_account (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.billing_account b
     SET visit_count   = b.visit_count + 1,
         last_visit_at = now(),
         updated_at    = now()
   WHERE b.user_id = uid
     AND (b.last_visit_at IS NULL OR b.last_visit_at < now() - interval '6 hours')
  RETURNING b.* INTO row;

  -- No UPDATE means "seen recently" — not an error, just nothing to count.
  IF NOT FOUND THEN
    SELECT * INTO row FROM public.billing_account WHERE user_id = uid;
  END IF;

  RETURN row;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. billing_ack_prompt(boolean) — the ask has been put, whatever the answer
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Stamped on DISMISS as well as on save, and deliberately so: the monthly
-- cadence is measured from the last time we asked, not the last time we got the
-- answer we wanted. A "not right now" buys the same full month of quiet that a
-- "yes" does. Anything else is nagging with extra steps.
--
-- `p_onboarding` additionally stamps `onboarded_at`, which is one-way: the
-- onboarding ask is shown exactly once per account, ever.

CREATE OR REPLACE FUNCTION public.billing_ack_prompt(p_onboarding boolean)
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
    RAISE EXCEPTION 'billing_ack_prompt: no authenticated user';
  END IF;

  INSERT INTO public.billing_account (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.billing_account b
     SET prompt_last_shown_at = now(),
         onboarded_at         = CASE WHEN p_onboarding THEN COALESCE(b.onboarded_at, now())
                                     ELSE b.onboarded_at END,
         updated_at           = now()
   WHERE b.user_id = uid
  RETURNING b.* INTO row;

  RETURN row;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. billing_apply_stripe(jsonb) — cache what Stripe just said
-- ══════════════════════════════════════════════════════════════════════════════
--
-- One entry point for every Stripe-truth column, taking the shape the API
-- assembles from a Stripe response. A key that is ABSENT leaves its column
-- alone; a key present and JSON-null CLEARS it. Those are different requests
-- ("I have nothing to say about the card" vs "there is no card any more") and
-- collapsing them is how a detached card would go on being displayed.
--
-- `support_cents` is clamped by 053's CHECK, so a nonsense amount is a failed
-- statement rather than a wrong row.

CREATE OR REPLACE FUNCTION public.billing_apply_stripe(p jsonb)
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
    RAISE EXCEPTION 'billing_apply_stripe: no authenticated user';
  END IF;

  INSERT INTO public.billing_account (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.billing_account b SET
    stripe_customer_id   = CASE WHEN p ? 'stripe_customer_id'
                                THEN NULLIF(p->>'stripe_customer_id', '')
                                ELSE b.stripe_customer_id END,
    subscription_id      = CASE WHEN p ? 'subscription_id'
                                THEN NULLIF(p->>'subscription_id', '')
                                ELSE b.subscription_id END,
    subscription_status  = CASE WHEN p ? 'subscription_status'
                                THEN NULLIF(p->>'subscription_status', '')
                                ELSE b.subscription_status END,
    support_cents        = CASE WHEN p ? 'support_cents'
                                THEN COALESCE((p->>'support_cents')::int, 0)
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

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Grants
-- ══════════════════════════════════════════════════════════════════════════════
--
-- EXECUTE is granted on a function by default to PUBLIC, which here would mean
-- `anon` too. Every function raises on a NULL `auth.uid()` so an anonymous call
-- fails anyway — but a security-definer function that is merely *reachable* by
-- the anon role is the kind of thing that becomes a finding the day somebody
-- adds an early return. Revoke first, then grant the one role that needs it.

REVOKE ALL ON FUNCTION public.billing_touch_visit()               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_ack_prompt(boolean)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_apply_stripe(jsonb)         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.billing_touch_visit()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_ack_prompt(boolean)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_stripe(jsonb)      TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. Table privileges — the belt under the RLS braces
-- ══════════════════════════════════════════════════════════════════════════════
--
-- SUPABASE GRANTS `authenticated` WRITE PRIVILEGES ON NEW PUBLIC TABLES BY
-- DEFAULT. Its bootstrap sets `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
-- ALL ON TABLES TO anon, authenticated, service_role`, so a table created here
-- arrives with INSERT/UPDATE/DELETE already granted, and the ONLY thing
-- standing in the way of a write is the absence of a policy.
--
-- That absence is genuinely enough — with no UPDATE policy an UPDATE matches no
-- row and with no INSERT policy an INSERT is rejected outright. But "enough"
-- rests on a policy NOT existing, which is a thing a future migration adds
-- without realising what it opens: one `FOR ALL` policy written for the
-- convenience of the visit counter would hand the browser `stripe_customer_id`
-- as well, and that column is a pointer into Stripe (see the header).
--
-- So the privilege is revoked outright. A write then fails LOUDLY, with
-- `42501 permission denied`, rather than quietly affecting zero rows — and it
-- keeps failing even if somebody later adds a permissive policy. Verified
-- against real Postgres, not assumed: with these revokes an UPDATE from
-- `authenticated` errors 42501 while the SELECT still returns the caller's own
-- row.
REVOKE ALL    ON public.billing_account FROM authenticated, anon;
GRANT  SELECT ON public.billing_account TO authenticated;

-- `billing_event` is the webhook's ledger: no user column, nobody's own data,
-- and nothing a browser has any business reading. Revoked from both roles and
-- granted to neither.
REVOKE ALL ON public.billing_event FROM authenticated, anon;
