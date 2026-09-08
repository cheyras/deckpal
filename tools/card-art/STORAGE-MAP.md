# Where a card image lives, end to end

**Project Holo subtask 2c — PREP artifact. UNTRACKED; do not commit.**
Written 2026-08-31 against `main` post-PR #150. Every claim carries a
file:line citation so the apply plan can be executed without re-deriving
anything.

---

## 1. The one-sentence version

A card image is addressed by **one string** — the *relative path* — which is a
**pure function of `(series.tcgdex_id, card_set.tcgdex_id, card.local_id,
quality)`**, and that same string is simultaneously the Supabase Storage object
key, the path under `IMAGE_CACHE_ROOT` on a self-host box, and the tail of the
public URL. There is no mapping table between an image and its bytes, and the
read path never asks the database where an asset is.

```
images/en/{serie}/{set}/{localId}.{quality}.webp
```

`packages/storage/src/paths.ts:44-46` (`cardRelativePath`) is the single
definition; `apps/images/src/layout.ts:31-45` re-exports it and adds the only
disk-specific part (`join(CACHE_ROOT, relativePath)`).

---

## 2. The address algebra

| Thing | Value | Defined at |
|---|---|---|
| Public URL the SPA requests | `/deckpal/images/en/{serie}/{set}/{localId}/{quality}.webp` | `apps/api/src/db.ts:400-403` (`cardImages()`) |
| URL prefix constant | `/deckpal/images/` | `packages/storage/src/paths.ts:122` (`IMAGE_URL_PREFIX`) |
| Relative path / object key | `images/en/{serie}/{set}/{localId}.{quality}.webp` | `packages/storage/src/paths.ts:44-46` |
| `image_asset.cache_key` | `card:{setTcgdexId}-{localId}:{quality}` | `packages/storage/src/paths.ts:50-52` |
| Canonical upstream URL | `https://assets.tcgdex.net/en/{serie}/{set}/{localId}/{quality}.webp` | `packages/storage/src/paths.ts:54-56` |
| Set logo / symbol | `sets/{setId}/{logo\|symbol}.webp`, key `set:{setId}:{kind}` | `packages/storage/src/paths.ts:66-72` |
| Sprites | `sprites/…`, **no manifest row at all** (pinned SHA is the provenance) | `packages/storage/src/paths.ts:88-118` |
| Qualities | exactly `low` and `high`; nothing above 600×825 | `packages/storage/src/paths.ts:29-31` |

**Note the `/` → `.` change.** The request path has `…/{localId}/{quality}.webp`
(five segments); the stored path has `…/{localId}.{quality}.webp` (four). Getting
that backwards produces keys that will never be found.

**Why `cache_key` is the safe join key to the catalog.** It contains exactly two
colons, so `split_part(cache_key, ':', 2)` is exactly `card.tcgdex_id` and
`split_part(…, ':', 3)` is the quality. Both set ids (`tk-bw-e`) and local ids
(`SWSH133`, `TG01`) can contain hyphens, so splitting the card id on `-` is
wrong. `tools/card-art/dump-affected.sql` uses the colon form.

**Path safety.** Every segment must match `/^[A-Za-z0-9][A-Za-z0-9.-]*$/` —
`paths.ts:129` (`SEGMENT`) on the request side, and independently
`packages/storage/src/object-path.ts:44` on the object-store side. This is why
`exu-!` and `exu-?` have no image at all and cannot be given one without a B6
path-contract change (`research/CARD-ART-SOURCES.md` §1).

---

## 3. Where the bytes physically are

**Both, and the two tiers are deliberately not the same copy.**

| Tier | Location | Written by | Read by |
|---|---|---|---|
| `object` (**production**) | Supabase Storage, public bucket `card-art`, object key **==** `relative_path` | `packages/storage/src/put-asset.ts:129-206` (`putStorageAsset`) | `apps/api/src/images/handler.ts` |
| `disk` (self-host) | `IMAGE_CACHE_ROOT` (defaults to `<repo>/cache`) | `apps/images/src/store.ts:118-165` (`putAsset`) | `apps/images/src/index.ts` |

