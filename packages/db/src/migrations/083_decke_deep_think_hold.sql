-- Deep Think uses the same frozen v2 pricing policy as every other Deck-E
-- request, but Opus can legitimately cost more than the ordinary 25-credit
-- leg. The multiplier changes only the reservation size; settlement remains
-- the Gateway-reported cost and returns everything unused.
DROP FUNCTION public.decke_metered_begin(uuid);

CREATE FUNCTION public.decke_metered_begin(
 p_request uuid,p_hold_multiplier integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; r public.decke_ai_request; reservation public.decke_metered_reservation;
 effective jsonb; policy jsonb; balance_now integer; debt_now integer; payment_hold boolean;
 carry numeric(20,12):=0; available numeric(24,12); held integer; cap numeric(24,12); moved jsonb;
BEGIN
 IF p_hold_multiplier IS NULL OR p_hold_multiplier NOT BETWEEN 1 AND 10 THEN
  RAISE EXCEPTION 'Hold multiplier must be between 1 and 10' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status<>'started' THEN
  RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM public.decke_metered_authorize(r.user_id,true);
 actor=r.user_id;
 SELECT * INTO reservation FROM public.decke_metered_reservation WHERE request_id=p_request;
 IF FOUND THEN
  IF r.charge_mode<>'paid' THEN
   RETURN jsonb_build_object('allowed',true,'mode',r.charge_mode,
    'heldCredits',reservation.held_credits,'capCredits',NULL);
  END IF;
  SELECT coalesce(b.balance,0),coalesce(c.fractional_credits,0)
    INTO balance_now,carry
    FROM (SELECT 1) x
    LEFT JOIN public.decke_credit_balance b ON b.user_id::text=actor
    LEFT JOIN public.decke_metered_credit c ON c.user_id=actor;
  RETURN jsonb_build_object('allowed',true,'mode',r.charge_mode,
   'heldCredits',reservation.held_credits,
   'capCredits',reservation.cap_credits::text,'balance',public.decke_metered_spendable(balance_now,carry)::text);
 END IF;
 effective=public.credit_effective_policy(actor,r.pricing_revision,r.override_revision);
 policy=effective->'policy';
 IF policy->>'version'<>'2' THEN
  RAISE EXCEPTION 'Metered accounting requires a v2 pricing revision' USING ERRCODE='22023';
 END IF;
 IF r.charge_mode IN ('unlimited','daily') THEN
  IF (r.charge_mode='unlimited' AND NOT (effective->>'unlimited')::boolean)
    OR (r.charge_mode='daily' AND ((effective->>'unlimited')::boolean OR (policy->>'enabled')::boolean)) THEN
   RAISE EXCEPTION 'Request pricing mode is invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.decke_metered_reservation(request_id,user_id,held_credits,cap_credits)
   VALUES(p_request,actor,0,0);
  RETURN jsonb_build_object('allowed',true,'mode',r.charge_mode,
   'heldCredits',0,'capCredits',NULL);
 END IF;
 IF r.charge_mode<>'paid' OR NOT (policy->>'enabled')::boolean OR (effective->>'unlimited')::boolean THEN
  RAISE EXCEPTION 'Request pricing mode is invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.credit_wallet_control(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
 SELECT debt INTO debt_now FROM public.credit_wallet_control WHERE user_id=actor FOR UPDATE;
 INSERT INTO public.decke_credit_balance(user_id,balance)
  SELECT id,0 FROM public.app_user WHERE id::text=actor ON CONFLICT DO NOTHING;
 SELECT balance INTO balance_now FROM public.decke_credit_balance WHERE user_id::text=actor FOR UPDATE;
 IF balance_now IS NULL THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.decke_metered_credit(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
 SELECT fractional_credits INTO carry FROM public.decke_metered_credit WHERE user_id=actor FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=actor AND
  (pending_refund_cents>0 OR dispute_status IN
   ('needs_response','under_review','warning_needs_response','warning_under_review','lost')))
  INTO payment_hold;
 available=balance_now-carry;
 IF payment_hold THEN
  RETURN jsonb_build_object('allowed',false,'mode','paid','reason','payment_hold',
   'balance',public.decke_metered_spendable(balance_now,carry)::text);
 END IF;
 IF debt_now>0 THEN
  RETURN jsonb_build_object('allowed',false,'mode','paid','reason','debt',
   'balance',public.decke_metered_spendable(balance_now,carry)::text,'debt',debt_now);
 END IF;
 IF available<(policy->>'legHoldMinCredits')::integer THEN
  RETURN jsonb_build_object('allowed',false,'mode','paid','reason','insufficient',
   'balance',public.decke_metered_spendable(balance_now,carry)::text,
   'needed',(policy->>'legHoldMinCredits')::integer);
 END IF;
 held=least((policy->>'legHoldCredits')::integer*p_hold_multiplier,balance_now);
 cap=held-carry;
 INSERT INTO public.decke_metered_reservation(request_id,user_id,held_credits,cap_credits)
  VALUES(p_request,actor,held,cap);
 moved=public.credit_apply_delta(actor,-held,'spend','Deck-E chat hold',
  'metered-reserve:'||p_request::text,r.pricing_revision,effective);
 RETURN jsonb_build_object('allowed',true,'mode','paid','heldCredits',held,
  'capCredits',cap::text,'balance',public.decke_metered_spendable((moved->>'balance')::integer,carry)::text);
END $$;

-- Replacing the signature drops its ACL with it. Restore 081's exact boundary:
-- PUBLIC and browser roles get nothing except the authenticated, server-claim
-- checked entry point; the migration owner retains its inherent ownership.
REVOKE ALL ON FUNCTION public.decke_metered_begin(uuid,integer) FROM PUBLIC;
DO $acl$
DECLARE principal text; grantee_sql text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal) THEN CONTINUE; END IF;
  grantee_sql=quote_ident(principal);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_metered_begin(uuid,integer) FROM %s',grantee_sql);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.decke_metered_begin(uuid,integer) TO authenticated;
 END IF;
END $acl$;
