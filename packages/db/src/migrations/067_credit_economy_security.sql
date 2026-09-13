-- These functions use the verified server session claim. A direct PostgREST session
-- may read its wallet but cannot bind a browser-supplied Stripe customer or session.
CREATE FUNCTION public.credit_server_actor() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb; actor text; kind text;
BEGIN
 claims=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 actor=claims->>'sub'; kind=claims->>'deckpal_auth_kind';
 IF actor IS NULL OR NOT coalesce(kind='jwt' OR (kind='local' AND current_setting('role')='none'),false) OR NOT public.admin_account_active(actor)
 THEN RAISE EXCEPTION 'A trusted application session is required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION public.credit_wallet_read(p_user text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; b integer; d integer; held boolean; stale uuid;
BEGIN
 actor=public.admin_actor_id();
 IF actor IS NULL OR NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 p_user=coalesce(p_user,actor);
 IF p_user<>actor THEN PERFORM public.admin_require_permission('credits.read'); END IF;
 -- Crash recovery: expired reservations cannot start a provider. Reopening a
 -- wallet refunds them idempotently, including a process killed before finally.
 FOR stale IN SELECT id FROM public.credit_spend WHERE user_id=p_user AND provider_started_at IS NULL AND refunded_at IS NULL AND created_at<=now()-interval '5 minutes' LOOP
  PERFORM public.credit_spend_refund(p_user,stale);
 END LOOP;
 SELECT balance INTO b FROM public.decke_credit_balance WHERE user_id::text=p_user;
 SELECT debt INTO d FROM public.credit_wallet_control WHERE user_id=p_user;
 SELECT EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))) INTO held;
 RETURN jsonb_build_object('balance',coalesce(b,0),'debt',coalesce(d,0),'purchaseHold',held);
END $$;

