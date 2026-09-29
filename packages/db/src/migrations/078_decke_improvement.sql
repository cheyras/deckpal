-- 078 · Pseudonymised Deck-E improvement corpus, consent, feedback and readers.
--
-- The collection is deliberately separate from personal history and accounting.
-- It contains no raw user, conversation, exchange or request identifiers.  The
-- only stable owner value and the two UUID identities are HMAC-SHA256 values
-- made with the singleton database secret below.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.user_settings
  ADD COLUMN decke_share_prompts boolean NOT NULL DEFAULT true;

CREATE TABLE public.decke_improvement_secret (
  id smallint PRIMARY KEY CHECK (id = 1),
  key bytea NOT NULL CHECK (octet_length(key) = 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.decke_improvement_secret(id,key)
VALUES (1,extensions.gen_random_bytes(32));

-- Consent is deliberately separate from the corpus.  An asked/declined/revoked
-- conversation has no improvement content, but the durable row prevents Deck-E
-- from asking again in that conversation.
CREATE TABLE public.decke_improvement_consent (
  id uuid PRIMARY KEY,
  owner_key bytea NOT NULL CHECK (octet_length(owner_key) = 32),
  status text NOT NULL CHECK (status IN ('asked','shared','declined','revoked')),
  source text NOT NULL CHECK (source IN ('decke_ask','feedback','reader')),
  asked_at timestamptz,
  answered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decke_improvement_consent_owner_idx
  ON public.decke_improvement_consent(owner_key,updated_at DESC);

CREATE TABLE public.decke_improvement_conversation (
  id uuid PRIMARY KEY,
  owner_key bytea NOT NULL CHECK (octet_length(owner_key) = 32),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  build_first text,
  build_last text,
  cost_usd numeric(24,12),
  cost_coverage text NOT NULL DEFAULT 'unknown' CHECK (cost_coverage IN ('complete','partial','unknown')),
  has_error boolean NOT NULL DEFAULT false
);
CREATE INDEX decke_improvement_conversation_list_idx
  ON public.decke_improvement_conversation(updated_at DESC,id DESC);
CREATE INDEX decke_improvement_conversation_owner_idx
  ON public.decke_improvement_conversation(owner_key);
CREATE INDEX decke_improvement_conversation_build_idx
  ON public.decke_improvement_conversation(build_last,updated_at DESC);
CREATE INDEX decke_improvement_conversation_error_idx
  ON public.decke_improvement_conversation(has_error,updated_at DESC) WHERE has_error;

CREATE TABLE public.decke_improvement_turn (
  conversation_id uuid NOT NULL REFERENCES public.decke_improvement_conversation(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  asked text NOT NULL DEFAULT '',
  answered text NOT NULL DEFAULT '',
  tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tools) = 'array'),
  feedback smallint CHECK (feedback IN (-1,1)),
  feedback_comment text CHECK (char_length(feedback_comment) <= 500),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cache_read_tokens bigint CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  cache_write_tokens bigint CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  reasoning_tokens bigint CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  cost_usd numeric(24,12),
  cost_coverage text NOT NULL DEFAULT 'unknown' CHECK (cost_coverage IN ('complete','partial','unknown')),
  build_sha text,
  build_pr integer,
  finish_reason text,
  has_error boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id,seq)
);
CREATE INDEX decke_improvement_turn_build_idx
  ON public.decke_improvement_turn(build_sha,build_pr,started_at DESC);
CREATE INDEX decke_improvement_turn_build_pr_idx
  ON public.decke_improvement_turn(build_pr,started_at DESC) WHERE build_pr IS NOT NULL;
CREATE INDEX decke_improvement_turn_feedback_idx
  ON public.decke_improvement_turn(feedback,started_at DESC) WHERE feedback IS NOT NULL;
CREATE INDEX decke_improvement_turn_error_idx
  ON public.decke_improvement_turn(has_error,started_at DESC) WHERE has_error;

CREATE TABLE public.decke_improvement_leg (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  seq integer NOT NULL,
  leg integer NOT NULL CHECK (leg >= 0),
  asked text NOT NULL DEFAULT '',
  answered text NOT NULL DEFAULT '',
  model_id text,
  provider text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cache_read_tokens bigint CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  cache_write_tokens bigint CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  reasoning_tokens bigint CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  cost_usd numeric(24,12) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_coverage text NOT NULL DEFAULT 'unknown' CHECK (cost_coverage IN ('complete','partial','unknown')),
  cost_source text NOT NULL DEFAULT 'unknown' CHECK (cost_source IN ('provider_reported','token_rate_estimate','unknown')),
  status text NOT NULL CHECK (status IN ('started','completed','failed','cancelled','abandoned')),
  finish_reason text,
  build_sha text,
  build_pr integer,
  error jsonb,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tool_calls) = 'array'),
  UNIQUE (id,conversation_id,seq),
  UNIQUE (conversation_id,seq,leg),
  FOREIGN KEY (conversation_id,seq) REFERENCES public.decke_improvement_turn(conversation_id,seq) ON DELETE CASCADE
);
CREATE INDEX decke_improvement_leg_model_idx
  ON public.decke_improvement_leg(model_id,started_at DESC);
CREATE INDEX decke_improvement_leg_tools_idx
  ON public.decke_improvement_leg USING gin(tool_calls jsonb_path_ops);

CREATE TABLE public.decke_improvement_event (
  conversation_id uuid NOT NULL,
  seq integer NOT NULL,
  leg_id uuid,
  batch integer NOT NULL CHECK (batch >= 0),
  batch_ordinal integer NOT NULL CHECK (batch_ordinal >= 0),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('animation','browser_tool','notice','error','timing','approval_ui')),
  payload jsonb NOT NULL,
  PRIMARY KEY (conversation_id,seq,ordinal),
  UNIQUE (conversation_id,seq,batch,batch_ordinal),
  FOREIGN KEY (leg_id,conversation_id,seq)
    REFERENCES public.decke_improvement_leg(id,conversation_id,seq) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id,seq) REFERENCES public.decke_improvement_turn(conversation_id,seq) ON DELETE CASCADE
);
CREATE INDEX decke_improvement_event_kind_idx
  ON public.decke_improvement_event(kind,at DESC);

ALTER TABLE public.decke_turn
  ADD CONSTRAINT decke_turn_feedback_parent_key UNIQUE (conversation_id,seq,user_id);

CREATE TABLE public.decke_turn_feedback (
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 0),
  vote smallint CHECK (vote IN (-1,1)),
  comment text CHECK (char_length(comment) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,conversation_id,seq),
  FOREIGN KEY (conversation_id,seq,user_id)
    REFERENCES public.decke_turn(conversation_id,seq,user_id) ON DELETE CASCADE
);
CREATE INDEX decke_turn_feedback_updated_idx
  ON public.decke_turn_feedback(user_id,updated_at DESC);

ALTER TABLE public.decke_improvement_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_improvement_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_improvement_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_improvement_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_improvement_leg ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_improvement_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decke_turn_feedback ENABLE ROW LEVEL SECURITY;

-- A token capability is server-owned.  OAuth and PAT credentials both resolve
-- through api_token, so one live bit covers both credential forms.
ALTER TABLE public.api_token
  ADD COLUMN decke_improvement_read boolean NOT NULL DEFAULT false;
ALTER TABLE public.oauth_code
  ADD COLUMN decke_improvement_read boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.api_token.decke_improvement_read IS
  'Explicit non-browser capability for Deck-E improvement readers; requires live admin permission too.';
COMMENT ON COLUMN public.oauth_code.decke_improvement_read IS
  'Signed-in consent decision copied to api_token by the OAuth exchange; defaults closed.';

INSERT INTO public.admin_permission(key,permission_group,description)
VALUES ('decke.improvement.read','AI','Read the pseudonymised Deck-E improvement corpus.')
ON CONFLICT DO NOTHING;
INSERT INTO public.admin_role_permission(role_id,permission_key)
SELECT id,'decke.improvement.read' FROM public.admin_role
 WHERE system AND tier >= 40
ON CONFLICT DO NOTHING;

