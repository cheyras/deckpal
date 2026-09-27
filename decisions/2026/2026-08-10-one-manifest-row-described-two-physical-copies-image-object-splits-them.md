---
date: "2026-08-10"
title: "one manifest row described two physical copies; `image_object` splits them"
decided_by: "agent on behalf of @cheyras (gap named by the user; schema shape chosen here)."
areas: ["images"]
supersedes: []
---
## 2026-08-10 — one manifest row described two physical copies; `image_object` splits them
**Decided by:** agent on behalf of @cheyras (gap named by the user; schema shape chosen here).

**Decision:** migration **025_image_object** adds a per-copy table and leaves
`image_asset` as the identity/provenance record. Both image choke points now write
their own tier's row, and `manifest:check` gained an object-tier mode.

```sql
CREATE TABLE image_object (
  cache_key    TEXT NOT NULL REFERENCES image_asset(cache_key) ON DELETE CASCADE,
  tier         TEXT NOT NULL CHECK (tier IN ('disk','object')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  content_type TEXT NOT NULL,
  etag         TEXT,
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, tier)
);
CREATE INDEX image_object_by_tier ON image_object (tier, cache_key);
ALTER TABLE image_object ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_object_read ON image_object FOR SELECT USING (true);
```

**Why:** the 2026-08-10 cloud-image-tier entry closed with "one row now describes
two physical copies … a `tier` column is the real fix if this ever needs to be
exact." It needs to be exact. `card:sv03.5-102:low` is 14,906 bytes on the Pi
(what TCGdex served when it was warmed) and 17,954 in the bucket (what TCGdex
serves today); `image_asset.byte_size` could only ever be right about one of them,
and whichever writer touched it last won.

**Shape, and what was deliberately left out:**
- **No `relative_path`.** It is a pure function of the upstream identifiers and
  identical in both tiers by contract (B6 — the Storage object key *is*
  `relative_path`). A second copy would only be a second place for it to be wrong.
- **No `cache_control`.** It exists on one tier only and Storage already stores it;
  a column would be a stale mirror of someone else's field.
- **`etag` means the storage layer's validator for THIS copy**, not upstream's
  (that is provenance and stays on `image_asset.etag`). Supabase's is a content
  MD5; a POSIX filesystem assigns none, so the disk tier writes NULL rather than
  inventing one — the same rule `source_url` follows.
- **`image_asset` keeps its physical columns.** They are the historical record of
  the first copy and every existing reader depends on them; B4's spirit (shipped
  things are immutable) applies to columns, not just files.
- **The FK is the point.** `image_object.cache_key REFERENCES image_asset` makes a
  stored copy of something with no provenance record *unrepresentable*, not merely
  discouraged. Proven on a scratch DB: the insert fails with 23503.
- **The migration does not backfill.** An `INSERT … SELECT` would assert that every
  `image_asset` row describes a local disk file — true on the Pi, false on a cloud
  database that imported the manifest. Only the operator knows which, so
  backfilling is an explicit command. Portable, no `@supabase-only` marker.
- **RLS mirrors `image_asset`.** Verified first that Supabase's default privileges
  grant `anon` *ALL* on new public tables, so a table with RLS off would have been
  anon-writable. Confirmed live against the project: anon SELECT 200, anon INSERT
  **401 / 42501**.

**Writers.** `apps/images/src/store.ts` writes `tier='disk'` inside `putAsset`,
`recordExistingAsset` and `ensureRecorded`; `packages/storage/src/put-asset.ts`
writes `tier='object'` after a successful upload. Neither ever writes the other's
tier. The object-tier write is the one step that happens *after* the bytes: the
`image_asset` row is the B1 guarantee and must precede publication, whereas the
per-tier row is a measurement of the published copy. If it fails, the asset is
still correct and still attributable, so it is reported (`objectRecorded: false`
plus a warning naming the repair command) rather than thrown — throwing would make
the caller serve a placeholder for an image that uploaded perfectly well, and the
next request is a Storage HIT that never re-enters the function.

**`manifest:check` now has two modes.** Default = disk tier, unchanged in what it
fails on, plus a new `no disk-tier row (025)` defect and a printed per-tier row
count. `--object-store` = the cloud tier, reconciling `image_object(tier='object')`
against a recursive listing of the actual bucket. That is the first time B1 has
been *falsifiable* on the cloud side: the disk tier could always prove "no byte
without a row" by walking a directory, while the object tier could only take the
manifest's word for it. Inter-tier divergence is reported as a **count, not a
defect** — it is the fact the table exists to record.

**Backfills run:** disk tier 47,924 rows (every row *measured*, never copied from
`image_asset.byte_size` — copying would make the two agree by construction and
destroy the check's ability to notice they had diverged); object tier 2,597 rows
from the bucket's own metadata, later 2,835 as prod kept filling.

**Two upstream facts found by probing rather than assuming:**
1. **Supabase's REST upload returns no ETag header** — only a JSON `{Key, Id}`.
   But the etag it serves for the stored object is exactly the **MD5 of the
   content**, verified against all 1,854 backfilled objects *and* an
   upload-then-HEAD probe. So the choke point hashes the bytes it just published
   instead of spending a HEAD round trip per asset inside a serverless function.
   If that equality ever breaks, `--object-store` reports an etag mismatch — loud,
   which is the correct way for an assumption to fail. Verified three-way after a
   real delete-and-refill: computed MD5 = recorded etag = bucket eTag = local file
   MD5 = `5f901e47…`.
2. **`uploadObject` had no backoff.** Supabase answers `429 too_many_connections`
   well below what a bulk mirror offers it (six parallel uploads was already too
   many), and a throttled asset was simply lost from the run — observed, not
   theorised: a prefix run failed on seven assets. It now retries 429/5xx with
   exponential backoff and jitter, with a deliberately small default budget
   (4 attempts, ~2.8 s) because the same function runs in the serverless fill,
   where a long ladder becomes a function timeout. The re-run uploaded 13/13 clean.

