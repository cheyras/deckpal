---
date: "2026-08-10"
title: "the 1,854 unrecoverable card images, and an audit of how they arrived"
decided_by: "agent on behalf of @cheyras."
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-10 — the 1,854 unrecoverable card images, and an audit of how they arrived
**Decided by:** agent on behalf of @cheyras.

**Context:** 1,854 `image_asset` rows carry `source_url IS NULL` — their canonical
TCGdex URL 404s, so the cloud tier's lazy fill can never recover them and they
served the placeholder. Measured before acting: **1,854 rows, 1,854 files present
on disk, 126,884,794 bytes (121.01 MiB)**, recorded `byte_size` matching actual
on-disk size exactly, split 927 `low` + 927 `high`. Supabase plan read from the
management API rather than assumed — `"plan": "free"`, so **1 GB**; usage across
both buckets was 156,579,648 bytes (**14.6%**), far below the 60% stop-line, so no
Pro decision was needed.

**Found on arrival:** the bytes were already in the bucket. An out-of-band run of
`scripts/storage-backfill.mjs` (since committed by another session as `a4ac5f7`)
uploaded all 1,854 between 04:00 and 04:05 UTC, before this work started. That
script writes objects directly rather than through `putStorageAsset`.

**So they were audited rather than trusted, and the method matters more than the
verdict:** Supabase stores a content MD5 as each object's etag, which makes a full
content check free and local. Every one of the 1,854 was verified, not a sample —
**1,854/1,854 object sizes matched the on-disk file, and 1,854/1,854 MD5s of the
local file matched the object's stored eTag.** Object keys are `relative_path`
verbatim; **0** objects outside `images/`, `sets/`, `sprites/`; **0** non-sprite
objects with no `image_asset` row. Content types came back 1,824 `image/webp` +
30 `image/png`, which is the known "30 cached `.webp` files are actually PNG
bytes" population — the sniffer doing its job, not an anomaly. Nothing needed
re-filling.

**Provenance stayed honest.** These have no resolvable upstream URL, so the
mirror path records `unknownProvenance(...)` with a reason that says *why* —
"canonical TCGdex URL 404s and `manifest:backfill` therefore left `source_url`
NULL rather than guessing" — never a plausible URL. `putStorageAssetFromFile()`
is the new explicit local-file entry point; it is `putStorageAsset` with the bytes
read off disk, and it has **no default provenance argument**, because reading a
file establishes nothing about where its contents came from.

**Supported path is now a module command**, per B1's "no loose fill scripts under
`scripts/`": `pnpm --filter deckpal-images storage:backfill`
(`--missing-source` / `--prefix` / `--reconcile`), idempotent and resumable — an
object already in the bucket is not re-sent, but its per-tier row is still
recorded from the object's own metadata, which is what makes a re-run repair a
partial one. Proven end to end by deleting a live object and re-running: 1 upload,
1,769 skipped-and-recorded, 0 failures.

**`scripts/storage-backfill.mjs` is superseded and was deliberately left in place.**
It belongs to another live session; deleting a peer's committed work was escalated
rather than assumed, and the owner will decide. It cannot write `image_object`
rows, so objects it creates will be reported by `manifest:check --object-store` as
"objects with no row" — the checker's output names the cause and the repair command
so the next person is not left guessing. `DEPLOYMENT.md` now points at the module
command instead.

**Correction to a reported bug:** a perf audit reported Storage objects serving
`cache-control: no-cache`. That is a **HEAD-request artifact** of Supabase's public
endpoint, not a real header. Same object, same second: HEAD → `no-cache`, GET →
`public, max-age=31536000`, and Cloudflare caches it (MISS then HIT on the second
GET). All objects already carried `metadata->>'cacheControl' = 'max-age=31536000'`.
Nothing was re-uploaded to "fix" a non-bug. The prod page-load numbers that
prompted it need a different explanation — most likely the cross-origin 302
double-hop against a bucket that was hours old and still filling.

**Verification:** migrations 001→025 applied uninterrupted on two fresh scratch
databases — plain Postgres (021/023 correctly skipped) and `SUPABASE_MODE=1` with
auth stubs (all 25 applied, and the runner's orphaned-`app_user` preflight fired
as designed). Both dropped afterwards. `image_object`'s tier CHECK, `byte_size`
CHECK, composite-PK upsert, FK rejection and ON DELETE CASCADE were each exercised
directly. Workspace typecheck clean, 33 image tests + 49 deck tests pass, Pi
`manifest:check` CLEAN (exit 0) including `--deep`.

