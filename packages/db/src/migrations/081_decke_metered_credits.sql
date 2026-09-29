-- Metered Deck-E legs reserve whole credits, then settle the exact aggregate
-- Gateway cost against one per-user fractional liability.
ALTER TABLE public.decke_ai_request
  ALTER COLUMN charged_credits TYPE numeric(24,12)
  USING charged_credits::numeric;

CREATE TABLE public.decke_metered_credit (
  user_id text PRIMARY KEY,
  fractional_credits numeric(20,12) NOT NULL DEFAULT 0
    CHECK (fractional_credits>=0 AND fractional_credits<1)
);
CREATE TABLE public.decke_metered_reservation (
  request_id uuid PRIMARY KEY REFERENCES public.decke_ai_request(id),
  user_id text NOT NULL,
  held_credits integer NOT NULL CHECK (held_credits>=0),
  cap_credits numeric(24,12) NOT NULL CHECK (cap_credits>=0),
  provider_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decke_metered_reservation_user_created
  ON public.decke_metered_reservation(user_id,created_at);
CREATE TABLE public.decke_metered_settlement (
  request_id uuid PRIMARY KEY REFERENCES public.decke_ai_request(id),
  user_id text NOT NULL,
  known_cost_usd numeric(24,12) NOT NULL CHECK (known_cost_usd>=0),
  credits numeric(24,12) NOT NULL CHECK (credits>=0),
  whole_credits integer NOT NULL CHECK (whole_credits>=0),
  unknown_operations integer NOT NULL CHECK (unknown_operations>=0),
  coverage text NOT NULL CHECK (coverage IN ('complete','partial','unknown')),
  status text NOT NULL CHECK (status IN ('completed','failed','cancelled','abandoned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.decke_metered_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_metered_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_metered_settlement ENABLE ROW LEVEL SECURITY;

-- Migration 077's accumulator represented the same customer liability. Move
-- it instead of letting import fixes and chat round independently.
INSERT INTO public.decke_metered_credit(user_id,fractional_credits)
SELECT user_id,fractional_credits FROM public.decke_import_fix_credit
WHERE fractional_credits<>0
ON CONFLICT(user_id) DO UPDATE SET fractional_credits=EXCLUDED.fractional_credits;
UPDATE public.decke_import_fix_credit SET fractional_credits=0
WHERE fractional_credits<>0;

CREATE OR REPLACE FUNCTION public.credit_validate_policy(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k text; e jsonb; n numeric; v2 boolean;
BEGIN
 v2=jsonb_typeof(p)='object' AND p->>'version'='2';
 IF v2 THEN
  IF p-ARRAY['version','enabled','microUsdPerCredit','markupBps','lowBalance','legHoldCredits','legHoldMinCredits']<>'{}'::jsonb
    OR NOT p ?& ARRAY['version','enabled','microUsdPerCredit','markupBps','lowBalance','legHoldCredits','legHoldMinCredits']
    OR jsonb_typeof(p->'version')<>'number' OR jsonb_typeof(p->'enabled')<>'boolean' THEN
   RAISE EXCEPTION 'Invalid credit policy' USING ERRCODE='22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['microUsdPerCredit','markupBps','lowBalance','legHoldCredits','legHoldMinCredits'] LOOP
   IF jsonb_typeof(p->k)<>'number' OR (p->>k)!~'^[0-9]+$' THEN
    RAISE EXCEPTION 'Invalid integer policy field: %',k USING ERRCODE='22023';
   END IF;
  END LOOP;
  IF (p->>'microUsdPerCredit')::numeric NOT BETWEEN 1 AND 1000000000
    OR (p->>'markupBps')::numeric NOT BETWEEN 0 AND 100000
    OR (p->>'lowBalance')::numeric NOT BETWEEN 0 AND 1000000
    OR (p->>'legHoldMinCredits')::numeric<1
    OR (p->>'legHoldMinCredits')::numeric>(p->>'legHoldCredits')::numeric
    OR (p->>'legHoldCredits')::numeric>10000 THEN
   RAISE EXCEPTION 'Credit policy out of range' USING ERRCODE='22023';
  END IF;
  RETURN;
 END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object'
   OR NOT p ?& ARRAY['enabled','microUsdPerCredit','markupBps','estimatedMicroUsd','lowBalance']
   OR p-ARRAY['enabled','microUsdPerCredit','markupBps','estimatedMicroUsd','lowBalance']<>'{}'::jsonb
   OR jsonb_typeof(p->'enabled')<>'boolean' THEN
  RAISE EXCEPTION 'Invalid credit policy' USING ERRCODE='22023';
 END IF;
 FOREACH k IN ARRAY ARRAY['microUsdPerCredit','markupBps','lowBalance'] LOOP
  IF jsonb_typeof(p->k)<>'number' OR (p->>k)!~'^[0-9]+$' THEN
   RAISE EXCEPTION 'Invalid integer policy field: %',k USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (p->>'microUsdPerCredit')::numeric NOT BETWEEN 1 AND 1000000000
   OR (p->>'markupBps')::numeric NOT BETWEEN 0 AND 100000
   OR (p->>'lowBalance')::numeric NOT BETWEEN 0 AND 1000000 THEN
  RAISE EXCEPTION 'Credit policy out of range' USING ERRCODE='22023';
 END IF;
 e=p->'estimatedMicroUsd';
 IF jsonb_typeof(e)<>'object' OR NOT e ?& ARRAY['chatTurn','analysis','planDeck']
   OR e-ARRAY['chatTurn','analysis','planDeck']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid estimates' USING ERRCODE='22023';
 END IF;
 FOREACH k IN ARRAY ARRAY['chatTurn','analysis','planDeck'] LOOP
  IF jsonb_typeof(e->k)<>'number' OR (e->>k)!~'^[0-9]+$'
    OR (e->>k)::numeric NOT BETWEEN 0 AND 1000000000 THEN
   RAISE EXCEPTION 'Invalid estimate: %',k USING ERRCODE='22023';
  END IF;
  n=ceil((e->>k)::numeric*(10000+(p->>'markupBps')::numeric)
    /((p->>'microUsdPerCredit')::numeric*10000));
  IF n>2147483647 THEN
   RAISE EXCEPTION 'Credit quote overflows balance' USING ERRCODE='22023';
  END IF;
 END LOOP;
END $$;

-- Fresh databases reach 081 before runtime initialization. They must initialize
-- directly into v2, while upgraded databases get a new immutable revision below.
CREATE OR REPLACE FUNCTION public.credit_policy_initialize(p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('deckpal.credit.policy',0));
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Enablement must be boolean' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.credit_policy_current) THEN RETURN; END IF;
 INSERT INTO public.credit_policy_revision(policy) VALUES(jsonb_build_object(
  'version',2,'enabled',p_enabled,'microUsdPerCredit',10000,'markupBps',0,'lowBalance',100,
  'legHoldCredits',25,'legHoldMinCredits',3)) RETURNING revision INTO r;
 INSERT INTO public.credit_policy_current VALUES(true,r);
END $$;

DO $policy_upgrade$
DECLARE old_policy jsonb; next_revision bigint;
BEGIN
 SELECT r.policy INTO old_policy
 FROM public.credit_policy_current c JOIN public.credit_policy_revision r USING(revision)
 WHERE c.singleton FOR UPDATE OF c;
 IF old_policy IS NOT NULL AND coalesce((old_policy->>'version')::integer,1)<>2 THEN
  INSERT INTO public.credit_policy_revision(policy) VALUES(jsonb_build_object(
   'version',2,
   'enabled',(old_policy->>'enabled')::boolean,
   'microUsdPerCredit',(old_policy->>'microUsdPerCredit')::integer,
   'markupBps',(old_policy->>'markupBps')::integer,
   'lowBalance',(old_policy->>'lowBalance')::integer,
   'legHoldCredits',25,
   'legHoldMinCredits',3
  )) RETURNING revision INTO next_revision;
  UPDATE public.credit_policy_current SET revision=next_revision WHERE singleton;
 END IF;
END $policy_upgrade$;

CREATE FUNCTION public.decke_metered_actor(p_require_active boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
 actor text:=public.admin_actor_id();
BEGIN
 IF actor IS NULL OR NOT public.admin_is_session()
   OR coalesce((claims->>'deckpal_server_request')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'A DeckPal server request is required' USING ERRCODE='42501';
 END IF;
 IF p_require_active AND NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

-- Authorise a metered call on a request owned by p_owner. The chat function
-- (api/chat.mjs) reaches these entry points on the API's own privileged pool
-- connection, which carries no JWT claims: only the server holds those
-- credentials, and that role can already read and write every table here, so
-- the connection itself is the proof. A connection that has switched to a
-- client role (Express's per-user RLS transactions, PostgREST as anon or
-- authenticated) or that PostgREST opened (session user 'authenticator') must
-- instead carry the verified subject and the API's server claim. Inside this
-- SECURITY DEFINER function current_user is the owner, so the caller's role is
-- read from the 'role' setting and session_user.
CREATE FUNCTION public.decke_metered_authorize(p_owner text,p_require_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;
BEGIN
 IF coalesce(current_setting('role',true),'none') IN ('none','')
    AND session_user::text NOT IN ('authenticator','anon','authenticated') THEN
  IF p_owner IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  IF p_require_active AND NOT public.admin_account_active(p_owner) THEN
   RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
  END IF;
  RETURN;
 END IF;
 actor=public.decke_metered_actor(p_require_active);
 IF p_owner IS NULL OR actor<>p_owner THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION public.decke_metered_known_credits(p_request uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.decke_ai_request; p jsonb; known_usd numeric(24,12);
BEGIN
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 p=public.credit_effective_policy(r.user_id,r.pricing_revision,r.override_revision)->'policy';
 SELECT coalesce(sum(cost_usd),0) INTO known_usd
 FROM public.decke_ai_operation WHERE request_id=p_request;
 RETURN round(known_usd*1000000*(10000+(p->>'markupBps')::numeric)
   /((p->>'microUsdPerCredit')::numeric*10000),12);
END $$;

-- The carry is a fraction of a credit already used but not yet taken from the
-- whole-credit balance. While the balance covers it, the spendable balance is
-- balance minus carry; once an overrun has emptied the balance, the uncovered
-- fraction is owed like any other debt instead of showing a negative wallet.
-- It is never rounded up: the next whole credit that arrives settles it.
CREATE FUNCTION public.decke_metered_spendable(p_balance integer,p_carry numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT round(greatest(0::numeric,coalesce(p_balance,0)-coalesce(p_carry,0)),12) $$;
CREATE FUNCTION public.decke_metered_owed(p_debt integer,p_balance integer,p_carry numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT trim_scale(coalesce(p_debt,0)+greatest(0::numeric,coalesce(p_carry,0)-coalesce(p_balance,0))) $$;

CREATE FUNCTION public.decke_metered_begin(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; r public.decke_ai_request; reservation public.decke_metered_reservation;
 effective jsonb; policy jsonb; balance_now integer; debt_now integer; payment_hold boolean;
 carry numeric(20,12):=0; available numeric(24,12); held integer; cap numeric(24,12); moved jsonb;
BEGIN
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
 IF debt_now>0 OR carry>balance_now THEN
  RETURN jsonb_build_object('allowed',false,'mode','paid','reason','debt',
   'balance',public.decke_metered_spendable(balance_now,carry)::text,
   'debt',public.decke_metered_owed(debt_now,balance_now,carry));
 END IF;
 IF available<(policy->>'legHoldMinCredits')::integer THEN
  RETURN jsonb_build_object('allowed',false,'mode','paid','reason','insufficient',
   'balance',public.decke_metered_spendable(balance_now,carry)::text,
   'needed',(policy->>'legHoldMinCredits')::integer);
 END IF;
 held=least((policy->>'legHoldCredits')::integer,balance_now);
 cap=held-carry;
 INSERT INTO public.decke_metered_reservation(request_id,user_id,held_credits,cap_credits)
  VALUES(p_request,actor,held,cap);
 moved=public.credit_apply_delta(actor,-held,'spend','Deck-E chat hold',
  'metered-reserve:'||p_request::text,r.pricing_revision,effective);
 RETURN jsonb_build_object('allowed',true,'mode','paid','heldCredits',held,
  'capCredits',cap::text,'balance',public.decke_metered_spendable((moved->>'balance')::integer,carry)::text);
END $$;

CREATE FUNCTION public.decke_metered_status(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; r public.decke_ai_request; reservation public.decke_metered_reservation; known numeric(24,12);
BEGIN
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.decke_metered_authorize(r.user_id,true);
 actor=r.user_id;
 SELECT * INTO reservation FROM public.decke_metered_reservation WHERE request_id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Metered reservation unavailable' USING ERRCODE='42501'; END IF;
 known=public.decke_metered_known_credits(p_request);
 RETURN jsonb_build_object('knownCredits',known::text,
  'capCredits',CASE WHEN r.charge_mode='paid' THEN reservation.cap_credits::text ELSE NULL END,
  'capReached',r.charge_mode='paid' AND known>=reservation.cap_credits);
END $$;

CREATE OR REPLACE FUNCTION public.decke_usage_operation_begin(
 p_id uuid,p_request uuid,p_category text,p_tool text,p_model text,p_provider text,p_key text,p_spend uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; r public.decke_ai_request; s public.credit_spend;
 reservation public.decke_metered_reservation; first_start boolean=false;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request AND status='started';
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.decke_metered_authorize(r.user_id,true);
 actor=r.user_id;
 IF p_spend IS NOT NULL THEN
  s=public.credit_spend_lock_authorize(r.user_id,p_spend);
  IF s.request_key IS DISTINCT FROM (CASE WHEN p_tool='chat_turn' THEN r.request_key ELSE r.request_key||':deep:'||p_key END) THEN
   RAISE EXCEPTION 'Spend does not belong to this operation' USING ERRCODE='42501';
  END IF;
  first_start=s.provider_started_at IS NULL;
  IF NOT first_start AND NOT EXISTS(SELECT 1 FROM public.decke_ai_operation
    WHERE request_id=r.id AND credit_spend_id=s.id AND NOT invocation_cancelled) THEN
   RAISE EXCEPTION 'Spend already started outside this request' USING ERRCODE='40001';
  END IF;
 ELSE
  SELECT * INTO reservation FROM public.decke_metered_reservation WHERE request_id=p_request FOR UPDATE;
  IF FOUND THEN
   IF r.charge_mode='paid' AND public.decke_metered_known_credits(p_request)>=reservation.cap_credits THEN
    RAISE EXCEPTION 'Metered credit cap reached' USING ERRCODE='DKCAP';
   END IF;
   IF r.charge_mode IN ('paid','unlimited') THEN
    PERFORM id FROM public.credit_order WHERE user_id=r.user_id ORDER BY id FOR SHARE;
    PERFORM 1 FROM public.credit_wallet_control WHERE user_id=r.user_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.credit_wallet_control WHERE user_id=r.user_id AND debt>0)
      OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=r.user_id AND
       (pending_refund_cents>0 OR dispute_status IN
        ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))) THEN
     RAISE EXCEPTION 'Credit account is on hold' USING ERRCODE='42501';
    END IF;
   END IF;
  ELSIF r.charge_mode<>'daily' THEN
   RAISE EXCEPTION 'A credit reservation is required' USING ERRCODE='42501';
  END IF;
 END IF;
 IF NOT public.admin_account_active(r.user_id) OR NOT public.admin_user_has_permission(r.user_id,'decke.use') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.decke_ai_operation(id,request_id,category,tool_key,model_id,provider,operation_key,credit_spend_id,starts_reservation)
 VALUES(p_id,p_request,p_category,p_tool,left(p_model,160),left(p_provider,80),left(p_key,160),p_spend,first_start);
 IF first_start THEN UPDATE public.credit_spend SET provider_started_at=now() WHERE id=s.id; END IF;
 IF p_spend IS NULL AND reservation.request_id IS NOT NULL THEN
  UPDATE public.decke_metered_reservation SET provider_started_at=coalesce(provider_started_at,now())
   WHERE request_id=p_request;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.decke_usage_external_operation_begin(
 p_id uuid,p_request uuid,p_tool text,p_model text,p_provider text,p_key text,p_spend uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; r public.decke_ai_request; s public.credit_spend;
 reservation public.decke_metered_reservation; first_start boolean=false;
BEGIN
 IF p_tool NOT IN ('jev_reflex','jev_audit') OR p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 160 THEN
  RAISE EXCEPTION 'Invalid external usage operation' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request AND status='started';
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.decke_metered_authorize(r.user_id,true);
 actor=r.user_id;
 IF p_spend IS NOT NULL THEN
  s=public.credit_spend_lock_authorize(r.user_id,p_spend);
  IF s.request_key IS DISTINCT FROM r.request_key THEN
   RAISE EXCEPTION 'Spend does not belong to this chat turn' USING ERRCODE='42501';
  END IF;
  first_start=s.provider_started_at IS NULL;
  IF NOT first_start AND NOT EXISTS(SELECT 1 FROM public.decke_ai_operation
    WHERE request_id=r.id AND credit_spend_id=s.id AND NOT invocation_cancelled) THEN
   RAISE EXCEPTION 'Spend already started outside this request' USING ERRCODE='40001';
  END IF;
 ELSE
  SELECT * INTO reservation FROM public.decke_metered_reservation WHERE request_id=p_request FOR UPDATE;
  IF FOUND THEN
   IF r.charge_mode='paid' AND public.decke_metered_known_credits(p_request)>=reservation.cap_credits THEN
    RAISE EXCEPTION 'Metered credit cap reached' USING ERRCODE='DKCAP';
   END IF;
   IF r.charge_mode IN ('paid','unlimited') THEN
    PERFORM id FROM public.credit_order WHERE user_id=r.user_id ORDER BY id FOR SHARE;
    PERFORM 1 FROM public.credit_wallet_control WHERE user_id=r.user_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.credit_wallet_control WHERE user_id=r.user_id AND debt>0)
      OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=r.user_id AND
       (pending_refund_cents>0 OR dispute_status IN
        ('needs_response','under_review','warning_needs_response','warning_under_review','lost'))) THEN
     RAISE EXCEPTION 'Credit account is on hold' USING ERRCODE='42501';
    END IF;
   END IF;
  ELSIF r.charge_mode<>'daily' THEN
   RAISE EXCEPTION 'A credit reservation is required' USING ERRCODE='42501';
  END IF;
 END IF;
 IF NOT public.admin_account_active(r.user_id) OR NOT public.admin_user_has_permission(r.user_id,'decke.use') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.decke_ai_operation(id,request_id,category,tool_key,model_id,provider,operation_key,credit_spend_id,starts_reservation)
 VALUES(p_id,p_request,'response',p_tool,left(p_model,160),left(p_provider,80),left(p_key,160),p_spend,first_start);
 IF first_start THEN UPDATE public.credit_spend SET provider_started_at=now() WHERE id=s.id; END IF;
 IF p_spend IS NULL AND reservation.request_id IS NOT NULL THEN
  UPDATE public.decke_metered_reservation SET provider_started_at=coalesce(provider_started_at,now())
   WHERE request_id=p_request;
 END IF;
END $$;

CREATE FUNCTION public.decke_metered_settle_core(p_request uuid,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.decke_ai_request; reservation public.decke_metered_reservation;
 settled public.decke_metered_settlement; effective jsonb; policy jsonb;
 known_usd numeric(24,12):=0; amount numeric(24,12):=0; carried numeric(20,12):=0;
 whole integer:=0; operation_count integer:=0; unknown_count integer:=0;
 coverage text; balance_now integer; final_balance numeric(24,12);
BEGIN
 IF p_status NOT IN ('completed','failed','cancelled','abandoned') THEN
  RAISE EXCEPTION 'Invalid metered settlement' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO settled FROM public.decke_metered_settlement WHERE request_id=p_request;
 IF FOUND THEN
  SELECT public.decke_metered_spendable(b.balance,c.fractional_credits)
   INTO final_balance FROM (SELECT 1) x
   LEFT JOIN public.decke_credit_balance b ON b.user_id::text=r.user_id
   LEFT JOIN public.decke_metered_credit c ON c.user_id=r.user_id;
  RETURN jsonb_build_object('credits',settled.credits::text,
   'wholeCredits',settled.whole_credits,'knownCostUsd',settled.known_cost_usd::text,
   'coverage',settled.coverage,'balance',final_balance::text);
 END IF;
 IF r.status<>'started' THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO reservation FROM public.decke_metered_reservation
  WHERE request_id=p_request AND user_id=r.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Metered reservation unavailable' USING ERRCODE='42501'; END IF;
 SELECT count(*)::integer,count(*) FILTER(WHERE cost_usd IS NULL)::integer,coalesce(sum(cost_usd),0)
  INTO operation_count,unknown_count,known_usd
  FROM public.decke_ai_operation WHERE request_id=p_request;
 coverage=CASE WHEN operation_count=0 OR operation_count=unknown_count THEN 'unknown'
  WHEN unknown_count=0 THEN 'complete' ELSE 'partial' END;
 IF r.charge_mode='paid' THEN
  effective=public.credit_effective_policy(r.user_id,r.pricing_revision,r.override_revision);
  policy=effective->'policy';
  IF policy->>'version'<>'2' THEN
   RAISE EXCEPTION 'Metered accounting requires a v2 pricing revision' USING ERRCODE='22023';
  END IF;
  amount=round(known_usd*1000000*(10000+(policy->>'markupBps')::numeric)
    /((policy->>'microUsdPerCredit')::numeric*10000),12);
  INSERT INTO public.credit_wallet_control(user_id) VALUES(r.user_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.credit_wallet_control WHERE user_id=r.user_id FOR UPDATE;
  PERFORM 1 FROM public.decke_credit_balance WHERE user_id::text=r.user_id FOR UPDATE;
  INSERT INTO public.decke_metered_credit(user_id) VALUES(r.user_id) ON CONFLICT DO NOTHING;
  SELECT fractional_credits INTO carried FROM public.decke_metered_credit WHERE user_id=r.user_id FOR UPDATE;
  whole=floor(carried+amount)::integer;
  UPDATE public.decke_metered_credit SET fractional_credits=carried+amount-whole WHERE user_id=r.user_id;
  IF whole<reservation.held_credits THEN
   PERFORM public.credit_apply_delta(r.user_id,reservation.held_credits-whole,'grant','Unused Deck-E chat hold',
    'metered-release:'||p_request::text,r.pricing_revision,
    jsonb_build_object('costUsd',known_usd,'credits',amount,'coverage',coverage));
  ELSIF whole>reservation.held_credits THEN
   PERFORM public.credit_apply_delta(r.user_id,reservation.held_credits-whole,'spend','Deck-E chat excess',
    'metered-excess:'||p_request::text,r.pricing_revision,
    jsonb_build_object('costUsd',known_usd,'credits',amount,'coverage',coverage));
  END IF;
 END IF;
 INSERT INTO public.decke_metered_settlement(
  request_id,user_id,known_cost_usd,credits,whole_credits,unknown_operations,coverage,status
 ) VALUES(p_request,r.user_id,known_usd,amount,whole,unknown_count,coverage,p_status);
 UPDATE public.decke_ai_request SET status=p_status,finished_at=now(),charged_credits=amount WHERE id=p_request;
 SELECT public.decke_metered_spendable(b.balance,c.fractional_credits)
  INTO final_balance FROM (SELECT 1) x
  LEFT JOIN public.decke_credit_balance b ON b.user_id::text=r.user_id
  LEFT JOIN public.decke_metered_credit c ON c.user_id=r.user_id;
 RETURN jsonb_build_object('credits',amount::text,'wholeCredits',whole,
  'knownCostUsd',known_usd::text,'coverage',coverage,
  'balance',final_balance::text);
END $$;

CREATE FUNCTION public.decke_metered_settle(p_request uuid,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; owner_id text;
BEGIN
 SELECT user_id INTO owner_id FROM public.decke_ai_request WHERE id=p_request;
 PERFORM public.decke_metered_authorize(owner_id,false);
 RETURN public.decke_metered_settle_core(p_request,p_status);
END $$;

CREATE FUNCTION public.decke_metered_recover(p_user text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; stale record; recovered integer:=0;
BEGIN
 actor=public.admin_actor_id();
 IF actor IS NULL OR NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501';
 END IF;
 p_user=coalesce(p_user,actor);
 IF p_user<>actor THEN PERFORM public.admin_require_permission('credits.read'); END IF;
 FOR stale IN
  SELECT h.request_id
  FROM public.decke_metered_reservation h JOIN public.decke_ai_request r ON r.id=h.request_id
  WHERE h.user_id=p_user AND r.status='started'
    AND h.created_at<=now()-interval '15 minutes'
    AND NOT EXISTS(SELECT 1 FROM public.decke_metered_settlement s WHERE s.request_id=h.request_id)
  ORDER BY h.created_at,h.request_id FOR UPDATE OF r SKIP LOCKED
 LOOP
  UPDATE public.decke_ai_operation SET status='abandoned',finished_at=now(),
   error_code=coalesce(error_code,'settlement_recovered')
   WHERE request_id=stale.request_id AND status='started';
  PERFORM public.decke_metered_settle_core(stale.request_id,'abandoned');
  recovered=recovered+1;
 END LOOP;
 RETURN recovered;
END $$;

CREATE OR REPLACE FUNCTION public.credit_quote_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb; p jsonb; prices jsonb:='{}'::jsonb; k text; cost integer; actor text;
BEGIN
 actor=public.credit_server_actor(); r=public.credit_effective_policy(actor); p=r->'policy';
 IF p->>'version'='2' THEN
  RETURN jsonb_build_object('enabled',(p->>'enabled')::boolean,'lowAt',(p->>'lowBalance')::integer,
   'mode','metered','holdCredits',(p->>'legHoldCredits')::integer,
   'holdMinCredits',(p->>'legHoldMinCredits')::integer,'pricingRevision',r->'revision',
   'unlimited',r->'unlimited','overrideRevision',r->'overrideRevision');
 END IF;
 FOREACH k IN ARRAY ARRAY['chatTurn','analysis','planDeck'] LOOP
  cost=CASE WHEN (r->>'unlimited')::boolean THEN 0 ELSE greatest(1,
   ceil((p->'estimatedMicroUsd'->>k)::numeric*(10000+(p->>'markupBps')::numeric)
    /((p->>'microUsdPerCredit')::numeric*10000)))::integer END;
  prices=prices||jsonb_build_object(k,cost);
 END LOOP;
 RETURN jsonb_build_object('enabled',(p->>'enabled')::boolean,'unlimited',r->'unlimited',
  'overrideRevision',r->'overrideRevision','lowAt',(p->>'lowBalance')::integer,
  'prices',prices,'pricingRevision',r->'revision','mode','flat');
END $$;

CREATE OR REPLACE FUNCTION public.credit_wallet_read(p_user text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; b integer; d integer; payment_hold boolean; stale uuid;
 carry numeric(20,12):=0; open_holds bigint:=0;
BEGIN
 actor=public.admin_actor_id();
 IF actor IS NULL OR NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501';
 END IF;
 p_user=coalesce(p_user,actor);
 IF p_user<>actor THEN PERFORM public.admin_require_permission('credits.read'); END IF;
 PERFORM public.decke_metered_recover(p_user);
 PERFORM public.decke_import_fix_recover(p_user);
 FOR stale IN
  SELECT id FROM public.credit_spend
  WHERE user_id=p_user AND provider_started_at IS NULL AND refunded_at IS NULL
   AND created_at<=now()-interval '5 minutes'
  ORDER BY created_at,id FOR UPDATE SKIP LOCKED
 LOOP
  PERFORM public.credit_spend_refund(p_user,stale);
 END LOOP;
 SELECT balance INTO b FROM public.decke_credit_balance WHERE user_id::text=p_user;
 SELECT debt INTO d FROM public.credit_wallet_control WHERE user_id=p_user;
 SELECT fractional_credits INTO carry FROM public.decke_metered_credit WHERE user_id=p_user;
 SELECT EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND
  (pending_refund_cents>0 OR dispute_status IN
   ('needs_response','under_review','warning_needs_response','warning_under_review','lost')))
  INTO payment_hold;
 SELECT coalesce(sum(held),0) INTO open_holds FROM (
  SELECT h.held_credits::bigint held FROM public.decke_metered_reservation h
   WHERE h.user_id=p_user AND NOT EXISTS(
    SELECT 1 FROM public.decke_metered_settlement s WHERE s.request_id=h.request_id)
  UNION ALL
  SELECT h.credits::bigint FROM public.decke_import_fix_reservation h
   WHERE h.user_id=p_user AND NOT EXISTS(
    SELECT 1 FROM public.decke_import_fix_settlement s WHERE s.request_id=h.request_id)
 ) holds;
 RETURN jsonb_build_object('balance',public.decke_metered_spendable(b,carry)::text,
  'heldCredits',open_holds,'debt',public.decke_metered_owed(d,b,carry),'purchaseHold',payment_hold);
END $$;

CREATE OR REPLACE FUNCTION public.credit_events_read(p_user text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wallet jsonb; result jsonb; actor text; can_see_policy boolean;
BEGIN
 wallet=public.credit_wallet_read(p_user);
 p_user=coalesce(p_user,public.admin_actor_id());
 IF p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 1000000 THEN
  RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023';
 END IF;
 actor=public.admin_actor_id();
 can_see_policy=public.admin_user_has_permission(actor,'admin.access')
  AND public.admin_user_has_permission(actor,'credits.read');
 WITH visible AS (
  SELECT e.id::text id,e.delta::numeric delta,e.kind,e.reason,e.created_at,
   e.pricing_revision,e.pricing_snapshot,e.debt_delta
  FROM public.decke_credit_event e
  WHERE e.user_id::text=p_user AND (e.ref IS NULL OR
   (e.ref NOT LIKE 'metered-reserve:%' AND e.ref NOT LIKE 'metered-release:%'
    AND e.ref NOT LIKE 'metered-excess:%'))
  UNION ALL
  SELECT s.request_id::text,-s.credits,'spend'::text,'Deck-E chat'::text,s.created_at,
   r.pricing_revision,
   CASE WHEN can_see_policy THEN public.credit_effective_policy(r.user_id,r.pricing_revision,r.override_revision) ELSE NULL END,
   0
  FROM public.decke_metered_settlement s JOIN public.decke_ai_request r ON r.id=s.request_id
  WHERE s.user_id=p_user AND r.charge_mode='paid'
 ), page AS (
  SELECT id,delta,kind,reason,created_at AS "createdAt",pricing_revision AS "pricingRevision",
   CASE WHEN can_see_policy THEN pricing_snapshot ELSE NULL END AS "pricingSnapshot",debt_delta AS "debtDelta"
  FROM visible ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET p_offset
 )
 SELECT jsonb_build_object('events',coalesce(jsonb_agg(page),'[]'::jsonb),
  'total',(SELECT count(*) FROM visible),'limit',p_limit,'offset',p_offset)
 INTO result FROM page;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.decke_import_fix_finish(p_request uuid,p_operation uuid,p_status text,
 p_input bigint,p_output bigint,p_cache_read bigint,p_cache_write bigint,p_reasoning bigint,
 p_usd numeric,p_source text,p_generation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; claims jsonb; r public.decke_ai_request; price_policy jsonb;
 amount numeric(24,12):=0; carried numeric(20,12); whole integer:=0; held integer;
BEGIN
 claims=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
 actor=public.admin_actor_id();
 IF actor IS NULL OR NOT public.admin_is_session()
   OR coalesce((claims->>'deckpal_server_request')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'A DeckPal server request is required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request AND user_id=actor FOR UPDATE;
 IF NOT FOUND OR NOT starts_with(r.request_key,'import_fix:') THEN
  RAISE EXCEPTION 'Import fix request unavailable' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.decke_import_fix_settlement WHERE request_id=p_request) THEN
  SELECT credits,whole_credits INTO amount,whole FROM public.decke_import_fix_settlement WHERE request_id=p_request;
  RETURN jsonb_build_object('credits',amount,'wholeCredits',whole,'duplicate',true);
 END IF;
 IF r.status<>'started' OR p_status NOT IN ('completed','failed','cancelled')
   OR p_source NOT IN ('provider_reported','token_rate_estimate','unknown')
   OR (p_source='unknown')<>(p_usd IS NULL) OR p_usd<0 OR p_usd>10 THEN
  RAISE EXCEPTION 'Invalid import fix settlement' USING ERRCODE='22023';
 END IF;
 SELECT credits INTO held FROM public.decke_import_fix_reservation
  WHERE request_id=p_request AND user_id=actor FOR UPDATE;
 IF held IS NULL THEN RAISE EXCEPTION 'Import fix reservation unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.decke_ai_operation SET status=p_status,finished_at=now(),
  input_tokens=p_input,output_tokens=p_output,cache_read_tokens=p_cache_read,
  cache_write_tokens=p_cache_write,reasoning_tokens=p_reasoning,cost_usd=p_usd,
  cost_source=p_source,generation_id=p_generation,
  error_code=CASE WHEN p_status='failed' THEN 'provider_error' ELSE NULL END
  WHERE id=p_operation AND request_id=p_request AND tool_key='import_fix' AND status='started';
 IF NOT FOUND THEN RAISE EXCEPTION 'Import fix operation unavailable' USING ERRCODE='42501'; END IF;
 IF r.charge_mode='paid' THEN
  INSERT INTO public.credit_wallet_control(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.credit_wallet_control WHERE user_id=actor FOR UPDATE;
  PERFORM 1 FROM public.decke_credit_balance WHERE user_id::text=actor FOR UPDATE;
  price_policy=public.credit_effective_policy(actor,r.pricing_revision,r.override_revision)->'policy';
  IF p_usd IS NOT NULL THEN
   amount=round(p_usd*1000000*(10000+(price_policy->>'markupBps')::numeric)
    /((price_policy->>'microUsdPerCredit')::numeric*10000),12);
  END IF;
  INSERT INTO public.decke_metered_credit(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
  SELECT fractional_credits INTO carried FROM public.decke_metered_credit WHERE user_id=actor FOR UPDATE;
  whole=floor(carried+amount)::integer;
  UPDATE public.decke_metered_credit SET fractional_credits=carried+amount-whole WHERE user_id=actor;
  IF whole<held THEN
   PERFORM public.credit_apply_delta(actor,held-whole,'grant','Unused Deck-E import fix hold',
    'import-fix-release:'||p_request::text,r.pricing_revision,
    jsonb_build_object('costUsd',p_usd,'credits',amount,'operation','importFix'));
  ELSIF whole>held THEN
   PERFORM public.credit_apply_delta(actor,held-whole,'spend','Deck-E import fix excess',
    'import-fix-excess:'||p_request::text,r.pricing_revision,
    jsonb_build_object('costUsd',p_usd,'credits',amount,'operation','importFix'));
  END IF;
 END IF;
 INSERT INTO public.decke_import_fix_settlement(request_id,user_id,cost_usd,credits,whole_credits)
  VALUES(p_request,actor,p_usd,amount,whole);
 UPDATE public.decke_ai_request SET status=p_status,finished_at=now(),charged_credits=amount WHERE id=p_request;
 RETURN jsonb_build_object('credits',amount,'wholeCredits',whole,'duplicate',false);
END $$;

CREATE OR REPLACE FUNCTION public.credit_spend_create_effective(
 p_user text,p_operation text,p_revision bigint,p_override bigint,p_key text,p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb; current_policy jsonb; pol jsonb; cost integer; b integer; d integer;
 held boolean; sid uuid; result jsonb; mode text;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_revision IS NULL OR p_override IS NULL
   OR p_hash IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 300
   OR p_hash!~'^[a-f0-9]{64}$' OR p_operation NOT IN ('chatTurn','analysis','planDeck') THEN
  RAISE EXCEPTION 'Invalid spend reference' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(741290064);
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 q=public.credit_effective_policy(p_user,p_revision,p_override); pol=q->'policy';
 IF pol->>'version'='2' THEN RAISE EXCEPTION 'Flat pricing retired' USING ERRCODE='22023'; END IF;
 current_policy=public.credit_effective_policy(p_user);
 IF p_revision<>(current_policy->>'revision')::bigint OR p_override<>(current_policy->>'overrideRevision')::bigint THEN
  IF position(':deep:' IN p_key)=0 OR NOT EXISTS(
   SELECT 1 FROM public.credit_spend s WHERE s.user_id=p_user
    AND s.request_key=split_part(p_key,':deep:',1)
    AND s.pricing_revision=p_revision AND s.override_revision=p_override
    AND s.provider_started_at IS NOT NULL AND s.refunded_at IS NULL
    AND s.created_at>now()-interval '15 minutes'
  ) THEN RAISE EXCEPTION 'Pricing changed; request a fresh quote' USING ERRCODE='40001'; END IF;
 END IF;
 mode=CASE WHEN (q->>'unlimited')::boolean THEN 'unlimited' ELSE 'paid' END;
 IF NOT (pol->>'enabled')::boolean AND mode<>'unlimited' THEN
  RAISE EXCEPTION 'Invalid pricing revision' USING ERRCODE='22023';
 END IF;
 cost=CASE WHEN mode='unlimited' THEN 0 ELSE greatest(1,
  ceil((pol->'estimatedMicroUsd'->>p_operation)::numeric*(10000+(pol->>'markupBps')::numeric)
   /((pol->>'microUsdPerCredit')::numeric*10000)))::int END;
 PERFORM pg_advisory_xact_lock(hashtextextended('credit.spend:'||p_user||':'||p_key,0));
 IF EXISTS(SELECT 1 FROM public.credit_spend WHERE user_id=p_user AND request_key=p_key) THEN
  RAISE EXCEPTION 'This operation was already accepted; send a new message' USING ERRCODE='40001';
 END IF;
 INSERT INTO public.credit_wallet_control(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
 SELECT debt INTO d FROM public.credit_wallet_control WHERE user_id=p_user FOR UPDATE;
 SELECT balance INTO b FROM public.decke_credit_balance WHERE user_id::text=p_user FOR UPDATE;
 held=d>0 OR EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=p_user AND
  (pending_refund_cents>0 OR dispute_status IN
   ('needs_response','under_review','warning_needs_response','warning_under_review','lost')));
 IF coalesce(b,0)<cost OR held THEN
  RETURN jsonb_build_object('allowed',false,'balance',coalesce(b,0),'needed',cost,'debt',d,'held',held);
 END IF;
 INSERT INTO public.credit_spend(user_id,request_key,payload_hash,operation,credits,
  pricing_revision,override_revision,pricing_snapshot,charge_mode)
 VALUES(p_user,p_key,p_hash,p_operation,cost,p_revision,p_override,q,mode) RETURNING id INTO sid;
 IF cost>0 THEN
  result=public.credit_apply_delta(p_user,-cost,'spend',p_operation,'spend:'||sid,p_revision,q);
 ELSE result=jsonb_build_object('balance',coalesce(b,0),'debt',d); END IF;
 RETURN result||jsonb_build_object('allowed',true,'spent',cost,'spendId',sid,'unlimited',mode='unlimited');
END $$;

-- Creation defaults in Supabase grant broadly. Close every new object and all
-- replaced internals before restoring only the guarded application RPCs.
REVOKE ALL ON public.decke_metered_credit,public.decke_metered_reservation,public.decke_metered_settlement FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decke_metered_actor(boolean),public.decke_metered_authorize(text,boolean),public.decke_metered_spendable(integer,numeric),
 public.decke_metered_owed(integer,integer,numeric),public.decke_metered_known_credits(uuid),
 public.decke_metered_begin(uuid),public.decke_metered_status(uuid),
 public.decke_metered_settle_core(uuid,text),public.decke_metered_settle(uuid,text),
 public.decke_metered_recover(text) FROM PUBLIC;
DO $acl$
DECLARE principal text; grantee_sql text; signature text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal) THEN CONTINUE; END IF;
  grantee_sql=quote_ident(principal);
  EXECUTE format('REVOKE ALL ON public.decke_metered_credit,public.decke_metered_reservation,public.decke_metered_settlement FROM %s',grantee_sql);
  FOREACH signature IN ARRAY ARRAY[
   'credit_validate_policy(jsonb)','credit_policy_initialize(boolean)',
   'decke_metered_actor(boolean)','decke_metered_authorize(text,boolean)','decke_metered_spendable(integer,numeric)',
   'decke_metered_owed(integer,integer,numeric)','decke_metered_known_credits(uuid)',
   'decke_metered_begin(uuid)','decke_metered_status(uuid)',
   'decke_metered_settle_core(uuid,text)','decke_metered_settle(uuid,text)',
   'decke_metered_recover(text)','decke_usage_operation_begin(uuid,uuid,text,text,text,text,text,uuid)',
   'decke_usage_external_operation_begin(uuid,uuid,text,text,text,text,uuid)',
   'credit_quote_read()','credit_wallet_read(text)','credit_events_read(text,integer,integer)',
   'decke_import_fix_finish(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,text,text)',
   'credit_spend_create_effective(text,text,bigint,bigint,text,text)'
  ] LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %s',signature,grantee_sql);
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.decke_metered_begin(uuid),public.decke_metered_status(uuid),
   public.decke_metered_settle(uuid,text),
   public.decke_usage_operation_begin(uuid,uuid,text,text,text,text,text,uuid),
   public.decke_usage_external_operation_begin(uuid,uuid,text,text,text,text,uuid),
   public.credit_quote_read(),public.credit_wallet_read(text),public.credit_events_read(text,integer,integer),
   public.decke_import_fix_finish(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,text,text)
   TO authenticated;
 END IF;
END $acl$;
