-- Versioned estimated usage prices. Existing balances and ledger deltas are unchanged.
CREATE TABLE public.credit_policy_revision (
 revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 policy jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.credit_policy_current (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 revision bigint NOT NULL REFERENCES public.credit_policy_revision(revision)
);
CREATE TABLE public.credit_pack (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 credits integer NOT NULL CHECK (credits BETWEEN 1 AND 1000000),
 price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 50000),
 currency text NOT NULL DEFAULT 'usd' CHECK (currency='usd'),
 active boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.credit_wallet_control (
 user_id text PRIMARY KEY,
 debt integer NOT NULL DEFAULT 0 CHECK (debt>=0),
 stripe_customer_id text UNIQUE,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.credit_order (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL,
 pack_id uuid NOT NULL REFERENCES public.credit_pack(id),
 pack_revision integer NOT NULL,
 pack_name text NOT NULL,
 credits integer NOT NULL CHECK (credits>0),
 price_cents integer NOT NULL CHECK(price_cents>0),
 currency text NOT NULL CHECK(currency='usd'),
 pricing_revision bigint NOT NULL REFERENCES public.credit_policy_revision(revision),
 attempt_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','refunded','disputed')),
 stripe_customer_id text,
 stripe_session_id text UNIQUE,
 stripe_payment_intent_id text UNIQUE,
 checkout_url text,
 livemode boolean,
 granted_at timestamptz,
 reconciliation_revision integer NOT NULL DEFAULT 0 CHECK (reconciliation_revision>=0),
 reversed_credits integer NOT NULL DEFAULT 0 CHECK (reversed_credits>=0),
 refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents>=0),
 pending_refund_cents integer NOT NULL DEFAULT 0 CHECK (pending_refund_cents>=0),
 dispute_id text,
 dispute_status text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,attempt_key)
);
CREATE INDEX credit_order_user_created ON public.credit_order(user_id,created_at DESC);
ALTER TABLE public.decke_credit_event ADD COLUMN pricing_revision bigint REFERENCES public.credit_policy_revision(revision);
ALTER TABLE public.decke_credit_event ADD COLUMN pricing_snapshot jsonb;
ALTER TABLE public.decke_credit_event ADD COLUMN debt_delta integer NOT NULL DEFAULT 0;
CREATE TABLE public.credit_spend (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL,
 request_key text NOT NULL,
 payload_hash text NOT NULL,
 operation text NOT NULL,
 credits integer NOT NULL CHECK(credits>0),
 pricing_revision bigint NOT NULL REFERENCES public.credit_policy_revision(revision),
 provider_started_at timestamptz,
 refunded_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key)
);
CREATE TABLE public.credit_adjustment (
 user_id text NOT NULL,
 attempt_key text NOT NULL,
 actor_id text NOT NULL,
 delta integer NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,attempt_key)
);

