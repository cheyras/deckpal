-- Product access is lifecycle policy, never an editable role permission.
SELECT pg_advisory_xact_lock(741290064);
CREATE SEQUENCE public.feature_revision_seq AS bigint;
CREATE TABLE public.app_feature (
 key text PRIMARY KEY CHECK(key ~ '^[a-z][a-z0-9_]{0,63}$'), label text NOT NULL,
 lifecycle text NOT NULL CHECK(lifecycle IN('released','beta','experimental','disabled')),
 revision bigint NOT NULL DEFAULT nextval('public.feature_revision_seq'), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.app_feature_opt_in (
 user_id text NOT NULL REFERENCES public.admin_account(user_id) ON DELETE CASCADE,
 feature_key text NOT NULL REFERENCES public.app_feature(key), opted_in boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT nextval('public.feature_revision_seq'), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,feature_key)
);
ALTER TABLE public.app_feature ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feature_opt_in ENABLE ROW LEVEL SECURITY;
INSERT INTO public.app_feature(key,label,lifecycle) VALUES('scanner','Scanner','experimental'),('decke','Deck-E','experimental');
CREATE FUNCTION public.feature_access(p_user text,p_key text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE f public.app_feature; pref public.app_feature_opt_in; active boolean; eligible boolean; enabled boolean; automatic boolean; reason text;
BEGIN
 SELECT * INTO f FROM public.app_feature WHERE key=p_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO pref FROM public.app_feature_opt_in WHERE user_id=p_user AND feature_key=p_key;
 active:=public.admin_account_active(p_user) AND EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL);
 automatic:=public.admin_is_super(p_user);
 eligible:=active AND (f.lifecycle IN('released','beta') OR (f.lifecycle='experimental' AND public.admin_role_tier(p_user)>=20));
 enabled:=eligible AND (f.lifecycle='released' OR (f.lifecycle='experimental' AND automatic) OR coalesce(pref.opted_in,false));
 reason:=CASE WHEN NOT active THEN 'account_unavailable' WHEN f.lifecycle='disabled' THEN 'disabled'
 WHEN f.lifecycle='released' THEN 'released' WHEN NOT eligible THEN 'experimental_tier_required'
 WHEN f.lifecycle='experimental' AND automatic THEN 'automatic' WHEN enabled THEN 'opted_in' ELSE 'opt_in_required' END;
 RETURN jsonb_build_object('key',f.key,'label',f.label,'lifecycle',f.lifecycle,'revision',greatest(f.revision,coalesce(pref.revision,0)),
 'optedIn',coalesce(pref.opted_in,false),'eligible',eligible,'enabled',enabled,'reason',reason);
