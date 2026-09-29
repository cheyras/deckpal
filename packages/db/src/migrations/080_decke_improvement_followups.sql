-- Follow-ups from the pre-merge review of the Deck-E shared-chats work (078/079
-- are applied and immutable).
--
-- 1. decke_improvement_auto_share runs on every chat leg for every reader, and
--    079 locked the conversation FOR UPDATE before even reading the Always-share
--    setting. FOR UPDATE conflicts with the key-share lock a History insert
--    takes on its parent conversation, and the chat path's observational
--    deadline gives up waiting without cancelling, so a slow or frozen
--    invocation could stall that reader's History saves. The setting and any
--    existing consent are now read first, without locks; only a reader who
--    actually has Always-share on, for an undecided conversation, takes a lock,
--    and it is FOR NO KEY UPDATE, which History inserts do not wait on. A
--    conversation whose History row does not exist yet is skipped rather than
--    raised, so the first leg of every new chat no longer logs an error.
--
-- 2. decke_improvement_identity_terms used auth.uid() and read auth.users
--    unguarded, so on self-host (no Supabase auth schema) every feedback save,
--    share and telemetry batch failed. It now takes the verified subject from
--    public.admin_actor_id(), as the corpus writers do, and reads the email only
--    where auth.users exists, as 078's redaction_terms does.

CREATE OR REPLACE FUNCTION public.decke_improvement_auto_share(p_user text,p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner bytea; conversation uuid; share_all boolean;
BEGIN
 owner=public.decke_improvement_require_writer(p_user);
 IF p_conversation IS NULL THEN RAISE EXCEPTION 'Conversation is required' USING ERRCODE='22023'; END IF;
 SELECT decke_share_all INTO share_all FROM public.user_settings WHERE user_id::text=p_user;
 IF NOT coalesce(share_all,false) THEN
  RETURN jsonb_build_object('status','skipped','reason','off');
 END IF;
 conversation=public.decke_improvement_uuid('conversation:',p_conversation);
 IF EXISTS(SELECT 1 FROM public.decke_improvement_consent WHERE id=conversation AND owner_key=owner) THEN
  RETURN jsonb_build_object('status','skipped','reason','decided');
 END IF;
 PERFORM 1 FROM public.decke_conversation
  WHERE id=p_conversation AND user_id::text=p_user FOR NO KEY UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('status','skipped','reason','pending');
 END IF;
 -- Re-read under the lock: the reader may have turned the setting off, or
 -- answered this conversation, since the unlocked checks above.
 SELECT decke_share_all INTO share_all FROM public.user_settings WHERE user_id::text=p_user FOR SHARE;
 IF NOT coalesce(share_all,false) THEN
  RETURN jsonb_build_object('status','skipped','reason','off');
 END IF;
 IF EXISTS(SELECT 1 FROM public.decke_improvement_consent WHERE id=conversation AND owner_key=owner) THEN
  RETURN jsonb_build_object('status','skipped','reason','decided');
 END IF;
 RETURN public.decke_improvement_answer(p_user,p_conversation,true,'always');
END $$;

CREATE OR REPLACE FUNCTION public.decke_improvement_identity_terms(p_user text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text; username text; display_name text; email text;
BEGIN
 actor=public.admin_actor_id();
 IF actor IS NULL OR p_user IS NULL OR actor<>p_user THEN
  RAISE EXCEPTION 'Identity terms are available only to their subject' USING ERRCODE='42501';
 END IF;
 SELECT u.username,p.display_name INTO username,display_name
 FROM public.app_user u
 LEFT JOIN public.user_profile p ON p.user_id=u.id
 WHERE u.id::text=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account is unavailable' USING ERRCODE='P0002'; END IF;
 IF to_regclass('auth.users') IS NOT NULL THEN
  EXECUTE 'SELECT email FROM auth.users WHERE id::text=$1' INTO email USING p_user;
 END IF;
 RETURN jsonb_build_object('username',username,'displayName',display_name,'email',email);
END $$;
