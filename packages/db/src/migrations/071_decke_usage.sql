-- Usage metadata is server-authored; private excerpts are separately consent gated.
CREATE TABLE public.decke_sharing (
 user_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.decke_ai_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
 conversation_id uuid, exchange_id uuid NOT NULL, seq integer CHECK(seq BETWEEN 0 AND 10000),
 request_key text NOT NULL, payload_hash text NOT NULL,
 consent_epoch bigint, category text NOT NULL DEFAULT 'response' CHECK(category IN ('response','research','planning')),
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','failed','cancelled','abandoned')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 build_sha text, build_pr integer, pricing_revision bigint, override_revision bigint,
 charge_mode text NOT NULL CHECK(charge_mode IN ('paid','unlimited','daily')), charged_credits integer,
 UNIQUE(user_id,request_key)
);
CREATE INDEX decke_ai_request_list ON public.decke_ai_request(started_at DESC,id DESC);
CREATE INDEX decke_ai_request_exchange ON public.decke_ai_request(user_id,conversation_id,exchange_id);
CREATE TABLE public.decke_ai_operation (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES public.decke_ai_request(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('response','research','planning')), tool_key text NOT NULL,
 model_id text NOT NULL, provider text NOT NULL, operation_key text NOT NULL,
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','failed','cancelled','abandoned')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 input_tokens bigint, output_tokens bigint, cache_read_tokens bigint, cache_write_tokens bigint, reasoning_tokens bigint,
 cost_usd numeric(24,12) CHECK(cost_usd>=0), cost_source text NOT NULL DEFAULT 'unknown' CHECK(cost_source IN ('provider_reported','token_rate_estimate','unknown')),
 generation_id text, error_code text,
 credit_spend_id uuid REFERENCES public.credit_spend(id), starts_reservation boolean NOT NULL DEFAULT false,
 invocation_cancelled boolean NOT NULL DEFAULT false,
 CHECK((cost_source='unknown' AND cost_usd IS NULL) OR (cost_source<>'unknown' AND cost_usd IS NOT NULL))
);
CREATE INDEX decke_ai_operation_request ON public.decke_ai_operation(request_id);
CREATE TABLE public.decke_ai_content (
 request_id uuid PRIMARY KEY REFERENCES public.decke_ai_request(id) ON DELETE CASCADE,
 asked text NOT NULL DEFAULT '', answered text NOT NULL DEFAULT ''
);
ALTER TABLE public.decke_sharing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_ai_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_ai_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_ai_content ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.decke_sharing_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; s public.decke_sharing;
BEGIN
 actor=public.credit_server_actor();
 SELECT * INTO s FROM public.decke_sharing WHERE user_id=actor;
 RETURN jsonb_build_object('enabled',coalesce(s.enabled,false),'revision',coalesce(s.revision,0),'updatedAt',s.updated_at);
