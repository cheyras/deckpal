-- 072 · What a user can reach directly over PostgREST (security audit SEC-01, SEC-02, SEC-10).
--
-- Supabase serves the `public` schema at /rest/v1 to anyone holding the anon key,
-- and the anon key ships in the SPA by design. So every object here answers two
-- questions, not one: what does the API do with it, and what can a stranger (or
-- another signed-in user) do with it directly? Three objects answered the second
-- question badly. Each section below closes one.
--
-- DELIBERATELY NOT `-- @supabase-only`. The runner skips those files when
-- SUPABASE_MODE is unset and the CLI reports them as SKIPPED, which is easy to
-- read past on a production run. Everything here is either plain Postgres or
-- wrapped in a `pg_roles` guard (the shape 064/068/069 use), so the file applies
-- on every deployment and cannot be passed over.
--
-- Depends on: 004, 009, 011, 015, 019, 020, 021, 026, 027, 029, 068.

-- ══════════════════════════════════════════════════════════════════════════════
-- 0. Preflight: refuse, readably, if the new invariants are already broken
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Sections 2 and 3 add constraints that validate existing rows. A violation
-- would abort this whole file with a bare constraint error. Worse, a violation
-- can only come from someone having used one of these holes, so it is evidence
-- to keep, not a row to clean up silently. Say what was found and stop.
DO $preflight$
DECLARE shared_avatars bigint; foreign_children bigint;
BEGIN
 SELECT count(*) INTO shared_avatars FROM (
  SELECT avatar_path FROM public.user_profile
   WHERE avatar_path IS NOT NULL GROUP BY avatar_path HAVING count(*) > 1) s;
 SELECT (SELECT count(*) FROM public.deck_card c JOIN public.deck d ON d.id = c.deck_id WHERE c.user_id <> d.user_id)
      + (SELECT count(*) FROM public.deck_version c JOIN public.deck d ON d.id = c.deck_id WHERE c.user_id <> d.user_id)
      + (SELECT count(*) FROM public.battle_log c JOIN public.deck d ON d.id = c.deck_id WHERE c.user_id <> d.user_id)
      + (SELECT count(*) FROM public.binder_placement b JOIN public.list_item i ON i.id = b.list_item_id WHERE b.user_id <> i.user_id)
   INTO foreign_children;
 IF shared_avatars > 0 OR foreign_children > 0 THEN
  RAISE EXCEPTION '072 stopped: % avatar key(s) held by more than one profile, % deck/binder row(s) owned by someone other than their parent''s owner',
   shared_avatars, foreign_children
   USING ERRCODE = '23000',
         HINT = 'Nothing was changed. These rows are what SEC-02/SEC-10 allow an attacker to create: keep them as evidence and resolve them by hand before re-running.';
 END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Views run with the caller's rights (SEC-01)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- A Postgres view runs with its OWNER's privileges unless it says otherwise, and
-- the owner here is the migration role, which owns the tables underneath and so
-- is never subject to their RLS. 020 recreated `collection_dupe_predicate` as
-- such a view over `collection_item`, and Supabase's default privileges granted
-- SELECT on it to `anon`. The result: every account's (user_id, card_id,
-- owns-two-or-more) was readable at /rest/v1/collection_dupe_predicate with only
-- the anon key. Confirmed in production on 2026-09-26 by a count-only request:
-- 1,549 rows visible, while `collection_item` itself answered 0.
--
-- Nothing reads the view (it predates multi-user and the Dupes tab was never
-- built), so it is dropped. No CASCADE: if anything did depend on it, this must
-- fail rather than take that object with it.
DROP VIEW IF EXISTS public.collection_dupe_predicate;

-- The remaining views leak nothing today: the four catalog views read tables
-- whose policies are `USING (true)`, and `admin_user_role` is granted to no
-- client role at all (068). They become invoker views anyway, so "a view obeys
-- the caller's RLS" is the rule rather than a property each view happens to
-- have. For the catalog views this changes no result: `anon` and
-- `authenticated` already hold SELECT on every table beneath them. The
-- migration lint (packages/db/src/__tests__/migrationLint.test.ts) now fails
-- any view that is not created this way, which is Supabase's advisor rule 0010.
ALTER VIEW public.variant_tier_resolved         SET (security_invoker = true);
ALTER VIEW public.card_without_standard_variant SET (security_invoker = true);
ALTER VIEW public.master_required_variant       SET (security_invoker = true);
ALTER VIEW public.set_variant_coverage          SET (security_invoker = true);
ALTER VIEW public.admin_user_role               SET (security_invoker = true);

-- Supabase's defaults also grant INSERT/UPDATE/DELETE on views. None of these is
-- auto-updatable except `admin_user_role` (already revoked from every client
-- role by 068), so the grants are inert today; revoking them keeps a future
-- simple view from turning into a write path through its owner's rights.
DO $view_acl$
DECLARE principal text; view_name text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['anon','authenticated'] LOOP
  CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal);
  FOREACH view_name IN ARRAY ARRAY['variant_tier_resolved','card_without_standard_variant','master_required_variant','set_variant_coverage','admin_user_role'] LOOP
   EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM %I', view_name, principal);
  END LOOP;
 END LOOP;
