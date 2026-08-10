-- ─────────────────────────────────────────────────────────────────────────────
-- 029 — user_profile: the avatar object's record.
--
-- Issue #14 ("a way for users to add a profile photo"). `avatar_path` has
-- existed since migration 005 and was never written by anything; this migration
-- turns it from a bare pointer into the avatar's PROVENANCE RECORD and adds the
-- INSERT policy the upload path needs.
--
-- ── Why the avatar is NOT an `image_asset` row (contract B1) ────────────────
-- B1 says every stored byte gets a provenance record, written through a choke
-- point. The avatar keeps that promise in a different table, because it is a
-- different class of byte from cached catalog art. Four concrete reasons, not
-- one convenience:
--
--   1. PROVENANCE DOES NOT FIT THE UNION. `Provenance` is `{origin:'url'}` or
--      `{origin:'unknown', reason}`. An avatar has no upstream URL to record,
--      but its source is not unknown either — it is "uploaded by this user at
--      this time", which is exactly what the columns below record. Forcing it
--      through `unknownProvenance()` would file a known source as unknown, the
--      precise dishonesty B1 exists to prevent.
--   2. `image_asset` IS WORLD-READABLE. Migration 021 gives it
--      `FOR SELECT USING (true)`. Publishing avatar object keys there would put
--      every user's key in a table anyone can read, defeating the unguessable
--      key. `user_profile` is world-readable too, so the key is not a secret —
--      but there is no reason to publish it twice.
--   3. `manifest:check --object-store` RECONCILES AGAINST THE card-art BUCKET.
--      Avatars live in `user-avatars`. Rows pointing at a different bucket would
--      register as permanent drift and turn a working tripwire into noise.
--   4. LRU EVICTION SEMANTICS ARE WRONG. `image_asset.last_access_on` exists so
--      cold catalog art can be evicted and re-fetched from upstream. An evicted
--      avatar is gone forever — there is nowhere to re-fetch it from.
--
-- (Migration 006's `kind` CHECK does list 'avatar' and 'banner'. That was
-- written for the single-user self-host design, where the avatar would have
-- shared the local disk cache. It is vestigial, not a mandate.)
--
-- The record this migration creates is stronger than a pointer: exactly one row
-- per stored object, keyed by its owner, carrying the same facts `image_object`
-- records for the card-art tier (byte size, sniffed content type, stored-at).
-- Which makes the orphan reaper a one-liner:
--   every key in the bucket that is not `SELECT avatar_path FROM user_profile`.
--
-- ── Path contract (B6) ─────────────────────────────────────────────────────
--   bucket `user-avatars`, key `<32 lowercase hex>.webp`, always 256×256 WebP.
-- The key is random rather than derived from the user id so it cannot be probed
-- by iterating account ids, and so that a replaced avatar lands on a brand-new
-- URL (free cache-busting past Supabase's immutable CDN headers).
-- Authoritative in `packages/storage/src/avatar-store.ts`.
--
-- ── Self-host ──────────────────────────────────────────────────────────────
-- Deliberately NOT @supabase-only: the columns belong to the table in both
-- deployments, and a self-host DB that later migrates into Supabase should not
-- have a hole here. Self-host has no object store, so the API hides the feature
-- (`GET /avatar` answers `enabled:false`) and these columns simply stay NULL.
-- The policy below is created only where RLS policies already exist.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_profile
  ADD COLUMN avatar_updated_at   TIMESTAMPTZ,
  ADD COLUMN avatar_byte_size    INTEGER,
  ADD COLUMN avatar_content_type TEXT;

-- All four avatar columns are set together or not at all. A path with no
-- measurement is the "byte with no record" B1 forbids; a measurement with no
-- path is a record of nothing. Existing rows are all-NULL, so they pass.
ALTER TABLE user_profile
  ADD CONSTRAINT user_profile_avatar_complete
  CHECK (num_nonnulls(avatar_path, avatar_updated_at, avatar_byte_size, avatar_content_type) IN (0, 4));

ALTER TABLE user_profile
  ADD CONSTRAINT user_profile_avatar_byte_size_positive
  CHECK (avatar_byte_size IS NULL OR avatar_byte_size > 0);

COMMENT ON COLUMN user_profile.avatar_path IS
  'Object key in the `user-avatars` bucket (<32 hex>.webp), or NULL. This row IS '
  'the avatar''s B1 provenance record — see migration 029 and packages/storage/src/avatar-store.ts.';

-- ── The INSERT policy (the latent trap) ────────────────────────────────────
-- Migration 021 gave user_profile SELECT + UPDATE policies only: rows are
-- created by the `handle_new_user` signup trigger, which is SECURITY DEFINER
-- and bypasses RLS. That works right up until a profile row is missing for any
-- reason (a user created before the trigger existed, a hand-inserted auth row,
-- a trigger that was briefly dropped) — then the avatar upsert silently updates
-- ZERO rows and the object is published with nothing pointing at it: an orphan,
-- which is exactly the failure B1 exists to prevent.
--
-- The upload path therefore uses INSERT … ON CONFLICT (user_id) DO UPDATE so a
-- missing profile row self-heals, and that requires an INSERT policy. Scoped to
-- the caller's own row, so it grants nothing a user could not already do by
-- signing up. `app_user`'s FK still gates it: you cannot conjure a profile for
-- an account that does not exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'user_profile'
       AND policyname = 'user_profile_update'
  ) THEN
    EXECUTE $p$
      CREATE POLICY user_profile_insert ON user_profile
        FOR INSERT TO authenticated
        WITH CHECK (user_id = (SELECT auth.uid()))
    $p$;
  END IF;
END $$;
