-- Single canonical role. Existing signatures and deprecated read projections survive.
-- Apply with the normal transactional migration runner; unresolved legacy mappings fail atomically.
SELECT pg_advisory_xact_lock(741290064);
CREATE TABLE public.admin_role_migration_snapshot(
 user_id text PRIMARY KEY, prior_roles jsonb NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admin_role_migration_snapshot
 SELECT u.id::text,coalesce(jsonb_agg(jsonb_build_object('id',r.id,'key',r.key,'name',r.name,'permissions',
 (SELECT coalesce(jsonb_agg(permission_key),'[]') FROM public.admin_role_permission WHERE role_id=r.id))) FILTER(WHERE r.id IS NOT NULL),'[]'),now()
 FROM public.app_user u LEFT JOIN public.admin_user_role ur ON ur.user_id=u.id::text LEFT JOIN public.admin_role r ON r.id=ur.role_id GROUP BY u.id;
ALTER TABLE public.admin_role ADD COLUMN tier integer;
ALTER TABLE public.admin_role ADD COLUMN system boolean NOT NULL DEFAULT false;
INSERT INTO public.admin_permission(key,permission_group,description) VALUES
 ('devtools.access','Development','Open development tools without administration.'),
 ('roles.assign','Roles','Assign a single role within structural authority.')
 ON CONFLICT DO NOTHING;
UPDATE public.admin_role SET tier=50,system=true WHERE key='super_admin';
INSERT INTO public.admin_role(id,key,name,description,protected,tier,system) VALUES
 ('68000000-0000-4000-8000-000000000010','user','User','Standard product access; beta features require opt-in.',true,10,true),
 ('68000000-0000-4000-8000-000000000020','superuser','Superuser','May opt into experimental features.',true,20,true),
 ('68000000-0000-4000-8000-000000000030','contributor','Contributor','Development tools; no account or financial administration.',true,30,true),
 ('68000000-0000-4000-8000-000000000040','admin','Admin','Administration; may assign User and Superuser.',true,40,true),
 ('68000000-0000-4000-8000-000000000060','owner','Owner','Protected ownership and reserved financial authority.',true,60,true);
-- Legacy labelers retain ONLY their existing developer capability, not every tool.
UPDATE public.admin_role SET tier=30 WHERE key='legacy_labeler';
UPDATE public.admin_role SET tier=10 WHERE key='legacy_decke';
DELETE FROM public.admin_role_permission WHERE role_id IN(SELECT id FROM public.admin_role WHERE key IN('legacy_decke','legacy_labeler')) AND permission_key IN('admin.access','decke.use');
INSERT INTO public.admin_role_permission SELECT id,'devtools.access' FROM public.admin_role WHERE key='legacy_labeler' ON CONFLICT DO NOTHING;

-- A trusted operator can supply reviewed compact JSON through the driver startup
-- option PGOPTIONS=-c deckpal.role_migration_map=<json>, retained across runner transactions.
-- SET LOCAL also works when the caller owns the same migration transaction. No web RPC writes this mapping; no name/rank guessing.
-- {"roles":{"existing-role-uuid":40},"users":{"account-id":"destination-role-uuid"}}
DO $preflight$
DECLARE mapping jsonb:=coalesce(nullif(current_setting('deckpal.role_migration_map',true),''),'{}')::jsonb; missing text; owner_id text;
BEGIN
 IF jsonb_typeof(mapping)<>'object' THEN RAISE EXCEPTION 'Role migration mapping must be an object' USING ERRCODE='22023'; END IF;
 UPDATE public.admin_role r SET tier=(mapping->'roles'->>r.id::text)::integer WHERE tier IS NULL AND mapping->'roles' ? r.id::text;
 SELECT string_agg(id::text||' ('||name||')',', ') INTO missing FROM public.admin_role WHERE tier IS NULL OR (NOT system AND tier NOT IN(10,20,30,40));
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Single-role migration requires reviewed role tier mapping: %',missing USING ERRCODE='55000'; END IF;
 SELECT bootstrap_owner INTO owner_id FROM public.admin_state WHERE bootstrapped_at IS NOT NULL;
 IF EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL) AND
 (owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_user WHERE id::text=owner_id)) THEN
  RAISE EXCEPTION 'Recorded bootstrap owner must exist before Owner migration' USING ERRCODE='55000';
 END IF;
 -- A superadmin membership has an explicit mapping. Legacy Deck-E alone adds no
 -- authority; combinations with one other role preserve that single role.
 SELECT string_agg(user_id,', ') INTO missing FROM (
  SELECT ur.user_id FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id
  WHERE ur.user_id IS DISTINCT FROM owner_id AND NOT coalesce(mapping->'users' ? ur.user_id,false)
  GROUP BY ur.user_id HAVING count(*) FILTER(WHERE r.key NOT IN('legacy_decke'))>1
   AND count(*) FILTER(WHERE r.key='super_admin')=0
 ) unresolved;
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Single-role migration requires reviewed account mapping: %',missing USING ERRCODE='55000'; END IF;
END $preflight$;
ALTER TABLE public.admin_role ALTER COLUMN tier SET NOT NULL;
ALTER TABLE public.admin_role ADD CONSTRAINT admin_role_tier_check CHECK((system AND tier IN(10,20,30,40,50,60)) OR (NOT system AND tier IN(10,20,30,40)));
ALTER TABLE public.admin_account ADD COLUMN role_id uuid NOT NULL DEFAULT '68000000-0000-4000-8000-000000000010' REFERENCES public.admin_role(id);
INSERT INTO public.admin_account(user_id) SELECT id::text FROM public.app_user ON CONFLICT DO NOTHING;
UPDATE public.admin_account a SET role_id=choice.role_id FROM (
 SELECT DISTINCT ON(ur.user_id) ur.user_id,ur.role_id FROM public.admin_user_role ur JOIN public.admin_role r ON r.id=ur.role_id
 WHERE r.key<>'legacy_decke' ORDER BY ur.user_id,(r.key='super_admin') DESC,r.id
) choice WHERE choice.user_id=a.user_id;
DO $mapping$
DECLARE mapping jsonb:=coalesce(nullif(current_setting('deckpal.role_migration_map',true),''),'{}')::jsonb; item record;
BEGIN
 FOR item IN SELECT * FROM jsonb_each_text(coalesce(mapping->'users','{}')) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.admin_account WHERE user_id=item.key) OR NOT EXISTS(SELECT 1 FROM public.admin_role WHERE id=item.value::uuid AND tier<=50) THEN
   RAISE EXCEPTION 'Invalid reviewed role mapping for %',item.key USING ERRCODE='22023';
  END IF;
  UPDATE public.admin_account SET role_id=item.value::uuid WHERE user_id=item.key;
 END LOOP;
 UPDATE public.admin_account SET role_id='68000000-0000-4000-8000-000000000060'
 WHERE user_id=(SELECT bootstrap_owner FROM public.admin_state WHERE bootstrapped_at IS NOT NULL);