-- Deterministic pseudonyms.  The collision branch makes the stronger contract
-- explicit: even the astronomically unlikely HMAC equality cannot reproduce
-- the supplied user-linked UUID.
CREATE FUNCTION public.decke_improvement_uuid(p_domain text,p_input uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret bytea; hex text; out_id uuid;
BEGIN
 SELECT key INTO secret FROM public.decke_improvement_secret WHERE id=1;
 IF secret IS NULL OR p_domain NOT IN ('conversation:','request:') OR p_input IS NULL THEN
  RAISE EXCEPTION 'Improvement pseudonym input is invalid' USING ERRCODE='22023';
 END IF;
 hex=encode(extensions.hmac(convert_to(p_domain||p_input::text,'UTF8'),secret,'sha256'),'hex');
 out_id=(substring(hex,1,8)||'-'||substring(hex,9,4)||'-'||substring(hex,13,4)||'-'||substring(hex,17,4)||'-'||substring(hex,21,12))::uuid;
 IF out_id=p_input THEN
  hex=encode(extensions.hmac(convert_to(p_domain||'collision:'||p_input::text,'UTF8'),secret,'sha256'),'hex');
  out_id=(substring(hex,1,8)||'-'||substring(hex,9,4)||'-'||substring(hex,13,4)||'-'||substring(hex,17,4)||'-'||substring(hex,21,12))::uuid;
 END IF;
 RETURN out_id;
END $$;

CREATE FUNCTION public.decke_improvement_owner_key(p_user text) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret bytea;
BEGIN
 SELECT key INTO secret FROM public.decke_improvement_secret WHERE id=1;
 IF secret IS NULL OR p_user IS NULL OR p_user='' THEN RAISE EXCEPTION 'Improvement owner is invalid' USING ERRCODE='22023'; END IF;
 RETURN extensions.hmac(convert_to('owner:'||p_user,'UTF8'),secret,'sha256');
END $$;

-- Redaction must cover representations routinely produced by URLs, forms and
-- Unicode-aware clients.  Expanding in SQL keeps the defence-in-depth layer
-- effective even when a caller reaches a writer without the API redactor.
CREATE FUNCTION public.decke_improvement_redaction_variants(p_terms text[]) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE raw_term text; normalized text; encoded text; form_encoded text; bytes bytea;
 byte integer; position integer; variants text[]:='{}'::text[]; result text[];
BEGIN
 FOREACH raw_term IN ARRAY coalesce(p_terms,'{}'::text[]) LOOP
  CONTINUE WHEN raw_term IS NULL OR char_length(btrim(raw_term))<1;
  FOR normalized IN
   SELECT normalize(btrim(raw_term),NFC) UNION SELECT normalize(btrim(raw_term),NFD)
  LOOP
   variants=array_append(variants,normalized);
   bytes=convert_to(normalized,'UTF8'); encoded=''; form_encoded='';
   FOR position IN 0..octet_length(bytes)-1 LOOP
    byte=get_byte(bytes,position);
    IF (byte BETWEEN 48 AND 57) OR (byte BETWEEN 65 AND 90) OR (byte BETWEEN 97 AND 122)
       OR byte IN (45,46,95,126) THEN
     encoded=encoded||chr(byte);
    ELSE
     encoded=encoded||'%'||upper(lpad(to_hex(byte),2,'0'));
    END IF;
    IF (byte BETWEEN 48 AND 57) OR (byte BETWEEN 65 AND 90) OR (byte BETWEEN 97 AND 122)
       OR byte IN (42,45,46,95) THEN
     form_encoded=form_encoded||chr(byte);
    ELSIF byte=32 THEN
     form_encoded=form_encoded||'+';
    ELSE
     form_encoded=form_encoded||'%'||upper(lpad(to_hex(byte),2,'0'));
    END IF;
   END LOOP;
   variants=array_append(variants,encoded);
   variants=array_append(variants,form_encoded);
   IF strpos(normalized,'@')>0 THEN
    variants=array_append(variants,replace(normalized,'@','&#64;'));
    variants=array_append(variants,replace(normalized,'@','&#x40;'));
    variants=array_append(variants,replace(normalized,'@','&commat;'));
   END IF;
  END LOOP;
 END LOOP;
 SELECT coalesce(array_agg(value ORDER BY char_length(value) DESC,value),'{}'::text[]) INTO result
 FROM (SELECT DISTINCT value FROM unnest(variants) value WHERE char_length(value)>=1) expanded;
 RETURN result;
END $$;

CREATE FUNCTION public.decke_improvement_redaction_terms(p_user text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE username text; display_name text; email text; terms text[];
BEGIN
 SELECT u.username,p.display_name INTO username,display_name
   FROM public.app_user u LEFT JOIN public.user_profile p ON p.user_id=u.id
  WHERE u.id::text=p_user;
 IF to_regclass('auth.users') IS NOT NULL THEN
  EXECUTE 'SELECT email FROM auth.users WHERE id::text=$1' INTO email USING p_user;
 END IF;
 SELECT coalesce(array_agg(value ORDER BY char_length(value) DESC,value),'{}'::text[]) INTO terms
   FROM (SELECT DISTINCT value FROM unnest(ARRAY[username,display_name,email,split_part(email,'@',1)]) value
          WHERE value IS NOT NULL AND char_length(btrim(value))>=1) candidates;
 RETURN terms;
END $$;

CREATE FUNCTION public.decke_improvement_redact_text(p_text text,p_terms text[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE out_text text:=p_text; term text; at_pos integer; relative_pos integer; search_from integer;
 before_char text; after_char text; escaped text[]; codepoint integer; low_escape text; low_point integer; consumed integer;
BEGIN
 IF out_text IS NULL THEN RETURN NULL; END IF;
 -- Decode JSON-style Unicode spellings before matching. This protects text
 -- columns as well as JSON encoded inside arbitrary string fields.
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
 FOREACH term IN ARRAY public.decke_improvement_redaction_variants(p_terms) LOOP
  search_from=1;
  LOOP
   relative_pos=strpos(substring(lower(out_text) FROM search_from),lower(term));
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

-- Arbitrary tool/error/event JSON may contain model-call timestamps or raw
-- provider identifiers. Readers get turn-level ten-second offsets separately;
-- nested telemetry never exposes another wall-clock or duration fingerprint.
CREATE FUNCTION public.decke_improvement_reader_json(p_value jsonb,p_base timestamptz) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE raw_text text; parsed_json jsonb; result jsonb; matched text[];
BEGIN
 CASE jsonb_typeof(p_value)
  WHEN 'string' THEN
   raw_text=p_value#>>'{}';
   BEGIN
    parsed_json=raw_text::jsonb;
    IF jsonb_typeof(parsed_json) IN ('object','array') THEN
     RETURN to_jsonb(public.decke_improvement_reader_json(parsed_json,p_base)::text);
    END IF;
   EXCEPTION WHEN invalid_text_representation THEN NULL;
   END;
   LOOP
    SELECT regexp_match(raw_text,'[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:?[0-9]{2})') INTO matched;
    EXIT WHEN matched IS NULL;
    raw_text=replace(raw_text,matched[1],'[time omitted]');
   END LOOP;
   raw_text=regexp_replace(raw_text,
    '("(?:latencyMs|latency_ms|durationMs|duration_ms|elapsedMs|elapsed_ms|offsetMs|offset_ms|epochMs|epoch_ms)"[[:space:]]*:[[:space:]]*)[0-9]+(?:\.[0-9]+)?',
    '\1"[timing omitted]"','gi');
   raw_text=regexp_replace(raw_text,
    '("(?:requestId|request_id|generationId|generation_id)"[[:space:]]*:[[:space:]]*)("[^"]*"|[0-9]+|null)',
    '\1"[redacted]"','gi');
   RETURN to_jsonb(raw_text);
  WHEN 'array' THEN
   SELECT coalesce(jsonb_agg(public.decke_improvement_reader_json(value,p_base) ORDER BY ordinality),'[]'::jsonb)
    INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY;
   RETURN result;
  WHEN 'object' THEN
   SELECT coalesce(jsonb_object_agg(key,
    CASE WHEN lower(replace(key,'_','')) IN ('latencyms','durationms','elapsedms','offsetms','startedoffsetms','finishedoffsetms',
      'timing','timings','steptiming','steptimings','epoch','epochms','now')
      THEN to_jsonb('[timing omitted]'::text)
     WHEN lower(replace(key,'_','')) IN ('at','time','timestamp','createdat','updatedat','startedat','finishedat','requestedat')
      THEN to_jsonb('[time omitted]'::text)
     WHEN lower(replace(key,'_','')) IN ('inputtokens','outputtokens','cachereadtokens','cachewritetokens','reasoningtokens','totaltokens')
       AND jsonb_typeof(value)='number' THEN to_jsonb(round((value#>>'{}')::numeric,-2))
     WHEN lower(replace(key,'_',''))='costusd' AND jsonb_typeof(value)='number'
       THEN to_jsonb(round((value#>>'{}')::numeric,2))
     ELSE public.decke_improvement_reader_json(value,p_base) END),'{}'::jsonb)
    INTO result FROM jsonb_each(p_value)
    WHERE lower(replace(key,'_','')) NOT IN ('requestid','generationid');
   RETURN result;
  ELSE RETURN p_value;
 END CASE;
END $$;

CREATE FUNCTION public.decke_improvement_redact_json_identifiers(p_value jsonb,p_terms text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE raw_text text; parsed_json jsonb;
BEGIN
 CASE jsonb_typeof(p_value)
  WHEN 'string' THEN
   raw_text=p_value#>>'{}';
   BEGIN
    parsed_json=raw_text::jsonb;
    IF jsonb_typeof(parsed_json) IN ('object','array') THEN
     RETURN to_jsonb(public.decke_improvement_redact_json_identifiers(parsed_json,p_terms)::text);
    END IF;
   EXCEPTION WHEN invalid_text_representation THEN NULL;
   END;
   RETURN to_jsonb(public.decke_improvement_redact_text(raw_text,p_terms));
  WHEN 'array' THEN RETURN coalesce((SELECT jsonb_agg(public.decke_improvement_redact_json_identifiers(value,p_terms) ORDER BY ordinality)
    FROM jsonb_array_elements(p_value) WITH ORDINALITY),'[]'::jsonb);
  WHEN 'object' THEN RETURN coalesce((SELECT jsonb_object_agg(public.decke_improvement_redact_text(key,p_terms),
    public.decke_improvement_redact_json_identifiers(value,p_terms)) FROM jsonb_each(p_value)),'{}'::jsonb);
  ELSE RETURN p_value;
 END CASE;
END $$;

CREATE FUNCTION public.decke_improvement_require_writer(p_user text) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb); actor text:=public.admin_actor_id();
BEGIN
 IF actor IS NULL OR actor<>p_user OR NOT public.admin_is_session()
    OR coalesce((claims->>'deckpal_server_request')::boolean,false) IS NOT TRUE
    OR NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'A DeckPal server request for this active account is required' USING ERRCODE='42501';
 END IF;
 RETURN public.decke_improvement_owner_key(actor);
END $$;

CREATE FUNCTION public.decke_improvement_require_reader() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb); actor text:=public.admin_actor_id(); token_id uuid;
BEGIN
 IF actor IS NULL OR NOT public.admin_account_active(actor) OR public.admin_role_tier(actor)<40
    OR NOT ('admin.access'=ANY(public.admin_permissions(actor)))
    OR NOT ('decke.improvement.read'=ANY(public.admin_permissions(actor))) THEN
  RAISE EXCEPTION 'Deck-E improvement read permission is required' USING ERRCODE='42501';
 END IF;
 IF claims->>'deckpal_auth_kind'='token' THEN
  BEGIN token_id=(claims->>'deckpal_token_id')::uuid; EXCEPTION WHEN OTHERS THEN token_id=NULL; END;
  IF token_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.api_token t WHERE t.id=token_id AND t.user_id::text=actor
      AND t.decke_improvement_read AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at>now())
  ) THEN RAISE EXCEPTION 'Token lacks decke_improvement_read capability' USING ERRCODE='42501'; END IF;
 ELSIF NOT public.admin_is_session() THEN
  RAISE EXCEPTION 'A signed-in session or capable token is required' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION public.decke_improvement_recompute(p_conversation uuid,p_seq integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.decke_improvement_turn t SET
   asked=coalesce(x.asked,''),answered=coalesce(x.answered,''), finished_at=x.finished_at,
   latency_ms=CASE WHEN x.finished_at IS NULL THEN NULL ELSE greatest(0,floor(extract(epoch FROM (x.finished_at-x.started_at))*1000)::integer) END,
   input_tokens=x.input_tokens,output_tokens=x.output_tokens,cache_read_tokens=x.cache_read_tokens,
   cache_write_tokens=x.cache_write_tokens,reasoning_tokens=x.reasoning_tokens,
   cost_usd=x.cost_usd,cost_coverage=x.coverage,build_sha=x.build_sha,build_pr=x.build_pr,
   finish_reason=x.finish_reason,has_error=x.has_error
 FROM (
  SELECT min(started_at) started_at,
   CASE WHEN count(finished_at)=count(*) THEN max(finished_at) END finished_at,
   (array_agg(asked ORDER BY leg) FILTER(WHERE asked<>''))[1] asked,
   string_agg(answered,'' ORDER BY leg) answered,
   sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(cache_read_tokens) cache_read_tokens,
   sum(cache_write_tokens) cache_write_tokens,sum(reasoning_tokens) reasoning_tokens,
   sum(cost_usd) cost_usd,
   CASE WHEN count(cost_usd)=0 THEN 'unknown' WHEN bool_and(cost_coverage='complete') THEN 'complete' ELSE 'partial' END coverage,
   (array_agg(build_sha ORDER BY leg DESC) FILTER(WHERE build_sha IS NOT NULL))[1] build_sha,
   (array_agg(build_pr ORDER BY leg DESC) FILTER(WHERE build_pr IS NOT NULL))[1] build_pr,
   (array_agg(finish_reason ORDER BY leg DESC) FILTER(WHERE finish_reason IS NOT NULL))[1] finish_reason,
   bool_or(error IS NOT NULL OR status='failed') OR EXISTS(
    SELECT 1 FROM public.decke_improvement_event e WHERE e.conversation_id=p_conversation AND e.seq=p_seq AND e.kind='error') has_error
  FROM public.decke_improvement_leg
  WHERE conversation_id=p_conversation AND seq=p_seq
 ) x WHERE t.conversation_id=p_conversation AND t.seq=p_seq;

 UPDATE public.decke_improvement_conversation c SET
   started_at=x.started_at,updated_at=x.updated_at,build_first=x.build_first,build_last=x.build_last,
   cost_usd=x.cost_usd,cost_coverage=x.coverage,has_error=x.has_error
 FROM (
  SELECT least(min(turns.started_at),coalesce((SELECT min(e.at) FROM public.decke_improvement_event e
    WHERE e.conversation_id=p_conversation),min(turns.started_at))) started_at,
   greatest(max(coalesce(turns.finished_at,turns.started_at)),now()) updated_at,
   (array_agg(build_sha ORDER BY seq) FILTER(WHERE build_sha IS NOT NULL))[1] build_first,
   (array_agg(build_sha ORDER BY seq DESC) FILTER(WHERE build_sha IS NOT NULL))[1] build_last,
   (SELECT sum(l.cost_usd) FROM public.decke_improvement_leg l WHERE l.conversation_id=p_conversation) cost_usd,
   CASE
    WHEN NOT EXISTS(SELECT 1 FROM public.decke_improvement_leg l WHERE l.conversation_id=p_conversation AND l.cost_usd IS NOT NULL) THEN 'unknown'
    WHEN NOT EXISTS(SELECT 1 FROM public.decke_improvement_leg l WHERE l.conversation_id=p_conversation AND l.cost_coverage<>'complete') THEN 'complete'
    ELSE 'partial'
   END coverage,
   bool_or(has_error) has_error
  FROM public.decke_improvement_turn turns WHERE conversation_id=p_conversation
 ) x WHERE c.id=p_conversation;
END $$;

CREATE FUNCTION public.decke_improvement_can_ask(p_user text,p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; prompts boolean; inserted integer; existing_status text;
BEGIN
 IF p_conversation IS NULL THEN RAISE EXCEPTION 'Conversation is required' USING ERRCODE='22023'; END IF;
 owner=public.decke_improvement_require_writer(p_user);
 PERFORM 1 FROM public.decke_conversation
  WHERE id=p_conversation AND user_id::text=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is unavailable' USING ERRCODE='P0002'; END IF;
 SELECT decke_share_prompts INTO prompts FROM public.user_settings
  WHERE user_id::text=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings row is unavailable' USING ERRCODE='P0002'; END IF;
 IF NOT prompts THEN
  RETURN jsonb_build_object('allowed',false,'reason','prompts_disabled');
 END IF;
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 INSERT INTO public.decke_improvement_consent(id,owner_key,status,source,asked_at,updated_at)
 VALUES(conversation,owner,'asked','decke_ask',now(),now()) ON CONFLICT(id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN RETURN jsonb_build_object('allowed',true,'reason','asked'); END IF;
 SELECT status INTO existing_status FROM public.decke_improvement_consent
  WHERE id=conversation AND owner_key=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('allowed',false,'reason','already_'||existing_status);
END $$;

-- Sharing backfills only usage metadata in SQL.  Raw History content is
-- returned to the API, which redacts it before replaying it through record_leg.
CREATE FUNCTION public.decke_improvement_answer(
 p_user text,p_conversation uuid,p_share boolean,p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; consent_owner bytea; prior_status text; started timestamptz;
 raw_turns jsonb; raw_requests jsonb; request_row record; affected integer;
BEGIN
 IF p_conversation IS NULL OR p_share IS NULL OR p_source NOT IN ('decke_ask','feedback','reader') THEN
  RAISE EXCEPTION 'Invalid improvement answer' USING ERRCODE='22023';
 END IF;
 owner=public.decke_improvement_require_writer(p_user);
 PERFORM 1 FROM public.decke_conversation
  WHERE id=p_conversation AND user_id::text=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is unavailable' USING ERRCODE='P0002'; END IF;
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 INSERT INTO public.decke_improvement_consent(id,owner_key,status,source,asked_at,answered_at,updated_at)
 VALUES(conversation,owner,CASE WHEN p_share THEN 'shared' ELSE 'declined' END,p_source,
   CASE WHEN p_source='decke_ask' THEN now() END,now(),now())
 ON CONFLICT(id) DO NOTHING;
 SELECT owner_key,status INTO consent_owner,prior_status
  FROM public.decke_improvement_consent WHERE id=conversation FOR UPDATE;
 IF consent_owner<>owner THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;
 IF NOT p_share AND prior_status IN ('shared','revoked') THEN
  RAISE EXCEPTION 'Stop sharing through revoke' USING ERRCODE='22023';
 END IF;
 UPDATE public.decke_improvement_consent SET
  status=CASE WHEN p_share THEN 'shared' ELSE 'declined' END,
  source=p_source,answered_at=now(),updated_at=now()
 WHERE id=conversation;
 IF NOT p_share THEN
  RETURN jsonb_build_object('status','declined','source',p_source,'conversationId',conversation);
 END IF;

 SELECT coalesce(min(at),now()) INTO started FROM (
  SELECT created_at at FROM public.decke_turn WHERE conversation_id=p_conversation AND user_id::text=p_user
  UNION ALL
  SELECT started_at FROM public.decke_ai_request WHERE conversation_id=p_conversation AND user_id=p_user
 ) available;
 INSERT INTO public.decke_improvement_conversation(id,owner_key,started_at,updated_at)
 VALUES(conversation,owner,started,now())
 ON CONFLICT(id) DO UPDATE SET updated_at=greatest(public.decke_improvement_conversation.updated_at,EXCLUDED.updated_at)
 WHERE public.decke_improvement_conversation.owner_key=EXCLUDED.owner_key;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;

 -- Create empty turn shells for every History row.  No transcript text crosses
 -- this boundary; the returned backfill is redacted by the API before writing.
 INSERT INTO public.decke_improvement_turn(conversation_id,seq,started_at,build_sha,build_pr,finish_reason)
 SELECT conversation,t.seq,t.created_at,t.build_sha,t.build_pr,t.finish_reason
 FROM public.decke_turn t WHERE t.conversation_id=p_conversation AND t.user_id::text=p_user
 ON CONFLICT(conversation_id,seq) DO UPDATE SET
  started_at=least(public.decke_improvement_turn.started_at,EXCLUDED.started_at),
  build_sha=coalesce(EXCLUDED.build_sha,public.decke_improvement_turn.build_sha),
  build_pr=coalesce(EXCLUDED.build_pr,public.decke_improvement_turn.build_pr),
  finish_reason=coalesce(EXCLUDED.finish_reason,public.decke_improvement_turn.finish_reason);

 -- One improvement leg represents one metered request.  Operation values are
 -- aggregated; raw request/conversation IDs are used only while deriving HMACs.
 FOR request_row IN
  SELECT r.*,
   (row_number() OVER(PARTITION BY r.seq ORDER BY r.started_at,r.id)-1)::integer leg_no,
   a.operation_count,a.known_costs,a.input_tokens,a.output_tokens,a.cache_read_tokens,
   a.cache_write_tokens,a.reasoning_tokens,a.cost_usd,a.has_estimate,a.model_id,a.provider
  FROM public.decke_ai_request r
  CROSS JOIN LATERAL (
   SELECT count(*)::integer operation_count,count(o.cost_usd)::integer known_costs,
    sum(o.input_tokens) input_tokens,sum(o.output_tokens) output_tokens,
    sum(o.cache_read_tokens) cache_read_tokens,sum(o.cache_write_tokens) cache_write_tokens,
    sum(o.reasoning_tokens) reasoning_tokens,sum(o.cost_usd) cost_usd,
    bool_or(o.cost_source='token_rate_estimate') has_estimate,
    CASE WHEN count(DISTINCT o.model_id)=1 THEN min(o.model_id)
         WHEN count(DISTINCT o.model_id)>1 THEN 'mixed' END model_id,
    CASE WHEN count(DISTINCT o.provider)=1 THEN min(o.provider)
         WHEN count(DISTINCT o.provider)>1 THEN 'mixed' END provider
   FROM public.decke_ai_operation o WHERE o.request_id=r.id
  ) a
  WHERE r.conversation_id=p_conversation AND r.user_id=p_user AND r.seq IS NOT NULL
  ORDER BY r.seq,r.started_at,r.id
 LOOP
  INSERT INTO public.decke_improvement_turn(conversation_id,seq,started_at,build_sha,build_pr,finish_reason)
  VALUES(conversation,request_row.seq,request_row.started_at,request_row.build_sha,request_row.build_pr,
    (SELECT finish_reason FROM public.decke_turn WHERE conversation_id=p_conversation AND seq=request_row.seq AND user_id::text=p_user))
  ON CONFLICT(conversation_id,seq) DO UPDATE SET
   started_at=least(public.decke_improvement_turn.started_at,EXCLUDED.started_at),
   build_sha=coalesce(EXCLUDED.build_sha,public.decke_improvement_turn.build_sha),
   build_pr=coalesce(EXCLUDED.build_pr,public.decke_improvement_turn.build_pr),
   finish_reason=coalesce(EXCLUDED.finish_reason,public.decke_improvement_turn.finish_reason);
  INSERT INTO public.decke_improvement_leg(
   id,conversation_id,seq,leg,model_id,provider,started_at,finished_at,
   input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,
   cost_usd,cost_coverage,cost_source,status,finish_reason,build_sha,build_pr,error,tool_calls)
  VALUES(public.decke_improvement_uuid('request:',request_row.id),conversation,request_row.seq,request_row.leg_no,
   request_row.model_id,request_row.provider,request_row.started_at,request_row.finished_at,
   request_row.input_tokens,request_row.output_tokens,request_row.cache_read_tokens,
   request_row.cache_write_tokens,request_row.reasoning_tokens,request_row.cost_usd,
   CASE WHEN request_row.known_costs=0 THEN 'unknown'
        WHEN request_row.known_costs=request_row.operation_count THEN 'complete' ELSE 'partial' END,
   CASE WHEN request_row.known_costs=0 THEN 'unknown'
        WHEN request_row.has_estimate THEN 'token_rate_estimate' ELSE 'provider_reported' END,
   request_row.status,
   (SELECT finish_reason FROM public.decke_turn WHERE conversation_id=p_conversation AND seq=request_row.seq AND user_id::text=p_user),
   request_row.build_sha,request_row.build_pr,NULL,'[]'::jsonb)
  ON CONFLICT(id) DO UPDATE SET
   model_id=EXCLUDED.model_id,provider=EXCLUDED.provider,started_at=EXCLUDED.started_at,
   finished_at=EXCLUDED.finished_at,input_tokens=EXCLUDED.input_tokens,output_tokens=EXCLUDED.output_tokens,
   cache_read_tokens=EXCLUDED.cache_read_tokens,cache_write_tokens=EXCLUDED.cache_write_tokens,
   reasoning_tokens=EXCLUDED.reasoning_tokens,cost_usd=EXCLUDED.cost_usd,cost_coverage=EXCLUDED.cost_coverage,cost_source=EXCLUDED.cost_source,
   status=EXCLUDED.status,finish_reason=EXCLUDED.finish_reason,build_sha=EXCLUDED.build_sha,build_pr=EXCLUDED.build_pr
  WHERE public.decke_improvement_leg.conversation_id=EXCLUDED.conversation_id
    AND public.decke_improvement_leg.seq=EXCLUDED.seq AND public.decke_improvement_leg.leg=EXCLUDED.leg;
  PERFORM public.decke_improvement_recompute(conversation,request_row.seq);
 END LOOP;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'seq',t.seq,'asked',t.asked,'answered',t.answered,'tools',t.tools,
  'buildSha',t.build_sha,'buildPr',t.build_pr,'finishReason',t.finish_reason,
  'createdAt',t.created_at) ORDER BY t.seq),'[]'::jsonb)
 INTO raw_turns FROM public.decke_turn t
 WHERE t.conversation_id=p_conversation AND t.user_id::text=p_user;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'requestId',r.id,'seq',r.seq,'leg',r.leg_no) ORDER BY r.seq,r.started_at,r.id),'[]'::jsonb)
 INTO raw_requests FROM (
  SELECT q.id,q.seq,q.started_at,
   (row_number() OVER(PARTITION BY q.seq ORDER BY q.started_at,q.id)-1)::integer leg_no
  FROM public.decke_ai_request q
  WHERE q.conversation_id=p_conversation AND q.user_id=p_user AND q.seq IS NOT NULL
 ) r;
 RETURN jsonb_build_object('status','shared','source',p_source,'conversationId',conversation,
  'backfill',jsonb_build_object('turns',raw_turns,'requests',raw_requests));
END $$;

CREATE FUNCTION public.decke_improvement_shared_owner(p_user text,p_conversation uuid) RETURNS bytea
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; consent_owner bytea; conversation uuid;
BEGIN
 owner=public.decke_improvement_require_writer(p_user);
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 SELECT owner_key INTO consent_owner FROM public.decke_improvement_consent
  WHERE id=conversation AND status='shared' FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF consent_owner<>owner THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;
 RETURN owner;
END $$;

CREATE FUNCTION public.decke_improvement_record_backfill(
 p_user text,p_conversation uuid,p_turns jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; item jsonb; n integer:=0; terms text[]; identity_terms text[];
 clean_asked text; clean_answered text; clean_tools jsonb;
BEGIN
 IF p_turns IS NULL OR jsonb_typeof(p_turns)<>'array' OR jsonb_array_length(p_turns)>1000
    OR octet_length(p_turns::text)>1048576 THEN
  RAISE EXCEPTION 'Invalid or oversized improvement backfill' USING ERRCODE='22023';
 END IF;
 owner=public.decke_improvement_shared_owner(p_user,p_conversation);
 IF owner IS NULL THEN RETURN jsonb_build_object('recorded',false,'reason','not_shared'); END IF;
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 terms=public.decke_improvement_redaction_terms(p_user);
 SELECT ARRAY[p_user,p_conversation::text]
   ||coalesce(array_agg(r.id::text),'{}'::text[])
   ||coalesce(array_agg(r.exchange_id::text),'{}'::text[])
 INTO identity_terms FROM public.decke_ai_request r
 WHERE r.user_id=p_user AND r.conversation_id=p_conversation;
 FOR item IN SELECT value FROM jsonb_array_elements(p_turns) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'seq')<>'number'
     OR jsonb_typeof(item->'asked')<>'string' OR jsonb_typeof(item->'answered')<>'string'
     OR jsonb_typeof(item->'tools')<>'array' THEN
   RAISE EXCEPTION 'Invalid improvement backfill turn' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.decke_turn t WHERE t.conversation_id=p_conversation
    AND t.user_id::text=p_user AND t.seq=(item->>'seq')::integer) THEN
   RAISE EXCEPTION 'Personal history turn is unavailable' USING ERRCODE='P0002';
  END IF;
  clean_asked=public.decke_improvement_redact_text(
   public.decke_improvement_redact_text(item->>'asked',identity_terms),terms);
  clean_answered=public.decke_improvement_redact_text(
   public.decke_improvement_redact_text(item->>'answered',identity_terms),terms);
  clean_tools=public.decke_improvement_redact_json_identifiers(
   public.decke_improvement_redact_json_identifiers(item->'tools',identity_terms),terms);
  UPDATE public.decke_improvement_turn SET asked=clean_asked,answered=clean_answered,tools=clean_tools
   WHERE conversation_id=conversation AND seq=(item->>'seq')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Improvement turn is unavailable' USING ERRCODE='P0002'; END IF;
  n=n+1;
 END LOOP;
 UPDATE public.decke_improvement_conversation SET updated_at=now()
  WHERE id=conversation AND owner_key=owner;
 RETURN jsonb_build_object('recorded',true,'count',n,'conversationId',conversation);
EXCEPTION WHEN numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Invalid improvement backfill turn' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.decke_improvement_record_leg(
 p_user text,p_conversation uuid,p_seq integer,p_request uuid,p_leg integer,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; leg_id uuid; clean jsonb; terms text[];
 identity_terms text[]; exchange uuid; tool jsonb; clean_tool jsonb; clean_tools jsonb:='[]'::jsonb;
 started timestamptz; finished timestamptz; source text; leg_status text; affected integer;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>1048576
    OR p_seq IS NULL OR p_seq<0 OR p_leg IS NULL OR p_leg<0 OR p_conversation IS NULL OR p_request IS NULL THEN
  RAISE EXCEPTION 'Invalid or oversized improvement leg payload' USING ERRCODE='22023';
 END IF;
 owner=public.decke_improvement_shared_owner(p_user,p_conversation);
 IF owner IS NULL THEN RETURN jsonb_build_object('recorded',false,'reason','not_shared'); END IF;
 SELECT r.exchange_id INTO exchange FROM public.decke_ai_request r WHERE r.id=p_request AND r.user_id=p_user
   AND r.conversation_id=p_conversation AND r.seq=p_seq;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Request does not belong to this conversation turn' USING ERRCODE='42501';
 END IF;
 IF (p_payload ? 'asked' AND jsonb_typeof(p_payload->'asked')<>'string')
    OR (p_payload ? 'answered' AND jsonb_typeof(p_payload->'answered')<>'string')
    OR (p_payload ? 'tool_calls' AND jsonb_typeof(p_payload->'tool_calls')<>'array')
    OR (p_payload ? 'error' AND jsonb_typeof(p_payload->'error') NOT IN ('object','null'))
    OR jsonb_typeof(p_payload->'started_at')<>'string'
    OR (p_payload ? 'finished_at' AND jsonb_typeof(p_payload->'finished_at') NOT IN ('string','null'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['model_id','provider','cost_coverage','cost_source','status','finish_reason','build_sha']) k
      WHERE p_payload ? k AND jsonb_typeof(p_payload->k) NOT IN ('string','null'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['latency_ms','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens','cost_usd','build_pr']) k
      WHERE p_payload ? k AND jsonb_typeof(p_payload->k) NOT IN ('number','null')) THEN
  RAISE EXCEPTION 'Invalid improvement leg fields' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'tool_calls','[]'::jsonb)) v
   WHERE jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'id')<>'string' OR jsonb_typeof(v->'name')<>'string'
      OR NOT (v ? 'args') OR NOT (v ? 'output') OR jsonb_typeof(v->'phase')<>'string'
      OR (v ? 'approval' AND (jsonb_typeof(v->'approval')<>'object'
        OR jsonb_typeof(v->'approval'->'approved')<>'boolean'
        OR (v->'approval' ? 'reason' AND jsonb_typeof(v->'approval'->'reason')<>'string')))
      OR (v ? 'started_at' AND jsonb_typeof(v->'started_at')<>'string')
      OR (v ? 'finished_at' AND jsonb_typeof(v->'finished_at')<>'string')) THEN
  RAISE EXCEPTION 'Invalid tool call schema' USING ERRCODE='22023';
 END IF;
 terms=public.decke_improvement_redaction_terms(p_user);
 SELECT ARRAY[p_user,p_conversation::text]
   ||coalesce(array_agg(r.id::text),'{}'::text[])
   ||coalesce(array_agg(r.exchange_id::text),'{}'::text[])
 INTO identity_terms FROM public.decke_ai_request r
 WHERE r.user_id=p_user AND r.conversation_id=p_conversation AND r.seq=p_seq;
 clean=public.decke_improvement_redact_json_identifiers(p_payload,identity_terms);
 IF clean ? 'asked' THEN clean=jsonb_set(clean,'{asked}',to_jsonb(public.decke_improvement_redact_text(clean->>'asked',terms))); END IF;
 IF clean ? 'answered' THEN clean=jsonb_set(clean,'{answered}',to_jsonb(public.decke_improvement_redact_text(clean->>'answered',terms))); END IF;
 IF clean ? 'error' AND clean->'error'<>'null'::jsonb THEN
  clean=jsonb_set(clean,'{error}',public.decke_improvement_redact_json_identifiers(clean->'error',terms));
 END IF;
 FOR tool IN SELECT value FROM jsonb_array_elements(coalesce(clean->'tool_calls','[]'::jsonb)) LOOP
  clean_tool=tool||jsonb_build_object('args',public.decke_improvement_redact_json_identifiers(tool->'args',terms),
    'output',public.decke_improvement_redact_json_identifiers(tool->'output',terms));
  IF tool ? 'approval' AND tool->'approval' ? 'reason' THEN
   clean_tool=jsonb_set(clean_tool,'{approval,reason}',to_jsonb(public.decke_improvement_redact_text(tool->'approval'->>'reason',terms)));
  END IF;
  clean_tools=clean_tools||jsonb_build_array(clean_tool);
 END LOOP;
 clean=jsonb_set(clean,'{tool_calls}',clean_tools,true);
 BEGIN
  started=(clean->>'started_at')::timestamptz;
  finished=(clean->>'finished_at')::timestamptz;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid leg timestamp' USING ERRCODE='22023'; END;
 IF started IS NULL OR (finished IS NOT NULL AND finished<started) THEN RAISE EXCEPTION 'Invalid leg timing' USING ERRCODE='22023'; END IF;
 source=coalesce(clean->>'cost_source','unknown'); leg_status=coalesce(clean->>'status','completed');
 IF coalesce(clean->>'cost_coverage','') NOT IN ('complete','partial','unknown')
    OR source NOT IN ('provider_reported','token_rate_estimate','unknown') OR leg_status NOT IN ('started','completed','failed','cancelled','abandoned')
    OR ((clean->>'cost_usd') IS NULL)<>(source='unknown')
    OR ((clean->>'cost_usd') IS NULL)<>(clean->>'cost_coverage'='unknown') THEN
  RAISE EXCEPTION 'Invalid leg cost or status' USING ERRCODE='22023';
 END IF;
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 leg_id=public.decke_improvement_uuid('request:',p_request);
 INSERT INTO public.decke_improvement_conversation(id,owner_key,started_at,updated_at)
 VALUES(conversation,owner,started,coalesce(finished,started))
 ON CONFLICT(id) DO UPDATE SET updated_at=greatest(public.decke_improvement_conversation.updated_at,EXCLUDED.updated_at)
 WHERE public.decke_improvement_conversation.owner_key=EXCLUDED.owner_key;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 THEN RAISE EXCEPTION 'Conversation pseudonym belongs to another owner' USING ERRCODE='42501'; END IF;
 INSERT INTO public.decke_improvement_turn(conversation_id,seq,asked,started_at)
 VALUES(conversation,p_seq,coalesce(clean->>'asked',''),started)
 ON CONFLICT(conversation_id,seq) DO UPDATE SET
  asked=CASE WHEN public.decke_improvement_turn.asked='' THEN EXCLUDED.asked ELSE public.decke_improvement_turn.asked END,
  started_at=least(public.decke_improvement_turn.started_at,EXCLUDED.started_at);
 INSERT INTO public.decke_improvement_leg(id,conversation_id,seq,leg,asked,answered,model_id,provider,started_at,finished_at,latency_ms,
  input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd,cost_coverage,cost_source,status,finish_reason,build_sha,build_pr,error,tool_calls)
 VALUES(leg_id,conversation,p_seq,p_leg,coalesce(clean->>'asked',''),coalesce(clean->>'answered',''),clean->>'model_id',clean->>'provider',started,finished,
  (clean->>'latency_ms')::integer,(clean->>'input_tokens')::bigint,(clean->>'output_tokens')::bigint,(clean->>'cache_read_tokens')::bigint,
  (clean->>'cache_write_tokens')::bigint,(clean->>'reasoning_tokens')::bigint,(clean->>'cost_usd')::numeric,clean->>'cost_coverage',source,leg_status,
  clean->>'finish_reason',clean->>'build_sha',(clean->>'build_pr')::integer,
  CASE WHEN clean->'error'='null'::jsonb THEN NULL ELSE clean->'error' END,coalesce(clean->'tool_calls','[]'::jsonb))
 ON CONFLICT(id) DO UPDATE SET
  asked=EXCLUDED.asked,answered=EXCLUDED.answered,model_id=EXCLUDED.model_id,provider=EXCLUDED.provider,
  started_at=EXCLUDED.started_at,finished_at=EXCLUDED.finished_at,latency_ms=EXCLUDED.latency_ms,input_tokens=EXCLUDED.input_tokens,
  output_tokens=EXCLUDED.output_tokens,cache_read_tokens=EXCLUDED.cache_read_tokens,cache_write_tokens=EXCLUDED.cache_write_tokens,
  reasoning_tokens=EXCLUDED.reasoning_tokens,cost_usd=EXCLUDED.cost_usd,cost_coverage=EXCLUDED.cost_coverage,cost_source=EXCLUDED.cost_source,status=EXCLUDED.status,
  finish_reason=EXCLUDED.finish_reason,build_sha=EXCLUDED.build_sha,build_pr=EXCLUDED.build_pr,error=EXCLUDED.error,tool_calls=EXCLUDED.tool_calls
 WHERE public.decke_improvement_leg.conversation_id=EXCLUDED.conversation_id
   AND public.decke_improvement_leg.seq=EXCLUDED.seq AND public.decke_improvement_leg.leg=EXCLUDED.leg;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 THEN RAISE EXCEPTION 'Request pseudonym conflicts with another leg' USING ERRCODE='42501'; END IF;
 PERFORM public.decke_improvement_recompute(conversation,p_seq);
 RETURN jsonb_build_object('recorded',true,'conversationId',conversation,'seq',p_seq,'legId',leg_id);
