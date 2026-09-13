-- Application governance. No PostgreSQL roles or cloud configuration are created here.
-- Text account references deliberately support UUID cloud and legacy bigint self-host IDs.
CREATE TABLE public.admin_permission (
  key text PRIMARY KEY, permission_group text NOT NULL, description text NOT NULL
);
INSERT INTO public.admin_permission VALUES
 ('admin.access','Administration','Open the administration area and assigned tools.'),
 ('users.read','Users','Read the user directory, email addresses and account summaries.'),
 ('users.manage','Users','Suspend accounts, restore access and revoke connector credentials.'),
 ('roles.read','Roles','Read roles and their effective permissions.'),
 ('roles.manage','Roles','Create roles and assign permissions within your own authority.'),
 ('settings.read','Settings','Read application defaults.'),
 ('settings.write','Settings','Change defaults for accounts without an explicit preference.'),
 ('credits.read','Credits','Read credit economics and user credit histories.'),
 ('credits.manage','Credits','Change future usage prices, sell packs and adjust balances.'),
 ('audit.read','Administration','Read administrative changes, including account identifiers.'),
 ('scanner.use','Tools','Use the card scanner.'),
 ('scanner.label','Tools','Read private scanner photos and contribute training labels.'),
 ('design.view','Tools','View the design system. Production is read-only.'),
 ('diagnostics.view','Tools','Open internal diagnostic and Deck-E comparison interfaces.'),
 ('decke.use','AI','Use Deck-E; credit and account restrictions still apply.');