CREATE FUNCTION public.credit_events_read(p_user text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wallet jsonb; result jsonb;
BEGIN
 wallet=public.credit_wallet_read(p_user);
 p_user=coalesce(p_user,public.admin_actor_id());
 IF p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('events',coalesce(jsonb_agg(e),'[]'::jsonb),'total',(SELECT count(*) FROM public.decke_credit_event WHERE user_id::text=p_user),'limit',p_limit,'offset',p_offset) INTO result FROM (
 SELECT id::text,delta,kind,reason,created_at AS "createdAt",pricing_revision AS "pricingRevision",CASE WHEN public.admin_user_has_permission(public.admin_actor_id(),'admin.access') AND public.admin_user_has_permission(public.admin_actor_id(),'credits.read') THEN pricing_snapshot ELSE NULL END AS "pricingSnapshot" ,debt_delta AS "debtDelta"
 FROM public.decke_credit_event WHERE user_id::text=p_user ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET p_offset
 ) e;
 RETURN result;
END $$;

CREATE FUNCTION public.credit_packs_read(p_admin boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_admin THEN PERFORM public.admin_require_permission('credits.read'); END IF;
 RETURN jsonb_build_object('packs',(SELECT coalesce(jsonb_agg(p ORDER BY p."priceCents",p.id),'[]'::jsonb) FROM (
 SELECT id,name,credits,price_cents AS "priceCents",currency,active,revision FROM public.credit_pack WHERE active OR p_admin
 ) p));
END $$;

CREATE FUNCTION public.credit_order_create(p_pack uuid,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; pack public.credit_pack; ord public.credit_order; pol jsonb; wallet jsonb;
BEGIN
 actor=public.credit_server_actor();
 IF p_key IS NULL OR p_key!~'^[A-Za-z0-9_-]{8,100}$' THEN RAISE EXCEPTION 'Invalid checkout attempt' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('credit.checkout:'||actor,0));
 SELECT * INTO ord FROM public.credit_order WHERE user_id=actor AND attempt_key=p_key;
 IF FOUND THEN
  IF ord.pack_id<>p_pack THEN RAISE EXCEPTION 'Checkout key reused for another pack' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(ord);
 END IF;
 pol=public.credit_policy_read(); wallet=public.credit_wallet_read(actor);
 IF NOT public.admin_user_has_permission(actor,'decke.use') OR pol IS NULL OR NOT (pol->'policy'->>'enabled')::bool OR (wallet->>'purchaseHold')::bool THEN RAISE EXCEPTION 'Credit purchases unavailable' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.credit_order WHERE user_id=actor AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Checkout attempt limit reached; try later' USING ERRCODE='54000'; END IF;
 SELECT * INTO pack FROM public.credit_pack WHERE id=p_pack AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pack is not available' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.credit_order(user_id,pack_id,pack_revision,pack_name,credits,price_cents,currency,pricing_revision,attempt_key)
 VALUES(actor,pack.id,pack.revision,pack.name,pack.credits,pack.price_cents,pack.currency,(pol->>'revision')::bigint,p_key) RETURNING * INTO ord;
 RETURN to_jsonb(ord);
END $$;

CREATE FUNCTION public.credit_order_prepare(p_id uuid,p_customer text,p_live boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; ord public.credit_order;
BEGIN
 actor=public.credit_server_actor();
 IF p_customer IS NULL OR p_live IS NULL OR p_customer!~'^cus_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid Stripe customer' USING ERRCODE='22023'; END IF;
 SELECT * INTO ord FROM public.credit_order WHERE id=p_id AND user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
 IF ord.stripe_customer_id IS NOT NULL AND (ord.stripe_customer_id<>p_customer OR ord.livemode<>p_live) THEN RAISE EXCEPTION 'Order payment identity changed' USING ERRCODE='40001'; END IF;
 UPDATE public.credit_order SET stripe_customer_id=p_customer,livemode=p_live,updated_at=now() WHERE id=p_id RETURNING * INTO ord;
 INSERT INTO public.credit_wallet_control(user_id,stripe_customer_id) VALUES(actor,p_customer)
 ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id,updated_at=now();
 RETURN to_jsonb(ord);
END $$;

CREATE FUNCTION public.credit_order_bind(p_id uuid,p_session text,p_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;
BEGIN
 actor=public.credit_server_actor();
 IF p_session IS NULL OR p_url IS NULL OR p_session!~'^cs_[A-Za-z0-9_]+$' OR p_url!~'^https://checkout[.]stripe[.]com/' THEN RAISE EXCEPTION 'Invalid hosted checkout' USING ERRCODE='22023'; END IF;
 UPDATE public.credit_order SET stripe_session_id=p_session,checkout_url=p_url,updated_at=now()
 WHERE id=p_id AND user_id=actor AND (stripe_session_id IS NULL OR stripe_session_id=p_session);
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout binding conflict' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION public.credit_order_read(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; result jsonb;
BEGIN
 actor=public.credit_server_actor();
 SELECT jsonb_build_object('id',id,'status',status,'credits',credits,'priceCents',price_cents,'currency',currency)
 INTO result FROM public.credit_order WHERE id=p_id AND user_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.credit_customer_read() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT stripe_customer_id FROM public.credit_wallet_control WHERE user_id=public.credit_server_actor()
$$;

-- Signed webhook caller only. The order, not an event ID, owns the unique grant.
CREATE FUNCTION public.credit_order_fulfill(p_id uuid,p_user text,p_session text,p_customer text,p_intent text,p_cents integer,p_currency text,p_live boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.credit_order;
BEGIN
 SELECT * INTO ord FROM public.credit_order WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Credit order not found' USING ERRCODE='P0002'; END IF;
 IF p_user IS NULL OR p_session IS NULL OR p_customer IS NULL OR p_intent IS NULL OR p_cents IS NULL OR p_currency IS NULL OR p_live IS NULL OR ord.user_id<>p_user OR ord.stripe_customer_id IS DISTINCT FROM p_customer OR ord.price_cents<>p_cents OR ord.currency<>p_currency OR ord.livemode IS DISTINCT FROM p_live OR
 (ord.stripe_session_id IS NOT NULL AND ord.stripe_session_id<>p_session) OR
 (ord.stripe_payment_intent_id IS NOT NULL AND ord.stripe_payment_intent_id<>p_intent)
 THEN RAISE EXCEPTION 'Payment does not match frozen credit order' USING ERRCODE='22023'; END IF;
 IF ord.granted_at IS NOT NULL THEN RETURN false; END IF;
 IF p_session!~'^cs_[A-Za-z0-9_]+$' OR p_intent!~'^pi_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid payment identifiers' USING ERRCODE='22023'; END IF;
 PERFORM public.credit_apply_delta(ord.user_id,ord.credits,'grant','Purchased '||ord.pack_name,'credit-order:'||ord.id,ord.pricing_revision,jsonb_build_object('credits',ord.credits,'priceCents',ord.price_cents,'currency',ord.currency,'packRevision',ord.pack_revision));
 UPDATE public.credit_order SET status='paid',stripe_session_id=p_session,stripe_payment_intent_id=p_intent,granted_at=now(),updated_at=now() WHERE id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.credit_order_reverse(p_intent text,p_refunded integer,p_dispute text DEFAULT NULL,p_dispute_status text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.credit_order; target integer; movement integer; r integer; ds text;
BEGIN
 SELECT * INTO ord FROM public.credit_order WHERE stripe_payment_intent_id=p_intent FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF ord.granted_at IS NULL THEN RAISE EXCEPTION 'Order fulfillment must finish before reversal' USING ERRCODE='40001'; END IF;
 IF p_refunded IS NULL OR p_refunded NOT BETWEEN 0 AND ord.price_cents OR (p_dispute_status IS NOT NULL AND p_dispute_status NOT IN ('needs_response','under_review','won','lost','warning_needs_response','warning_under_review','warning_closed')) THEN RAISE EXCEPTION 'Invalid reversal' USING ERRCODE='22023'; END IF;
 r=greatest(p_refunded,ord.refunded_cents);
 ds=coalesce(p_dispute_status,ord.dispute_status);
 IF ord.dispute_status IN ('won','lost','resolved','warning_closed') AND coalesce(ds,'') NOT IN ('won','lost','resolved','warning_closed') THEN ds=ord.dispute_status; END IF;
 IF ord.dispute_status='resolved' AND ds='lost' AND ord.dispute_id=p_dispute THEN ds='resolved'; END IF;
 target=ceil(ord.credits::numeric*r/ord.price_cents)::integer;
 IF ds IN ('needs_response','under_review','lost','resolved','warning_needs_response','warning_under_review') THEN target=ord.credits; END IF;
 movement=ord.reversed_credits-target;
 IF movement<>0 THEN
  PERFORM public.credit_apply_delta(ord.user_id,movement,CASE WHEN movement>0 THEN 'grant' ELSE 'spend' END,
   CASE WHEN movement>0 THEN 'Credit payment dispute won' ELSE 'Credit payment refund or dispute' END,
   'credit-reversal:'||ord.id||':'||gen_random_uuid(),ord.pricing_revision);
 END IF;
 UPDATE public.credit_order SET reversed_credits=target,refunded_cents=r,dispute_id=coalesce(p_dispute,dispute_id),dispute_status=ds,
 status=CASE WHEN ds IN ('needs_response','under_review','lost','warning_needs_response','warning_under_review') THEN 'disputed' WHEN r>0 THEN 'refunded' ELSE 'paid' END,updated_at=now() WHERE id=ord.id;
 RETURN true;
END $$;

CREATE FUNCTION public.credit_hold_resolve(p_user text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE before_state jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 PERFORM public.admin_require_permission('credits.manage');
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.credit_order WHERE user_id=p_user ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.credit_wallet_control WHERE user_id=p_user FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.credit_wallet_control WHERE user_id=p_user AND debt>0) OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review'))) THEN RAISE EXCEPTION 'Resolve debt and open payment disputes first' USING ERRCODE='40001'; END IF;
 SELECT jsonb_agg(id) INTO before_state FROM public.credit_order WHERE user_id=p_user AND dispute_status='lost';
 UPDATE public.credit_order SET dispute_status='resolved',reconciliation_revision=reconciliation_revision+1,updated_at=now() WHERE user_id=p_user AND dispute_status='lost';
 PERFORM public.admin_audit_append('credits.hold.resolve','user',p_user,before_state,'{}'::jsonb,trim(p_reason));
END $$;


CREATE FUNCTION public.credit_policy_admin_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.admin_require_permission('credits.read');
 RETURN public.credit_policy_read();
END $$;

CREATE FUNCTION public.credit_quote_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb; p jsonb; prices jsonb='{}'::jsonb; k text; cost integer;
BEGIN
 IF NOT public.admin_is_session() OR NOT public.admin_account_active(public.admin_actor_id()) THEN RAISE EXCEPTION 'Application session required' USING ERRCODE='42501'; END IF;
 r=public.credit_policy_read(); p=r->'policy';
 IF r IS NULL THEN RAISE EXCEPTION 'Credit policy is not initialized' USING ERRCODE='55000'; END IF;
 FOREACH k IN ARRAY ARRAY['chatTurn','analysis','planDeck'] LOOP
  cost=greatest(1,ceil((p->'estimatedMicroUsd'->>k)::numeric*(10000+(p->>'markupBps')::numeric)/((p->>'microUsdPerCredit')::numeric*10000)))::integer;
  prices=prices||jsonb_build_object(k,cost);
 END LOOP;
 RETURN jsonb_build_object('enabled',(p->>'enabled')::boolean,'lowAt',(p->>'lowBalance')::integer,'prices',prices,'pricingRevision',r->'revision');
END $$;

-- The fresh Stripe charge/dispute snapshot is applied in the same atomic statement
-- as fulfillment, so a refunded payment is never briefly spendable.
CREATE FUNCTION public.credit_order_settle(p_id uuid,p_user text,p_session text,p_customer text,p_intent text,p_cents integer,p_currency text,p_live boolean,p_refunded integer,p_dispute text,p_dispute_status text,p_pending_refund integer,p_expected_revision integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE added boolean; observed integer;
BEGIN
 SELECT reconciliation_revision INTO observed FROM public.credit_order WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Credit order not found' USING ERRCODE='P0002'; END IF;
 IF p_expected_revision IS NULL OR observed<>p_expected_revision THEN RAISE EXCEPTION 'Payment state changed; reconcile again from Stripe' USING ERRCODE='40001'; END IF;
 IF p_pending_refund IS NULL OR p_pending_refund<0 OR p_pending_refund>p_cents THEN RAISE EXCEPTION 'Invalid pending refund' USING ERRCODE='22023'; END IF;
 added=public.credit_order_fulfill(p_id,p_user,p_session,p_customer,p_intent,p_cents,p_currency,p_live);
 PERFORM public.credit_order_reverse(p_intent,p_refunded,p_dispute,p_dispute_status);
 UPDATE public.credit_order SET pending_refund_cents=p_pending_refund,reconciliation_revision=reconciliation_revision+1 WHERE id=p_id;
 RETURN added;
END $$;


CREATE FUNCTION public.credit_admin_summary(p_days integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.admin_require_permission('credits.read');
 IF p_days IS NULL OR p_days NOT IN (7,30,90) THEN RAISE EXCEPTION 'Choose 7, 30, or 90 days' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('days',p_days,
 'creditsSpent',coalesce(sum(-delta) FILTER(WHERE delta<0),0),
 'creditsGranted',coalesce(sum(delta) FILTER(WHERE delta>0),0),
 'estimatedProviderMicroUsd',coalesce(sum((pricing_snapshot->'estimatedMicroUsd'->>reason)::numeric) FILTER(WHERE kind='spend' AND reason IN ('chatTurn','analysis','planDeck')),0),
 'unpricedSpends',count(*) FILTER(WHERE kind='spend' AND pricing_snapshot IS NULL)) INTO result
 FROM public.decke_credit_event WHERE created_at>=now()-make_interval(days=>p_days);
 RETURN result||jsonb_build_object(
 'paidOrders',(SELECT count(*) FROM public.credit_order WHERE granted_at>=now()-make_interval(days=>p_days)),
 'grossSalesCents',(SELECT coalesce(sum(price_cents),0) FROM public.credit_order WHERE granted_at>=now()-make_interval(days=>p_days)),
 'refundedCents',(SELECT coalesce(sum(refunded_cents),0) FROM public.credit_order WHERE granted_at>=now()-make_interval(days=>p_days)),
 'pendingOrders',(SELECT count(*) FROM public.credit_order WHERE status='pending'),
 'heldWallets',(SELECT count(DISTINCT user_id) FROM public.credit_order WHERE pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost')),
 'debtWallets',(SELECT count(*) FROM public.credit_wallet_control WHERE debt>0),
 'totalDebt',(SELECT coalesce(sum(debt),0) FROM public.credit_wallet_control));
END $$;
CREATE FUNCTION public.credit_admin_orders(p_status text,p_user text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.admin_require_permission('credits.read');
 IF p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 1000000 OR
 (p_status IS NOT NULL AND p_status NOT IN ('pending','paid','expired','refunded','disputed')) OR length(p_user)>100
 THEN RAISE EXCEPTION 'Invalid order filter' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('orders',(SELECT coalesce(jsonb_agg(o),'[]'::jsonb) FROM (
  SELECT o.id,o.user_id AS "userId",u.username,o.pack_name AS "packName",o.credits,o.price_cents AS "priceCents",o.currency,o.status,
  o.refunded_cents AS "refundedCents",o.pending_refund_cents AS "pendingRefundCents",o.reversed_credits AS "reversedCredits",o.dispute_status AS "disputeStatus",o.created_at AS "createdAt",o.granted_at AS "paidAt"
  FROM public.credit_order o LEFT JOIN public.app_user u ON u.id::text=o.user_id
  WHERE (p_status IS NULL OR o.status=p_status) AND (p_user IS NULL OR o.user_id=p_user)
  ORDER BY o.created_at DESC,o.id DESC LIMIT p_limit OFFSET p_offset
 ) o),'total',(SELECT count(*) FROM public.credit_order WHERE (p_status IS NULL OR status=p_status) AND (p_user IS NULL OR user_id=p_user)),'limit',p_limit,'offset',p_offset);
END $$;
CREATE INDEX credit_order_status_created ON public.credit_order(status,created_at DESC);
CREATE INDEX credit_order_granted ON public.credit_order(granted_at) WHERE granted_at IS NOT NULL;


CREATE TABLE public.credit_checkout_rate (
 user_id text PRIMARY KEY,
 window_start timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0)
);
ALTER TABLE public.credit_checkout_rate ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.credit_checkout_throttle() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; hits integer;
BEGIN
 actor=public.credit_server_actor();
 INSERT INTO public.credit_checkout_rate(user_id,attempts) VALUES(actor,1)
 ON CONFLICT(user_id) DO UPDATE SET
 attempts=CASE WHEN credit_checkout_rate.window_start<=now()-interval '1 hour' THEN 1 ELSE credit_checkout_rate.attempts+1 END,
 window_start=CASE WHEN credit_checkout_rate.window_start<=now()-interval '1 hour' THEN now() ELSE credit_checkout_rate.window_start END
 RETURNING attempts INTO hits;
 IF hits>60 THEN RAISE EXCEPTION 'Checkout request limit reached; try later' USING ERRCODE='54000'; END IF;
END $$;

-- Tables never accept browser writes. Only narrow functions are reachable.
ALTER TABLE public.credit_policy_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_policy_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_wallet_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_adjustment ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE f record; tab text;
BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'credit\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.credit_checkout_throttle(),public.credit_admin_summary(integer),public.credit_admin_orders(text,text,integer,integer),public.credit_policy_admin_read(),public.credit_quote_read(),public.credit_policy_save(jsonb,bigint),public.credit_pack_save(uuid,jsonb,integer),
   public.credit_wallet_read(text),public.credit_events_read(text,integer,integer),public.credit_packs_read(boolean),
   public.credit_adjust(text,integer,text,text),public.credit_hold_resolve(text,text),
   public.credit_order_create(uuid,text),public.credit_order_prepare(uuid,text,boolean),public.credit_order_bind(uuid,text,text),
   public.credit_order_read(uuid),public.credit_customer_read() TO authenticated;
 END IF;
 FOREACH tab IN ARRAY ARRAY['credit_policy_revision','credit_policy_current','credit_pack','credit_wallet_control','credit_order','credit_spend','credit_adjustment','credit_checkout_rate'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',tab);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',tab); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',tab); END IF;
 END LOOP;
END $$;