EXCEPTION WHEN numeric_value_out_of_range OR check_violation OR not_null_violation THEN
 RAISE EXCEPTION 'Invalid improvement leg numeric field' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.decke_improvement_record_events(
 p_user text,p_conversation uuid,p_seq integer,p_batch integer,p_events jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; item jsonb; base_ordinal integer; i integer:=0;
 terms text[]; identity_terms text[];
BEGIN
 IF p_events IS NULL OR jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 200
    OR octet_length(p_events::text)>524288 OR p_conversation IS NULL OR p_seq IS NULL OR p_seq<0
    OR p_batch IS NULL OR p_batch<0 THEN
  RAISE EXCEPTION 'Invalid or oversized improvement event batch' USING ERRCODE='22023';
 END IF;
 owner=public.decke_improvement_shared_owner(p_user,p_conversation);
 IF owner IS NULL THEN RETURN jsonb_build_object('recorded',false,'reason','not_shared'); END IF;
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 IF NOT EXISTS(SELECT 1 FROM public.decke_improvement_conversation WHERE id=conversation AND owner_key=owner) THEN
  RAISE EXCEPTION 'Improvement conversation is unavailable' USING ERRCODE='P0002';
 END IF;
 PERFORM 1 FROM public.decke_improvement_turn WHERE conversation_id=conversation AND seq=p_seq FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Improvement turn is unavailable' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.decke_improvement_event WHERE conversation_id=conversation AND seq=p_seq AND batch=p_batch) THEN
  RETURN jsonb_build_object('recorded',true,'duplicate',true,'count',0);
 END IF;
 terms=public.decke_improvement_redaction_terms(p_user);
 SELECT ARRAY[p_user,p_conversation::text]
   ||coalesce(array_agg(r.id::text),'{}'::text[])
   ||coalesce(array_agg(r.exchange_id::text),'{}'::text[])
 INTO identity_terms FROM public.decke_ai_request r
 WHERE r.user_id=p_user AND r.conversation_id=p_conversation AND r.seq=p_seq;
 SELECT coalesce(max(ordinal)+1,0) INTO base_ordinal FROM public.decke_improvement_event WHERE conversation_id=conversation AND seq=p_seq;
 FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'kind')<>'string'
     OR item->>'kind' NOT IN ('animation','browser_tool','notice','error','timing','approval_ui')
     OR jsonb_typeof(item->'at')<>'string' OR NOT (item ? 'payload') THEN
    RAISE EXCEPTION 'Invalid event schema' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.decke_improvement_event(conversation_id,seq,batch,batch_ordinal,ordinal,at,kind,payload)
  VALUES(conversation,p_seq,p_batch,i,base_ordinal+i,(item->>'at')::timestamptz,item->>'kind',
    public.decke_improvement_redact_json_identifiers(public.decke_improvement_redact_json_identifiers(item->'payload',identity_terms),terms));
  i=i+1;
 END LOOP;
 PERFORM public.decke_improvement_recompute(conversation,p_seq);
 RETURN jsonb_build_object('recorded',true,'duplicate',false,'count',i,'firstOrdinal',base_ordinal);