CREATE TABLE public.admin_role (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text UNIQUE NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
 protected boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE UNIQUE INDEX admin_role_name_unique ON public.admin_role(lower(name));
CREATE TABLE public.admin_role_permission (
 role_id uuid NOT NULL REFERENCES public.admin_role(id) ON DELETE CASCADE,
 permission_key text NOT NULL REFERENCES public.admin_permission(key), PRIMARY KEY(role_id,permission_key)
);
CREATE TABLE public.admin_account (
 user_id text PRIMARY KEY, suspended boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_user_role (
 user_id text NOT NULL REFERENCES public.admin_account(user_id) ON DELETE CASCADE,
 role_id uuid NOT NULL REFERENCES public.admin_role(id), PRIMARY KEY(user_id,role_id)
);
CREATE TABLE public.admin_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), bootstrapped_at timestamptz,
 bootstrap_owner text
);
INSERT INTO public.admin_state(singleton) VALUES(true);
CREATE TABLE public.admin_app_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 skin text NOT NULL DEFAULT 'premium' CHECK(skin IN ('premium','classic')),
 topbar text NOT NULL DEFAULT 'cover' CHECK(topbar IN ('cover','flat')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admin_app_settings(singleton) VALUES(true);
CREATE TABLE public.admin_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id text,
 action text NOT NULL, target_type text NOT NULL, target_id text,
 before_data jsonb, after_data jsonb, reason text CHECK(length(reason)<=1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON public.admin_audit(created_at DESC,id DESC);
CREATE INDEX admin_audit_target ON public.admin_audit(target_id,created_at DESC);
INSERT INTO public.admin_role(key,name,description,protected) VALUES
 ('super_admin','Super admin','Full application governance. At least one active super admin is required.',true),
 ('legacy_decke','Deck-E access','Imported legacy Deck-E access; now managed here.',false),
 ('legacy_labeler','Scanner labeler','Imported legacy scanner labeling access; now managed here.',false);
INSERT INTO public.admin_role_permission SELECT r.id,p.key FROM public.admin_role r CROSS JOIN public.admin_permission p WHERE r.key='super_admin';
INSERT INTO public.admin_role_permission SELECT id,'decke.use' FROM public.admin_role WHERE key='legacy_decke';
INSERT INTO public.admin_role_permission SELECT r.id,p FROM public.admin_role r CROSS JOIN unnest(ARRAY['admin.access','scanner.label']) p WHERE r.key='legacy_labeler';

CREATE FUNCTION public.admin_actor_id() RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog, pg_temp
AS $$ SELECT NULLIF(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','') $$;

CREATE FUNCTION public.admin_account_active(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp
AS $$ SELECT EXISTS(SELECT 1 FROM public.app_user u WHERE u.id::text=p_user_id)
 AND NOT EXISTS(SELECT 1 FROM public.admin_account a WHERE a.user_id=p_user_id AND a.suspended) $$;

CREATE FUNCTION public.admin_permissions(p_user_id text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp
AS $$ SELECT COALESCE(array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key),'{}'::text[])
 FROM public.admin_user_role ur JOIN public.admin_role_permission rp ON rp.role_id=ur.role_id
 WHERE ur.user_id=p_user_id AND public.admin_account_active(p_user_id) $$;

CREATE FUNCTION public.admin_is_super(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp
AS $$ SELECT public.admin_account_active(p_user_id) AND EXISTS(
 SELECT 1 FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id
 WHERE ur.user_id=p_user_id AND r.key='super_admin') $$;

-- Called by Express after verifying the credential. Direct Supabase sessions
-- are also valid, but a PAT's synthetic claims never contain a session ID.
CREATE FUNCTION public.admin_is_session() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
DECLARE c jsonb:=COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb,'{}'); valid boolean:=false;
BEGIN
 IF c->>'deckpal_auth_kind'='jwt' THEN RETURN true; END IF;
 IF c->>'deckpal_auth_kind'='local' AND current_setting('role')='none' THEN RETURN true; END IF;
 IF c->>'deckpal_auth_kind'='token' THEN RETURN false; END IF;
 IF c->>'session_id' ~ '^[0-9a-fA-F-]{36}$' AND to_regclass('auth.sessions') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id::text=$1 AND user_id::text=$2)' INTO valid USING c->>'session_id', c->>'sub';
 END IF;
 RETURN valid;
END $$;

CREATE FUNCTION public.admin_require_permission(p_key text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
DECLARE actor text:=public.admin_actor_id(); perms text[];
BEGIN
 IF actor IS NULL OR NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'A signed-in active account is required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL) THEN RAISE EXCEPTION 'Administration is not initialized' USING ERRCODE='55000'; END IF;
 perms:=public.admin_permissions(actor);
 IF NOT ('admin.access'=ANY(perms) AND p_key=ANY(perms)) THEN RAISE EXCEPTION 'Permission denied: %',p_key USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION public.admin_audit_append(p_action text,p_type text,p_id text,p_before jsonb,p_after jsonb,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
 INSERT INTO public.admin_audit(actor_id,action,target_type,target_id,before_data,after_data,reason)
 VALUES(public.admin_actor_id(),p_action,p_type,p_id,p_before,p_after,p_reason)
$$;

CREATE FUNCTION public.admin_bootstrap(p_owner text,p_decke text[],p_labelers text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
DECLARE uid text;
BEGIN
 -- EXECUTE is revoked from web roles below. Also refuse execution under an
 -- assumed web role, even if a future grant accidentally broadens access.
 IF current_setting('role') NOT IN ('none','service_role') THEN RAISE EXCEPTION 'Trusted bootstrap only' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(741290064);
 IF EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL) THEN RETURN true; END IF;
 IF p_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_user WHERE id::text=p_owner) THEN RETURN false; END IF;
 INSERT INTO public.admin_account(user_id) SELECT DISTINCT id::text FROM public.app_user WHERE id::text=ANY(array_append(p_decke||p_labelers,p_owner)) ON CONFLICT DO NOTHING;
 INSERT INTO public.admin_user_role SELECT p_owner,id FROM public.admin_role WHERE key='super_admin';
 INSERT INTO public.admin_user_role SELECT a.user_id,r.id FROM public.admin_account a CROSS JOIN public.admin_role r
 WHERE (r.key='legacy_decke' AND a.user_id=ANY(p_decke)) OR (r.key='legacy_labeler' AND a.user_id=ANY(p_labelers))
 ON CONFLICT DO NOTHING;
 INSERT INTO public.admin_audit(actor_id,action,target_type,target_id,after_data,reason)
 VALUES(NULL,'bootstrap','administration',NULL,jsonb_build_object('owner',p_owner,'importedAccounts',(SELECT count(*) FROM public.admin_account)),'One-time import of existing trusted deployment allowlists');
 UPDATE public.admin_state SET bootstrapped_at=now(),bootstrap_owner=p_owner WHERE singleton;
 RETURN true;
END $$;

CREATE FUNCTION public.admin_access(p_user text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
BEGIN
 IF current_setting('role') NOT IN ('none','service_role') AND p_user IS DISTINCT FROM public.admin_actor_id() THEN RAISE EXCEPTION 'Own access only' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ready',EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL),
 'suspended',NOT public.admin_account_active(p_user),'permissions',public.admin_permissions(p_user),
 'roles',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'key',r.key,'name',r.name) ORDER BY r.name)
 FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id WHERE ur.user_id=p_user),'[]'::jsonb));
