---
date: "2026-08-10"
title: "Re-keying stranded card art, and scheduling the refresh that prevents it"
decided_by: "Claude Opus 5 on behalf of @cheyras, closing the two follow-ups left by"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-10 — Re-keying stranded card art, and scheduling the refresh that prevents it
**Decided by:** Claude Opus 5 on behalf of @cheyras, closing the two follow-ups left by
the catalog refresh (DECISIONS.md, same day).

Two halves of one failure: upstream re-keyed four sets, the catalog followed and the
images did not; and nothing was scheduled to notice any of it.

### Part 1 — the 240 stranded `image_asset` rows

Confirmed against upstream and `card_set` rather than trusted from the brief: the pairs
are `swsh9.5tg`→`swsh9tg`, `swsh10.5tg`→`swsh10tg`, `swsh11.5tg`→`swsh11tg`,
`swsh12.5tg`→`swsh12tg` — set rows 177/178/183/184, 30 cards each. 240 rows per tier
(120 cards × low+high), and **every one of them carries `source_url IS NULL`**.

That NULL is the whole argument for how to fix it. Those bytes were warmed from pkmn.gg
before launch because TCGdex has no copy — verified today, `assets.tcgdex.net` 404s for
the old id *and* the new one, for `.webp`, `.png` and `.jpg` alike. So a re-warm would
not have restored 120 cards; it would have deleted them. **Re-key, never refetch**, and
carry the honest blank across untouched: an invented `source_url` would have made
`manifest:check` report full provenance coverage over a fiction (B1).

**Decisions, and why:**

* **Rename in place, not copy-then-delete.** Supabase Storage's `/object/move` renames
  server-side: the bytes never leave, the stored size/content-type/MD5 etag are
  preserved, so the `image_object(tier='object')` row that measured them stays true and
  needs no re-measure. Copy-then-delete doubles the failure surface and its torn state
  leaves *both* keys populated, which reads to `manifest:check --object-store` as an
  unrecorded object and needs a human to tell the live copy from the leftover. Disk tier
  is `fs.rename` within the cache root — same filesystem, atomic.
* **`cache_key` changes, because it is not an identifier we own.** It is a pure function
  of the request path (`paths.ts` `cardCacheKey`), so the renamed card derives
  `card:swsh9tg-TG01:low` and nothing will ever ask for the old key again. Leaving it
  would strand the row a second way: `touchLastAccess`, `evictionCandidates` and the
  cloud fill's `getManifestRow` all key on it, and the next lazy fill would try to INSERT
  the new key against a `relative_path` UNIQUE the old row still held.
* **`image_object` follows by identity, in the same transaction.** Its FK is
  `ON DELETE CASCADE` with no `ON UPDATE` action, so `UPDATE image_asset SET cache_key`
  is rejected outright (verified: *"still referenced from table image_object"*). The move
  is therefore insert-new → repoint-children → delete-old, with every column copied
  explicitly — `fetched_at` included, because it records when the bytes were fetched and
  they were not fetched again.
* **Rows first, bytes last, commit only once the bytes moved.** The opposite of
  `putAsset`'s order, deliberately: `putAsset` records before publishing because the bytes
  are NEW and must never be visible unrecorded, whereas here bytes and record already
  exist and agree. The likely failure (Storage says no) rolls the rows back and leaves the
  asset exactly as it was.
* **It refuses to run** if the connected database holds `image_object` rows for a tier
  whose bytes the run is not moving — re-keying shared identity would otherwise drag the
  other tier's row to an address its bytes are not at.

Lives in `apps/images/src/rekeySet.ts` as `rekey:set` (B1: commands go where the contract
lives, not in a loose script), with the `moveObject` primitive in
`packages/storage/src/object-store.ts`. Guarded like the importer's own detection: the new
set id must exist in `card_set` and the old must not.

**Found while verifying, worth keeping:** the first `--dry-run` reported 5 of 240 objects
"missing" that answer 200 on every subsequent request. `headObject`/`objectExists` return
null for both *"not there"* and *"could not ask"*. That conflation is harmless for the lazy
fill — worst case a re-fetch — but not for a bulk tool where the answer decides whether an
asset is skipped. A negative is now only believed after three attempts; a positive needs
none, since nothing invents an object.

**Verified, not asserted.** Both tiers, 240/240, 0 failures each. Row snapshots taken
before and after are **byte-identical** on both databases (kind, content_type, byte_size,
source_url, etag, fetched_at, last_access_on, is_pinned, and the per-tier size/type/etag);
disk file MD5s identical; old object keys now 400, new ones serve 200.
`manifest:check` **CLEAN** (47,924 files / 47,924 rows, 0 orphans) and
`manifest:check --object-store` **CLEAN** (2,946 objects / 2,946 rows, 0 unrecorded, 0
missing, 0 etag mismatches). In a real browser against production, all 30 `swsh9tg` cards
plus three from each of the other three sets decode at 300×418 from
`deckpal.app/deckpal/images/…` — 39/39 real art, zero placeholder headers, zero non-2xx.
(The SPA's set page is behind auth and no throwaway user was created for this; the
verification exercises the exact image URLs that page renders.)