EXCEPTION WHEN invalid_datetime_format THEN RAISE EXCEPTION 'Invalid event timestamp' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.decke_improvement_record_feedback(
 p_user text,p_conversation uuid,p_seq integer,p_vote smallint,p_comment text,p_share boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; clean_comment text; copied boolean:=false; identity_terms text[]; shared boolean:=false;
BEGIN
 IF p_conversation IS NULL OR p_seq IS NULL OR p_seq<0 OR p_share IS NULL
    OR (p_vote IS NOT NULL AND p_vote NOT IN(-1,1)) OR char_length(p_comment)>500 THEN
  RAISE EXCEPTION 'Invalid feedback' USING ERRCODE='22023';
 END IF;
 owner=public.decke_improvement_require_writer(p_user);
 IF NOT EXISTS(SELECT 1 FROM public.decke_turn t WHERE t.conversation_id=p_conversation
   AND t.seq=p_seq AND t.user_id::text=p_user) THEN
  RAISE EXCEPTION 'Personal history turn is unavailable' USING ERRCODE='P0002';
 END IF;
 IF p_vote IS NULL THEN p_comment=NULL; END IF;
 SELECT ARRAY[p_user,p_conversation::text]
   ||coalesce(array_agg(r.id::text),'{}'::text[])
   ||coalesce(array_agg(r.exchange_id::text),'{}'::text[])
 INTO identity_terms FROM public.decke_ai_request r
 WHERE r.user_id=p_user AND r.conversation_id=p_conversation AND r.seq=p_seq;
 clean_comment=left(public.decke_improvement_redact_text(
   public.decke_improvement_redact_text(p_comment,identity_terms),
   public.decke_improvement_redaction_terms(p_user)),500);
 INSERT INTO public.decke_turn_feedback(user_id,conversation_id,seq,vote,comment,updated_at)
 VALUES(p_user::uuid,p_conversation,p_seq,p_vote,p_comment,now())
 ON CONFLICT(user_id,conversation_id,seq) DO UPDATE SET vote=EXCLUDED.vote,comment=EXCLUDED.comment,updated_at=now();
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 SELECT status='shared' INTO shared FROM public.decke_improvement_consent
  WHERE id=conversation AND owner_key=owner FOR SHARE;
 shared=coalesce(shared,false);
 IF p_share AND NOT shared THEN
  PERFORM public.decke_improvement_answer(p_user,p_conversation,true,'feedback');
  shared=true;
 END IF;
 IF shared THEN
  UPDATE public.decke_improvement_turn SET feedback=p_vote,feedback_comment=clean_comment
   WHERE conversation_id=conversation AND seq=p_seq
     AND EXISTS(SELECT 1 FROM public.decke_improvement_conversation c WHERE c.id=conversation AND c.owner_key=owner);
  copied=FOUND;
  IF copied AND EXISTS(SELECT 1 FROM public.decke_improvement_leg WHERE conversation_id=conversation AND seq=p_seq) THEN
   PERFORM public.decke_improvement_recompute(conversation,p_seq);
  END IF;
 END IF;
 RETURN jsonb_build_object('saved',true,'copied',copied,'shared',shared,'vote',p_vote,'comment',p_comment);
END $$;

CREATE FUNCTION public.decke_improvement_revoke(p_user text,p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; consent_owner bytea;
 turns integer:=0; legs integer:=0; events integer:=0; conversations integer:=0;
BEGIN
 IF p_conversation IS NULL THEN RAISE EXCEPTION 'Conversation is required' USING ERRCODE='22023'; END IF;
 owner=public.decke_improvement_require_writer(p_user);
 PERFORM 1 FROM public.decke_conversation WHERE id=p_conversation AND user_id::text=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is unavailable' USING ERRCODE='P0002'; END IF;
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

CREATE FUNCTION public.decke_improvement_list_mine(p_user text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; items jsonb;
BEGIN
 owner=public.decke_improvement_require_writer(p_user);
 SELECT coalesce(jsonb_agg(jsonb_build_object('conversationId',c.id,'sharedAt',x.answered_at)
   ORDER BY x.updated_at DESC,c.id),'[]'::jsonb)
 INTO items
 FROM public.decke_conversation c
 JOIN public.decke_improvement_consent x
  ON x.id=public.decke_improvement_uuid('conversation:',c.id)
  AND x.owner_key=owner AND x.status='shared'
 WHERE c.user_id::text=p_user;
 RETURN jsonb_build_object('items',items);
END $$;

-- Account deletion must not strand a pseudonymous corpus that the former
-- reader can no longer revoke.  This is lifecycle cleanup, not a consent gate.
CREATE FUNCTION public.decke_improvement_account_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea;
BEGIN
 owner=public.decke_improvement_owner_key(OLD.id::text);
 DELETE FROM public.decke_improvement_conversation WHERE owner_key=owner;
 DELETE FROM public.decke_improvement_consent WHERE owner_key=owner;
 RETURN OLD;
END $$;
CREATE TRIGGER decke_improvement_account_delete
 BEFORE DELETE ON public.app_user
 FOR EACH ROW EXECUTE FUNCTION public.decke_improvement_account_delete();

CREATE FUNCTION public.decke_improvement_purge_expired() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer; total integer:=0;
BEGIN
 LOOP
  DELETE FROM public.decke_improvement_conversation WHERE id IN (
   SELECT id FROM public.decke_improvement_conversation
    WHERE updated_at<now()-interval '180 days' ORDER BY updated_at,id LIMIT 500
  );
  GET DIAGNOSTICS n=ROW_COUNT;
  total=total+n;
  EXIT WHEN n<500;
 END LOOP;
 RETURN total;
END $$;

-- Jev is part of the chat turn rather than a separately charged deep tool. It
-- still needs its own operation rows, so authorize the chat reservation while
-- preserving the Jev tool key and model/cost telemetry on the same request.
CREATE FUNCTION public.decke_usage_external_operation_begin(
 p_id uuid,p_request uuid,p_tool text,p_model text,p_provider text,p_key text,p_spend uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.decke_ai_request; s public.credit_spend; first_start boolean=false;
BEGIN
 IF p_tool NOT IN ('jev_reflex','jev_audit') OR p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 160 THEN
  RAISE EXCEPTION 'Invalid external usage operation' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(741290064);
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_request AND status='started';
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF p_spend IS NOT NULL THEN
  s=public.credit_spend_lock_authorize(r.user_id,p_spend);
  IF s.request_key IS DISTINCT FROM r.request_key THEN
   RAISE EXCEPTION 'Spend does not belong to this chat turn' USING ERRCODE='42501';
  END IF;
  first_start=s.provider_started_at IS NULL;
  IF NOT first_start AND NOT EXISTS(
   SELECT 1 FROM public.decke_ai_operation
    WHERE request_id=r.id AND credit_spend_id=s.id AND NOT invocation_cancelled
  ) THEN
   RAISE EXCEPTION 'Spend already started outside this request' USING ERRCODE='40001';
  END IF;
 ELSIF r.charge_mode<>'daily' THEN
  RAISE EXCEPTION 'A credit reservation is required' USING ERRCODE='42501';
 END IF;
 IF NOT public.admin_account_active(r.user_id) OR NOT public.admin_user_has_permission(r.user_id,'decke.use') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.decke_ai_operation(
  id,request_id,category,tool_key,model_id,provider,operation_key,credit_spend_id,starts_reservation
 ) VALUES(
  p_id,p_request,'response',p_tool,left(p_model,160),left(p_provider,80),left(p_key,160),p_spend,first_start
 );
 IF first_start THEN UPDATE public.credit_spend SET provider_started_at=now() WHERE id=s.id; END IF;
END $$;

-- Aggregate accounting for every chat, without transcript or tool content.
-- Authorization intentionally reuses the existing AI Usage admin boundary.
CREATE FUNCTION public.decke_usage_conversation_costs(
 p_filters jsonb DEFAULT '{}'::jsonb,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE filters jsonb:=coalesce(p_filters,'{}'::jsonb); cursor_time timestamptz; cursor_id uuid;
 items jsonb; next_cursor text;
BEGIN
 PERFORM public.decke_usage_require_admin();
 IF jsonb_typeof(filters)<>'object' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR filters-ARRAY['from','to','userId','model']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid conversation cost filters' USING ERRCODE='22023';
 END IF;
 IF p_cursor IS NOT NULL THEN
  BEGIN
   cursor_time=split_part(p_cursor,'|',1)::timestamptz;
   cursor_id=split_part(p_cursor,'|',2)::uuid;
  EXCEPTION WHEN OTHERS THEN
   RAISE EXCEPTION 'Invalid conversation cost cursor' USING ERRCODE='22023';
  END;
 END IF;
 WITH grouped AS (
  SELECT r.conversation_id,r.user_id,
   min(r.started_at) first_activity,
   greatest(max(coalesce(r.finished_at,r.started_at)),max(coalesce(o.finished_at,o.started_at))) last_activity,
   count(DISTINCT r.seq) FILTER(WHERE r.seq IS NOT NULL) turn_count,
   count(DISTINCT r.id) request_count,count(o.id) operation_count,count(o.cost_usd) known_count,
   sum(o.cost_usd) cost_usd,
   CASE WHEN count(o.id)=0 OR count(o.cost_usd)=0 THEN 'unknown'
        WHEN count(o.cost_usd)=count(o.id) THEN 'complete' ELSE 'partial' END coverage,
   to_jsonb(array_remove(array_agg(DISTINCT o.model_id ORDER BY o.model_id),NULL)) models
  FROM public.decke_ai_request r
  LEFT JOIN public.decke_ai_operation o ON o.request_id=r.id
  WHERE r.conversation_id IS NOT NULL
   AND (NOT(filters?'from') OR r.started_at>=(filters->>'from')::timestamptz)
   AND (NOT(filters?'to') OR r.started_at<(filters->>'to')::timestamptz)
   AND (NOT(filters?'userId') OR r.user_id=filters->>'userId')
   AND (NOT(filters?'model') OR EXISTS(
    SELECT 1 FROM public.decke_ai_operation matching
    WHERE matching.request_id=r.id AND matching.model_id=filters->>'model'))
  GROUP BY r.conversation_id,r.user_id
 ), selected AS (
  SELECT * FROM grouped
  WHERE cursor_time IS NULL OR (last_activity,conversation_id)<(cursor_time,cursor_id)
  ORDER BY last_activity DESC,conversation_id DESC LIMIT p_limit+1
 ), page AS (
  SELECT * FROM selected ORDER BY last_activity DESC,conversation_id DESC LIMIT p_limit
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'conversationId',conversation_id,'userId',user_id,'firstActivity',first_activity,
   'lastActivity',last_activity,'turnCount',turn_count,'requestCount',request_count,
   'operationCount',operation_count,'knownCostCount',known_count,
   'unknownCostCount',operation_count-known_count,'costUsd',cost_usd,
   'costCoverage',coverage,'models',models)
   ORDER BY last_activity DESC,conversation_id DESC),'[]'::jsonb),
  CASE WHEN (SELECT count(*) FROM selected)>p_limit THEN
   (SELECT last_activity::text||'|'||conversation_id::text FROM page ORDER BY last_activity,conversation_id LIMIT 1)
  END
 INTO items,next_cursor FROM page;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Invalid conversation cost filter value' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.decke_improvement_token_capability(p_token uuid,p_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; changed integer;
BEGIN
 IF p_token IS NULL OR p_on IS NULL THEN RAISE EXCEPTION 'Token capability input is invalid' USING ERRCODE='22023'; END IF;
 actor=public.admin_require_permission('decke.improvement.read');
 IF public.admin_role_tier(actor)<40 THEN RAISE EXCEPTION 'Eligible administrator required' USING ERRCODE='42501'; END IF;
 UPDATE public.api_token SET decke_improvement_read=p_on
  WHERE id=p_token AND user_id::text=actor AND revoked_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN RAISE EXCEPTION 'Active owned token not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('tokenId',p_token,'deckeImprovementRead',p_on);
END $$;

CREATE FUNCTION public.decke_improvement_oauth_capability(p_code text,p_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; changed integer;
BEGIN
 IF p_code IS NULL OR p_on IS NULL THEN RAISE EXCEPTION 'OAuth capability input is invalid' USING ERRCODE='22023'; END IF;
 actor=public.admin_require_permission('decke.improvement.read');
 IF public.admin_role_tier(actor)<40 THEN RAISE EXCEPTION 'Eligible administrator required' USING ERRCODE='42501'; END IF;
 UPDATE public.oauth_code SET decke_improvement_read=p_on
  WHERE code=p_code AND user_id::text=actor AND used_at IS NULL AND expires_at>now();
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN RAISE EXCEPTION 'Active owned authorization code not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('deckeImprovementRead',p_on);
END $$;

CREATE FUNCTION public.decke_improvement_list(p_filters jsonb DEFAULT '{}'::jsonb,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cursor_time timestamptz; cursor_id uuid; items jsonb; next_cursor text; filters jsonb:=coalesce(p_filters,'{}'::jsonb);
BEGIN
 PERFORM public.decke_improvement_require_reader();
 BEGIN PERFORM public.decke_improvement_purge_expired(); EXCEPTION WHEN read_only_sql_transaction THEN NULL; END;
 IF jsonb_typeof(filters)<>'object' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR filters-ARRAY['from','to','build_sha','build_pr','vote','min_cost','max_cost','has_error','model','tool']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid list filters' USING ERRCODE='22023';
 END IF;
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
   AND (NOT(filters?'from') OR c.updated_at>=(filters->>'from')::timestamptz)
   AND (NOT(filters?'to') OR c.updated_at<(filters->>'to')::timestamptz)
   AND (NOT(filters?'has_error') OR c.has_error=(filters->>'has_error')::boolean)
   AND (NOT(filters?'min_cost') OR c.cost_usd>=(filters->>'min_cost')::numeric)
   AND (NOT(filters?'max_cost') OR c.cost_usd<=(filters->>'max_cost')::numeric)
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
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Invalid list filter value' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.decke_improvement_detail(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.decke_improvement_require_reader();
 BEGIN PERFORM public.decke_improvement_purge_expired(); EXCEPTION WHEN read_only_sql_transaction THEN NULL; END;
 SELECT jsonb_build_object('conversation',jsonb_build_object('id',c.id,'date',to_char(c.started_at AT TIME ZONE 'UTC','YYYY-MM-DD'),
  'buildFirst',c.build_first,'buildLast',c.build_last,'costUsd',CASE WHEN c.cost_usd IS NULL THEN NULL ELSE round(c.cost_usd,2) END,
  'costCoverage',c.cost_coverage,'hasError',c.has_error),
  'turns',coalesce((SELECT jsonb_agg(jsonb_build_object('seq',t.seq,'asked',t.asked,'answered',t.answered,
   'tools',public.decke_improvement_reader_json(t.tools,c.started_at),'feedback',t.feedback,'feedbackComment',t.feedback_comment,
   'offsetSeconds',(round(extract(epoch FROM (t.started_at-c.started_at))/10)*10)::bigint,
   'tokens',jsonb_build_object(
    'input',CASE WHEN t.input_tokens IS NULL THEN NULL ELSE round(t.input_tokens::numeric,-2)::bigint END,
    'output',CASE WHEN t.output_tokens IS NULL THEN NULL ELSE round(t.output_tokens::numeric,-2)::bigint END,
    'cacheRead',CASE WHEN t.cache_read_tokens IS NULL THEN NULL ELSE round(t.cache_read_tokens::numeric,-2)::bigint END,
    'cacheWrite',CASE WHEN t.cache_write_tokens IS NULL THEN NULL ELSE round(t.cache_write_tokens::numeric,-2)::bigint END,
    'reasoning',CASE WHEN t.reasoning_tokens IS NULL THEN NULL ELSE round(t.reasoning_tokens::numeric,-2)::bigint END),
   'costUsd',CASE WHEN t.cost_usd IS NULL THEN NULL ELSE round(t.cost_usd,2) END,
   'costCoverage',t.cost_coverage,'buildSha',t.build_sha,'buildPr',t.build_pr,'finishReason',t.finish_reason,'hasError',t.has_error,
   'legs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'leg',l.leg,'asked',l.asked,'answered',l.answered,
    'modelId',l.model_id,'provider',l.provider,
    'tokens',jsonb_build_object(
     'input',CASE WHEN l.input_tokens IS NULL THEN NULL ELSE round(l.input_tokens::numeric,-2)::bigint END,
     'output',CASE WHEN l.output_tokens IS NULL THEN NULL ELSE round(l.output_tokens::numeric,-2)::bigint END,
     'cacheRead',CASE WHEN l.cache_read_tokens IS NULL THEN NULL ELSE round(l.cache_read_tokens::numeric,-2)::bigint END,
     'cacheWrite',CASE WHEN l.cache_write_tokens IS NULL THEN NULL ELSE round(l.cache_write_tokens::numeric,-2)::bigint END,
     'reasoning',CASE WHEN l.reasoning_tokens IS NULL THEN NULL ELSE round(l.reasoning_tokens::numeric,-2)::bigint END),
    'costUsd',CASE WHEN l.cost_usd IS NULL THEN NULL ELSE round(l.cost_usd,2) END,
    'costCoverage',l.cost_coverage,'costSource',l.cost_source,'status',l.status,'finishReason',l.finish_reason,
    'buildSha',l.build_sha,'buildPr',l.build_pr,'error',public.decke_improvement_reader_json(l.error,c.started_at),
    'toolCalls',public.decke_improvement_reader_json(l.tool_calls,c.started_at)) ORDER BY l.leg)
    FROM public.decke_improvement_leg l WHERE l.conversation_id=t.conversation_id AND l.seq=t.seq),'[]'::jsonb),
   'events',coalesce((SELECT jsonb_agg(jsonb_build_object('ordinal',e.ordinal,'batch',e.batch,'batchOrdinal',e.batch_ordinal,
    'legId',e.leg_id,
    'kind',e.kind,'payload',public.decke_improvement_reader_json(e.payload,c.started_at)) ORDER BY e.ordinal)
    FROM public.decke_improvement_event e WHERE e.conversation_id=t.conversation_id AND e.seq=t.seq),'[]'::jsonb)
  ) ORDER BY t.seq) FROM public.decke_improvement_turn t WHERE t.conversation_id=c.id),'[]'::jsonb))
 INTO result FROM public.decke_improvement_conversation c
 WHERE c.id=p_id AND c.updated_at>=now()-interval '180 days';
 IF result IS NULL THEN RAISE EXCEPTION 'Improvement conversation not found' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.decke_improvement_search(p_query text,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE items jsonb;
BEGIN
 PERFORM public.decke_improvement_require_reader();
 BEGIN PERFORM public.decke_improvement_purge_expired(); EXCEPTION WHEN read_only_sql_transaction THEN NULL; END;
 IF p_query IS NULL OR char_length(btrim(p_query)) NOT BETWEEN 2 AND 100
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Invalid search query' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('conversationId',conversation_id,'seq',seq,
  'date',to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD'),
  'askedSnippet',left(asked,240),'answeredSnippet',left(answered,240),'toolNames',tool_names) ORDER BY updated_at DESC,conversation_id,seq),'[]'::jsonb)
 INTO items FROM (
  SELECT t.conversation_id,t.seq,c.started_at,c.updated_at,t.asked,t.answered,
   coalesce((SELECT jsonb_agg(DISTINCT (tc->>'name')) FROM public.decke_improvement_leg l CROSS JOIN LATERAL jsonb_array_elements(l.tool_calls) tc
     WHERE l.conversation_id=t.conversation_id AND l.seq=t.seq),'[]'::jsonb) tool_names
  FROM public.decke_improvement_turn t JOIN public.decke_improvement_conversation c ON c.id=t.conversation_id
  WHERE c.updated_at>=now()-interval '180 days' AND (
     strpos(lower(t.asked),lower(btrim(p_query)))>0 OR strpos(lower(t.answered),lower(btrim(p_query)))>0
     OR EXISTS(SELECT 1 FROM public.decke_improvement_leg l CROSS JOIN LATERAL jsonb_array_elements(l.tool_calls) tc
       WHERE l.conversation_id=t.conversation_id AND l.seq=t.seq AND strpos(lower(tc->>'name'),lower(btrim(p_query)))>0))
  ORDER BY c.updated_at DESC,t.conversation_id,t.seq LIMIT p_limit
 ) matches;
 RETURN jsonb_build_object('query',btrim(p_query),'items',items);