END $$;

CREATE FUNCTION public.admin_public_defaults() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('skin',skin,'topbar',topbar) FROM public.admin_app_settings WHERE singleton
$$;

CREATE FUNCTION public.admin_user_projection(p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
DECLARE out jsonb; mail text; signed timestamptz;
BEGIN
 SELECT jsonb_build_object('id',u.id::text,'username',u.username,'createdAt',u.created_at,
 'suspended',COALESCE(a.suspended,false),'revision',COALESCE(a.revision,1),
 'roles',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) ORDER BY r.name) FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id WHERE ur.user_id=u.id::text),'[]'::jsonb))
 INTO out FROM public.app_user u LEFT JOIN public.admin_account a ON a.user_id=u.id::text WHERE u.id::text=p_id;
 IF out IS NULL THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 IF to_regclass('auth.users') IS NOT NULL THEN
  EXECUTE 'SELECT email,last_sign_in_at FROM auth.users WHERE id::text=$1' INTO mail,signed USING p_id;
 END IF;
 RETURN out||jsonb_build_object('email',mail,'lastSignInAt',signed);
END $$;

CREATE FUNCTION public.admin_role_projection(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('id',r.id,'key',r.key,'name',r.name,'description',r.description,'protected',r.protected,'revision',r.revision,
 'permissions',COALESCE((SELECT jsonb_agg(permission_key ORDER BY permission_key) FROM public.admin_role_permission WHERE role_id=r.id),'[]'::jsonb),
 'memberCount',(SELECT count(*) FROM public.admin_user_role WHERE role_id=r.id)) FROM public.admin_role r WHERE id=p_id
$$;

-- Every state-changing entry point shares this serialization lock. Role
-- revisions plus target-account revisions reject stale forms after the lock.
CREATE FUNCTION public.admin_api(p_operation text,p jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
DECLARE actor text; permission text; target text:=p->>'id'; rid uuid; before jsonb; after jsonb;
 perms text[]; requested text[]; is_super boolean; n bigint; lim integer:=50; off integer:=0; rows jsonb; item record; search text; status text;
BEGIN
 IF jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'Expected an object' USING ERRCODE='22023'; END IF;
 permission:=CASE
 WHEN p_operation IN ('overview') THEN 'admin.access'
 WHEN p_operation IN ('users','user') THEN 'users.read'
 WHEN p_operation IN ('user.status','user.revoke-tokens') THEN 'users.manage'
 WHEN p_operation IN ('roles') THEN 'roles.read'
 WHEN p_operation IN ('role.create','role.update','role.delete','user.roles') THEN 'roles.manage'
 WHEN p_operation='settings' THEN 'settings.read'
 WHEN p_operation='settings.update' THEN 'settings.write'
 WHEN p_operation='audit' THEN 'audit.read' END;
 IF permission IS NULL THEN RAISE EXCEPTION 'Unknown administration operation' USING ERRCODE='22023'; END IF;
 IF p_operation IN ('user.status','user.revoke-tokens','user.roles','role.create','role.update','role.delete','settings.update') THEN PERFORM pg_advisory_xact_lock(741290064); END IF;
 actor:=public.admin_require_permission(permission); perms:=public.admin_permissions(actor); is_super:=public.admin_is_super(actor);
 IF p_operation IN ('users','audit') THEN
  lim:=COALESCE((p->>'limit')::integer,50); off:=COALESCE((p->>'offset')::integer,0);
  IF lim NOT BETWEEN 1 AND 100 OR off NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Pagination is out of range' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_operation='overview' THEN
  RETURN jsonb_build_object('adminReady',true,'counts',
   (CASE WHEN 'users.read'=ANY(perms) THEN jsonb_build_object('users',(SELECT count(*) FROM public.app_user),'suspended',(SELECT count(*) FROM public.admin_account WHERE suspended)) ELSE '{}'::jsonb END)
   ||(CASE WHEN 'roles.read'=ANY(perms) THEN jsonb_build_object('roles',(SELECT count(*) FROM public.admin_role)) ELSE '{}'::jsonb END)
   ||(CASE WHEN 'audit.read'=ANY(perms) THEN jsonb_build_object('auditEvents',(SELECT count(*) FROM public.admin_audit)) ELSE '{}'::jsonb END),
   'status',jsonb_build_object('bootstrap','ready','mode',CASE WHEN to_regclass('auth.users') IS NULL THEN 'self-host' ELSE 'cloud' END));
 ELSIF p_operation='users' THEN
  search:=COALESCE(p->>'search',''); status:=COALESCE(p->>'status','all');
  IF length(search)>200 OR status NOT IN ('all','active','suspended') THEN RAISE EXCEPTION 'Invalid user filter' USING ERRCODE='22023'; END IF;
  -- Selected projection alone can see auth.users; no raw-auth table grants.
  SELECT count(*),COALESCE(jsonb_agg(v ORDER BY created,id) FILTER(WHERE pos>off AND pos<=off+lim),'[]'::jsonb) INTO n,rows FROM (
   SELECT v,created,id,row_number() OVER(ORDER BY created,id) pos FROM (
    SELECT public.admin_user_projection(u.id::text) v,u.created_at created,u.id::text id FROM public.app_user u
   ) directory WHERE (search='' OR v->>'username' ILIKE '%'||search||'%' OR v->>'email' ILIKE '%'||search||'%' OR id=search)
   AND (status='all' OR (v->>'suspended')::boolean=(status='suspended'))
   AND (COALESCE(p->>'role','')='' OR EXISTS(SELECT 1 FROM public.admin_user_role ur WHERE ur.user_id=id AND ur.role_id::text=p->>'role'))
  ) filtered;
  RETURN jsonb_build_object('users',rows,'total',n,'limit',lim,'offset',off);
 ELSIF p_operation='user' THEN
  after:=public.admin_user_projection(target); before:='{}';
  FOR item IN SELECT * FROM (VALUES('collection_item','collectionItems'),('deck','decks'),('api_token','connectors')) t(tbl,label) LOOP
   IF to_regclass('public.'||item.tbl) IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id::text=$1%s',item.tbl,CASE WHEN item.tbl='api_token' THEN ' AND revoked_at IS NULL' ELSE '' END) INTO n USING target;
    before:=before||jsonb_build_object(item.label,n);
   END IF;
  END LOOP;
  RETURN jsonb_build_object('user',after,'permissions',public.admin_permissions(target),'stats',before);
 ELSIF p_operation='roles' THEN
  RETURN jsonb_build_object('roles',(SELECT COALESCE(jsonb_agg(public.admin_role_projection(id) ORDER BY protected DESC,name),'[]') FROM public.admin_role),
  'permissions',(SELECT jsonb_agg(jsonb_build_object('key',key,'group',permission_group,'description',description) ORDER BY permission_group,key) FROM public.admin_permission));
 ELSIF p_operation IN ('role.create','role.update','role.delete') THEN
  IF p_operation<>'role.create' THEN
   rid:=target::uuid; before:=public.admin_role_projection(rid);
   IF before IS NULL THEN RAISE EXCEPTION 'Role not found' USING ERRCODE='P0002'; END IF;
   IF (before->>'protected')::boolean THEN RAISE EXCEPTION 'The super admin role is immutable' USING ERRCODE='42501'; END IF;
   IF (p->>'expectedRevision')::integer IS DISTINCT FROM (before->>'revision')::integer THEN RAISE EXCEPTION 'Role changed; refresh and retry' USING ERRCODE='40001'; END IF;
   IF NOT is_super AND EXISTS(SELECT 1 FROM public.admin_role_permission WHERE role_id=rid AND NOT(permission_key=ANY(perms))) THEN RAISE EXCEPTION 'Cannot manage a role with authority you do not hold' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_operation='role.delete' THEN
   IF EXISTS(SELECT 1 FROM public.admin_user_role WHERE role_id=rid) THEN RAISE EXCEPTION 'Remove role assignments before deleting this role' USING ERRCODE='55000'; END IF;
   DELETE FROM public.admin_role WHERE id=rid; after:=NULL;
  ELSE
   IF jsonb_typeof(p->'permissions') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'permissions')>50
    OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR length(btrim(p->>'name')) NOT BETWEEN 1 AND 80
    OR jsonb_typeof(p->'description') IS DISTINCT FROM 'string' OR length(p->>'description')>500 THEN RAISE EXCEPTION 'Invalid role fields' USING ERRCODE='22023'; END IF;
   SELECT COALESCE(array_agg(DISTINCT value),'{}') INTO requested FROM jsonb_array_elements_text(p->'permissions');
   IF EXISTS(SELECT 1 FROM unnest(requested) r WHERE NOT EXISTS(SELECT 1 FROM public.admin_permission WHERE key=r)) THEN RAISE EXCEPTION 'Unknown permission' USING ERRCODE='22023'; END IF;
   IF NOT is_super AND NOT(requested<@perms) THEN RAISE EXCEPTION 'Cannot grant authority you do not hold' USING ERRCODE='42501'; END IF;
   IF p_operation='role.create' THEN
    INSERT INTO public.admin_role(key,name,description) VALUES('custom_'||gen_random_uuid()::text,btrim(p->>'name'),p->>'description') RETURNING id INTO rid;
   ELSE UPDATE public.admin_role SET name=btrim(p->>'name'),description=p->>'description',revision=revision+1 WHERE id=rid; END IF;
   DELETE FROM public.admin_role_permission WHERE role_id=rid;
   INSERT INTO public.admin_role_permission SELECT rid,unnest(requested);
   after:=public.admin_role_projection(rid);
  END IF;
  PERFORM public.admin_audit_append(p_operation,'role',rid::text,before,after,p->>'reason');
  RETURN jsonb_build_object('role',after);
 ELSIF p_operation IN ('user.roles','user.status','user.revoke-tokens') THEN
  before:=public.admin_user_projection(target);
  IF NOT is_super AND (EXISTS(SELECT 1 FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id WHERE ur.user_id=target AND r.protected) OR EXISTS(SELECT 1 FROM public.admin_user_role ur JOIN public.admin_role_permission rp ON rp.role_id=ur.role_id WHERE ur.user_id=target AND NOT(rp.permission_key=ANY(perms)))) THEN RAISE EXCEPTION 'Cannot manage an account with greater authority' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'A reason of 3 to 1000 characters is required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.admin_account(user_id) VALUES(target) ON CONFLICT DO NOTHING;
  IF p_operation<>'user.revoke-tokens' AND (p->>'expectedRevision')::integer IS DISTINCT FROM (before->>'revision')::integer THEN RAISE EXCEPTION 'Account changed; refresh and retry' USING ERRCODE='40001'; END IF;
  IF p_operation='user.roles' THEN
   IF jsonb_typeof(p->'roleIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'roleIds')>100 THEN RAISE EXCEPTION 'Invalid role IDs' USING ERRCODE='22023'; END IF;
   SELECT COALESCE(array_agg(DISTINCT value),'{}') INTO requested FROM jsonb_array_elements_text(p->'roleIds');
   IF EXISTS(SELECT 1 FROM unnest(requested) AS wanted(role_id) WHERE NOT EXISTS(SELECT 1 FROM public.admin_role r WHERE r.id::text=wanted.role_id)) THEN RAISE EXCEPTION 'Unknown role' USING ERRCODE='22023'; END IF;
   IF NOT is_super AND EXISTS(SELECT 1 FROM public.admin_role r WHERE r.id::text=ANY(requested) AND
    (r.protected OR EXISTS(SELECT 1 FROM public.admin_role_permission rp WHERE rp.role_id=r.id AND NOT(rp.permission_key=ANY(perms))))) THEN RAISE EXCEPTION 'Cannot grant this role' USING ERRCODE='42501'; END IF;
   DELETE FROM public.admin_user_role WHERE user_id=target;
   INSERT INTO public.admin_user_role SELECT target,id FROM public.admin_role WHERE id::text=ANY(requested);
  ELSIF p_operation='user.status' THEN
   IF jsonb_typeof(p->'suspended') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'suspended must be boolean' USING ERRCODE='22023'; END IF;
   UPDATE public.admin_account SET suspended=(p->>'suspended')::boolean WHERE user_id=target;
  END IF;
  n:=0;
  IF p_operation='user.revoke-tokens' OR (p_operation='user.status' AND (p->>'suspended')::boolean) THEN
   IF to_regclass('public.api_token') IS NOT NULL THEN
    UPDATE public.api_token SET revoked_at=now() WHERE user_id::text=target AND revoked_at IS NULL; GET DIAGNOSTICS n=ROW_COUNT;
   END IF;
   IF to_regclass('public.oauth_code') IS NOT NULL THEN UPDATE public.oauth_code SET used_at=now() WHERE user_id::text=target AND used_at IS NULL; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id JOIN public.admin_account a ON a.user_id=ur.user_id WHERE r.key='super_admin' AND public.admin_account_active(ur.user_id)) THEN
   RAISE EXCEPTION 'At least one active super admin must remain' USING ERRCODE='55000';
  END IF;
  UPDATE public.admin_account SET revision=revision+1,updated_at=now() WHERE user_id=target;
  after:=public.admin_user_projection(target);
  PERFORM public.admin_audit_append(p_operation,'user',target,before,after||jsonb_build_object('revokedTokens',n),p->>'reason');
  RETURN jsonb_build_object('user',after,'revokedTokens',n);
 ELSIF p_operation IN ('settings','settings.update') THEN
  SELECT jsonb_build_object('settings',public.admin_public_defaults(),'revision',revision,'updatedAt',updated_at) INTO before FROM public.admin_app_settings WHERE singleton;
  IF p_operation='settings' THEN RETURN before; END IF;
  IF (p->>'expectedRevision')::integer IS DISTINCT FROM (before->>'revision')::integer THEN RAISE EXCEPTION 'Settings changed; refresh and retry' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p->'settings') IS DISTINCT FROM 'object' OR (p->'settings')-ARRAY['skin','topbar']<>'{}'::jsonb
   OR NOT COALESCE(p->'settings'->>'skin' IN ('premium','classic'),false) OR NOT COALESCE(p->'settings'->>'topbar' IN ('cover','flat'),false) THEN RAISE EXCEPTION 'Invalid application defaults' USING ERRCODE='22023'; END IF;
  UPDATE public.admin_app_settings SET skin=p->'settings'->>'skin',topbar=p->'settings'->>'topbar',revision=revision+1,updated_at=now() WHERE singleton;
  SELECT jsonb_build_object('settings',public.admin_public_defaults(),'revision',revision,'updatedAt',updated_at) INTO after FROM public.admin_app_settings WHERE singleton;
  PERFORM public.admin_audit_append(p_operation,'settings','application',before,after);
  RETURN after;
 ELSIF p_operation='audit' THEN
  SELECT count(*),COALESCE(jsonb_agg(v ORDER BY created DESC,id DESC) FILTER(WHERE pos>off AND pos<=off+lim),'[]'::jsonb) INTO n,rows FROM (
   SELECT jsonb_build_object('id',a.id::text,'actorId',a.actor_id,'actorName',u.username,'action',a.action,'targetType',a.target_type,'targetId',a.target_id,'before',a.before_data,'after',a.after_data,'reason',a.reason,'createdAt',a.created_at) v,a.id,a.created_at created,
    row_number() OVER(ORDER BY a.created_at DESC,a.id DESC) pos
   FROM public.admin_audit a LEFT JOIN public.app_user u ON u.id::text=a.actor_id
   WHERE (COALESCE(p->>'actor','')='' OR a.actor_id=p->>'actor')
    AND (COALESCE(p->>'action','')='' OR a.action=p->>'action')
    AND (COALESCE(p->>'target','')='' OR a.target_id=p->>'target')
  ) events;
  RETURN jsonb_build_object('events',rows,'total',n,'limit',lim,'offset',off);
 END IF;
 RAISE EXCEPTION 'Unknown operation' USING ERRCODE='22023';
