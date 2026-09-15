-- Per-user AI policy is immutable by revision and independent of role.
CREATE TABLE public.credit_user_ai_override (
 user_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 unlimited boolean NOT NULL, markup_bps integer CHECK(markup_bps BETWEEN 0 AND 100000),
 changed_by text NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,revision)
);
ALTER TABLE public.credit_user_ai_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_spend DROP CONSTRAINT credit_spend_credits_check;
ALTER TABLE public.credit_spend ADD COLUMN charge_mode text NOT NULL DEFAULT 'paid' CHECK(charge_mode IN ('paid','unlimited'));
ALTER TABLE public.credit_spend ADD COLUMN override_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.credit_spend ADD COLUMN pricing_snapshot jsonb;
ALTER TABLE public.credit_spend ADD CONSTRAINT credit_spend_credits_check CHECK((charge_mode='paid' AND credits>0) OR (charge_mode='unlimited' AND credits=0));

CREATE FUNCTION public.credit_effective_policy(p_user text,p_revision bigint DEFAULT NULL,p_override bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb; o public.credit_user_ai_override; p jsonb;
BEGIN
 IF p_revision IS NULL THEN r=public.credit_policy_read();
 ELSE SELECT jsonb_build_object('revision',revision,'policy',policy,'updatedAt',created_at) INTO r FROM public.credit_policy_revision WHERE revision=p_revision; END IF;
 IF r IS NULL THEN RAISE EXCEPTION 'Credit policy unavailable' USING ERRCODE='55000'; END IF;
 IF p_override IS NULL THEN SELECT * INTO o FROM public.credit_user_ai_override WHERE user_id=p_user ORDER BY revision DESC LIMIT 1;
 ELSIF p_override>0 THEN SELECT * INTO o FROM public.credit_user_ai_override WHERE user_id=p_user AND revision=p_override;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid override revision' USING ERRCODE='22023'; END IF;
 ELSIF p_override<>0 THEN RAISE EXCEPTION 'Invalid override revision' USING ERRCODE='22023'; END IF;
 p=r->'policy';
 IF o.markup_bps IS NOT NULL THEN p=jsonb_set(p,'{markupBps}',to_jsonb(o.markup_bps)); END IF;
 PERFORM public.credit_validate_policy(p);
 RETURN r||jsonb_build_object('policy',p,'unlimited',coalesce(o.unlimited,false),'overrideRevision',coalesce(o.revision,0),'globalMarkupBps',r->'policy'->'markupBps');
END $$;

CREATE FUNCTION public.admin_user_ai_override_read(p_user text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.credit_user_ai_override; p jsonb; actor text;
BEGIN
 actor=public.credit_server_actor();
 PERFORM public.admin_require_permission('credits.read');
 IF NOT EXISTS(SELECT 1 FROM public.app_user WHERE id::text=p_user) THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO o FROM public.credit_user_ai_override WHERE user_id=p_user ORDER BY revision DESC LIMIT 1;
 p=public.credit_policy_read();
 RETURN jsonb_build_object('userId',p_user,'revision',coalesce(o.revision,0),'unlimited',coalesce(o.unlimited,false),
 'markupBps',o.markup_bps,'effectiveMarkupBps',coalesce(o.markup_bps,(p->'policy'->>'markupBps')::integer),
 'globalPolicyRevision',p->'revision','updatedAt',o.updated_at,'canEdit',public.admin_is_owner(actor));
END $$;
CREATE FUNCTION public.admin_user_ai_override_update(p_user text,p_expected bigint,p_unlimited boolean,p_markup integer,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; old jsonb; rev bigint;
BEGIN
 actor=public.admin_require_owner();
 IF p_expected IS NULL OR p_expected<0 OR p_unlimited IS NULL OR (p_markup IS NOT NULL AND p_markup NOT BETWEEN 0 AND 100000) OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid AI override' USING ERRCODE='22023'; END IF;
 old=public.admin_user_ai_override_read(p_user);
 rev=(old->>'revision')::bigint;
 IF rev<>p_expected THEN RAISE EXCEPTION 'AI override changed; reload before saving' USING ERRCODE='40001'; END IF;
 INSERT INTO public.credit_user_ai_override(user_id,revision,unlimited,markup_bps,changed_by,reason)
 VALUES(p_user,rev+1,p_unlimited,p_markup,actor,trim(p_reason));
 -- Validate the combined denomination and markup before committing.
 PERFORM public.credit_effective_policy(p_user);
 PERFORM public.admin_audit_append('credits.user_override.update','app_user',p_user,old,public.admin_user_ai_override_read(p_user),trim(p_reason));
 RETURN public.admin_user_ai_override_read(p_user);
END $$;

CREATE FUNCTION public.credit_spend_create_effective(p_user text,p_operation text,p_revision bigint,p_override bigint,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb; current_policy jsonb; pol jsonb; cost integer; b integer; d integer; held boolean; sid uuid; result jsonb; mode text;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_revision IS NULL OR p_override IS NULL OR p_hash IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 300 OR p_hash!~'^[a-f0-9]{64}$' OR p_operation NOT IN ('chatTurn','analysis','planDeck') THEN RAISE EXCEPTION 'Invalid spend reference' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(741290064);
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 -- Only current policy can authorize fresh work. A nested call may inherit the
 -- immutable policy of its already-started, unrefunded parent reservation.
 current_policy=public.credit_effective_policy(p_user);
 IF p_revision<>(current_policy->>'revision')::bigint OR p_override<>(current_policy->>'overrideRevision')::bigint THEN
  IF position(':deep:' IN p_key)=0 OR NOT EXISTS(
   SELECT 1 FROM public.credit_spend s WHERE s.user_id=p_user AND s.request_key=split_part(p_key,':deep:',1)
   AND s.pricing_revision=p_revision AND s.override_revision=p_override
   AND s.provider_started_at IS NOT NULL AND s.refunded_at IS NULL
   AND s.created_at>now()-interval '15 minutes'
  ) THEN RAISE EXCEPTION 'Pricing changed; request a fresh quote' USING ERRCODE='40001'; END IF;
 END IF;
 q=public.credit_effective_policy(p_user,p_revision,p_override); pol=q->'policy';
 mode=CASE WHEN (q->>'unlimited')::boolean THEN 'unlimited' ELSE 'paid' END;
 IF NOT (pol->>'enabled')::boolean AND mode<>'unlimited' THEN RAISE EXCEPTION 'Invalid pricing revision' USING ERRCODE='22023'; END IF;
 cost=CASE WHEN mode='unlimited' THEN 0 ELSE greatest(1,ceil((pol->'estimatedMicroUsd'->>p_operation)::numeric*(10000+(pol->>'markupBps')::numeric)/((pol->>'microUsdPerCredit')::numeric*10000)))::int END;
 PERFORM pg_advisory_xact_lock(hashtextextended('credit.spend:'||p_user||':'||p_key,0));
 IF EXISTS(SELECT 1 FROM public.credit_spend WHERE user_id=p_user AND request_key=p_key) THEN RAISE EXCEPTION 'This operation was already accepted; send a new message' USING ERRCODE='40001'; END IF;
 INSERT INTO public.credit_wallet_control(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT debt INTO d FROM public.credit_wallet_control WHERE user_id=p_user FOR UPDATE;
 SELECT balance INTO b FROM public.decke_credit_balance WHERE user_id::text=p_user FOR UPDATE;
 held=d>0 OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost')));
 IF coalesce(b,0)<cost OR held THEN RETURN jsonb_build_object('allowed',false,'balance',coalesce(b,0),'needed',cost,'debt',d,'held',held); END IF;
 INSERT INTO public.credit_spend(user_id,request_key,payload_hash,operation,credits,pricing_revision,override_revision,pricing_snapshot,charge_mode)
 VALUES(p_user,p_key,p_hash,p_operation,cost,p_revision,p_override,q,mode) RETURNING id INTO sid;
 IF cost>0 THEN result=public.credit_apply_delta(p_user,-cost,'spend',p_operation,'spend:'||sid,p_revision,q);
 ELSE result=jsonb_build_object('balance',coalesce(b,0),'debt',d); END IF;
 RETURN result||jsonb_build_object('allowed',true,'spent',cost,'spendId',sid,'unlimited',mode='unlimited');
END $$;

CREATE OR REPLACE FUNCTION public.credit_spend_create(p_user text,p_operation text,p_revision bigint,p_key text,p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.credit_spend_create_effective(p_user,p_operation,p_revision,(public.credit_effective_policy(p_user)->>'overrideRevision')::bigint,p_key,p_hash)
$$;
CREATE OR REPLACE FUNCTION public.credit_spend_refund(p_user text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.credit_spend;
BEGIN
 SELECT * INTO s FROM public.credit_spend WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR s.provider_started_at IS NOT NULL OR s.refunded_at IS NOT NULL THEN RETURN false; END IF;
 IF s.credits>0 THEN PERFORM public.credit_apply_delta(p_user,s.credits,'grant','Cancelled before provider invocation','spend-refund:'||s.id,s.pricing_revision,s.pricing_snapshot); END IF;
 UPDATE public.credit_spend SET refunded_at=now() WHERE id=s.id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.credit_quote_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb; p jsonb; prices jsonb='{}'::jsonb; k text; cost integer; actor text;
BEGIN
 actor=public.credit_server_actor(); r=public.credit_effective_policy(actor); p=r->'policy';
 FOREACH k IN ARRAY ARRAY['chatTurn','analysis','planDeck'] LOOP
  cost=CASE WHEN (r->>'unlimited')::boolean THEN 0 ELSE greatest(1,ceil((p->'estimatedMicroUsd'->>k)::numeric*(10000+(p->>'markupBps')::numeric)/((p->>'microUsdPerCredit')::numeric*10000)))::integer END;
  prices=prices||jsonb_build_object(k,cost);
 END LOOP;
 RETURN jsonb_build_object('enabled',(p->>'enabled')::boolean,'unlimited',r->'unlimited','overrideRevision',r->'overrideRevision','lowAt',(p->>'lowBalance')::integer,'prices',prices,'pricingRevision',r->'revision');
END $$;
-- Lock in the same order for starts: governance, spend, payment orders, wallet.
-- Permission and holds are read AFTER every potentially blocking row lock.
CREATE FUNCTION public.credit_spend_lock_authorize(p_user text,p_id uuid) RETURNS public.credit_spend
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.credit_spend;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO s FROM public.credit_spend WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR s.refunded_at IS NOT NULL OR (s.provider_started_at IS NULL AND s.created_at<=now()-interval '5 minutes') THEN
  RAISE EXCEPTION 'Spend is not available for provider invocation' USING ERRCODE='40001';
 END IF;
 PERFORM id FROM public.credit_order WHERE user_id=p_user ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.credit_wallet_control WHERE user_id=p_user FOR UPDATE;
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.credit_wallet_control WHERE user_id=p_user AND debt>0)
 OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))) THEN
  RAISE EXCEPTION 'Credit account is on hold' USING ERRCODE='42501';
 END IF;
 RETURN s;
END $$;
CREATE OR REPLACE FUNCTION public.credit_spend_start(p_user text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.credit_spend;
BEGIN
 s=public.credit_spend_lock_authorize(p_user,p_id);
 IF s.provider_started_at IS NOT NULL THEN RAISE EXCEPTION 'Spend already started' USING ERRCODE='40001'; END IF;
 UPDATE public.credit_spend SET provider_started_at=now() WHERE id=s.id;
END $$;

CREATE OR REPLACE FUNCTION public.credit_admin_summary(p_days integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.admin_require_permission('credits.read');
 IF p_days IS NULL OR p_days NOT IN (7,30,90) THEN RAISE EXCEPTION 'Choose 7, 30, or 90 days' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('days',p_days,
 'creditsSpent',coalesce(sum(-delta) FILTER(WHERE delta<0),0),
 'creditsGranted',coalesce(sum(delta) FILTER(WHERE delta>0),0),
 'estimatedProviderMicroUsd',coalesce(sum((coalesce(pricing_snapshot->'policy',pricing_snapshot)->'estimatedMicroUsd'->>reason)::numeric) FILTER(WHERE kind='spend' AND reason IN ('chatTurn','analysis','planDeck')),0),
 'unpricedSpends',count(*) FILTER(WHERE kind='spend' AND (coalesce(pricing_snapshot->'policy',pricing_snapshot)->'estimatedMicroUsd'->>reason) IS NULL)) INTO result
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

DO $acl$
DECLARE role_name text; signature text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  IF role_name='PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.credit_user_ai_override FROM %s',CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END);
   FOREACH signature IN ARRAY ARRAY['credit_spend_lock_authorize(text,uuid)','credit_effective_policy(text,bigint,bigint)','credit_spend_create_effective(text,text,bigint,bigint,text,text)','admin_user_ai_override_read(text)','admin_user_ai_override_update(text,bigint,boolean,integer,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %s',signature,CASE WHEN role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END);
   END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.admin_user_ai_override_read(text),public.admin_user_ai_override_update(text,bigint,boolean,integer,text) TO authenticated;
 END IF;
END $acl$;