CREATE FUNCTION public.credit_validate_policy(p jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE k text; e jsonb; n numeric; denom numeric;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT p ?& ARRAY['enabled','microUsdPerCredit','markupBps','estimatedMicroUsd','lowBalance']
   OR p - ARRAY['enabled','microUsdPerCredit','markupBps','estimatedMicroUsd','lowBalance'] <> '{}'::jsonb
   OR jsonb_typeof(p->'enabled')<>'boolean' THEN RAISE EXCEPTION 'Invalid credit policy' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['microUsdPerCredit','markupBps','lowBalance'] LOOP
  IF jsonb_typeof(p->k)<>'number' OR (p->>k)!~'^[0-9]+$' THEN RAISE EXCEPTION 'Invalid integer policy field: %',k USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (p->>'microUsdPerCredit')::numeric NOT BETWEEN 1 AND 1000000000 OR
 (p->>'markupBps')::numeric NOT BETWEEN 0 AND 100000 OR (p->>'lowBalance')::numeric NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Credit policy out of range' USING ERRCODE='22023'; END IF;
 e=p->'estimatedMicroUsd';
 IF jsonb_typeof(e)<>'object' OR NOT e ?& ARRAY['chatTurn','analysis','planDeck'] OR e-ARRAY['chatTurn','analysis','planDeck']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid estimates' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['chatTurn','analysis','planDeck'] LOOP
  IF jsonb_typeof(e->k)<>'number' OR (e->>k)!~'^[0-9]+$' OR (e->>k)::numeric NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Invalid estimate: %',k USING ERRCODE='22023'; END IF;
  n=ceil((e->>k)::numeric*(10000+(p->>'markupBps')::numeric)/((p->>'microUsdPerCredit')::numeric*10000));
  IF n>2147483647 THEN RAISE EXCEPTION 'Credit quote overflows balance' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.credit_policy_initialize(p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('deckpal.credit.policy',0));
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Enablement must be boolean' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.credit_policy_current) THEN RETURN; END IF;
 INSERT INTO public.credit_policy_revision(policy) VALUES(jsonb_build_object(
 'enabled',p_enabled,'microUsdPerCredit',10000,'markupBps',0,'lowBalance',100,
 'estimatedMicroUsd',jsonb_build_object('chatTurn',143,'analysis',35600,'planDeck',750000))) RETURNING revision INTO r;
 INSERT INTO public.credit_policy_current VALUES(true,r);
END $$;

CREATE FUNCTION public.credit_policy_read() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy',r.policy,'revision',r.revision,'updatedAt',r.created_at)
 FROM public.credit_policy_current c JOIN public.credit_policy_revision r USING(revision)
$$;

CREATE FUNCTION public.credit_policy_save(p jsonb,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old jsonb; r bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 PERFORM public.admin_require_permission('credits.manage');
 PERFORM public.credit_validate_policy(p);
 PERFORM pg_advisory_xact_lock(hashtextextended('deckpal.credit.policy',0));
 old=public.credit_policy_read();
 IF p_expected IS NULL OR old IS NULL OR (old->>'revision')::bigint<>p_expected THEN RAISE EXCEPTION 'Credit settings changed; reload before saving' USING ERRCODE='40001'; END IF;
 INSERT INTO public.credit_policy_revision(policy) VALUES(p) RETURNING revision INTO r;
 UPDATE public.credit_policy_current SET revision=r;
 PERFORM public.admin_audit_append('credits.policy.update','credit_policy',r::text,old,public.credit_policy_read(),NULL);
 RETURN public.credit_policy_read();
END $$;

CREATE FUNCTION public.credit_pack_save(p_id uuid,p jsonb,p_expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old public.credit_pack; fresh public.credit_pack;
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 PERFORM public.admin_require_permission('credits.manage');
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT p ?& ARRAY['name','credits','priceCents','currency','active'] OR
 p-ARRAY['name','credits','priceCents','currency','active']<>'{}'::jsonb OR
 jsonb_typeof(p->'name')<>'string' OR length(trim(p->>'name')) NOT BETWEEN 1 AND 80 OR
 jsonb_typeof(p->'credits')<>'number' OR (p->>'credits')!~'^[0-9]+$' OR (p->>'credits')::numeric NOT BETWEEN 1 AND 1000000 OR
 jsonb_typeof(p->'priceCents')<>'number' OR (p->>'priceCents')!~'^[0-9]+$' OR (p->>'priceCents')::numeric NOT BETWEEN 100 AND 50000 OR
 p->>'currency'<>'usd' OR jsonb_typeof(p->'active')<>'boolean'
 THEN RAISE EXCEPTION 'Invalid credit pack' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.credit_pack(name,credits,price_cents,currency,active)
  VALUES(trim(p->>'name'),(p->>'credits')::int,(p->>'priceCents')::int,'usd',(p->>'active')::bool) RETURNING * INTO fresh;
 ELSE
  SELECT * INTO old FROM public.credit_pack WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pack not found' USING ERRCODE='P0002'; END IF;
  IF p_expected IS NULL OR old.revision<>p_expected THEN RAISE EXCEPTION 'Pack changed; reload before saving' USING ERRCODE='40001'; END IF;
  UPDATE public.credit_pack SET name=trim(p->>'name'),credits=(p->>'credits')::int,price_cents=(p->>'priceCents')::int,
   active=(p->>'active')::bool,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO fresh;
 END IF;
 PERFORM public.admin_audit_append('credits.pack.save','credit_pack',fresh.id::text,to_jsonb(old),to_jsonb(fresh),NULL);
 RETURN to_jsonb(fresh);
END $$;

-- The only balance-moving primitive. Called inside the same statement/transaction as
-- its immutable event, order/spend state and administrative audit.
CREATE FUNCTION public.credit_apply_delta(p_user text,p_delta integer,p_kind text,p_reason text,p_ref text,p_revision bigint DEFAULT NULL,p_snapshot jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b integer; d integer; db integer; dd integer; addition integer;
BEGIN
 INSERT INTO public.credit_wallet_control(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT debt INTO d FROM public.credit_wallet_control WHERE user_id=p_user FOR UPDATE;
 INSERT INTO public.decke_credit_balance(user_id,balance) SELECT id,0 FROM public.app_user WHERE id::text=p_user ON CONFLICT DO NOTHING;
 SELECT balance INTO b FROM public.decke_credit_balance WHERE user_id::text=p_user FOR UPDATE;
 IF b IS NULL THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 IF p_delta>=0 THEN dd=-least(d,p_delta); db=p_delta+dd;
 ELSE db=-least(b,-p_delta); dd=-p_delta+db; END IF;
 INSERT INTO public.decke_credit_event(user_id,delta,kind,reason,ref,pricing_revision,pricing_snapshot,debt_delta)
 SELECT id,db,p_kind,p_reason,p_ref,p_revision,p_snapshot,dd FROM public.app_user WHERE id::text=p_user;
 UPDATE public.decke_credit_balance SET balance=balance+db,updated_at=now() WHERE user_id::text=p_user RETURNING balance INTO b;
 UPDATE public.credit_wallet_control SET debt=debt+dd,updated_at=now() WHERE user_id=p_user RETURNING debt INTO d;
 RETURN jsonb_build_object('balance',b,'debt',d);
END $$;

CREATE FUNCTION public.credit_adjust(p_user text,p_delta integer,p_reason text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; old public.credit_adjustment; result jsonb; before_state jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 actor=public.admin_require_permission('credits.manage');
 IF p_delta IS NULL OR p_reason IS NULL OR p_key IS NULL OR p_delta=0 OR p_delta NOT BETWEEN -1000000 AND 1000000 OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 OR p_key!~'^[A-Za-z0-9_-]{8,100}$' THEN RAISE EXCEPTION 'Invalid credit adjustment' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('credit.adjust:'||p_user||':'||p_key,0));
 SELECT * INTO old FROM public.credit_adjustment WHERE user_id=p_user AND attempt_key=p_key;
 IF FOUND THEN
  IF old.delta<>p_delta OR old.reason<>trim(p_reason) OR old.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different adjustment' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('duplicate',true);
 END IF;
 SELECT jsonb_build_object('balance',b.balance,'debt',coalesce(w.debt,0)) INTO before_state FROM public.decke_credit_balance b LEFT JOIN public.credit_wallet_control w ON w.user_id=b.user_id::text WHERE b.user_id::text=p_user;
 INSERT INTO public.credit_adjustment VALUES(p_user,p_key,actor,p_delta,trim(p_reason),now());
 result=public.credit_apply_delta(p_user,p_delta,CASE WHEN p_delta>0 THEN 'grant' ELSE 'spend' END,trim(p_reason),'adjust:'||p_user||':'||p_key);
 PERFORM public.admin_audit_append('credits.adjust','user',p_user,before_state,result,trim(p_reason));
 RETURN result;
END $$;

CREATE FUNCTION public.credit_spend_create(p_user text,p_operation text,p_revision bigint,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pol jsonb; cost integer; b integer; d integer; sid uuid; result jsonb;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_revision IS NULL OR p_hash IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 300 OR p_hash!~'^[a-f0-9]{64}$' OR p_operation NOT IN ('chatTurn','analysis','planDeck') THEN RAISE EXCEPTION 'Invalid spend reference' USING ERRCODE='22023'; END IF;
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 SELECT policy INTO pol FROM public.credit_policy_revision WHERE revision=p_revision;
 IF pol IS NULL OR NOT (pol->>'enabled')::bool THEN RAISE EXCEPTION 'Invalid pricing revision' USING ERRCODE='22023'; END IF;
 cost=greatest(1,ceil((pol->'estimatedMicroUsd'->>p_operation)::numeric*(10000+(pol->>'markupBps')::numeric)/((pol->>'microUsdPerCredit')::numeric*10000)))::int;
 PERFORM pg_advisory_xact_lock(hashtextextended('credit.spend:'||p_user||':'||p_key,0));
 IF EXISTS(SELECT 1 FROM public.credit_spend WHERE user_id=p_user AND request_key=p_key) THEN RAISE EXCEPTION 'This operation was already accepted; send a new message' USING ERRCODE='40001'; END IF;
 INSERT INTO public.credit_wallet_control(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT debt INTO d FROM public.credit_wallet_control WHERE user_id=p_user FOR UPDATE;
 SELECT balance INTO b FROM public.decke_credit_balance WHERE user_id::text=p_user FOR UPDATE;
 IF coalesce(b,0)<cost OR d>0 OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))) THEN
  RETURN jsonb_build_object('allowed',false,'balance',coalesce(b,0),'needed',cost,'debt',d,'held',d>0 OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))));
 END IF;
 INSERT INTO public.credit_spend(user_id,request_key,payload_hash,operation,credits,pricing_revision) VALUES(p_user,p_key,p_hash,p_operation,cost,p_revision) RETURNING id INTO sid;
 result=public.credit_apply_delta(p_user,-cost,'spend',p_operation,'spend:'||sid,p_revision,pol);
 RETURN result||jsonb_build_object('allowed',true,'spent',cost,'spendId',sid);
END $$;

CREATE FUNCTION public.credit_spend_start(p_user text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.credit_wallet_control WHERE user_id=p_user AND debt>0) OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND (pending_refund_cents>0 OR dispute_status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))) THEN RAISE EXCEPTION 'Credit account is on hold' USING ERRCODE='42501'; END IF;
 UPDATE public.credit_spend SET provider_started_at=now() WHERE id=p_id AND user_id=p_user AND refunded_at IS NULL AND provider_started_at IS NULL AND created_at>now()-interval '5 minutes';
 IF NOT FOUND THEN RAISE EXCEPTION 'Spend is not available for provider invocation' USING ERRCODE='40001'; END IF;