END $$;

-- Migration 071's account-wide switch is retired in place.  Clearing it here
-- protects accounts that opted in before per-chat consent existed, while the
-- replacement functions keep deployed old clients metadata-only.
UPDATE public.decke_sharing
 SET enabled=false,revision=revision+CASE WHEN enabled THEN 1 ELSE 0 END,updated_at=now();
DELETE FROM public.decke_ai_content;

CREATE OR REPLACE FUNCTION public.decke_sharing_read() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;
BEGIN
 actor=public.credit_server_actor();
 UPDATE public.decke_sharing SET enabled=false WHERE user_id=actor AND enabled;
 RETURN jsonb_build_object('enabled',false,'retired',true,'mode','per_chat',
  'explanation','Deck-E chats are shared one conversation at a time. Use Share this chat or the feedback option.');
END $$;

CREATE OR REPLACE FUNCTION public.decke_sharing_save(p_enabled boolean,p_expected bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;
BEGIN
 actor=public.credit_server_actor();
 DELETE FROM public.decke_ai_content content USING public.decke_ai_request request
  WHERE content.request_id=request.id AND request.user_id=actor;
 INSERT INTO public.decke_sharing(user_id,enabled) VALUES(actor,false)
  ON CONFLICT(user_id) DO UPDATE SET enabled=false,updated_at=now();
 RETURN public.decke_sharing_read();
END $$;

CREATE OR REPLACE FUNCTION public.decke_usage_begin(
 p_user text,p_conversation uuid,p_exchange uuid,p_seq integer,p_key text,p_hash text,
 p_build_sha text,p_build_pr integer,p_pricing bigint,p_override bigint,p_mode text,p_asked text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rid uuid=gen_random_uuid(); ex uuid; previous public.decke_ai_request; owner_id text;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(741290064);
 IF NOT public.admin_account_active(p_user) OR NOT public.admin_user_has_permission(p_user,'decke.use') THEN
  RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501';
 END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 300 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$'
    OR p_mode NOT IN ('paid','unlimited','daily') OR (p_seq IS NOT NULL AND p_seq NOT BETWEEN 0 AND 10000) THEN
  RAISE EXCEPTION 'Invalid usage reference' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('decke.usage:'||p_user||':'||p_key,0));
 IF EXISTS(SELECT 1 FROM public.decke_ai_request WHERE user_id=p_user AND request_key=p_key) THEN
  RAISE EXCEPTION 'Request already accepted' USING ERRCODE='40001';
 END IF;
 IF p_conversation IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('decke.conversation:'||p_conversation::text,0));
  SELECT user_id::text INTO owner_id FROM public.decke_conversation WHERE id=p_conversation;
  IF owner_id IS NOT NULL AND owner_id<>p_user THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='42501'; END IF;
  INSERT INTO public.decke_conversation(id,user_id)
   SELECT p_conversation,id FROM public.app_user WHERE id::text=p_user ON CONFLICT DO NOTHING;
  SELECT user_id::text INTO owner_id FROM public.decke_conversation WHERE id=p_conversation;
  IF owner_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='42501'; END IF;
 END IF;
 ex=coalesce(p_exchange,rid);
 IF p_exchange IS NOT NULL AND p_seq IS NOT NULL AND p_conversation IS NOT NULL THEN
  SELECT * INTO previous FROM public.decke_ai_request
   WHERE user_id=p_user AND conversation_id=p_conversation AND (seq=p_seq OR exchange_id=p_exchange)
   ORDER BY started_at,id LIMIT 1;
  IF FOUND AND (previous.exchange_id<>p_exchange OR previous.seq IS DISTINCT FROM p_seq) THEN
   RAISE EXCEPTION 'Exchange reference conflicts' USING ERRCODE='40001';
  END IF;
 END IF;
 INSERT INTO public.decke_ai_request(
  id,user_id,conversation_id,exchange_id,seq,request_key,payload_hash,consent_epoch,
  build_sha,build_pr,pricing_revision,override_revision,charge_mode
 ) VALUES(
  rid,p_user,p_conversation,ex,p_seq,p_key,p_hash,NULL,
  left(p_build_sha,64),p_build_pr,p_pricing,p_override,p_mode
 );
 RETURN jsonb_build_object('id',rid,'exchangeId',ex,'consentEpoch',NULL);