Cloud cards with no art: **894 → 774**. The remaining 774 are absent from *both* tiers, so
`storage:backfill` cannot reach them either — this was never a mirroring gap. Sampled one
card from each of the ten largest holes (B2a, mfb, the tk-* Trainer Kits, mep, P-A,
cel25cc, ecard2, swshp): every one 404s upstream on `.webp`, `.png` and `.jpg`. MEP 087 is
not the exception, it is the rule. They need third-party sourcing (`warm:pkmn`, the
`fill-missing-assets` skill), not a backfill — a separate task.

### Part 2 — the schedule that should have caught it

`.github/workflows/catalog-refresh.yml`, Sundays 04:30 UTC plus `workflow_dispatch`.

**Weekly, at apps/sync's own `SCHEDULE.catalog` slot**, so the workflow is that stub made
real rather than a second competing answer to "when does the catalog refresh". Weekly is
the right grain: main sets ship quarterly but the churn that bites is continuous drip —
promos, Trainer Kits and Trainer Gallery subsets filled in weeks after a set is "done",
MEP going 60→89 post-ship. Weekly bounds staleness at 7 days against the 17 that produced
issue #21, where daily would spend a 460 MB pull and a production write seven times to
observe the same no-op six of them. `workflow_dispatch` covers "a set just dropped".

It calls `scripts/refresh-catalog.sh` rather than re-implementing the extraction, so B3
(never start the TCGdex server) keeps one enforcement point. `PGPOOL_MAX=1`, one
`concurrency` group that queues rather than cancels, no `continue-on-error` anywhere.

**It does not swallow the two defects `5ce5570` fixed.** Both abort the whole import
rather than skip a row, so they land as a red run — and when the summary file is missing
the job summary says which two shapes to look for instead of leaving 400 log lines. And a
**rename now fails the job on purpose**, after the import has committed: the catalog is
correct at that point, but the art is stranded exactly as it was here, and a green run
nobody reads is precisely how that recurs. The importer's `ImportSummary` now carries the
`{from,to,name}` pairs, so the summary prints the exact `rekey:set` commands for both
tiers. B8 makes the re-run free, and it goes green by itself once the re-key is done
(our id then equals upstream's, so there is no rename to detect and no override to
remember).

Secrets the owner must add — Settings → Secrets and variables → Actions, values taken
verbatim from `.env.cloud`: **`SUPABASE_DB_HOST`** (`PGHOST`), **`SUPABASE_DB_NAME`**
(`PGDATABASE`), **`SUPABASE_DB_USER`** (`PGUSER`), **`SUPABASE_DB_PASSWORD`**
(`PGPASSWORD`), and optionally **`SUPABASE_DB_PORT`** (`PGPORT`, defaults to 5432).
Nothing else — the importer touches Postgres only. They were **not** set by this agent
(B9); until they exist the first step fails with one line naming the missing ones rather
than an ECONNREFUSED to 127.0.0.1 forty seconds later.

**What could and could not be verified.** `act` and `actionlint` are not on this box, so
the workflow was not executed by GitHub's runner. What *was* run: the YAML parses to the
expected trigger/step graph; and the entire pipeline the job performs — image pull,
B3-safe `docker create`+`docker cp` extraction, delta report, import, summary JSON,
rendered job summary, gate — end to end against the local `pokedex` database, where it
came out a clean idempotent no-op (23,546 → 23,546 cards, `renamedSets: 0`, gate exit 0).
The rename branch was then exercised against a crafted summary: correct markdown, correct
`rekey:set` commands for both tiers, gate exit 1 with a `::error::` annotation; likewise
the crashed-import branch (no summary file) and the unconfigured branch. What remains
unproven until the owner adds the secrets is only the credential plumbing itself — the
`secrets.* → PG*` mapping and the TLS handshake to Supabase from a runner.

**Implications:** `image_asset.cache_key` and `relative_path` are derived addresses, not
identity — the bigint PKs are identity in the catalog, and in the image tier identity is
the asset, so a re-address must move rows and bytes together or move neither. Any future
upstream re-key is now two commands and two clean manifest checks. Also worth flagging
for the deck lane: `apps/api/src/deck/data/ptcgl-set-alias.json` and
`banlist-expanded.json` still map `BRS-TG`/`ASR-TG`/`LOR-TG`/`SIT-TG` to the OLD
`swshN.5tg` ids, which no `card_set` row holds any more — a separate break from the same
rename, left for that lane rather than fixed blind from here.

