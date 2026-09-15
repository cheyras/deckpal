-- @supabase-only
-- Offline migration for the explicit application-owned account tables below.
-- No deployment, auth configuration or PostgreSQL role creation is performed.
DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['admin_permission','admin_role','admin_role_permission','admin_account','admin_user_role','admin_state','admin_app_settings','admin_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon,authenticated',t);
 END LOOP;
 REVOKE ALL ON SEQUENCE public.admin_audit_id_seq FROM anon,authenticated;
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'admin_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon,authenticated',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_actor_id(),public.admin_access(text),public.admin_api(text,jsonb),public.admin_public_defaults() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_public_defaults() TO anon;
GRANT EXECUTE ON FUNCTION public.admin_bootstrap(text,text[],text[]),public.admin_access(text),public.admin_account_active(text),public.admin_permissions(text),public.admin_user_has_permission(text,text) TO service_role;

CREATE FUNCTION public.admin_current_account_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
 SELECT public.admin_actor_id() IS NULL OR public.admin_account_active(public.admin_actor_id())
$$;
REVOKE ALL ON FUNCTION public.admin_current_account_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_current_account_active() TO anon,authenticated;

-- Existing permissive tenant checks stay in place. This additional restrictive
-- predicate removes a suspended caller's private data access; anonymous public
-- profile/catalog reads retain their existing policies.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY[
  'app_user','user_settings','user_profile','user_showcase','collection_item','collection_event',
  'graded_card','card_note','user_set_progress','collection_value_point','user_dex_state',
  'card_list','list_item','binder_placement','deck','deck_card','deck_version','battle_log',
  'bug_report','api_token','mutation_batch','mutation_event','decke_usage',
  'decke_conversation','decke_turn','decke_credit_balance','decke_credit_event','scan_exemplar','scan_exemplar_frame',
  'billing_account','billing_event','billing_ab_event'
 ] LOOP
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) THEN
   EXECUTE format('CREATE POLICY admin_active_account ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.admin_current_account_active()) WITH CHECK (public.admin_current_account_active())',t);
  END IF;
 END LOOP;
END $$;

-- The named legacy billing RPCs write these three tables using SECURITY
-- DEFINER, so RLS alone cannot stop a suspended account invoking those RPCs.
-- This narrow write guard covers that escape hatch without altering catalog,
-- collection or importer triggers.
CREATE FUNCTION public.admin_guard_billing_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $$
BEGIN
 IF public.admin_actor_id() IS NOT NULL AND NOT public.admin_account_active(public.admin_actor_id()) THEN
  RAISE EXCEPTION 'This account is suspended' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admin_guard_billing_write() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_account','billing_event','billing_ab_event'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('CREATE TRIGGER admin_active_billing_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.admin_guard_billing_write()',t);
  END IF;
 END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_connector_client(text),public.admin_connector_issue(text,text,text,text,text) TO authenticated;
