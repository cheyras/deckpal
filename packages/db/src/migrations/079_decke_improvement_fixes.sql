-- 079 · Privacy and lifecycle fixes for the Deck-E improvement corpus.
--
-- Migration 078 is already deployed.  Keep its public signatures stable while
-- replacing the affected functions and repairing retained corpus rows in place.

-- Each percent run is decoded atomically.  Invalid UTF-8 and PostgreSQL's
-- unsupported NUL scalar stay byte-for-byte encoded instead of aborting a
-- writer or the retained-data repair below.
CREATE FUNCTION public.decke_improvement_percent_run(p_run text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE bytes bytea; decoded text;
BEGIN
 bytes=decode(replace(p_run,'%',''),'hex');
 IF position(decode('00','hex') IN bytes)>0 THEN RETURN p_run; END IF;
 decoded=convert_from(bytes,'UTF8');
 RETURN decoded;
EXCEPTION WHEN OTHERS THEN RETURN p_run;
END $$;

-- Splitting once and aggregating once avoids repeatedly copying/searching the
-- remaining suffix for inputs containing hundreds of thousands of runs.
CREATE FUNCTION public.decke_improvement_percent_decode(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE pieces text[]; runs text[]; out_text text;
 valid_utf8 text:='^(?:%(?:0[1-9A-Fa-f]|[1-7][0-9A-Fa-f])|%[cC][2-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[eE]0%[aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[eE][1-9a-cA-C]%[89aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[eE][dD]%[89][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[eE][eEfF]%[89aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[fF]0%[9aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[fF][1-3]%[89aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]|%[fF]4%8[0-9A-Fa-f]%[89aAbB][0-9A-Fa-f]%[89aAbB][0-9A-Fa-f])+$';
BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 pieces=regexp_split_to_array(p_text,'(?:%[0-9A-Fa-f]{2})+');
 SELECT coalesce(array_agg(m[1]),'{}'::text[]) INTO runs
 FROM regexp_matches(p_text,'((?:%[0-9A-Fa-f]{2})+)','g') m;
 SELECT string_agg(piece||CASE WHEN run IS NULL THEN ''
   WHEN lower(run)='%25' THEN '%'
   WHEN lower(run)='%20' THEN ' '
   WHEN run~valid_utf8 THEN convert_from(decode(replace(run,'%',''),'hex'),'UTF8')
   ELSE public.decke_improvement_percent_run(run) END,'' ORDER BY ordinality)
 INTO out_text FROM unnest(pieces,runs) WITH ORDINALITY decoded(piece,run,ordinality);
 RETURN coalesce(out_text,'');
END $$;

CREATE FUNCTION public.decke_improvement_decode_scalar(p_escape text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE codepoint integer; low_point integer; bytes bytea; hex_value text;
BEGIN
 IF p_escape~'^\\u' THEN
  codepoint=get_byte(decode(substring(p_escape FROM 3 FOR 4),'hex'),0)*256
    +get_byte(decode(substring(p_escape FROM 3 FOR 4),'hex'),1);
  IF codepoint BETWEEN 55296 AND 56319 THEN
   IF char_length(p_escape)<>12 THEN RETURN p_escape; END IF;
   low_point=get_byte(decode(substring(p_escape FROM 9 FOR 4),'hex'),0)*256
     +get_byte(decode(substring(p_escape FROM 9 FOR 4),'hex'),1);
   IF low_point NOT BETWEEN 56320 AND 57343 THEN RETURN p_escape; END IF;
   codepoint=65536+(codepoint-55296)*1024+(low_point-56320);
  ELSIF codepoint BETWEEN 56320 AND 57343 THEN
   RETURN p_escape;
  END IF;
 ELSIF p_escape~'^&#[xX]' THEN
  hex_value=substring(p_escape FROM 4 FOR char_length(p_escape)-4);
  bytes=decode(lpad(hex_value,6,'0'),'hex');
  codepoint=get_byte(bytes,0)*65536+get_byte(bytes,1)*256+get_byte(bytes,2);
 ELSE
  codepoint=substring(p_escape FROM 3 FOR char_length(p_escape)-3)::integer;
 END IF;
 IF codepoint=0 OR codepoint>1114111 OR codepoint BETWEEN 55296 AND 57343 THEN RETURN p_escape; END IF;
 RETURN chr(codepoint);
EXCEPTION WHEN OTHERS THEN RETURN p_escape;
END $$;

-- JSON and numeric-entity scalars use the same split/aggregate shape as
-- percent runs.  A NUL or unpaired surrogate is retained as written.
CREATE FUNCTION public.decke_improvement_decode_escapes(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE pattern text:='(\\u[dD][89aAbB][0-9A-Fa-f]{2}\\u[dD][c-fC-F][0-9A-Fa-f]{2}|\\u[0-9A-Fa-f]{4}|&#[xX][0-9A-Fa-f]{1,6};|&#[0-9]{1,7};)';
 pieces text[]; runs text[]; out_text text;
BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 pieces=regexp_split_to_array(p_text,pattern);
 SELECT coalesce(array_agg(m[1]),'{}'::text[]) INTO runs FROM regexp_matches(p_text,pattern,'g') m;
 SELECT string_agg(piece||CASE WHEN run IS NULL THEN '' ELSE public.decke_improvement_decode_scalar(run) END,
   '' ORDER BY ordinality)
 INTO out_text FROM unnest(pieces,runs) WITH ORDINALITY decoded(piece,run,ordinality);
 out_text=regexp_replace(coalesce(out_text,''),'&commat;','@','gi');
 out_text=regexp_replace(out_text,'&quot;','"','gi');
 out_text=regexp_replace(out_text,'&apos;','''','gi');
 out_text=regexp_replace(out_text,'&lt;','<','gi');
 out_text=regexp_replace(out_text,'&gt;','>','gi');
 RETURN regexp_replace(out_text,'&amp;','&','gi');
END $$;

CREATE FUNCTION public.decke_improvement_replace_terms(p_text text,p_terms text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE original text:=p_text; out_text text; term text; changed boolean:=false;
 at_pos integer; relative_pos integer; search_from integer; before_char text; after_char text;
BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 out_text=normalize(p_text,NFKC);
 FOR term IN
  SELECT normalized FROM (
   SELECT DISTINCT normalize(btrim(value),NFKC) normalized
   FROM unnest(coalesce(p_terms,'{}'::text[])) value
   WHERE value IS NOT NULL AND char_length(btrim(value))>=1
  ) candidates ORDER BY char_length(normalized) DESC,normalized COLLATE "C"
 LOOP
  search_from=1;
  LOOP
   relative_pos=strpos(substring(lower(out_text COLLATE "C.utf8") FROM search_from),lower(term COLLATE "C.utf8"));
   EXIT WHEN relative_pos=0;
   at_pos=search_from+relative_pos-1;
   IF char_length(term)<3 THEN
    before_char=CASE WHEN at_pos>1 THEN substring(out_text FROM at_pos-1 FOR 1) ELSE '' END;
    after_char=substring(out_text FROM at_pos+char_length(term) FOR 1);
    IF before_char~'[[:alnum:]_]' OR after_char~'[[:alnum:]_]' THEN
     search_from=at_pos+char_length(term);
     CONTINUE;
    END IF;
   END IF;
   out_text=overlay(out_text placing '[redacted]' from at_pos for char_length(term));
   search_from=at_pos+char_length('[redacted]');
   changed=true;
  END LOOP;
 END LOOP;
 RETURN CASE WHEN changed THEN out_text ELSE original END;
END $$;

CREATE FUNCTION public.decke_improvement_decode_text(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE out_text text:=p_text; next_text text; pass integer;
BEGIN
 IF out_text IS NULL THEN RETURN NULL; END IF;
 FOR pass IN 1..3 LOOP
  next_text=public.decke_improvement_percent_decode(out_text);
  EXIT WHEN next_text=out_text;
  out_text=next_text;
 END LOOP;
 out_text=replace(out_text,'+',' ');
 RETURN normalize(public.decke_improvement_decode_escapes(out_text),NFKC);
END $$;

CREATE OR REPLACE FUNCTION public.decke_improvement_redact_text(p_text text,p_terms text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE literal text; current_view text:=p_text; next_view text; escaped_view text; redacted text;
 form_terms text[]; pass integer; exposed integer; view_count integer;
BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 -- Literal variants win so an unrelated '+' or '%' is never decoded merely
 -- because it occurs in the same field as an identity.
 literal=public.decke_improvement_replace_terms(p_text,public.decke_improvement_redaction_variants(p_terms));
 exposed=((char_length(literal)-char_length(replace(literal,'[redacted]','')))
   -(char_length(p_text)-char_length(replace(p_text,'[redacted]',''))))/10;
 -- JSON/entity escapes are another literal representation.  Return their
 -- decoded view only when decoding is what exposes an identity.
 escaped_view=public.decke_improvement_decode_escapes(current_view);
 redacted=public.decke_improvement_replace_terms(escaped_view,p_terms);
 view_count=((char_length(redacted)-char_length(replace(redacted,'[redacted]','')))
   -(char_length(escaped_view)-char_length(replace(escaped_view,'[redacted]',''))))/10;
 IF view_count>exposed THEN RETURN redacted; END IF;
 exposed=greatest(exposed,view_count);
 FOR pass IN 1..3 LOOP
  next_view=public.decke_improvement_percent_decode(current_view);
  EXIT WHEN next_view=current_view;
  current_view=next_view;
  redacted=public.decke_improvement_replace_terms(current_view,p_terms);
  view_count=((char_length(redacted)-char_length(replace(redacted,'[redacted]','')))
    -(char_length(current_view)-char_length(replace(current_view,'[redacted]',''))))/10;
  IF view_count>exposed THEN RETURN redacted; END IF;
  exposed=greatest(exposed,view_count);
  escaped_view=public.decke_improvement_decode_escapes(current_view);
  redacted=public.decke_improvement_replace_terms(escaped_view,p_terms);
  view_count=((char_length(redacted)-char_length(replace(redacted,'[redacted]','')))
    -(char_length(escaped_view)-char_length(replace(escaped_view,'[redacted]',''))))/10;
  IF view_count>exposed THEN RETURN redacted; END IF;
  exposed=greatest(exposed,view_count);
 END LOOP;
 SELECT coalesce(array_agg(value),'{}'::text[]) INTO form_terms
 FROM (SELECT value FROM unnest(coalesce(p_terms,'{}'::text[])) value
       UNION SELECT replace(value,'+',' ') FROM unnest(coalesce(p_terms,'{}'::text[])) value) variants;
 next_view=replace(current_view,'+',' ');
 redacted=public.decke_improvement_replace_terms(next_view,form_terms);
 view_count=((char_length(redacted)-char_length(replace(redacted,'[redacted]','')))
   -(char_length(next_view)-char_length(replace(next_view,'[redacted]',''))))/10;
 IF view_count>exposed THEN RETURN redacted; END IF;
 exposed=greatest(exposed,view_count);
 escaped_view=public.decke_improvement_decode_escapes(next_view);
 redacted=public.decke_improvement_replace_terms(escaped_view,form_terms);
 view_count=((char_length(redacted)-char_length(replace(redacted,'[redacted]','')))
   -(char_length(escaped_view)-char_length(replace(escaped_view,'[redacted]',''))))/10;
 IF view_count>exposed THEN RETURN redacted; END IF;
 RETURN literal;
END $$;

-- The API may obtain only its own identity terms through the request subject.
-- Direct auth.users access remains unavailable to browser/request roles.
CREATE FUNCTION public.decke_improvement_identity_terms(p_user text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; username text; display_name text; email text;
BEGIN
 actor=auth.uid()::text;
 IF actor IS NULL OR p_user IS NULL OR actor<>p_user THEN
  RAISE EXCEPTION 'Identity terms are available only to their subject' USING ERRCODE='42501';
 END IF;
 SELECT u.username,p.display_name,a.email INTO username,display_name,email
 FROM public.app_user u
 LEFT JOIN public.user_profile p ON p.user_id=u.id
 LEFT JOIN auth.users a ON a.id=u.id
 WHERE u.id::text=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account is unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('username',username,'displayName',display_name,'email',email);
END $$;

CREATE FUNCTION public.decke_improvement_is_shared(p_user text,p_conversation uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; consent_owner bytea; conversation uuid;
BEGIN
 IF p_conversation IS NULL THEN RAISE EXCEPTION 'Conversation is required' USING ERRCODE='22023'; END IF;
 owner=public.decke_improvement_require_writer(p_user);
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 SELECT owner_key INTO consent_owner FROM public.decke_improvement_consent
 WHERE id=conversation AND status='shared';
 IF NOT FOUND THEN RETURN false; END IF;
 IF consent_owner<>owner THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.decke_improvement_request_telemetry(p_user text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request_started timestamptz; request_finished timestamptz; request_status text;
 request_build_sha text; request_build_pr integer; request_leg integer;
 operation_count integer; priced_count integer; model text; provider text;
 input_tokens bigint; output_tokens bigint; cache_read_tokens bigint; cache_write_tokens bigint; reasoning_tokens bigint;
 cost_usd numeric; cost_source text; cost_coverage text; latency_ms bigint;
BEGIN
 PERFORM public.decke_improvement_require_writer(p_user);
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request is required' USING ERRCODE='22023'; END IF;
 SELECT r.started_at,r.finished_at,r.status,r.build_sha,r.build_pr,
   (SELECT count(*)::integer-1 FROM public.decke_ai_request prior
    WHERE prior.user_id=r.user_id AND prior.conversation_id=r.conversation_id AND prior.seq=r.seq
      AND (prior.started_at,prior.id)<=(r.started_at,r.id))
 INTO request_started,request_finished,request_status,request_build_sha,request_build_pr,request_leg
 FROM public.decke_ai_request r WHERE r.id=p_request AND r.user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request is unavailable' USING ERRCODE='42501'; END IF;
 SELECT count(*)::integer,count(o.cost_usd)::integer,
   CASE count(DISTINCT nullif(o.model_id,'')) WHEN 0 THEN NULL WHEN 1 THEN min(nullif(o.model_id,'')) ELSE 'mixed' END,
   CASE count(DISTINCT nullif(o.provider,'')) WHEN 0 THEN NULL WHEN 1 THEN min(nullif(o.provider,'')) ELSE 'mixed' END,
   sum(o.input_tokens),sum(o.output_tokens),sum(o.cache_read_tokens),sum(o.cache_write_tokens),sum(o.reasoning_tokens),sum(o.cost_usd),
   CASE WHEN count(o.cost_usd)=0 THEN 'unknown'
     WHEN bool_or(o.cost_usd IS NOT NULL AND o.cost_source='token_rate_estimate') THEN 'token_rate_estimate'
     ELSE 'provider_reported' END
 INTO operation_count,priced_count,model,provider,input_tokens,output_tokens,cache_read_tokens,
   cache_write_tokens,reasoning_tokens,cost_usd,cost_source
 FROM public.decke_ai_operation o WHERE o.request_id=p_request;
 cost_coverage=CASE WHEN priced_count=0 THEN 'unknown' WHEN priced_count=operation_count THEN 'complete' ELSE 'partial' END;
 latency_ms=CASE WHEN request_finished IS NULL THEN NULL ELSE greatest(0,
   floor(extract(epoch FROM request_finished)*1000)::bigint-floor(extract(epoch FROM request_started)*1000)::bigint) END;
 RETURN jsonb_build_object(
  'leg_no',request_leg,'model_id',model,'provider',provider,
  'started_at',to_char(request_started AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'finished_at',CASE WHEN request_finished IS NULL THEN NULL ELSE to_char(request_finished AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
  'latency_ms',latency_ms,'input_tokens',input_tokens,'output_tokens',output_tokens,
  'cache_read_tokens',cache_read_tokens,'cache_write_tokens',cache_write_tokens,'reasoning_tokens',reasoning_tokens,
  'cost_usd',cost_usd,'cost_source',cost_source,'cost_coverage',cost_coverage,
  'status',request_status,'build_sha',request_build_sha,'build_pr',request_build_pr);
END $$;

-- History deletion and corpus withdrawal are one transaction.  Updating only
-- an existing consent also prevents an app_user cascade from recreating rows
-- after the account-deletion trigger has removed that owner's corpus state.
CREATE FUNCTION public.decke_improvement_withdraw_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; changed integer;
BEGIN
 owner=public.decke_improvement_owner_key(OLD.user_id::text);
 conversation=public.decke_improvement_uuid('conversation:',OLD.id);
 UPDATE public.decke_improvement_consent SET status='revoked',answered_at=now(),updated_at=now()
 WHERE id=conversation AND owner_key=owner;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN
  DELETE FROM public.decke_improvement_conversation WHERE id=conversation AND owner_key=owner;
 END IF;
 RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS decke_improvement_withdraw_history ON public.decke_conversation;
CREATE TRIGGER decke_improvement_withdraw_history
AFTER DELETE ON public.decke_conversation
FOR EACH ROW EXECUTE FUNCTION public.decke_improvement_withdraw_history();

CREATE OR REPLACE FUNCTION public.decke_improvement_revoke(p_user text,p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; consent_owner bytea;
 turns integer:=0; legs integer:=0; events integer:=0; conversations integer:=0;
BEGIN
 IF p_conversation IS NULL THEN RAISE EXCEPTION 'Conversation is required' USING ERRCODE='22023'; END IF;
 owner=public.decke_improvement_require_writer(p_user);
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 SELECT owner_key INTO consent_owner FROM public.decke_improvement_consent WHERE id=conversation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Improvement consent is unavailable' USING ERRCODE='P0002'; END IF;
 IF consent_owner<>owner THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;
 SELECT count(*)::integer INTO conversations FROM public.decke_improvement_conversation WHERE id=conversation;
 SELECT count(*)::integer INTO turns FROM public.decke_improvement_turn WHERE conversation_id=conversation;
 SELECT count(*)::integer INTO legs FROM public.decke_improvement_leg WHERE conversation_id=conversation;
 SELECT count(*)::integer INTO events FROM public.decke_improvement_event WHERE conversation_id=conversation;
 DELETE FROM public.decke_ai_content legacy USING public.decke_ai_request request
  WHERE legacy.request_id=request.id AND request.user_id=p_user AND request.conversation_id=p_conversation;
 DELETE FROM public.decke_improvement_conversation WHERE id=conversation AND owner_key=owner;
 UPDATE public.decke_improvement_consent SET status='revoked',answered_at=now(),updated_at=now()
  WHERE id=conversation;
 RETURN jsonb_build_object('revoked',true,'conversationId',p_conversation,'deleted',jsonb_build_object(
  'conversations',conversations,'turns',turns,'legs',legs,'events',events));
END $$;

CREATE OR REPLACE FUNCTION public.decke_improvement_list(p_filters jsonb DEFAULT '{}'::jsonb,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cursor_time timestamptz; cursor_id uuid; items jsonb; next_cursor text; filters jsonb:=coalesce(p_filters,'{}'::jsonb);
 min_cost numeric; max_cost numeric; from_day date; to_day date;
BEGIN
 PERFORM public.decke_improvement_require_reader();
 BEGIN PERFORM public.decke_improvement_purge_expired(); EXCEPTION WHEN read_only_sql_transaction THEN NULL; END;
 IF jsonb_typeof(filters)<>'object' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR filters-ARRAY['from','to','build_sha','build_pr','vote','min_cost','max_cost','has_error','model','tool']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid list filters' USING ERRCODE='22023';
 END IF;
 IF (filters?'from' AND (jsonb_typeof(filters->'from')<>'string' OR filters->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
    OR (filters?'to' AND (jsonb_typeof(filters->'to')<>'string' OR filters->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
    OR (filters?'min_cost' AND (jsonb_typeof(filters->'min_cost') NOT IN ('number','string') OR filters->>'min_cost'!~'^[0-9]+(?:[.][0-9]{1,2})?$'))
    OR (filters?'max_cost' AND (jsonb_typeof(filters->'max_cost') NOT IN ('number','string') OR filters->>'max_cost'!~'^[0-9]+(?:[.][0-9]{1,2})?$')) THEN
  RAISE EXCEPTION 'List date filters must be UTC days and costs must be whole cents' USING ERRCODE='22023';
 END IF;
 IF filters?'from' THEN from_day=(filters->>'from')::date; END IF;
 IF filters?'to' THEN to_day=(filters->>'to')::date; END IF;
 IF filters?'min_cost' THEN min_cost=(filters->>'min_cost')::numeric; END IF;
 IF filters?'max_cost' THEN max_cost=(filters->>'max_cost')::numeric; END IF;
 IF p_cursor IS NOT NULL THEN
  BEGIN
   cursor_id=p_cursor::uuid;
   SELECT updated_at INTO cursor_time FROM public.decke_improvement_conversation WHERE id=cursor_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023'; END;
 END IF;
 WITH selected AS (
  SELECT c.*,(SELECT count(*) FROM public.decke_improvement_turn t WHERE t.conversation_id=c.id) turn_count
  FROM public.decke_improvement_conversation c WHERE
   c.updated_at>=now()-interval '180 days'
   AND (cursor_time IS NULL OR (c.updated_at,c.id)<(cursor_time,cursor_id))
   AND (from_day IS NULL OR (c.started_at AT TIME ZONE 'UTC')::date>=from_day)
   AND (to_day IS NULL OR (c.started_at AT TIME ZONE 'UTC')::date<to_day)
   AND (NOT(filters?'has_error') OR c.has_error=(filters->>'has_error')::boolean)
   AND (min_cost IS NULL OR round(c.cost_usd,2)>=min_cost)
   AND (max_cost IS NULL OR round(c.cost_usd,2)<=max_cost)
   AND (NOT(filters?'build_sha') OR EXISTS(SELECT 1 FROM public.decke_improvement_turn t WHERE t.conversation_id=c.id AND t.build_sha=filters->>'build_sha'))
   AND (NOT(filters?'build_pr') OR EXISTS(SELECT 1 FROM public.decke_improvement_turn t WHERE t.conversation_id=c.id AND t.build_pr=(filters->>'build_pr')::integer))
   AND (NOT(filters?'vote') OR EXISTS(SELECT 1 FROM public.decke_improvement_turn t WHERE t.conversation_id=c.id AND t.feedback=(filters->>'vote')::smallint))
   AND (NOT(filters?'model') OR EXISTS(SELECT 1 FROM public.decke_improvement_leg l WHERE l.conversation_id=c.id AND l.model_id=filters->>'model'))
   AND (NOT(filters?'tool') OR EXISTS(SELECT 1 FROM public.decke_improvement_leg l WHERE l.conversation_id=c.id
     AND l.tool_calls @> jsonb_build_array(jsonb_build_object('name',filters->>'tool'))))
  ORDER BY c.updated_at DESC,c.id DESC LIMIT p_limit+1
 ), page AS (SELECT * FROM selected ORDER BY updated_at DESC,id DESC LIMIT p_limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'date',to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD'),
   'buildFirst',build_first,'buildLast',build_last,'turnCount',turn_count,
   'costUsd',CASE WHEN cost_usd IS NULL THEN NULL ELSE round(cost_usd,2) END,
   'costCoverage',cost_coverage,'hasError',has_error) ORDER BY updated_at DESC,id DESC),'[]'::jsonb),
   CASE WHEN (SELECT count(*) FROM selected)>p_limit THEN (SELECT id::text FROM page ORDER BY updated_at,id LIMIT 1) END
 INTO items,next_cursor FROM page;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Invalid list filter value' USING ERRCODE='22023';
END $$;

-- Repair shared rows whose personal History record disappeared before this
-- trigger existed, then re-run the stronger redactor over every retained field.
-- Materialising the HMAC mapping once avoids a corpus-by-History nested scan on
-- production data; the table is dropped again before this migration finishes.
CREATE TEMP TABLE decke_improvement_079_map AS
SELECT d.id raw_id,d.user_id::text p_user,
 public.decke_improvement_uuid('conversation:',d.id) corpus_id,
 public.decke_improvement_owner_key(d.user_id::text) owner_key
FROM public.decke_conversation d;
CREATE UNIQUE INDEX decke_improvement_079_map_corpus_idx
 ON decke_improvement_079_map(corpus_id,owner_key);

UPDATE public.decke_improvement_consent x SET status='revoked',answered_at=now(),updated_at=now()
WHERE x.status='shared'
 AND EXISTS(SELECT 1 FROM public.decke_improvement_conversation c WHERE c.id=x.id AND c.owner_key=x.owner_key)
 AND NOT EXISTS(
  SELECT 1 FROM pg_temp.decke_improvement_079_map m
  WHERE m.corpus_id=x.id AND m.owner_key=x.owner_key
 );

DELETE FROM public.decke_improvement_conversation c
WHERE NOT EXISTS(
 SELECT 1 FROM pg_temp.decke_improvement_079_map m
 WHERE m.corpus_id=c.id AND m.owner_key=c.owner_key
);

-- This migration-only helper reconstructs every identity term available to
-- the live writers, including raw UUIDs that were never retained in corpus
-- ownership columns.  Drop it before commit so it cannot become a reader API.
CREATE FUNCTION public.decke_improvement_repair_terms(p_user text,p_conversation uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.decke_improvement_redaction_terms(p_user)
   ||ARRAY[p_user,p_conversation::text]
   ||coalesce(array_agg(r.id::text),'{}'::text[])
   ||coalesce(array_agg(r.exchange_id::text),'{}'::text[])
 FROM public.decke_ai_request r
 WHERE r.user_id=p_user AND r.conversation_id=p_conversation
$$;

WITH identities AS MATERIALIZED (
 SELECT c.id,public.decke_improvement_repair_terms(m.p_user,m.raw_id) terms
 FROM public.decke_improvement_conversation c JOIN pg_temp.decke_improvement_079_map m
  ON m.corpus_id=c.id AND m.owner_key=c.owner_key
)
UPDATE public.decke_improvement_turn t SET
 asked=public.decke_improvement_redact_text(t.asked,i.terms),
 answered=public.decke_improvement_redact_text(t.answered,i.terms),
 tools=public.decke_improvement_redact_json_identifiers(t.tools,i.terms),
 feedback_comment=public.decke_improvement_redact_text(t.feedback_comment,i.terms)
FROM identities i WHERE t.conversation_id=i.id;

WITH identities AS MATERIALIZED (
 SELECT c.id,public.decke_improvement_repair_terms(m.p_user,m.raw_id) terms
 FROM public.decke_improvement_conversation c JOIN pg_temp.decke_improvement_079_map m
  ON m.corpus_id=c.id AND m.owner_key=c.owner_key
)
UPDATE public.decke_improvement_leg l SET
 asked=public.decke_improvement_redact_text(l.asked,i.terms),
 answered=public.decke_improvement_redact_text(l.answered,i.terms),
 error=public.decke_improvement_redact_json_identifiers(l.error,i.terms),
 tool_calls=public.decke_improvement_redact_json_identifiers(l.tool_calls,i.terms)
FROM identities i WHERE l.conversation_id=i.id;

WITH identities AS MATERIALIZED (
 SELECT c.id,public.decke_improvement_repair_terms(m.p_user,m.raw_id) terms
 FROM public.decke_improvement_conversation c JOIN pg_temp.decke_improvement_079_map m
  ON m.corpus_id=c.id AND m.owner_key=c.owner_key
)
UPDATE public.decke_improvement_event e SET
 payload=public.decke_improvement_redact_json_identifiers(e.payload,i.terms)
FROM identities i WHERE e.conversation_id=i.id;

DROP FUNCTION public.decke_improvement_repair_terms(text,uuid);
DROP TABLE pg_temp.decke_improvement_079_map;

DO $acl$
DECLARE principal text;
BEGIN
 -- Keep decoder and raw matching machinery private; only the three narrow
 -- subject-scoped boundaries below are callable by the request role.
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
  CONTINUE WHEN principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_percent_run(text) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_percent_decode(text) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_decode_scalar(text) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_decode_escapes(text) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_replace_terms(text,text[]) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_decode_text(text) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_identity_terms(text) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_is_shared(text,uuid) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_request_telemetry(text,uuid) FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_withdraw_history() FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.decke_improvement_identity_terms(text),
   public.decke_improvement_is_shared(text,uuid),
   public.decke_improvement_request_telemetry(text,uuid) TO authenticated;
 END IF;
END $acl$;

COMMENT ON FUNCTION public.decke_improvement_identity_terms(text) IS
 'Returns the calling authenticated subject identity terms for API-side improvement redaction.';
COMMENT ON FUNCTION public.decke_improvement_is_shared(text,uuid) IS
 'Reports subject-owned sharing state without exposing the corpus owner HMAC.';
COMMENT ON FUNCTION public.decke_improvement_request_telemetry(text,uuid) IS
 'Returns accounting metadata for one subject-owned request without chat content.';