END $view_acl$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. One avatar object, one owner (SEC-02)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `user_profile` is world-readable (021) and its own-row UPDATE policy has no
-- column list, so any signed-in user could PATCH their own `avatar_path` to
-- another user's object key, then call DELETE /api/avatar: the API reads the
-- caller's own path and deletes that object with the service key. Every
-- profile photo on the service was one loop away from gone.
--
-- A key may now belong to at most one profile. Pointing at a key someone else
-- holds fails with 23505, which closes the delete for every writer, the API and
-- PostgREST alike, without the API having to re-check ownership.
CREATE UNIQUE INDEX user_profile_avatar_path_uq
  ON public.user_profile (avatar_path) WHERE avatar_path IS NOT NULL;

-- The same missing column list let a user rewrite their public stats
-- (`unique_cards`, `trainer_level`, `total_quantity`) and `display_name`
-- directly. Nothing in the product writes those as the user; the API's only
-- writes as `authenticated` are the avatar record and its clear (routes/avatar.ts).
-- So the role keeps exactly those columns and nothing else. SELECT is untouched:
-- the table stays world-readable by design.
DO $profile_acl$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
  REVOKE INSERT, UPDATE, DELETE ON public.user_profile FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  REVOKE INSERT, UPDATE, DELETE ON public.user_profile FROM authenticated;
  GRANT INSERT (user_id, avatar_path, avatar_updated_at, avatar_byte_size, avatar_content_type)
     ON public.user_profile TO authenticated;
  GRANT UPDATE (avatar_path, avatar_updated_at, avatar_byte_size, avatar_content_type)
     ON public.user_profile TO authenticated;
 END IF;
END $profile_acl$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Rows the API treats as server-owned stay that way (SEC-10)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Own-row RLS answers "whose row is this?". It does not answer "which columns may
-- the owner change?" or "which parent may a new row point at?". The API enforces
-- both; PostgREST goes around the API.

-- 3a. A revoked token stays revoked. 027's own-row UPDATE policy let a user
-- PATCH `revoked_at` back to NULL, undoing an administrator's "revoke all
-- tokens". No legitimate writer ever clears it: the API's revoke is
-- `COALESCE(revoked_at, now())` and the admin paths only set it. The identity
-- columns are fixed at mint time for the same reason. `name` and `last_used_at`
-- stay writable.
CREATE FUNCTION public.api_token_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
  RAISE EXCEPTION 'A revoked token cannot be restored' USING ERRCODE = '42501';
 END IF;
 IF (NEW.id, NEW.user_id, NEW.token_hash, NEW.prefix, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.token_hash, OLD.prefix, OLD.created_at) THEN
  RAISE EXCEPTION 'A token''s identity is fixed when it is minted' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER api_token_guard_update BEFORE UPDATE ON public.api_token
  FOR EACH ROW EXECUTE FUNCTION public.api_token_guard_update();

DO $token_acl$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated'] LOOP
  CONTINUE WHEN principal <> 'PUBLIC' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal);
  EXECUTE format('REVOKE ALL ON FUNCTION public.api_token_guard_update() FROM %s',
                 CASE WHEN principal = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
 END LOOP;
END $token_acl$;

-- 3b. A child row belongs to its parent's owner. `deck_card`, `deck_version` and
-- `battle_log` referenced `deck(id)` alone, and a foreign-key check ignores RLS,
-- so a user who knew another user's deck id could insert rows under it as
-- themselves. The victim could not see those rows, yet their next add of the
-- same card (or their next version bump) collided with them and failed.
-- `binder_placement` had the same shape through `list_item(id)`, and its
-- UNIQUE (list_item_id) let a planted row keep a card out of its owner's binder.
-- Each now references (id, user_id), the shape `list_item` has had since 020.
ALTER TABLE public.deck      ADD CONSTRAINT deck_id_user_id_key      UNIQUE (id, user_id);
ALTER TABLE public.list_item ADD CONSTRAINT list_item_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE public.deck_card
  DROP CONSTRAINT deck_card_deck_id_fkey,
  ADD CONSTRAINT deck_card_deck_id_user_id_fkey
    FOREIGN KEY (deck_id, user_id) REFERENCES public.deck (id, user_id) ON DELETE CASCADE;
ALTER TABLE public.deck_version
  DROP CONSTRAINT deck_version_deck_id_fkey,
  ADD CONSTRAINT deck_version_deck_id_user_id_fkey
    FOREIGN KEY (deck_id, user_id) REFERENCES public.deck (id, user_id) ON DELETE CASCADE;
ALTER TABLE public.battle_log
  DROP CONSTRAINT battle_log_deck_id_fkey,
  ADD CONSTRAINT battle_log_deck_id_user_id_fkey
    FOREIGN KEY (deck_id, user_id) REFERENCES public.deck (id, user_id) ON DELETE CASCADE;
ALTER TABLE public.binder_placement
  DROP CONSTRAINT binder_placement_list_item_id_fkey,
  ADD CONSTRAINT binder_placement_list_item_id_user_id_fkey
    FOREIGN KEY (list_item_id, user_id) REFERENCES public.list_item (id, user_id) ON DELETE CASCADE;
