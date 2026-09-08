-- @supabase-only
-- 060 · Let a customer id be RELEASED, so the write-once pin does not brick an
--       account whose Stripe customer really is gone.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE CONFLICT 059 CREATED
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 059 pinned `stripe_customer_id` write-once as DEPTH behind the disclosure fix.
-- (An earlier version of this line said the pin "closed a real disclosure". It
-- does not, and this migration is the reason why: release-to-NULL plus a set is
-- two permitted calls that reach any customer id no other row holds. What closes
-- it is the ownership check `ensureCustomer` and `syncCustomer` ask of Stripe.
-- Corrected in place because 060 is unapplied; see 059's header, which had the
-- same sentence, and DECISIONS §33 on why the reason for leaving them was
-- itself false.)
--
-- The hole: the column is reachable from the browser via `billing_apply_stripe`,
-- and the webhook used to resolve an account from it, so pointing your row at a
-- stranger's customer harvested their card summary.
--
-- But `ensureCustomer` (apps/api/src/billing/service.ts) has a legitimate
-- recovery path that the pin broke. When the stored customer is genuinely
-- unusable — deleted in the dashboard, or belonging to a different Stripe
-- account after a test/live key swap — it creates a fresh one. With 059 applied
-- the follow-up write raised "cannot be repointed", so every subsequent request
-- 502'd AND minted another orphan customer at Stripe. `/portal` was worse: it
-- never writes the column, so it silently opened an empty portal on a
-- brand-new customer while the account's real row pointed elsewhere.
--
-- 059's header said this case was "worth a manual UPDATE by the owner". That is
-- not good enough: it is a self-inflicted outage on a path the code takes by
-- itself, in a loop, spending Stripe objects as it goes.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- RELEASING IS SAFE IN A WAY REPOINTING IS NOT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- This function can only ever set the column to NULL. It cannot be pointed at a
-- value, so it cannot be aimed at anybody. The worst an abusive caller achieves
-- is detaching THEIR OWN row from THEIR OWN customer.
--
-- ⚠️ That is not the same as "inconvenienced nobody", which is what this said
-- before. Detaching a PAYING row is real self-harm: the subscription goes on
-- charging at Stripe, the app then shows $0, `/portal` refuses because the row
-- has no customer, and re-subscribing bills a second time. It is self-harm with
-- no reach into anybody else's data, which is why it is accepted — but it is
-- accepted, not harmless. SECURITY.md carries the same account — and ONLY
-- SECURITY.md: the previous version of this line named six files, which
-- conflated this self-harm note with the separate pin-versus-ownership-check
-- correction those files do carry. It was written in the same commit as the
-- paragraph below telling the reader to grep before believing a citation.
-- Corrected here while 060 is still unapplied and B4 permits it.
--
-- ⚠️ AND THE SENTENCE THAT USED TO SIT HERE said "the disclosure 059 closed
-- needs the ability to name a target, and naming a target is exactly what is
-- still forbidden". Both halves are wrong: 059 did not close the disclosure
-- (the ownership check does), and naming a target is NOT forbidden — this
-- very function makes release-then-set possible, and a first write into a NULL
-- row never needed it. Round thirty-one rewrote the paragraph forty lines above
-- that carried this claim and left the paragraph that repeated it, which is the
-- defect class this file keeps demonstrating. Grep before you believe a
-- correction landed.
--
-- The card summary is cleared with it. A row that no longer knows its customer
-- must not keep displaying that customer's last four digits: the two facts came
-- from the same place and they leave together.
--
-- The route only calls this after Stripe itself has said the stored customer is
-- missing or does not name this account — the check in `ensureCustomer`, which
-- is also what makes the "brand new customer" it then creates trustworthy.

CREATE OR REPLACE FUNCTION public.billing_release_customer()
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
    RAISE EXCEPTION 'billing_release_customer: no authenticated user';
  END IF;

  UPDATE public.billing_account b
     SET stripe_customer_id = NULL,
         subscription_id     = NULL,
         subscription_status = NULL,
         support_cents       = 0,
         current_period_end  = NULL,
         cancel_at_period_end = FALSE,
         card_brand     = NULL,
         card_last4     = NULL,
         card_exp_month = NULL,
         card_exp_year  = NULL,
         stripe_synced_at = now(),
         updated_at       = now()
   WHERE b.user_id = uid
  RETURNING b.* INTO row;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_release_customer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_release_customer() TO authenticated;
