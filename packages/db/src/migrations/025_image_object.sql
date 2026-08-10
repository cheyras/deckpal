-- 025 · Per-tier physical metadata for cached images.
--
-- PORTABLE — deliberately NOT marked `-- @supabase-only`. Self-hosters need this
-- table too: it is where the disk tier records what it actually wrote.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- `image_asset` (migration 006) carries BOTH the logical identity/provenance of
-- an asset AND the physical facts of one copy of it (`byte_size`, `etag`,
-- `content_type`). That was fine while there was exactly one copy. As of the
-- cloud image tier (DECISIONS.md 2026-08-10) there are two — the self-host disk
-- cache and the Supabase Storage object — and they legitimately differ, because
-- upstream re-encodes assets between the day we warmed the disk and the day the
-- cloud tier fetched it. Measured example: `card:sv03.5-102:low` records 14,906
-- bytes (what TCGdex served when the Pi warmed it); the object in the bucket is
-- 17,954 bytes (what TCGdex serves today). One row cannot honestly answer
-- "how big is this asset" for both.
--
-- So the columns split by responsibility:
--
--   image_asset   — IDENTITY + PROVENANCE. cache_key, kind, relative_path,
--                   source_url, etag (the UPSTREAM validator we were given when
--                   the bytes were fetched), fetched_at, LRU/pin state. Shared by
--                   every tier, because where an asset came from does not change
--                   when you copy it. This table keeps its existing physical
--                   columns: they are the historical record of the first copy and
--                   removing them would break every reader (AGENTS.md B4 — shipped
--                   migrations are immutable, and the same courtesy is owed to
--                   shipped columns).
--
--   image_object  — ONE ROW PER PHYSICAL COPY. What THIS tier actually stored:
--                   its size, its sniffed content type, the storage layer's own
--                   entity tag for the stored bytes, and when it was written.
--
-- ── Why no `relative_path` here ─────────────────────────────────────────────
-- The path is a pure function of the upstream identifiers and is IDENTICAL in
-- both tiers by contract (AGENTS.md B6 / packages/storage paths.ts): the Supabase
-- Storage object key IS `image_asset.relative_path`, verbatim, which is what makes
-- a backfill a straight upload with no remapping. Duplicating it per tier would
-- create a second place for it to be wrong. It stays on `image_asset`.
--
-- ── Why `etag` is nullable and means something different per tier ────────────
-- `image_object.etag` is the STORAGE layer's validator for the stored bytes, not
-- upstream's. Supabase Storage hands back an MD5 hex of the object for free, so
-- the object tier records it and it doubles as a content check (verified
-- 2026-08-10: all 1,854 backfilled objects matched the local file's MD5). A POSIX
-- filesystem assigns no such thing, so the disk tier writes NULL rather than
-- inventing one — the same "an honest blank beats a plausible lie" rule the
-- provenance columns follow.
--
-- ── Not backfilled here, on purpose ─────────────────────────────────────────
-- This migration creates the table and nothing else. An `INSERT … SELECT` from
-- `image_asset` would assume that every existing row describes a local disk copy,
-- which is true on the Pi and false on a cloud-only deployment that imported the
-- manifest. Only the operator knows which they are, so backfilling is an explicit
-- command:
--     pnpm --filter deckscout-images manifest:backfill --disk-tier   (measures the files)
--     pnpm --filter deckscout-images storage:backfill  --reconcile   (reads the bucket)
--
-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mirrors `image_asset` in migration 021: on Supabase, default privileges grant
-- anon/authenticated ALL on new public tables, so a table with RLS off would be
-- writable by the anon key. RLS on + a SELECT-only policy leaves reads public
-- (sizes of card images are not secret) and denies every write to anyone but the
-- service role, which bypasses RLS. Both statements are plain PostgreSQL and are
-- harmless on self-host, where the migration runner owns the table and table
-- owners bypass RLS.

CREATE TABLE image_object (
  cache_key    TEXT NOT NULL REFERENCES image_asset(cache_key) ON DELETE CASCADE,
  -- 'disk'   — a file under IMAGE_CACHE_ROOT (apps/images, self-host)
  -- 'object' — an object in the card-art bucket (packages/storage, cloud)
  tier         TEXT NOT NULL CHECK (tier IN ('disk','object')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  content_type TEXT NOT NULL,
  -- Storage-assigned validator for THIS copy (Supabase Storage: MD5 hex).
  -- NULL on the disk tier, which has no such thing. NOT upstream's etag —
  -- that is provenance and lives on image_asset.
  etag         TEXT,
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, tier)
);

-- The PK leads with cache_key, so a tier-scoped sweep ("every object-tier row")
-- has no usable index. manifest:check does exactly that sweep on both tiers.
CREATE INDEX image_object_by_tier ON image_object (tier, cache_key);

ALTER TABLE image_object ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_object_read ON image_object FOR SELECT USING (true);