END $$;

CREATE OR REPLACE FUNCTION public.decke_usage_content_append(p_id uuid,p_text text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Compatibility no-op: improvement content requires per-conversation consent.
 RETURN;
END $$;

CREATE OR REPLACE FUNCTION public.decke_usage_detail(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.decke_ai_request; operations jsonb;
BEGIN
 PERFORM public.decke_usage_require_admin();
 SELECT * INTO r FROM public.decke_ai_request WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'toolKey',tool_key,'modelId',model_id,'provider',provider,
  'status',CASE WHEN status='started' AND started_at<now()-interval '15 minutes' THEN 'abandoned' ELSE status END,
  'startedAt',started_at,'finishedAt',finished_at,
  'tokens',jsonb_build_object('inputTokens',input_tokens,'outputTokens',output_tokens,'cacheReadTokens',cache_read_tokens,'cacheWriteTokens',cache_write_tokens,'reasoningTokens',reasoning_tokens),
  'cost',jsonb_build_object('source',cost_source,'usd',cost_usd::text,'currency','USD','coverage',CASE WHEN cost_usd IS NULL THEN 'unknown' ELSE 'complete' END)) ORDER BY started_at,id),'[]'::jsonb)
 INTO operations FROM public.decke_ai_operation WHERE request_id=p_id;
 RETURN jsonb_build_object('request',public.decke_usage_request_json(p_id),'operations',operations,
  'contentStatus','retired','content',NULL);