END $$;

-- Default privileges grant EXECUTE to PUBLIC; remove that implicit API.
REVOKE ALL ON TABLE public.admin_permission,public.admin_role,public.admin_role_permission,public.admin_account,public.admin_user_role,public.admin_state,public.admin_app_settings,public.admin_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.admin_audit_id_seq FROM PUBLIC;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'admin_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.sig);
 END LOOP;
END $$;
CREATE FUNCTION public.admin_user_has_permission(p_user text,p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
 SELECT p_key=ANY(public.admin_permissions(p_user))
$$;
REVOKE ALL ON FUNCTION public.admin_user_has_permission(text,text) FROM PUBLIC;

-- The consent UI uses its existing request connection. These narrow RPCs
-- replace a second trusted pool checkout without exposing bearer-code tables.
CREATE FUNCTION public.admin_connector_client(p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.admin_is_session() OR NOT public.admin_account_active(public.admin_actor_id()) THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('clientId',client_id,'clientName',client_name,'redirectUris',redirect_uris) INTO result FROM public.oauth_client WHERE client_id=p_id;
 RETURN result;
END $$;
CREATE FUNCTION public.admin_connector_issue(p_code text,p_client text,p_redirect text,p_challenge text,p_resource text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=public.admin_actor_id();
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 IF NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF p_code !~ '^dsac_[A-Za-z0-9_-]{43}$' OR p_challenge !~ '^[A-Za-z0-9_-]{43}$' OR length(COALESCE(p_resource,''))>2000 THEN RAISE EXCEPTION 'Invalid authorization request' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.oauth_client WHERE client_id=p_client AND p_redirect=ANY(redirect_uris)) THEN RAISE EXCEPTION 'Redirect does not match registered client' USING ERRCODE='22023'; END IF;
 INSERT INTO public.oauth_code(code,client_id,user_id,redirect_uri,code_challenge,code_challenge_method,resource,expires_at)
 SELECT p_code,p_client,u.id,p_redirect,p_challenge,'S256',p_resource,now()+interval '5 minutes' FROM public.app_user u WHERE u.id::text=actor;
END $$;
REVOKE ALL ON FUNCTION public.admin_connector_client(text),public.admin_connector_issue(text,text,text,text,text) FROM PUBLIC;

-- Every credential INSERT participates in the revocation boundary, including
-- direct PostgREST inserts. The lock is held through the inserting transaction;
-- revoke-all therefore cannot miss an uncommitted token and return success.
CREATE FUNCTION public.admin_guard_token_mint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 IF NOT public.admin_account_active(NEW.user_id::text) THEN
  RAISE EXCEPTION 'This account is suspended or unavailable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admin_guard_token_mint() FROM PUBLIC;
DO $$ BEGIN
 IF to_regclass('public.api_token') IS NOT NULL THEN
  CREATE TRIGGER admin_token_mint_boundary BEFORE INSERT ON public.api_token
   FOR EACH ROW EXECUTE FUNCTION public.admin_guard_token_mint();
 END IF;
END $$;