END $mapping$;
-- Preserve the original junction as private audit evidence, never an authority source.
ALTER TABLE public.admin_user_role RENAME TO admin_user_role_archive;
CREATE VIEW public.admin_user_role AS SELECT user_id,role_id FROM public.admin_account;
ALTER TABLE public.admin_role_migration_snapshot ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.admin_sync_new_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN INSERT INTO public.admin_account(user_id) VALUES(NEW.id::text) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
CREATE TRIGGER admin_default_account_role AFTER INSERT ON public.app_user FOR EACH ROW EXECUTE FUNCTION public.admin_sync_new_account();
CREATE FUNCTION public.admin_role_tier(p_user text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT r.tier FROM public.admin_account a JOIN public.admin_role r ON r.id=a.role_id WHERE a.user_id=p_user),0)
$$;
CREATE FUNCTION public.admin_is_owner(p_user text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.admin_account_active(p_user) AND EXISTS(SELECT 1 FROM public.admin_account a JOIN public.admin_role r ON r.id=a.role_id WHERE a.user_id=p_user AND r.id='68000000-0000-4000-8000-000000000060' AND r.key='owner' AND r.system AND r.tier=60)
$$;
CREATE OR REPLACE FUNCTION public.admin_is_super(p_user_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.admin_account_active(p_user_id) AND EXISTS(SELECT 1 FROM public.admin_account a JOIN public.admin_role r ON r.id=a.role_id WHERE a.user_id=p_user_id AND r.system AND r.key IN('super_admin','owner'))
$$;
CREATE FUNCTION public.admin_permission_ceiling(p_tier integer) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(array_agg(key ORDER BY key),'{}') FROM public.admin_permission WHERE
 key NOT IN('roles.manage','roles.assign','scanner.use','decke.use')
 AND (p_tier>=40 OR (p_tier>=30 AND key IN('devtools.access','design.view','diagnostics.view','scanner.label')))
$$;
-- Remove retired product flags from definitions; 069 resolves their lifecycle centrally.
DELETE FROM public.admin_role_permission WHERE permission_key IN('scanner.use','decke.use','roles.manage','roles.assign');
INSERT INTO public.admin_role_permission SELECT r.id,p FROM public.admin_role r CROSS JOIN LATERAL unnest(public.admin_permission_ceiling(r.tier)) p
 WHERE r.key IN('contributor','admin','super_admin','owner') ON CONFLICT DO NOTHING;
DO $ceilings$ DECLARE bad text; BEGIN
 SELECT string_agg(r.name||':'||rp.permission_key,', ') INTO bad FROM public.admin_role_permission rp JOIN public.admin_role r ON r.id=rp.role_id
 WHERE NOT(rp.permission_key=ANY(public.admin_permission_ceiling(r.tier)));
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'Reviewed role definitions exceed new tier ceilings: %',bad USING ERRCODE='55000'; END IF;
END $ceilings$;
CREATE FUNCTION public.admin_raw_permissions(p_user text) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(array_agg(DISTINCT permission ORDER BY permission),'{}') FROM (
 SELECT rp.permission_key permission FROM public.admin_account a JOIN public.admin_role r ON r.id=a.role_id JOIN public.admin_role_permission rp ON rp.role_id=r.id
 WHERE a.user_id=p_user AND rp.permission_key=ANY(public.admin_permission_ceiling(r.tier))
 UNION SELECT 'roles.assign' WHERE EXISTS(SELECT 1 FROM public.admin_account a JOIN public.admin_role r ON r.id=a.role_id WHERE a.user_id=p_user AND r.system AND r.key IN('admin','super_admin','owner'))
 UNION SELECT 'roles.manage' WHERE public.admin_is_super(p_user)
 UNION SELECT 'admin.access' WHERE public.admin_is_super(p_user)
 ) p WHERE public.admin_account_active(p_user)
$$;
CREATE OR REPLACE FUNCTION public.admin_permissions(p_user_id text) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.admin_raw_permissions(p_user_id)
$$;
CREATE FUNCTION public.admin_require_owner() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=public.admin_actor_id(); BEGIN
 PERFORM pg_advisory_xact_lock(741290064);
 IF actor IS NULL OR NOT public.admin_is_session() OR NOT public.admin_is_owner(actor) THEN RAISE EXCEPTION 'Owner authority is required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION public.admin_role_summary(p_role uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'key',key,'name',name,'tier',tier) FROM public.admin_role WHERE id=p_role
$$;
CREATE FUNCTION public.admin_assignable_roles(p_actor text,p_target text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_agg(r.id ORDER BY r.tier,r.name),'[]') FROM public.admin_role r WHERE r.tier<=50 AND r.key<>'legacy_decke'
 AND public.admin_account_active(p_actor) AND 'admin.access'=ANY(public.admin_permissions(p_actor)) AND
 CASE WHEN public.admin_is_super(p_actor) THEN p_target IS NULL OR public.admin_role_tier(p_target)<60 OR public.admin_is_owner(p_actor)
 ELSE EXISTS(SELECT 1 FROM public.admin_account a JOIN public.admin_role ar ON ar.id=a.role_id WHERE a.user_id=p_actor AND ar.system AND ar.key='admin')
  AND r.system AND r.key IN('user','superuser') AND (p_target IS NULL OR EXISTS(SELECT 1 FROM public.admin_account ta JOIN public.admin_role tr ON tr.id=ta.role_id WHERE ta.user_id=p_target AND tr.system AND tr.key IN('user','superuser')))
 END
$$;
CREATE FUNCTION public.admin_target_actions(p_actor text,p_target text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ids jsonb:=public.admin_assignable_roles(p_actor,p_target); allowed boolean; reason text; BEGIN
 allowed:=public.admin_account_active(p_actor) AND 'users.manage'=ANY(public.admin_permissions(p_actor))
 AND (CASE WHEN public.admin_role_tier(p_target)=60 THEN public.admin_is_owner(p_actor)
 WHEN public.admin_is_super(p_actor) THEN true ELSE public.admin_role_tier(p_target)<=20 END);
 reason:=CASE WHEN public.admin_role_tier(p_target)=60 AND NOT public.admin_is_owner(p_actor) THEN 'owner_protected' ELSE 'target_authority' END;
 RETURN jsonb_build_object('canAssignRole',jsonb_array_length(ids)>0,'assignableRoleIds',ids,'canChangeStatus',allowed,'canRevokeTokens',allowed,
 'denialReasons',jsonb_build_object('assignRole',CASE WHEN jsonb_array_length(ids)=0 THEN reason END,'changeStatus',CASE WHEN NOT allowed THEN reason END,'revokeTokens',CASE WHEN NOT allowed THEN reason END));
END $$;
CREATE FUNCTION public.admin_actor_capabilities(p_user text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('canEditRoles',public.admin_is_super(p_user),'canAssignRoles',jsonb_array_length(public.admin_assignable_roles(p_user))>0,
 'canManageUserOverrides',public.admin_is_owner(p_user),'canReadSharedConversations',public.admin_account_active(p_user) AND public.admin_role_tier(p_user)>=40 AND public.admin_user_has_permission(p_user,'admin.access'),
 'assignableRoleIds',public.admin_assignable_roles(p_user))
$$;
CREATE OR REPLACE FUNCTION public.admin_access(p_user text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.admin_account; r public.admin_role; legacy jsonb; BEGIN
 IF current_setting('role') NOT IN('none','service_role') AND p_user IS DISTINCT FROM public.admin_actor_id() THEN RAISE EXCEPTION 'Own access only' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.admin_account WHERE user_id=p_user;
 SELECT * INTO r FROM public.admin_role WHERE id=a.role_id;
 legacy:=public.admin_role_summary(CASE WHEN r.key='owner' THEN (SELECT id FROM public.admin_role WHERE key='super_admin') ELSE r.id END);
 RETURN jsonb_build_object('ready',EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL),'suspended',NOT public.admin_account_active(p_user),
 'role',public.admin_role_summary(r.id),'isOwner',public.admin_is_owner(p_user),'permissions',public.admin_permissions(p_user),
 'roles',CASE WHEN legacy IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(legacy) END,'revision',coalesce(a.revision,0)::text||':'||coalesce(r.revision,0)::text,
 'actorCapabilities',public.admin_actor_capabilities(p_user),'features','[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.admin_user_projection(p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE out jsonb; mail text; signed timestamptz; BEGIN
 SELECT jsonb_build_object('id',u.id::text,'username',u.username,'createdAt',u.created_at,'suspended',a.suspended,'revision',a.revision,
 'role',public.admin_role_summary(a.role_id),'roles',jsonb_build_array(public.admin_role_summary(CASE WHEN r.key='owner' THEN (SELECT id FROM public.admin_role WHERE key='super_admin') ELSE r.id END)),
 'actions',public.admin_target_actions(public.admin_actor_id(),u.id::text))
 INTO out FROM public.app_user u JOIN public.admin_account a ON a.user_id=u.id::text JOIN public.admin_role r ON r.id=a.role_id WHERE u.id::text=p_id;
 IF out IS NULL THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 IF to_regclass('auth.users') IS NOT NULL THEN EXECUTE 'SELECT email,last_sign_in_at FROM auth.users WHERE id::text=$1' INTO mail,signed USING p_id; END IF;
 RETURN out||jsonb_build_object('email',mail,'lastSignInAt',signed);
END $$;
CREATE OR REPLACE FUNCTION public.admin_role_projection(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.admin_role_summary(r.id)||jsonb_build_object('description',r.description,'protected',r.protected,'protectedIdentity',r.system,'system',r.system,'revision',r.revision,
 'permissions',coalesce((SELECT jsonb_agg(permission_key ORDER BY permission_key) FROM public.admin_role_permission WHERE role_id=r.id),'[]'),
 'memberCount',(SELECT count(*) FROM public.admin_account WHERE role_id=r.id),'canEdit',public.admin_is_super(public.admin_actor_id()) AND r.key<>'owner',
 'canDelete',public.admin_is_super(public.admin_actor_id()) AND NOT r.system,
 'editablePermissions',public.admin_permission_ceiling(r.tier),
 'denialReason',CASE WHEN r.key='owner' THEN 'owner_protected' WHEN NOT public.admin_is_super(public.admin_actor_id()) THEN 'role_definition_authority' END)
 FROM public.admin_role r WHERE r.id=p_id
$$;
CREATE FUNCTION public.admin_guard_role_definition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.system THEN RAISE EXCEPTION 'Built-in identity cannot be deleted' USING ERRCODE='42501'; END IF; RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.key<>OLD.key OR NEW.tier<>OLD.tier OR NEW.system<>OLD.system OR (OLD.system AND NOT NEW.protected)) THEN RAISE EXCEPTION 'Role identity and tier are immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND (NEW.system OR NEW.tier>40 OR NEW.key IN('owner','super_admin','admin','contributor','superuser','user')) THEN RAISE EXCEPTION 'Reserved role identity' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_role_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.admin_role FOR EACH ROW EXECUTE FUNCTION public.admin_guard_role_definition();
CREATE FUNCTION public.admin_guard_role_permission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(NEW.permission_key=ANY(public.admin_permission_ceiling((SELECT tier FROM public.admin_role WHERE id=NEW.role_id)))) THEN RAISE EXCEPTION 'Permission exceeds role tier or is reserved' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_role_permission_ceiling BEFORE INSERT OR UPDATE ON public.admin_role_permission FOR EACH ROW EXECUTE FUNCTION public.admin_guard_role_permission();

ALTER FUNCTION public.admin_api(text,jsonb) RENAME TO admin_api_legacy;
CREATE FUNCTION public.admin_api(p_operation text,p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text; target text:=p->>'id'; before jsonb; after jsonb; requested text[]; rid uuid; r public.admin_role; tier_value integer; ids jsonb; actions jsonb; revoked integer:=0;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Expected object' USING ERRCODE='22023'; END IF;
 IF p_operation IN('role.create','role.update','role.delete','user.role','user.roles','user.status','user.revoke-tokens') THEN PERFORM pg_advisory_xact_lock(741290064); END IF;
 IF p_operation='roles' THEN
  actor:=public.admin_require_permission('roles.read');
  RETURN jsonb_build_object('roles',(SELECT coalesce(jsonb_agg(public.admin_role_projection(id) ORDER BY tier,name),'[]') FROM public.admin_role WHERE key<>'legacy_decke'),
  'permissionCeilings',jsonb_build_object('10',public.admin_permission_ceiling(10),'20',public.admin_permission_ceiling(20),'30',public.admin_permission_ceiling(30),'40',public.admin_permission_ceiling(40)),
  'permissions',(SELECT jsonb_agg(jsonb_build_object('key',key,'group',permission_group,'description',description) ORDER BY permission_group,key) FROM public.admin_permission WHERE key NOT IN('scanner.use','decke.use','roles.manage','roles.assign')));
 ELSIF p_operation IN('role.create','role.update','role.delete') THEN
  actor:=public.admin_require_permission('roles.manage');
  IF NOT public.admin_is_super(actor) THEN RAISE EXCEPTION 'Role definition authority required' USING ERRCODE='42501'; END IF;
  IF p_operation<>'role.create' THEN
   rid:=target::uuid; SELECT * INTO r FROM public.admin_role WHERE id=rid; before:=public.admin_role_projection(rid);
   IF NOT FOUND THEN RAISE EXCEPTION 'Role not found' USING ERRCODE='P0002'; END IF;
   IF r.key IN('owner','legacy_decke') OR (p_operation='role.delete' AND r.system) THEN RAISE EXCEPTION 'Protected role identity' USING ERRCODE='42501'; END IF;
   IF (p->>'expectedRevision')::integer IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'Role changed; refresh' USING ERRCODE='40001'; END IF;
   IF p ?| ARRAY['tier','key','system','protected','protectedIdentity','idOverride'] THEN RAISE EXCEPTION 'Role identity is immutable' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_operation='role.delete' THEN
   IF EXISTS(SELECT 1 FROM public.admin_account WHERE role_id=rid) THEN RAISE EXCEPTION 'Role has members' USING ERRCODE='55000'; END IF;
   DELETE FROM public.admin_role WHERE id=rid; after:=NULL;
  ELSE
   tier_value:=CASE WHEN p_operation='role.create' THEN coalesce((p->>'tier')::integer,40) ELSE r.tier END;
   IF tier_value NOT IN(10,20,30,40,50) OR (p_operation='role.create' AND tier_value>40) THEN RAISE EXCEPTION 'Invalid custom role tier' USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(p->'permissions') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'permissions')>50 OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR length(btrim(p->>'name')) NOT BETWEEN 1 AND 80 OR jsonb_typeof(p->'description') IS DISTINCT FROM 'string' OR length(p->>'description')>500 THEN RAISE EXCEPTION 'Invalid role fields' USING ERRCODE='22023'; END IF;
   SELECT coalesce(array_agg(DISTINCT value),'{}') INTO requested FROM jsonb_array_elements_text(p->'permissions');
   IF NOT(requested<@public.admin_permission_ceiling(tier_value)) THEN RAISE EXCEPTION 'Permission exceeds role tier or is reserved' USING ERRCODE='42501'; END IF;
   IF p_operation='role.create' THEN INSERT INTO public.admin_role(key,name,description,tier) VALUES('custom_'||gen_random_uuid(),btrim(p->>'name'),p->>'description',tier_value) RETURNING id INTO rid;
   ELSE UPDATE public.admin_role SET name=btrim(p->>'name'),description=p->>'description',revision=revision+1 WHERE id=rid; END IF;
   DELETE FROM public.admin_role_permission WHERE role_id=rid;
   INSERT INTO public.admin_role_permission SELECT rid,unnest(requested);
   after:=public.admin_role_projection(rid);
  END IF;
  PERFORM public.admin_audit_append(p_operation,'role',rid::text,before,after,p->>'reason');
  RETURN jsonb_build_object('role',after);
 ELSIF p_operation IN('user.role','user.roles') THEN
  actor:=public.admin_require_permission('roles.assign'); before:=public.admin_user_projection(target);
  IF p_operation='user.roles' THEN
   IF jsonb_typeof(p->'roleIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'roleIds')<>1 THEN RAISE EXCEPTION 'Exactly one role is required' USING ERRCODE='22023'; END IF;
   rid:=(p->'roleIds'->>0)::uuid;
  ELSE rid:=(p->>'roleId')::uuid; END IF;
  SELECT * INTO r FROM public.admin_role WHERE id=rid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Role not found' USING ERRCODE='P0002'; END IF;
  ids:=public.admin_assignable_roles(actor,target);
  IF NOT(ids @> jsonb_build_array(rid)) THEN RAISE EXCEPTION 'Cannot modify target or assign this role' USING ERRCODE='42501'; END IF;
  IF (p->>'expectedRevision')::integer IS DISTINCT FROM (before->>'revision')::integer OR (p_operation='user.role' AND (p->>'expectedRoleRevision')::integer IS DISTINCT FROM r.revision) THEN RAISE EXCEPTION 'Account or role changed; refresh' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
  IF public.admin_role_tier(target)=60 AND NOT EXISTS(SELECT 1 FROM public.admin_account WHERE user_id<>target AND public.admin_is_owner(user_id)) THEN RAISE EXCEPTION 'At least one active Owner must remain' USING ERRCODE='55000'; END IF;
  UPDATE public.admin_account SET role_id=rid,revision=revision+1,updated_at=now() WHERE user_id=target;
  after:=public.admin_user_projection(target);
  PERFORM public.admin_audit_append('user.role','user',target,before,after,p->>'reason');
  RETURN jsonb_build_object('user',after,'actorCapabilities',public.admin_actor_capabilities(actor));
 ELSIF p_operation IN('user.status','user.revoke-tokens') THEN
  actor:=public.admin_require_permission('users.manage'); before:=public.admin_user_projection(target); actions:=public.admin_target_actions(actor,target);
  IF NOT(actions->>CASE WHEN p_operation='user.status' THEN 'canChangeStatus' ELSE 'canRevokeTokens' END)::boolean THEN RAISE EXCEPTION 'Target authority is protected' USING ERRCODE='42501'; END IF;
  IF p_operation='user.status' AND (p->>'suspended')::boolean AND public.admin_role_tier(target)=60 AND NOT EXISTS(SELECT 1 FROM public.admin_account WHERE user_id<>target AND public.admin_is_owner(user_id)) THEN RAISE EXCEPTION 'At least one active Owner must remain' USING ERRCODE='55000'; END IF;
  IF jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
  IF p_operation='user.status' THEN
   IF jsonb_typeof(p->'suspended') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'suspended must be boolean' USING ERRCODE='22023'; END IF;
   IF (p->>'expectedRevision')::integer IS DISTINCT FROM (before->>'revision')::integer THEN RAISE EXCEPTION 'Account changed; refresh' USING ERRCODE='40001'; END IF;
   UPDATE public.admin_account SET suspended=(p->>'suspended')::boolean WHERE user_id=target;
  END IF;
  IF p_operation='user.revoke-tokens' OR (p_operation='user.status' AND (p->>'suspended')::boolean) THEN
   IF to_regclass('public.api_token') IS NOT NULL THEN UPDATE public.api_token SET revoked_at=now() WHERE user_id::text=target AND revoked_at IS NULL; GET DIAGNOSTICS revoked=ROW_COUNT; END IF;
   IF to_regclass('public.oauth_code') IS NOT NULL THEN UPDATE public.oauth_code SET used_at=now() WHERE user_id::text=target AND used_at IS NULL; END IF;
  END IF;
  UPDATE public.admin_account SET revision=revision+1,updated_at=now() WHERE user_id=target;
  after:=public.admin_user_projection(target);
  PERFORM public.admin_audit_append(p_operation,'user',target,before,after||jsonb_build_object('revokedTokens',revoked),p->>'reason');
  RETURN jsonb_build_object('user',after,'revokedTokens',revoked);
 END IF;
 RETURN public.admin_api_legacy(p_operation,p);
END $$;
-- New bootstrap is still trusted, one-time and signature-compatible. Old allowlists
-- cannot silently promote accounts into new experiment/devtool tiers.
CREATE OR REPLACE FUNCTION public.admin_bootstrap(p_owner text,p_decke text[],p_labelers text[]) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('role') NOT IN('none','service_role') THEN RAISE EXCEPTION 'Trusted bootstrap only' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(741290064);
 IF EXISTS(SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL) THEN RETURN true; END IF;
 IF p_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_user WHERE id::text=p_owner) THEN RETURN false; END IF;
 INSERT INTO public.admin_account(user_id) SELECT id::text FROM public.app_user ON CONFLICT DO NOTHING;
 UPDATE public.admin_account SET role_id='68000000-0000-4000-8000-000000000060' WHERE user_id=p_owner;
 UPDATE public.admin_state SET bootstrap_owner=p_owner,bootstrapped_at=now() WHERE singleton;
 PERFORM public.admin_audit_append('bootstrap','administration',NULL,NULL,jsonb_build_object('owner',p_owner),'Trusted Owner initialization; legacy lists require explicit reviewed migration');
 RETURN true;
END $$;
INSERT INTO public.admin_audit(action,target_type,after_data,reason) VALUES('roles.migrate','administration',jsonb_build_object('accounts',(SELECT count(*) FROM public.admin_account)),'Canonical single roles; prior assignments retained privately');

DO $acl$
DECLARE principal text; sig text; obj text; BEGIN
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
  IF principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal) THEN CONTINUE; END IF;
  FOREACH obj IN ARRAY ARRAY['admin_user_role','admin_user_role_archive','admin_role_migration_snapshot'] LOOP EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s',obj,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END); END LOOP;
  FOREACH sig IN ARRAY ARRAY['admin_api_legacy(text,jsonb)','admin_api(text,jsonb)','admin_sync_new_account()','admin_role_tier(text)','admin_is_owner(text)','admin_permission_ceiling(integer)','admin_raw_permissions(text)','admin_require_owner()','admin_role_summary(uuid)','admin_assignable_roles(text,text)','admin_target_actions(text,text)','admin_actor_capabilities(text)','admin_guard_role_definition()','admin_guard_role_permission()'] LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %s',sig,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END); END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN GRANT EXECUTE ON FUNCTION public.admin_api(text,jsonb) TO authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION public.admin_is_owner(text),public.admin_role_tier(text) TO service_role; END IF;
END $acl$;