- Bucket name: `card-art`, overridable via `CARD_ART_BUCKET` —
  `packages/storage/src/config.ts:20`.
- Credentials: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` —
  `packages/storage/src/config.ts:37-48`. Reads are public; writes carry the
  service role.
- Disk root: `IMAGE_CACHE_ROOT` — `apps/images/src/config.ts:33`.
- Public object URL: `{SUPABASE_URL}/storage/v1/object/public/card-art/{key}` —
  `packages/storage/src/object-store.ts:24-30` (`publicObjectUrl`).

**The key equality is the point** (migration `025_image_object.sql:37-39`): "the
Supabase Storage object key IS `image_asset.relative_path`, verbatim, which is
what makes a backfill a straight upload with no remapping." That is what lets the
re-sourcing pipeline stage bytes into a directory tree and publish them with the
**shipped** backfill command instead of a bespoke uploader.

---

## 4. The database rows

Two tables, split by responsibility (migration `025_image_object.sql:20-33`).

### `image_asset` — identity + provenance (migration `006_sync.sql:49-61`)

| Column | Meaning |
|---|---|
| `cache_key` PK | `card:{set}-{localId}:{quality}` |
| `kind` | CHECK `('card','set-logo','set-symbol','set-background','sprite','avatar','banner')` |
| `relative_path` UNIQUE | the object key / disk path |
| `content_type` | **sniffed from magic bytes**, never the extension |
| `byte_size` | > 0 (CHECK) |
| `source_url` | **the provenance column this whole task is about.** NULL = "we could not establish where these bytes came from" — an honest blank, not a default |
| `etag` | **upstream's** validator for the bytes we fetched |
| `fetched_at`, `last_access_on`, `is_pinned` | LRU / pin state |

RLS: enabled, world-readable, writes service-role only
(`021_rls_policies.sql:126-127`).

### `image_object` — one row per physical copy (migration `025_image_object.sql:67-88`)

`(cache_key, tier)` PK, `tier IN ('disk','object')`, plus `byte_size`,
`content_type`, `etag` (**Storage's** MD5-hex validator, NULL on disk),
`stored_at`. FK to `image_asset(cache_key) ON DELETE CASCADE` — so deleting a
manifest row removes its per-tier rows automatically.

There is **no other provenance column.** `source_url` + `etag` on `image_asset`
and `etag` on `image_object` are the complete set.

---

## 5. How a request resolves (production)

`vercel.json` rewrites `/deckpal/images/(.*)` → `/api/images?p=$1`, handled by
`apps/api/src/images/handler.ts` (`handleImageRequest`, bottom of file):

1. `imageSubPathFromUrl` → `parseImagePath` (`paths.ts:141-303`) turns the URL
   into `{ relativePath, cacheKey, canonicalSourceUrl, assetKind }`. No DB.
2. **`objectExists(relativePath)`** — an unauthenticated HEAD against the public
   bucket URL (`object-store.ts:41-56`). A hit answers **302** to
   `publicObjectUrl(relativePath)` with `Cache-Control: public, max-age=31536000,
   immutable` and `X-Cache: HIT`. **Bytes are never proxied through the
   function, and the DB is never consulted on a hit.**
3. On a miss, `fill()` → `resolveSourceUrl` → `getManifestRow(cacheKey)` over
   PostgREST (`packages/storage/src/manifest.ts:44-60`). Resolution order
   (`handler.ts` `resolveSourceFromManifest`): sprite pinned SHA → **recorded
   `source_url`** → card canonical TCGdex derivation → set-image crosswalk →
   null.
4. `fetchSourceBytesWithExtensionFallback` (`fetch-source.ts`) fetches under the
   **allow-list** in `packages/storage/src/upstream.ts:70-73`
   (`IMAGE_SOURCE_HOSTS` = `assets.tcgdex.net`, `raw.githubusercontent.com`) —
   destination check on the first URL *and every redirect hop*, then a
   content-type + magic-byte check.
5. `putStorageAsset` writes the manifest row, uploads, then records the
   `image_object` row, and the response 302s with `X-Cache: FILLED`.
6. Failure → the ~1 KB placeholder WebP, `200`, `X-Placeholder: 1`,
   `Cache-Control: public, max-age=60`.

Self-host is the same algebra with `res.sendFile` instead of a 302, and it
**never** fetches upstream on the read path (`apps/images/src/index.ts:24-32`).

---

## 6. What this means for replacing bytes

**Five consequences the apply plan depends on.**

1. **Replacement is an overwrite, not a delete-then-write.** The object key is a
   pure function of the card ref, so publishing new bytes for a card writes the
   same key. `uploadObject` sends `x-upsert: true`
   (`object-store.ts:159-186`), so the out-of-policy bytes are gone the moment
   the new ones land. **No delete step is needed for a replaced asset.** Deletion
   is only for assets with no approved replacement.

2. **The allow-list already blocks a re-fill from the retired host, and always
   did.** `upstream.ts:56-68` states it explicitly: bytes an unapproved source
   contributed in the past *may still be in the bucket and still serve as a
   `HIT`* — what the list guarantees is that a refill can never go back for more.
   So the bytes in the bucket are the entire remaining exposure, and this task is
   exactly the work of removing them.

3. **Adding `images.pokemontcg.io` to `IMAGE_SOURCE_HOSTS` is NOT required to
   land this work, and probably should not be done.** The staging + backfill path
   reads bytes off local disk (`putStorageAssetFromFile`,
   `put-asset.ts:222-282`) and never calls `fetchSourceBytes`. The host would
   only be needed if the *serverless lazy fill* should be able to re-fetch a
   pokemontcg.io asset later — which is a separate, deliberate decision
   (`upstream.ts:60-67` sets out what approving a source requires: the host, a
   one-line justification, and a DECISIONS.md entry). **Until it is added, a
   re-sourced asset whose object is later lost will NOT self-heal** — it will
   fall back to the TCGdex derivation, 404, and serve the placeholder. Flag this
   to the owner as a real trade-off rather than slipping the host in.

4. **CDN staleness is the one thing an overwrite does not fix immediately.** The
   302 carries `immutable, max-age=31536000` and the object is stored with
   `cache-control: max-age=31536000` (`object-store.ts:169`). Third-party caches
   (Vercel's CDN for the redirect, Supabase's CDN for the bytes, and browsers)
   may keep serving the *old* bytes after the swap. The origin object is
   replaced, so we no longer host them — but **verify** with a direct HEAD of the
   public object URL and compare `content-length`/`etag` to the staged file's
   MD5. If Supabase's CDN does not invalidate on upsert, a delete-then-upload is
   the fallback (accepting a brief 404 window).

5. **`byte_size`/`content_type` on `image_asset` go stale unless updated.**
   `insertManifestRow` treats a duplicate `cache_key` as `'exists'` and does not
   update it (`manifest.ts:81-105`), so the backfill will refresh `image_object`
   but not `image_asset`. `tools/card-art/out/apply-source-urls.sql` therefore
   updates `source_url`, `etag`, `content_type`, `byte_size` and `fetched_at`
   itself, guarded on the row still being unattributed.

---

## 7. The commands that already exist (use these; do not write new ones)

| Command | What it does | File |
|---|---|---|
| `pnpm --filter deckpal-images storage:backfill --prefix images --force` | Uploads files under `IMAGE_CACHE_ROOT` for manifest rows matching the prefix, through `putStorageAssetFromFile` — the B1 choke point. `--force` re-uploads over an existing object. | `apps/images/src/cloudBackfill.ts` |
| `… storage:backfill --reconcile` | Walks the bucket and repairs `image_object` rows. | same |
| `… manifest:check --object-store` | The drift tripwire: rows without objects, objects without rows, size/etag mismatches. | `apps/images/src/manifestCheck.ts` |
| `… warm:cloud --dry-run` | Drives the deployed tier's own lazy fill over the whole catalog and writes a residue file naming every asset it could not serve. | `apps/images/src/cloudWarm.ts` |

`storage:backfill` needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the
`PG*`/`DATABASE_URL` connection; it opens **one** pooled connection and closes it
in a `finally`.
