---
date: "2026-08-10"
title: "Profile photos: a public avatar bucket, a random key, and a B1 exception that is written down"
decided_by: "agent on behalf of @cheyras (feature requested by a user through"
areas: ["images"]
supersedes: []
---
## 2026-08-10 — Profile photos: a public avatar bucket, a random key, and a B1 exception that is written down

**Decided by:** agent on behalf of @cheyras (feature requested by a user through
the in-app reporter — issue #14, "We need a way for users to add a profile
photo to their account").

**Decision:** users can upload, replace and remove a profile photo. Bytes live
in a new **public** Supabase Storage bucket `user-avatars` under a **random**
object key; the record lives on the existing `user_profile` row (migration
**029**), not in `image_asset`. Uploads are validated by magic bytes and
re-encoded server-side to 256×256 WebP with `sharp`.

### Public bucket, unguessable key

A profile photo is meant to be seen — the Friends surface is already stubbed on
/profile — so a private bucket would buy nothing and cost a signing round trip
in front of the header chip on *every page load*. Public it is, served straight
off Supabase's CDN with `max-age=31536000, immutable`.

The key is 32 random hex characters, **not** anything derived from the user id.
In a public bucket a derived key would be probeable by iterating accounts. It is
not a secret — `user_profile` is world-readable by design (migration 021,
`FOR SELECT USING (true)`, and PostgREST exposes the `public` schema) — it just
refuses to be the thing that leaks the mapping. Because a replacement always
gets a fresh key it is also free cache-busting: a changed photo is a new URL, so
`immutable` stays honest and no `?v=` is needed.

**Known consequence, stated rather than discovered later:** removal is immediate
in the app and in the origin bucket, but the *old* URL can still resolve from
Cloudflare's edge for the life of the cache header. Verified: after a replace,
the origin listing showed one object while the old URL still answered 200 from
cache. Acceptable — the URL is 128 bits of randomness known only to someone who
already saw the photo — but it is not "deleted everywhere the instant you click
Remove", and pretending otherwise would be the lie.

### Validation: nothing the client says is trusted

Not the `Content-Type`, not the filename, not the extension. The accept decision
comes from the magic bytes via `sniffContentType` (the sniffer packages/storage
already owns for the card-art tier), and then from whether `sharp` can actually
decode the buffer — a file that fakes a header but is truncated dies there.
JPEG/PNG/WebP only; GIF and SVG are deliberately out (no animated avatars, and
SVG is a script-execution vector we have no reason to accept).

Everything is re-encoded to 256×256 WebP, which is three things at once:

1. **The real content check.** Bytes that survive decode → resize → re-encode
   are an image, whatever else they were. A polyglot does not survive it.
2. **The privacy fix.** Phone photos carry EXIF, including GPS. Storing the
   original would publish a user's home address to a public bucket. `.rotate()`
   runs first so the orientation tag is applied before it is discarded.
3. **The weight fix.** A 178 KB test PNG stores as 9.2 KB.

The body cap is **3 MB**, below Vercel's 4.5 MB function-request limit, so the
rejection is ours with a sentence that names the number, rather than Vercel's
`FUNCTION_PAYLOAD_TOO_LARGE` page. Measured on the deployed site: 3.35 MB → our
`413 {"code":"too_large"}`; 7.3 MB → Vercel's own 413 before our handler runs.
The browser checks size locally too, so a real user never reaches the second
case. `sharp` is imported **dynamically**: a top-level import would run at the
cold start of the one function that serves every route, so a native module that
failed to load would take down the entire API rather than one feature.

### Provenance: a documented exception to B1, not a bypass

Contract B1 requires a provenance record for every stored byte. Avatars keep the
promise **in a different table**, and the reasoning is written out in full at the
top of migration 029 and in `packages/storage/src/avatar-store.ts`:

1. **The `Provenance` union has no member that fits.** It is `{origin:'url'}` or
   `{origin:'unknown', reason}`. An avatar has no upstream URL, but its source is
   not unknown either — it is *this user, at this time*. Filing a known source as
   unknown is exactly the dishonesty B1 exists to prevent.
2. **`image_asset` is world-readable** (021). Publishing avatar keys there would
   put every user's key in a table anyone can read.
3. **`manifest:check --object-store` reconciles against the `card-art` bucket.**
   Avatar rows would read as permanent drift and turn a working tripwire into
   noise.
4. **LRU semantics are wrong.** `image_asset.last_access_on` exists so cold
   catalog art can be evicted and re-fetched. An evicted avatar is gone forever.

(Migration 006's `kind` CHECK does list `'avatar'` and `'banner'`. That was
written for the single-user self-host design where the avatar would have shared
the local disk cache. Vestigial, not a mandate.)

The replacement record is not weaker: one row per stored object, keyed by its
owner, carrying the same facts `image_object` records for card art — byte size,
*sniffed* content type, stored-at — with a CHECK that all four avatar columns are
set together or not at all. And `putAvatarObject` **cannot be called without a
recorder**: it runs before the bytes are published and is rolled back if
publishing fails, mirroring `put-asset.ts`'s record-then-publish ordering. The
pure test suite pins that ordering, and earned its keep immediately — it caught
`storageEnv()` sitting *between* the record and the try block, where a throw
skipped the rollback and left a row pointing at an object that was never
published.

### The latent trap: `user_profile` had no INSERT policy

Migration 021 gave `user_profile` SELECT + UPDATE only, because rows are created
by the `handle_new_user` signup trigger (SECURITY DEFINER, bypasses RLS). That
holds right up until a profile row is missing for any reason — and then a bare
`UPDATE` touches **zero rows, reports success, and orphans the object**: the
exact failure B1 exists to prevent, arriving through the back door. 029 adds
`user_profile_insert` (own row, `TO authenticated`) and the upload path upserts.
The policy is created inside a `DO` block guarded on `user_profile_update`
existing, so the same migration is correct on plain self-host Postgres, where it
adds the columns and no policy.

### Orphans: the cascade does not reach Storage

**Measured, not assumed.** Deleting the throwaway account through the Supabase
admin API cascaded cleanly in Postgres — `auth.users`, `app_user`,
`user_profile`, `api_token` all zero — and **left the avatar object in the
bucket**. Supabase Storage has no foreign key to application tables, so it never
could have done otherwise. Replace and Remove both reap their predecessor inline
(verified: 1 object for 1 row through every step of the lifecycle), so the only
orphan source is account deletion.

The reaper is a one-liner by construction, which is the whole point of putting
the key on the owner's row: everything in the bucket that is not in
`SELECT avatar_path FROM user_profile WHERE avatar_path IS NOT NULL`.
`listAvatarObjectKeys()` in avatar-store.ts is its left-hand side. It was run by
hand to clear this session's orphan. **Deliberately not wired to a schedule
here** — an unattended job that deletes user data on a set derived from a live
query is exactly the kind of thing that should be added on purpose, with a
dry-run, rather than as a side effect of a feature commit.

### Self-host

No object store, so no feature: `GET /avatar` answers `enabled:false`, the UI
renders no control at all, and the write verbs answer 501 rather than failing
halfway. Verified against a local self-host run. Storing avatars on the image
server's local disk was considered and rejected — that cache is LRU-evictable
and rebuildable from upstream by design, and an avatar is neither. The columns
still ship there (the migration is *not* `@supabase-only`) so a self-host DB that
later moves to Supabase has no hole.

### Two things found by looking rather than by testing

* `requireSession`'s 403 said *"Personal access tokens cannot manage tokens"* —
  true when it guarded only `/tokens`, false the moment `/avatar` mounted behind
  it. It now speaks about account settings.
* The profile ring used to render **only** when the insights overview had
  resolved, so an insights outage took the photo *and its upload control* off the
  page — the same trap the file already documents for Sign out and Account. Only
  the level badge is gated now.

### Verified

Typecheck, 49 deck + 29 auth + 14 token + 6 bug + 11 new storage tests, all five
builds. End to end on **deckpal.app** as a throwaway confirmed user, in a real
browser at 1440 and 390: add → renders in the profile ring, the desktop header
chip, the mobile drawer's View Profile button and the insights trainer card;
reload → persisted; replace → new key, old object reaped; a `.txt` renamed
`.png` → *"That file is not a JPEG, PNG or WebP image…"* with the existing photo
untouched; a 16 MB JPEG → *"That image is larger than 3 MB…"*; remove → the
letter/glyph default returns and the control relabels itself to "Add photo". A
personal access token is refused 403 on all three verbs. Zero unexpected console
errors; the only HTTP ≥ 400 in the whole run were the two deliberate rejections.

A browser pass also caught a defect no test would have: for the length of the
fetch the disc was **empty** — no photo, no fallback — because an `<img>` whose
bytes are still in flight paints nothing, and the disc was an if/else. The glyph
is now a layer *underneath* the image, and a finished upload decodes the new URL
before handing it to the query cache so the swap lands on something already in
memory. Fixed in `4185bc1`, re-verified in the browser.