END $$;

CREATE FUNCTION public.credit_spend_refund(p_user text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.credit_spend;
BEGIN
 SELECT * INTO s FROM public.credit_spend WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR s.provider_started_at IS NOT NULL OR s.refunded_at IS NOT NULL THEN RETURN false; END IF;
 PERFORM public.credit_apply_delta(p_user,s.credits,'grant','Cancelled before provider invocation','spend-refund:'||s.id,s.pricing_revision);
 UPDATE public.credit_spend SET refunded_at=now() WHERE id=s.id;
 RETURN true;
END $$;

-- migrateUp commits each numbered file independently. Close inherited/default
-- client ACLs in the creation transaction, even if the upgrade stops here.
-- Later security migrations grant only the intended client RPCs. The creator
-- and existing explicit trusted-server grants remain intact; no role/default
-- privilege settings or unrelated schema objects are changed.
DO $creation_acl$
DECLARE principal text; grantee_sql text; object_name text; signature text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  IF principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal) THEN CONTINUE; END IF;
  grantee_sql:=CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END;
  FOREACH object_name IN ARRAY ARRAY['credit_policy_revision','credit_policy_current','credit_pack','credit_wallet_control','credit_order','credit_spend','credit_adjustment'] LOOP
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %s',object_name,grantee_sql);
  END LOOP;
  EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM %s','credit_policy_revision_revision_seq',grantee_sql);
  FOREACH signature IN ARRAY ARRAY[
   'public.credit_validate_policy(jsonb)',
   'public.credit_policy_initialize(boolean)',
   'public.credit_policy_read()',
   'public.credit_policy_save(jsonb,bigint)',
   'public.credit_pack_save(uuid,jsonb,integer)',
   'public.credit_apply_delta(text,integer,text,text,text,bigint,jsonb)',
   'public.credit_adjust(text,integer,text,text)',
   'public.credit_spend_create(text,text,bigint,text,text)',
   'public.credit_spend_start(text,uuid)',
   'public.credit_spend_refund(text,uuid)'
  ] LOOP
   EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s',signature::regprocedure,grantee_sql);
  END LOOP;
 END LOOP;
END $creation_acl$;
