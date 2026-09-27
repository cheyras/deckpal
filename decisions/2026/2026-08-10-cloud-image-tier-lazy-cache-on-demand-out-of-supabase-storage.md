---
date: "2026-08-10"
title: "Cloud image tier: lazy cache-on-demand out of Supabase Storage"
decided_by: "user (chose \"lazy cache-on-demand\" over a 2.1 GB up-front backfill)."
areas: ["images"]
supersedes: []
---
## 2026-08-10 — Cloud image tier: lazy cache-on-demand out of Supabase Storage
**Decided by:** user (chose "lazy cache-on-demand" over a 2.1 GB up-front backfill).
**Decision:** `/deckpal/images/*` on the Vercel deployment is now served by a
serverless function (`api/images.mjs` → `apps/api/src/images/handler.ts`) that
fills a public Supabase Storage bucket (`card-art`) on demand.

**Why:** the SPA asks for card art at `/deckpal/images/en/<serie>/<set>/<localId>/<low|high>.webp`
and set imagery at `/deckpal/images/sets/<setId>/<logo|symbol>.webp` (built in
`apps/api/src/db.ts` `cardImages()` and `apps/web/src/components/ui.tsx`
`setAssetUrl()`). Self-host answers those from `apps/images` (:3701) off a local
WebP cache. That service was never ported to the cloud, so on deckpal.app every
one of those URLs fell through to the SPA catch-all rewrite and returned
**`200 text/html`** — the index shell, as an image. Every `<img>` on every catalog
page was silently broken, and nothing failed loudly enough to notice. Verified
before the fix: `curl https://deckpal.app/deckpal/images/en/sv/sv03.5/102/low.webp`
→ `200`, `content-type: text/html`, 4,462 bytes.

**Shape:**
- **Routing.** `vercel.json` gains `{"source": "/deckpal/images/(.*)", "destination": "/api/images?p=$1"}`
  **first** in `rewrites`, ahead of `/api/(.*)` and the `/(.*)` → `/index.html`
  fallback. It cannot shadow `/api/*` (different prefix), and the capture group is
  passed as `?p=` so the handler never has to guess how the platform rewrote the
  path. The SPA fallback stays last — that ordering is the whole bug.
- **HIT** → `302` to the public object URL with `public, max-age=31536000, immutable`.
  Bytes are never proxied through the function; the CDN caches the redirect, so a
  warm asset costs the function nothing after the first request per edge.
- **MISS** → read the `image_asset` row for that logical path, fetch the bytes
  from its recorded `source_url`, write bytes + row through the choke point, 302.
- **FAIL** (no row, or upstream will not serve it) → the same ~1 KB placeholder
  WebP `apps/images` serves, for cards; `404` for set imagery (the SPA already
  renders its own set-mark fallback). Both with `max-age=60` so they self-heal.
  **An image URL never answers with HTML** — that is the invariant this whole
  change exists to restore, and it holds for traversal attempts, sprite paths the
  cloud tier does not carry, and internal errors alike.
- **Validation.** `parseImagePath()` in `@deckpal/storage` is an allow-list:
  decode percent-escapes exactly once, then require `[A-Za-z0-9][A-Za-z0-9.-]*`
  per segment plus an explicit `..` rejection — the same rule
  `apps/images/src/index.ts` applies. The regex contains no separator character,
  so the parsed relative path (which becomes the Storage object key) cannot
  escape its subtree. 29 pure tests in `apps/api/src/images/__tests__/paths.test.ts`,
  wired into CI as `pnpm --filter deckpal-api test:images`.

**One copy of the path algebra.** The pure part of `apps/images/src/layout.ts`
(relative paths, cache keys, canonical source URLs, `LANG`/`QUALITIES`), the
content-type sniffer and the placeholder moved to a new workspace package,
`@deckpal/storage`; `apps/images` re-exports them, so every existing import
site there is unchanged and the two tiers cannot drift. The Storage **object key
is the `image_asset.relative_path` verbatim**, which is what keeps a future bulk
backfill a straight upload of `cache/` with no remapping.

**Choke point (`packages/storage/src/put-asset.ts`).** The object-store twin of
`apps/images/src/store.ts`, same contract, same reason (DECISIONS 2026-08-07 —
1,970 files had landed with no manifest row and we lost their provenance):
1. **Provenance is required** — a discriminated union with no default. The URL
   written to `source_url` is only ever one a fetch actually succeeded against.
2. **Content type is sniffed, not assumed** — magic bytes, never the `.webp`.
3. **Ordering mirrors store.ts**: insert the row, then upload. On upload failure
   the row is removed *only* if this call inserted it; a pre-existing row is left
   alone (visible drift beats destroying a good record).
4. **Serving never depends on it** — a Storage HIT does zero DB work.
The manifest is reached over PostgREST rather than `pg`: this path touches the DB
at most once per asset ever, and a pooled TCP connection per serverless instance
would spend the cluster's connection budget (ARCHITECTURE §6) for nothing.

**Concurrency:** idempotent upsert, no locking. Racing cold requests fetch the
same recorded URL and write byte-identical content with `x-upsert: true`, so
last-writer-wins is indistinguishable from first-writer-wins; the manifest insert
is keyed on `cache_key` (PK) and `relative_path` (UNIQUE), so the loser gets a
409 and treats it as "already recorded". Verified with six parallel cold requests
for one asset: six `302`s, one intact object.

**Existing rows are not rewritten.** When a manifest row already exists (the disk
tier's), the cloud fill leaves `source_url`, `etag`, `byte_size` and
`content_type` untouched and only adds the object. Consequence, accepted
knowingly: one row now describes two physical copies, and upstream re-encodes
mean they can differ in size (`card:sv03.5-102:low` records 14,906 bytes; the
copy TCGdex serves today, and therefore the object in the bucket, is 17,954). The
row's job is provenance, which is shared and correct; the bucket is the object
tier's ground truth. Nothing new drifts on the Pi, so `manifest:check` stays
clean. A `tier` column is the real fix if this ever needs to be exact.
The one write-back that *is* allowed is `recordProvenanceIfUnknown()`: a row with
`source_url IS NULL` gets the URL filled in, filtered on `source_url=is.null`, and
only after a fetch from it succeeded. In practice this almost never fires — the
1,854 NULL-provenance card rows are precisely the ones whose canonical upstream
URL 404s (that is why `manifest:backfill` left them blank), so they serve the
placeholder and remain honest blanks.

**A full backfill remains available and is now cheap to do.** 2.1 GB / 47,598
webp files sit at `cache/images` on the Pi, and the object key is the relative
path, so the backfill is an upload of that tree — no new code, no remapping. It
is gated on Supabase **Pro ($25/mo, 100 GB)**; the Free tier's 1 GB cannot hold
the corpus. Until then the bucket only ever holds what someone actually looked
at, which is the point. A backfill would also fix the ~1,854 cards whose art
exists locally (warmed from pkmn.gg) but is no longer fetchable from TCGdex.

**Noted, not fixed:** the service worker's Tier-1 image cache does not engage on
cloud. `apps/web/src/sw.ts` derives `BASE` from its own URL — `/` on cloud — and
matches images at `` `${BASE}images/` ``, while the API hands out
`/deckpal/images/...` regardless of deploy target. So cloud image requests
match no SW route and go straight to the network (which is why the cross-origin
302 works transparently). Out of scope here; worth a follow-up.