END $$;
CREATE FUNCTION public.feature_enabled(p_user text,p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((public.feature_access(p_user,p_key)->>'enabled')::boolean,false)
$$;
CREATE FUNCTION public.feature_access_list(p_user text,p_admin boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_agg(public.feature_access(p_user,key)||CASE WHEN p_admin THEN jsonb_build_object('revision',revision) ELSE '{}'::jsonb END ORDER BY key),'[]') FROM public.app_feature
$$;
CREATE OR REPLACE FUNCTION public.admin_permissions(p_user_id text) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(array_agg(DISTINCT permission ORDER BY permission),'{}') FROM (
 SELECT unnest(public.admin_raw_permissions(p_user_id)) permission
 UNION SELECT 'scanner.use' WHERE public.feature_enabled(p_user_id,'scanner')
 UNION SELECT 'decke.use' WHERE public.feature_enabled(p_user_id,'decke')
 ) granted
$$;
-- Keep the signature/ACL of admin_access; private base projection cannot be called by clients.
ALTER FUNCTION public.admin_access(text) RENAME TO admin_access_roles;
CREATE FUNCTION public.admin_access(p_user text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.admin_access_roles(p_user)||jsonb_build_object('features',public.feature_access_list(p_user),
 'revision',(public.admin_access_roles(p_user)->>'revision')||':'||coalesce((SELECT max(greatest(f.revision,coalesce(o.revision,0)))::text FROM public.app_feature f LEFT JOIN public.app_feature_opt_in o ON o.feature_key=f.key AND o.user_id=p_user),'0'))
$$;
CREATE FUNCTION public.feature_api(p_operation text,p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=public.admin_actor_id(); f public.app_feature; current_access jsonb; admin_op boolean:=p_operation IN('admin.list','admin.update'); before jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Expected object' USING ERRCODE='22023'; END IF;
 IF p_operation IN('self.update','admin.update') THEN PERFORM pg_advisory_xact_lock(741290064); END IF;
 IF NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN RAISE EXCEPTION 'Active web session required' USING ERRCODE='42501'; END IF;
 IF admin_op AND NOT public.admin_is_super(actor) THEN RAISE EXCEPTION 'Superadmin or Owner required' USING ERRCODE='42501'; END IF;
 IF p_operation NOT IN('self.list','self.update','admin.list','admin.update') THEN RAISE EXCEPTION 'Unknown operation' USING ERRCODE='22023'; END IF;
 IF p_operation IN('self.update','admin.update') THEN
  SELECT * INTO f FROM public.app_feature WHERE key=p->>'key';
  IF NOT FOUND THEN RAISE EXCEPTION 'Feature not found' USING ERRCODE='P0002'; END IF;
  current_access:=public.feature_access(actor,f.key);
  IF (p->>'expectedRevision')::bigint IS DISTINCT FROM (CASE WHEN admin_op THEN f.revision ELSE (current_access->>'revision')::bigint END) THEN RAISE EXCEPTION 'Feature changed; refresh' USING ERRCODE='40001'; END IF;
  IF admin_op THEN
   IF p-ARRAY['key','lifecycle','expectedRevision','reason']<>'{}'::jsonb OR jsonb_typeof(p->'lifecycle') IS DISTINCT FROM 'string' OR p->>'lifecycle' NOT IN('released','beta','experimental','disabled') OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Invalid lifecycle change' USING ERRCODE='22023'; END IF;
   before:=to_jsonb(f);
   UPDATE public.app_feature SET lifecycle=p->>'lifecycle',revision=nextval('public.feature_revision_seq'),updated_at=now() WHERE key=f.key;
   PERFORM public.admin_audit_append('feature.lifecycle','feature',f.key,before,(SELECT to_jsonb(x) FROM public.app_feature x WHERE key=f.key),p->>'reason');
  ELSE
   IF p-ARRAY['key','optedIn','expectedRevision']<>'{}'::jsonb OR jsonb_typeof(p->'optedIn') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'optedIn must be boolean' USING ERRCODE='22023'; END IF;
   IF (p->>'optedIn')::boolean AND (NOT(current_access->>'eligible')::boolean OR f.lifecycle NOT IN('beta','experimental')) THEN RAISE EXCEPTION 'This feature is not available for opt-in' USING ERRCODE='42501'; END IF;
   INSERT INTO public.app_feature_opt_in(user_id,feature_key,opted_in) VALUES(actor,f.key,(p->>'optedIn')::boolean)
   ON CONFLICT(user_id,feature_key) DO UPDATE SET opted_in=EXCLUDED.opted_in,revision=nextval('public.feature_revision_seq'),updated_at=now();
  END IF;
 END IF;
 RETURN jsonb_build_object('features',public.feature_access_list(actor,admin_op));
END $$;
-- Close every new surface in its creation transaction even with permissive cloud defaults.
DO $acl$ DECLARE principal text; sig text; BEGIN
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
  IF principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal) THEN CONTINUE; END IF;
  EXECUTE format('REVOKE ALL ON TABLE public.app_feature,public.app_feature_opt_in FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  EXECUTE format('REVOKE ALL ON SEQUENCE public.feature_revision_seq FROM %s',CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
  FOREACH sig IN ARRAY ARRAY['feature_access(text,text)','feature_enabled(text,text)','feature_access_list(text,boolean)','feature_api(text,jsonb)','admin_access_roles(text)','admin_access(text)'] LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %s',sig,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END); END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN GRANT EXECUTE ON FUNCTION public.admin_access(text),public.feature_api(text,jsonb) TO authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION public.admin_access(text),public.feature_enabled(text,text) TO service_role; END IF;
END $acl$;