END $$;

DO $feedback_policy$
BEGIN
 IF to_regprocedure('auth.uid()') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY decke_turn_feedback_select ON public.decke_turn_feedback FOR SELECT USING (user_id=(SELECT auth.uid()))';
  EXECUTE 'CREATE POLICY decke_turn_feedback_insert ON public.decke_turn_feedback FOR INSERT WITH CHECK (user_id=(SELECT auth.uid()))';
  EXECUTE 'CREATE POLICY decke_turn_feedback_update ON public.decke_turn_feedback FOR UPDATE USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()))';
  EXECUTE 'CREATE POLICY decke_turn_feedback_delete ON public.decke_turn_feedback FOR DELETE USING (user_id=(SELECT auth.uid()))';
  EXECUTE 'CREATE POLICY decke_turn_feedback_active ON public.decke_turn_feedback AS RESTRICTIVE FOR ALL TO authenticated USING (public.admin_current_account_active()) WITH CHECK (public.admin_current_account_active())';
 END IF;
END $feedback_policy$;

DO $acl$
DECLARE principal text; sig text; tbl text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
  CONTINUE WHEN principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal);
  FOREACH tbl IN ARRAY ARRAY['decke_improvement_secret','decke_improvement_consent','decke_improvement_conversation','decke_improvement_turn','decke_improvement_leg','decke_improvement_event','decke_turn_feedback'] LOOP
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s',tbl,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  END LOOP;
  FOREACH sig IN ARRAY ARRAY[
   'decke_improvement_uuid(text,uuid)','decke_improvement_owner_key(text)','decke_improvement_redaction_variants(text[])',
   'decke_improvement_redaction_terms(text)','decke_improvement_redact_text(text,text[])',
   'decke_improvement_redact_json_identifiers(jsonb,text[])','decke_improvement_reader_json(jsonb,timestamptz)',
   'decke_improvement_require_writer(text)',
   'decke_improvement_require_reader()','decke_improvement_recompute(uuid,integer)',
   'decke_improvement_can_ask(text,uuid)','decke_improvement_answer(text,uuid,boolean,text)',
   'decke_improvement_shared_owner(text,uuid)',
   'decke_improvement_record_backfill(text,uuid,jsonb)',
   'decke_improvement_record_leg(text,uuid,integer,uuid,integer,jsonb)',
   'decke_improvement_record_events(text,uuid,integer,integer,jsonb)',
   'decke_improvement_record_feedback(text,uuid,integer,smallint,text,boolean)',
   'decke_improvement_revoke(text,uuid)','decke_improvement_list_mine(text)',
   'decke_improvement_account_delete()',
   'decke_improvement_purge_expired()','decke_usage_external_operation_begin(uuid,uuid,text,text,text,text,uuid)',
   'decke_usage_conversation_costs(jsonb,text,integer)',
   'decke_improvement_token_capability(uuid,boolean)','decke_improvement_oauth_capability(text,boolean)',
   'decke_improvement_list(jsonb,text,integer)',
   'decke_improvement_detail(uuid)','decke_improvement_search(text,integer)'] LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %s',sig,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.decke_turn_feedback TO authenticated;
  GRANT EXECUTE ON FUNCTION public.decke_improvement_can_ask(text,uuid),
   public.decke_improvement_answer(text,uuid,boolean,text),
   public.decke_improvement_revoke(text,uuid),public.decke_improvement_list_mine(text),
   public.decke_improvement_record_backfill(text,uuid,jsonb),
   public.decke_improvement_record_leg(text,uuid,integer,uuid,integer,jsonb),
   public.decke_improvement_record_events(text,uuid,integer,integer,jsonb),
   public.decke_improvement_record_feedback(text,uuid,integer,smallint,text,boolean),
   public.decke_improvement_token_capability(uuid,boolean),
   public.decke_improvement_oauth_capability(text,boolean),
   public.decke_usage_conversation_costs(jsonb,text,integer),
   public.decke_improvement_list(jsonb,text,integer),public.decke_improvement_detail(uuid),
   public.decke_improvement_search(text,integer) TO authenticated;
  REVOKE INSERT(decke_improvement_read),UPDATE(decke_improvement_read) ON public.api_token FROM authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE INSERT(decke_improvement_read),UPDATE(decke_improvement_read) ON public.api_token FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.decke_improvement_purge_expired(),
   public.decke_usage_external_operation_begin(uuid,uuid,text,text,text,text,uuid) TO service_role;
 END IF;
END $acl$;

COMMENT ON TABLE public.decke_improvement_conversation IS 'Pseudonymised Deck-E improvement collection; owner_key is never exposed by reader functions.';
COMMENT ON TABLE public.decke_improvement_consent IS 'Per-conversation opt-in state; its HMAC id and owner key never leave security-definer functions.';
COMMENT ON TABLE public.decke_turn_feedback IS 'Personal own-row feedback retained separately from the improvement collection.';
COMMENT ON TABLE public.decke_sharing IS 'Retired account-wide Deck-E sharing preference. Rows are forced disabled by migration 078.';
COMMENT ON TABLE public.decke_ai_content IS 'Retired legacy excerpt table. Migration 078 clears it and all compatibility writers are metadata-only.';
