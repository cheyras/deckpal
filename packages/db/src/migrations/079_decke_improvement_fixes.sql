-- 079 · Privacy and lifecycle fixes for the Deck-E improvement corpus.
--
-- Migration 078 is already deployed.  Keep its public signatures stable while
-- replacing the affected functions and repairing retained corpus rows in place.

-- Decode representations before matching.  Encoding identity terms cannot
-- cover case changes inside UTF-8 bytes (for example JOS%C3%89 versus Jos%C3%A9).
-- Three passes handle ordinary nested encodings without making malformed input
-- an unbounded parser; invalid byte runs and entities remain literal text.
CREATE FUNCTION public.decke_improvement_decode_text(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE out_text text:=p_text; matched text[]; decoded text; bytes bytea;
 at_pos integer; relative_pos integer; search_from integer; pass integer; codepoint integer;
 escaped text[]; low_escape text; low_point integer; consumed integer;
 first_byte integer; sequence_bytes integer; encoded_prefix text;
BEGIN
 IF out_text IS NULL THEN RETURN NULL; END IF;
 FOR pass IN 1..3 LOOP
  -- JSON Unicode escapes can be exposed by a preceding percent decode.
  search_from=1;
  LOOP
   SELECT regexp_match(substring(out_text FROM search_from),'(\\u([0-9A-Fa-f]{4}))') INTO escaped;
   EXIT WHEN escaped IS NULL;
   relative_pos=strpos(lower(substring(out_text FROM search_from)),lower(escaped[1]));
   at_pos=search_from+relative_pos-1;
   codepoint=get_byte(decode(escaped[2],'hex'),0)*256+get_byte(decode(escaped[2],'hex'),1);
   consumed=6;
   IF codepoint BETWEEN 55296 AND 56319 THEN
    low_escape=substring(out_text FROM at_pos+6 FOR 6);
    IF low_escape~'^\\u[dD][c-fC-F][0-9A-Fa-f]{2}$' THEN
     low_point=get_byte(decode(substring(low_escape FROM 3 FOR 4),'hex'),0)*256
       +get_byte(decode(substring(low_escape FROM 3 FOR 4),'hex'),1);
     codepoint=65536+(codepoint-55296)*1024+(low_point-56320);
     consumed=12;
    ELSE
     search_from=at_pos+6;
     CONTINUE;
    END IF;
   ELSIF codepoint BETWEEN 56320 AND 57343 THEN
    search_from=at_pos+6;
    CONTINUE;
   END IF;
   out_text=overlay(out_text placing chr(codepoint) from at_pos for consumed);
   search_from=at_pos+1;
  END LOOP;

  -- Decode complete percent-byte runs together so multibyte UTF-8 survives.
  -- A malformed UTF-8 run is skipped rather than aborting a telemetry write.
  search_from=1;
  LOOP
   SELECT regexp_match(substring(out_text FROM search_from),'((?:%[0-9A-Fa-f]{2})+)') INTO matched;
   EXIT WHEN matched IS NULL;
   relative_pos=strpos(substring(out_text FROM search_from),matched[1]);
   at_pos=search_from+relative_pos-1;
   BEGIN
    bytes=decode(replace(matched[1],'%',''),'hex');
    decoded=convert_from(bytes,'UTF8');
    out_text=overlay(out_text placing decoded from at_pos for char_length(matched[1]));
    search_from=at_pos+char_length(decoded);
   EXCEPTION WHEN OTHERS THEN
    -- One malformed byte must not shield an adjacent valid UTF-8 identity.
    -- Decode a valid leading scalar when possible; otherwise advance exactly
    -- one triplet and let the next loop reconsider the remaining run.
    first_byte=get_byte(decode(substring(matched[1] FROM 2 FOR 2),'hex'),0);
    sequence_bytes=CASE WHEN first_byte<128 THEN 1 WHEN first_byte BETWEEN 194 AND 223 THEN 2
      WHEN first_byte BETWEEN 224 AND 239 THEN 3 WHEN first_byte BETWEEN 240 AND 244 THEN 4 ELSE 0 END;
    IF sequence_bytes>0 AND char_length(matched[1])>=sequence_bytes*3 THEN
     encoded_prefix=substring(matched[1] FROM 1 FOR sequence_bytes*3);
     BEGIN
      decoded=convert_from(decode(replace(encoded_prefix,'%',''),'hex'),'UTF8');
      out_text=overlay(out_text placing decoded from at_pos for char_length(encoded_prefix));
      search_from=at_pos+char_length(decoded);
     EXCEPTION WHEN OTHERS THEN search_from=at_pos+3;
     END;
    ELSE
     search_from=at_pos+3;
    END IF;
   END;
  END LOOP;
  out_text=replace(out_text,'+',' ');

  -- Decode the small named-entity set emitted by clients, followed by bounded
  -- numeric entities.  Invalid Unicode scalar values are left untouched.
  out_text=regexp_replace(out_text,'&commat;','@','gi');
  out_text=regexp_replace(out_text,'&quot;','"','gi');
  out_text=regexp_replace(out_text,'&apos;','''','gi');
  out_text=regexp_replace(out_text,'&lt;','<','gi');
  out_text=regexp_replace(out_text,'&gt;','>','gi');
  out_text=regexp_replace(out_text,'&amp;','&','gi');
  search_from=1;
  LOOP
   SELECT regexp_match(substring(out_text FROM search_from),'(&#[xX]([0-9A-Fa-f]{1,6});)') INTO matched;
   EXIT WHEN matched IS NULL;
   relative_pos=strpos(substring(out_text FROM search_from),matched[1]);
   at_pos=search_from+relative_pos-1;
   BEGIN
    bytes=decode(lpad(matched[2],6,'0'),'hex');
    codepoint=get_byte(bytes,0)*65536+get_byte(bytes,1)*256+get_byte(bytes,2);
    IF codepoint=0 OR codepoint>1114111 OR codepoint BETWEEN 55296 AND 57343 THEN RAISE EXCEPTION 'invalid scalar'; END IF;
    out_text=overlay(out_text placing chr(codepoint) from at_pos for char_length(matched[1]));
    search_from=at_pos+1;
   EXCEPTION WHEN OTHERS THEN search_from=at_pos+char_length(matched[1]);
   END;
  END LOOP;
  search_from=1;
  LOOP
   SELECT regexp_match(substring(out_text FROM search_from),'(&#([0-9]{1,7});)') INTO matched;
   EXIT WHEN matched IS NULL;
   relative_pos=strpos(substring(out_text FROM search_from),matched[1]);
   at_pos=search_from+relative_pos-1;
   BEGIN
    codepoint=matched[2]::integer;
    IF codepoint=0 OR codepoint>1114111 OR codepoint BETWEEN 55296 AND 57343 THEN RAISE EXCEPTION 'invalid scalar'; END IF;
    out_text=overlay(out_text placing chr(codepoint) from at_pos for char_length(matched[1]));
    search_from=at_pos+1;
   EXCEPTION WHEN OTHERS THEN search_from=at_pos+char_length(matched[1]);
   END;
  END LOOP;
 END LOOP;
 RETURN normalize(out_text,NFC);
END $$;

CREATE OR REPLACE FUNCTION public.decke_improvement_redact_text(p_text text,p_terms text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE out_text text:=public.decke_improvement_decode_text(p_text); term text;
 at_pos integer; relative_pos integer; search_from integer; before_char text; after_char text;
BEGIN
 IF out_text IS NULL THEN RETURN NULL; END IF;
 FOR term IN
  SELECT normalized FROM (
   SELECT DISTINCT normalize(btrim(value),NFC) normalized
   FROM unnest(coalesce(p_terms,'{}'::text[])) value
   WHERE value IS NOT NULL AND char_length(btrim(value))>=1
  ) candidates ORDER BY char_length(normalized) DESC,normalized COLLATE "C"
 LOOP
  search_from=1;
  LOOP
   -- C.utf8 supplies Unicode-aware casing even when the cluster itself was
   -- initialised with the bytewise C locale, as the integration runner is.
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
  END LOOP;
 END LOOP;
 RETURN out_text;
END $$;

-- The API may obtain only its own identity terms through the request subject.
-- Direct auth.users access remains unavailable to browser/request roles.
CREATE FUNCTION public.decke_improvement_identity_terms(p_user text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; username text; display_name text; email text; terms text[];
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
 SELECT coalesce(array_agg(value ORDER BY char_length(value) DESC,value),'{}'::text[]) INTO terms
 FROM (SELECT DISTINCT btrim(value) value FROM unnest(ARRAY[username,display_name,email]) value
       WHERE value IS NOT NULL AND char_length(btrim(value))>=1) candidates;
 RETURN terms;
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
    OR (filters?'min_cost' AND (jsonb_typeof(filters->'min_cost')<>'number' OR filters->>'min_cost'!~'^[0-9]+(?:[.][0-9]{1,2})?$'))
    OR (filters?'max_cost' AND (jsonb_typeof(filters->'max_cost')<>'number' OR filters->>'max_cost'!~'^[0-9]+(?:[.][0-9]{1,2})?$')) THEN
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
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
  CONTINUE WHEN principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_decode_text(text) FROM %s',
   CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_identity_terms(text) FROM %s',
   CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON FUNCTION public.decke_improvement_withdraw_history() FROM %s',
   CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.decke_improvement_identity_terms(text) TO authenticated;
 END IF;
END $acl$;

COMMENT ON FUNCTION public.decke_improvement_identity_terms(text) IS
 'Returns the calling authenticated subject identity terms for API-side improvement redaction.';