END $$;
CREATE FUNCTION public.decke_sharing_save(p_enabled boolean,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; s public.decke_sharing;
BEGIN
 actor=public.credit_server_actor();
 IF p_enabled IS NULL OR p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION 'Invalid consent setting' USING ERRCODE='22023'; END IF;
 INSERT INTO public.decke_sharing(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.decke_sharing WHERE user_id=actor FOR UPDATE;
 IF s.revision<>p_expected THEN RAISE EXCEPTION 'Sharing setting changed; reload before saving' USING ERRCODE='40001'; END IF;
 IF s.enabled<>p_enabled THEN
  UPDATE public.decke_sharing SET enabled=p_enabled,revision=revision+1,updated_at=now() WHERE user_id=actor;
  -- Withdrawal removes the optional administrative excerpt, not the user's own history.
  IF NOT p_enabled THEN DELETE FROM public.decke_ai_content c USING public.decke_ai_request r WHERE c.request_id=r.id AND r.user_id=actor; END IF;
 END IF;
 RETURN public.decke_sharing_read();
END $$;

CREATE FUNCTION public.decke_usage_begin(p_user text,p_conversation uuid,p_exchange uuid,p_seq integer,p_key text,p_hash text,p_build_sha text,p_build_pr integer,p_pricing bigint,p_override bigint,p_mode text,p_asked text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rid uuid=gen_random_uuid(); ex uuid; ep bigint; previous public.decke_ai_request; s public.decke_sharing; owner_id text;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(741290064);
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 300 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' OR p_mode NOT IN ('paid','unlimited','daily') OR (p_seq IS NOT NULL AND p_seq NOT BETWEEN 0 AND 10000) THEN RAISE EXCEPTION 'Invalid usage reference' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('decke.usage:'||p_user||':'||p_key,0));
 IF EXISTS(SELECT 1 FROM public.decke_ai_request WHERE user_id=p_user AND request_key=p_key) THEN RAISE EXCEPTION 'Request already accepted' USING ERRCODE='40001'; END IF;
 IF p_conversation IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('decke.conversation:'||p_conversation::text,0));
  SELECT user_id::text INTO owner_id FROM public.decke_conversation WHERE id=p_conversation;
  IF owner_id IS NOT NULL AND owner_id<>p_user THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='42501'; END IF;
  INSERT INTO public.decke_conversation(id,user_id) SELECT p_conversation,id FROM public.app_user WHERE id::text=p_user ON CONFLICT DO NOTHING;
  SELECT user_id::text INTO owner_id FROM public.decke_conversation WHERE id=p_conversation;
  IF owner_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='42501'; END IF;
 END IF;
 ex=coalesce(p_exchange,rid);
 -- Missing old-client correlation remains metadata-only. First leg fixes the epoch.
 IF p_exchange IS NOT NULL AND p_seq IS NOT NULL AND p_conversation IS NOT NULL THEN
  SELECT * INTO previous FROM public.decke_ai_request WHERE user_id=p_user AND conversation_id=p_conversation AND (seq=p_seq OR exchange_id=p_exchange) ORDER BY started_at,id LIMIT 1;
  IF FOUND THEN
   IF previous.exchange_id<>p_exchange OR previous.seq IS DISTINCT FROM p_seq THEN RAISE EXCEPTION 'Exchange reference conflicts' USING ERRCODE='40001'; END IF;
   ep=previous.consent_epoch;
  ELSE
   INSERT INTO public.decke_sharing(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
   SELECT * INTO s FROM public.decke_sharing WHERE user_id=p_user FOR SHARE;
   IF s.enabled THEN ep=s.revision; END IF;
  END IF;
 END IF;
 INSERT INTO public.decke_ai_request(id,user_id,conversation_id,exchange_id,seq,request_key,payload_hash,consent_epoch,build_sha,build_pr,pricing_revision,override_revision,charge_mode)
 VALUES(rid,p_user,p_conversation,ex,p_seq,p_key,p_hash,ep,left(p_build_sha,64),p_build_pr,p_pricing,p_override,p_mode);
 PERFORM 1 FROM public.decke_sharing WHERE user_id=p_user FOR SHARE;
 IF ep IS NOT NULL AND EXISTS(SELECT 1 FROM public.decke_sharing WHERE user_id=p_user AND enabled AND revision=ep) THEN
  INSERT INTO public.decke_ai_content(request_id,asked) VALUES(rid,left(coalesce(p_asked,''),24000));
 END IF;
 RETURN jsonb_build_object('id',rid,'exchangeId',ex,'consentEpoch',ep);
END $$;
CREATE FUNCTION public.decke_usage_operation_begin(p_id uuid,p_request uuid,p_category text,p_tool text,p_model text,p_provider text,p_key text,p_spend uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.decke_ai_request; s public.credit_spend; first_start boolean=false;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request AND status='started';
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF p_spend IS NOT NULL THEN
  s=public.credit_spend_lock_authorize(r.user_id,p_spend);
  IF s.request_key IS DISTINCT FROM (CASE WHEN p_tool='chat_turn' THEN r.request_key ELSE r.request_key||':deep:'||p_key END) THEN
   RAISE EXCEPTION 'Spend does not belong to this operation' USING ERRCODE='42501';
  END IF;
  first_start=s.provider_started_at IS NULL;
  IF NOT first_start AND NOT EXISTS(SELECT 1 FROM public.decke_ai_operation WHERE request_id=r.id AND credit_spend_id=s.id AND NOT invocation_cancelled) THEN
   RAISE EXCEPTION 'Spend already started outside this request' USING ERRCODE='40001';
  END IF;
 ELSIF r.charge_mode<>'daily' THEN
  RAISE EXCEPTION 'A credit reservation is required' USING ERRCODE='42501';
 END IF;
 -- Recheck after the spend/payment waits; disabled/suspended work never starts.
 IF NOT public.admin_account_active(r.user_id) OR NOT public.admin_user_has_permission(r.user_id,'decke.use')
 THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.decke_ai_operation(id,request_id,category,tool_key,model_id,provider,operation_key,credit_spend_id,starts_reservation)
 VALUES(p_id,p_request,p_category,p_tool,left(p_model,160),left(p_provider,80),left(p_key,160),p_spend,first_start);
 -- One transaction: a failed operation insert/authorization cannot strand a debit.
 IF first_start THEN UPDATE public.credit_spend SET provider_started_at=now() WHERE id=s.id; END IF;
END $$;
CREATE FUNCTION public.decke_usage_operation_cancel_uninvoked(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.decke_ai_operation; s public.credit_spend;
BEGIN
 -- Server-only compensation, called solely when the JS invocation latch has
 -- NOT fired (e.g. abort while awaiting operation_begin). Never provider failure.
 SELECT * INTO o FROM public.decke_ai_operation WHERE id=p_id;
 IF o.credit_spend_id IS NOT NULL THEN
  SELECT * INTO s FROM public.credit_spend WHERE id=o.credit_spend_id FOR UPDATE;
 END IF;
 SELECT * INTO o FROM public.decke_ai_operation WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR o.status<>'started' THEN RETURN false; END IF;
 UPDATE public.decke_ai_operation SET status='cancelled',finished_at=now(),invocation_cancelled=true,error_code='cancelled_before_invocation' WHERE id=o.id;
 IF s.id IS NOT NULL AND s.refunded_at IS NULL AND EXISTS(
  SELECT 1 FROM public.decke_ai_operation WHERE credit_spend_id=s.id AND starts_reservation AND invocation_cancelled
 ) AND NOT EXISTS(
  SELECT 1 FROM public.decke_ai_operation WHERE credit_spend_id=s.id AND id<>o.id AND NOT invocation_cancelled
 ) THEN
  UPDATE public.credit_spend SET provider_started_at=NULL WHERE id=s.id;
  RETURN public.credit_spend_refund(s.user_id,s.id);
 END IF;
 RETURN false;
END $$;
CREATE FUNCTION public.decke_usage_content_append(p_id uuid,p_text text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;
BEGIN
 SELECT user_id INTO actor FROM public.decke_ai_request WHERE id=p_id;
 -- Serialize with withdrawal; an already-running write cannot recreate withdrawn text.
 PERFORM 1 FROM public.decke_sharing WHERE user_id=actor FOR SHARE;
 UPDATE public.decke_ai_content c SET answered=left(c.answered||coalesce(p_text,''),24000)
 FROM public.decke_ai_request r,public.decke_sharing s WHERE c.request_id=p_id AND r.id=c.request_id
 AND s.user_id=r.user_id AND s.enabled AND s.revision=r.consent_epoch;
END $$;
CREATE FUNCTION public.decke_usage_require_admin() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;
BEGIN
 actor=public.credit_server_actor();
 IF public.admin_role_tier(actor)<40 OR NOT public.admin_user_has_permission(actor,'admin.access') THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION public.decke_usage_request_json(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'userId',r.user_id,'conversationId',r.conversation_id,'exchangeId',r.exchange_id,'seq',r.seq,
 'category',r.category,'status',CASE WHEN r.status='started' AND r.started_at<now()-interval '15 minutes' THEN 'abandoned' ELSE r.status END,
 'startedAt',r.started_at,'finishedAt',r.finished_at,'buildSha',r.build_sha,'buildPr',r.build_pr,'pricingRevision',r.pricing_revision,
 'overrideRevision',r.override_revision,'chargeMode',r.charge_mode,'chargedCredits',r.charged_credits,'operationCount',a.n,
 'inputTokens',a.input_tokens,'outputTokens',a.output_tokens,
 'cost',jsonb_build_object('source',CASE WHEN a.estimated>0 THEN 'token_rate_estimate' WHEN a.known>0 THEN 'provider_reported' ELSE 'unknown' END,
 'usd',CASE WHEN a.known>0 THEN a.usd::text ELSE NULL END,'currency','USD',
 'coverage',CASE WHEN a.n=0 OR a.known=0 THEN 'unknown' WHEN a.known=a.n THEN 'complete' ELSE 'partial' END))
 FROM public.decke_ai_request r CROSS JOIN LATERAL (
 SELECT count(*) n,count(cost_usd) known,count(*) FILTER(WHERE cost_source='token_rate_estimate') estimated,sum(cost_usd) usd,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens
 FROM public.decke_ai_operation WHERE request_id=r.id) a WHERE r.id=p_id
$$;
CREATE FUNCTION public.decke_usage_detail(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.decke_ai_request; s public.decke_sharing; c public.decke_ai_content; operations jsonb; state text;
BEGIN
 PERFORM public.decke_usage_require_admin();
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.decke_sharing WHERE user_id=r.user_id;
 state=CASE WHEN r.consent_epoch IS NULL THEN 'not_shared' WHEN NOT public.admin_account_active(r.user_id) OR NOT coalesce(s.enabled,false) OR s.revision<>r.consent_epoch THEN 'revoked' ELSE 'unavailable' END;
 IF state='unavailable' THEN SELECT * INTO c FROM public.decke_ai_content WHERE request_id=p_id; IF FOUND THEN state='shared'; END IF; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'toolKey',tool_key,'modelId',model_id,'provider',provider,
 'status',CASE WHEN status='started' AND started_at<now()-interval '15 minutes' THEN 'abandoned' ELSE status END,
 'startedAt',started_at,'finishedAt',finished_at,
 'tokens',jsonb_build_object('inputTokens',input_tokens,'outputTokens',output_tokens,'cacheReadTokens',cache_read_tokens,'cacheWriteTokens',cache_write_tokens,'reasoningTokens',reasoning_tokens),
 'cost',jsonb_build_object('source',cost_source,'usd',cost_usd::text,'currency','USD','coverage',CASE WHEN cost_usd IS NULL THEN 'unknown' ELSE 'complete' END)) ORDER BY started_at,id),'[]'::jsonb)
 INTO operations FROM public.decke_ai_operation WHERE request_id=p_id;
 RETURN jsonb_build_object('request',public.decke_usage_request_json(p_id),'operations',operations,'contentStatus',state,
 'content',CASE WHEN state='shared' THEN jsonb_build_object('asked',c.asked,'answered',c.answered) ELSE NULL END);
END $$;
CREATE FUNCTION public.decke_usage_list(p_filter jsonb,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE items jsonb; total bigint; agg jsonb;
BEGIN
 PERFORM public.decke_usage_require_admin();
 IF p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 1000000 OR p_filter IS NULL OR jsonb_typeof(p_filter)<>'object' THEN RAISE EXCEPTION 'Invalid usage filter' USING ERRCODE='22023'; END IF;
 WITH filtered AS (
 SELECT r.* FROM public.decke_ai_request r WHERE
 (NOT p_filter?'userId' OR r.user_id=p_filter->>'userId')
 AND (NOT p_filter?'conversationId' OR r.conversation_id::text=p_filter->>'conversationId')
 AND (NOT p_filter?'modelId' OR EXISTS(SELECT 1 FROM public.decke_ai_operation o WHERE o.request_id=r.id AND o.model_id=p_filter->>'modelId'))
 AND (NOT p_filter?'costSource' OR EXISTS(SELECT 1 FROM public.decke_ai_operation o WHERE o.request_id=r.id AND o.cost_source=p_filter->>'costSource'))
 AND (NOT p_filter?'buildSha' OR r.build_sha=p_filter->>'buildSha')
 AND (NOT p_filter?'buildPr' OR r.build_pr=(p_filter->>'buildPr')::integer)
 AND (NOT p_filter?'category' OR r.category=p_filter->>'category' OR EXISTS(SELECT 1 FROM public.decke_ai_operation o WHERE o.request_id=r.id AND o.category=p_filter->>'category'))
 AND (NOT p_filter?'status' OR (CASE WHEN r.status='started' AND r.started_at<now()-interval '15 minutes' THEN 'abandoned' ELSE r.status END)=p_filter->>'status')
 AND (NOT p_filter?'from' OR r.started_at>=(p_filter->>'from')::timestamptz)
 AND (NOT p_filter?'to' OR r.started_at<=(p_filter->>'to')::timestamptz)
 ), page AS (SELECT * FROM filtered ORDER BY started_at DESC,id DESC LIMIT p_limit OFFSET p_offset)
 SELECT (SELECT count(*) FROM filtered),
 (SELECT coalesce(jsonb_agg(public.decke_usage_request_json(id) ORDER BY started_at DESC,id DESC),'[]'::jsonb) FROM page),
 (SELECT jsonb_build_object('knownUsd',coalesce(sum(o.cost_usd),0)::text,'knownCount',count(o.cost_usd),'unknownCount',count(*)-count(o.cost_usd)) FROM filtered f JOIN public.decke_ai_operation o ON o.request_id=f.id)
 INTO total,items,agg;
 RETURN jsonb_build_object('items',items,'total',total,'limit',p_limit,'offset',p_offset,'aggregate',agg);
END $$;
CREATE FUNCTION public.decke_usage_conversation(p_id uuid,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; total bigint;
BEGIN
 PERFORM public.decke_usage_require_admin();
 IF p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM public.decke_ai_request WHERE conversation_id=p_id;
 SELECT coalesce(jsonb_agg(public.decke_usage_detail(id) ORDER BY started_at,id),'[]'::jsonb) INTO result
 FROM (SELECT id,started_at FROM public.decke_ai_request WHERE conversation_id=p_id ORDER BY started_at,id LIMIT p_limit OFFSET p_offset) x;
 RETURN jsonb_build_object('items',result,'total',total,'limit',p_limit,'offset',p_offset);
END $$;

CREATE FUNCTION public.decke_usage_observations(p_days integer,p_sha text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE groups jsonb;
BEGIN
 PERFORM public.decke_usage_require_admin();
 IF p_days NOT IN (7,30,90) OR (p_sha IS NOT NULL AND length(p_sha)>64) THEN RAISE EXCEPTION 'Invalid observation window' USING ERRCODE='22023'; END IF;
 WITH samples AS (
 SELECT r.id,r.build_sha,o.operation_key,o.category,
 CASE WHEN o.tool_key='chat_turn' THEN 'chatTurn' WHEN o.tool_key IN ('research_meta','analyze_collection') THEN 'analysis' ELSE 'planDeck' END operation,
 array_agg(DISTINCT o.model_id ORDER BY o.model_id) models,
 count(*)=count(o.cost_usd) AND bool_and(o.status='completed') complete,sum(o.cost_usd) usd
 FROM public.decke_ai_request r JOIN public.decke_ai_operation o ON o.request_id=r.id
 WHERE r.started_at>=now()-make_interval(days=>p_days) AND (p_sha IS NULL OR r.build_sha=p_sha)
 GROUP BY r.id,r.build_sha,o.operation_key,o.category,o.tool_key
 ), grouped AS (
 SELECT operation,category,build_sha,models,count(*) n,count(*) FILTER(WHERE complete) complete,
 ceil(avg(usd) FILTER(WHERE complete)*1000000)::bigint mean,
 ceil((percentile_cont(0.95) WITHIN GROUP(ORDER BY usd) FILTER(WHERE complete))*1000000)::bigint p95,
 coalesce(sum(usd),0)::text known FROM samples GROUP BY operation,category,build_sha,models)
 SELECT coalesce(jsonb_agg(jsonb_build_object('operation',operation,'category',category,'buildSha',build_sha,'modelIds',models,
 'sampleCount',n,'completeCount',complete,'unknownCount',n-complete,'meanMicroUsd',mean,'p95MicroUsd',p95,'knownUsd',known)),'[]'::jsonb) INTO groups FROM grouped;
 RETURN jsonb_build_object('days',p_days,'buildSha',p_sha,'groups',groups,
 'notice','Only complete reported-cost samples inform estimates. Review coverage and save an explicit pricing revision; existing flat charges are unchanged.');
END $$;
ALTER TABLE public.decke_turn ADD COLUMN exchange_id uuid;
CREATE FUNCTION public.decke_usage_withdraw_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM public.decke_ai_content c USING public.decke_ai_request r
 WHERE c.request_id=r.id AND r.conversation_id=OLD.id AND r.user_id=OLD.user_id::text;
 RETURN OLD;
END $$;
CREATE TRIGGER decke_history_withdraw_content AFTER DELETE ON public.decke_conversation
FOR EACH ROW EXECUTE FUNCTION public.decke_usage_withdraw_history();

DO $acl$
DECLARE r text; f record; t text;
BEGIN
 FOREACH r IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  IF r='PUBLIC' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOREACH t IN ARRAY ARRAY['decke_sharing','decke_ai_request','decke_ai_operation','decke_ai_content'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s',t,CASE WHEN r='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r) END);
   END LOOP;
   FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'decke_usage_%' OR proname LIKE 'decke_sharing_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.signature,CASE WHEN r='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r) END);
   END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.decke_sharing_read(),public.decke_sharing_save(boolean,bigint),
  public.decke_usage_list(jsonb,integer,integer),public.decke_usage_detail(uuid),public.decke_usage_conversation(uuid,integer,integer),public.decke_usage_observations(integer,text) TO authenticated;
 END IF;
END $acl$;
