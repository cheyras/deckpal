-- Import fixes use the existing Deck-E usage and credit ledger. The wallet's
-- whole-credit columns stay compatible with purchases; this accumulator keeps
-- the exact fractional cost until a whole credit can be debited.
CREATE TABLE public.decke_import_fix_credit (
  user_id text PRIMARY KEY,
  fractional_credits numeric(20,12) NOT NULL DEFAULT 0 CHECK (fractional_credits >= 0 AND fractional_credits < 1)
);
CREATE TABLE public.decke_import_fix_settlement (
  request_id uuid PRIMARY KEY REFERENCES public.decke_ai_request(id),
  user_id text NOT NULL,
  cost_usd numeric(24,12),
  credits numeric(20,12) NOT NULL,
  whole_credits integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.decke_import_fix_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_import_fix_settlement ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.decke_import_fix_begin(p_cap integer,p_key text,p_hash text,p_model text,p_build_sha text,p_build_pr integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; policy jsonb; mode text; r jsonb; op uuid=gen_random_uuid(); used integer;
BEGIN
  actor=public.credit_server_actor();
  IF coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'deckpal_server_request')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'A DeckPal server request is required' USING ERRCODE='42501';
  END IF;
  IF p_cap NOT BETWEEN 1 AND 10000 OR p_model IS NULL OR length(p_model)>160 THEN
    RAISE EXCEPTION 'Invalid import fix request' USING ERRCODE='22023';
  END IF;
  policy=public.credit_effective_policy(actor);
  IF policy IS NULL THEN RAISE EXCEPTION 'Credit accounting is unavailable' USING ERRCODE='P0002'; END IF;
  mode=CASE WHEN (policy->>'unlimited')::boolean THEN 'unlimited'
            WHEN (policy->'policy'->>'enabled')::boolean THEN 'paid' ELSE 'daily' END;
  IF mode='paid' THEN
    IF NOT EXISTS (SELECT 1 FROM public.decke_credit_balance WHERE user_id::text=actor AND balance>0)
      THEN RAISE EXCEPTION 'Deck-E credits are empty' USING ERRCODE='P0001'; END IF;
    IF EXISTS(SELECT 1 FROM public.credit_wallet_control WHERE user_id=actor AND debt>0) OR
       EXISTS(SELECT 1 FROM public.credit_order WHERE user_id=actor AND
         (pending_refund_cents>0 OR dispute_status IN
          ('needs_response','under_review','warning_needs_response','warning_under_review','lost')))
      THEN RAISE EXCEPTION 'Deck-E credits are on hold' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.decke_usage AS u(user_id,day,chat_turns)
    VALUES(actor::uuid,(now() AT TIME ZONE 'utc')::date,1)
    ON CONFLICT(user_id,day) DO UPDATE SET chat_turns=u.chat_turns+1,updated_at=now()
      WHERE u.chat_turns<p_cap
    RETURNING chat_turns INTO used;
  IF used IS NULL THEN RAISE EXCEPTION 'Deck-E daily limit reached' USING ERRCODE='54000'; END IF;
  r=public.decke_usage_begin(actor,NULL,NULL,NULL,p_key,p_hash,p_build_sha,p_build_pr,
    (policy->>'revision')::bigint,coalesce((policy->>'overrideRevision')::bigint,0),mode,'');
  INSERT INTO public.decke_ai_operation(id,request_id,category,tool_key,model_id,provider,operation_key)
    VALUES(op,(r->>'id')::uuid,'response','import_fix',p_model,'gateway','import_fix');
  RETURN jsonb_build_object('requestId',r->>'id','operationId',op,'mode',mode);
END $$;

CREATE FUNCTION public.decke_import_fix_finish(p_request uuid,p_operation uuid,p_status text,
  p_input bigint,p_output bigint,p_cache_read bigint,p_cache_write bigint,p_reasoning bigint,
  p_usd numeric,p_source text,p_generation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; r public.decke_ai_request; price_policy jsonb; amount numeric(20,12)=0;
  carried numeric(20,12); whole integer=0;
BEGIN
  actor=public.credit_server_actor();
  IF coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'deckpal_server_request')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'A DeckPal server request is required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request AND user_id=actor FOR UPDATE;
  IF NOT FOUND OR r.request_key NOT LIKE 'import_fix:%' THEN
    RAISE EXCEPTION 'Import fix request unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.decke_import_fix_settlement WHERE request_id=p_request) THEN
    SELECT credits,whole_credits INTO amount,whole FROM public.decke_import_fix_settlement WHERE request_id=p_request;
    RETURN jsonb_build_object('credits',amount,'wholeCredits',whole,'duplicate',true);
  END IF;
  IF r.status<>'started' OR p_status NOT IN ('completed','failed','cancelled') OR
     p_source NOT IN ('provider_reported','token_rate_estimate','unknown') OR
     (p_source='unknown')<>(p_usd IS NULL) OR p_usd<0 OR p_usd>10 THEN
    RAISE EXCEPTION 'Invalid import fix settlement' USING ERRCODE='22023';
  END IF;
  UPDATE public.decke_ai_operation SET status=p_status,finished_at=now(),
    input_tokens=p_input,output_tokens=p_output,cache_read_tokens=p_cache_read,
    cache_write_tokens=p_cache_write,reasoning_tokens=p_reasoning,cost_usd=p_usd,
    cost_source=p_source,generation_id=p_generation,
    error_code=CASE WHEN p_status='failed' THEN 'provider_error' ELSE NULL END
    WHERE id=p_operation AND request_id=p_request AND tool_key='import_fix' AND status='started';
  IF NOT FOUND THEN RAISE EXCEPTION 'Import fix operation unavailable' USING ERRCODE='42501'; END IF;
  IF r.charge_mode='paid' AND p_usd IS NOT NULL THEN
    price_policy=public.credit_effective_policy(actor,r.pricing_revision,r.override_revision)->'policy';
    amount=round(p_usd*1000000*(10000+(price_policy->>'markupBps')::numeric)
      /((price_policy->>'microUsdPerCredit')::numeric*10000),12);
    INSERT INTO public.decke_import_fix_credit(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
    SELECT fractional_credits INTO carried FROM public.decke_import_fix_credit WHERE user_id=actor FOR UPDATE;
    whole=floor(carried+amount)::integer;
    UPDATE public.decke_import_fix_credit SET fractional_credits=carried+amount-whole WHERE user_id=actor;
    IF whole>0 THEN
      PERFORM public.credit_apply_delta(actor,-whole,'spend','Deck-E import fix',
        'import-fix:'||p_request::text,r.pricing_revision,
        jsonb_build_object('costUsd',p_usd,'credits',amount,'operation','importFix'));
    END IF;
  END IF;
  INSERT INTO public.decke_import_fix_settlement(request_id,user_id,cost_usd,credits,whole_credits)
    VALUES(p_request,actor,p_usd,amount,whole);
  UPDATE public.decke_ai_request SET status=p_status,finished_at=now(),charged_credits=whole WHERE id=p_request;
  RETURN jsonb_build_object('credits',amount,'wholeCredits',whole,'duplicate',false);
END $$;

REVOKE ALL ON public.decke_import_fix_credit,public.decke_import_fix_settlement FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decke_import_fix_begin(integer,text,text,text,text,integer),
  public.decke_import_fix_finish(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,text,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.decke_import_fix_credit,public.decke_import_fix_settlement FROM anon;
    REVOKE ALL ON FUNCTION public.decke_import_fix_begin(integer,text,text,text,text,integer),
      public.decke_import_fix_finish(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,text,text) FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.decke_import_fix_credit,public.decke_import_fix_settlement FROM authenticated;
    REVOKE ALL ON FUNCTION public.decke_import_fix_begin(integer,text,text,text,text,integer),
      public.decke_import_fix_finish(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,text,text) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.decke_import_fix_begin(integer,text,text,text,text,integer),
      public.decke_import_fix_finish(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,numeric,text,text) TO authenticated;
  END IF;
END $$;
