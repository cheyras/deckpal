---
date: "2026-08-10"
title: "The hosted card scanner matched nothing: it died at `spawn magick` (#20)"
decided_by: "agent on behalf of @cheyras (reported through the in-app reporter"
areas: ["scanner","catalog"]
supersedes: []
---
## 2026-08-10 — The hosted card scanner matched nothing: it died at `spawn magick` (#20)

**Decided by:** agent on behalf of @cheyras (reported through the in-app reporter
— issue #20, "Card scanner isn't detecting any card", /scan on an iPhone at 428px).

**Decision:** un-park the scanner. Rank in SQL against `card_image_phash` with
native `bit_count`, decode with `sharp` instead of a shelled-out ImageMagick, and
bump `ALGO` to `dhash8v3` with a full re-index. `ARCHITECTURE.md` §10 and
`AGENTS.md` B5 no longer describe the scanner as parked, because it isn't.

### The failure mode was not the one the docs predicted

`ARCHITECTURE.md` parked the scanner on the in-memory index — "~23k hashes in
typed arrays, incompatible with serverless" — and that is true, but it is not what
users were hitting. Authenticated against prod, a scan answers:

```
HTTP 400  could not decode the uploaded image:
          imagemagick spawn failed (magick): spawn magick ENOENT
```

The request died at the **decode**, before it ever reached the index. The scanner
shelled out to `magick` — a deliberate choice, recorded as "no native deps" — and a
Vercel function has no system ImageMagick. Every scan, every frame, 100% of the
time, since the cloud pivot.

The reporter saw none of that. The live camera loop swallowed non-abort errors on
purpose ("transient decode/network blip — keep looping, don't nag the user"), so a
totally dead scanner and a badly framed card are the same UI: "Point the camera at
a card", forever. **That silence is the reason this arrived as "isn't detecting any
card" rather than as an error.** The loop now stops and shows the message after
three consecutive failures — one blip stays silent, a broken scanner does not.

### Why the decoder had to change, and why that forced a re-index

`sharp` ships prebuilt binaries for both deployments, so it is the one decoder that
works in a function *and* on the Pi. But it is not interchangeable with ImageMagick:
measured over 300 cached cards, sharp's 72×64 grayscale field yields a dHash **0–9
bits away from ImageMagick's, median 2**. Against a threshold of 9 that is not a
rounding difference, it is most of the budget. The v2 index was therefore unusable
and all 22,652 hashes were recomputed as `dhash8v3` (~120 s, 188 cards/s). sharp is
also ~8× faster per image (1.5 ms vs 12.3 ms), which is what made re-indexing cheap.

The `algo` column is what makes this safe: the matcher filters on it, so a
half-migrated index under-reports matches and can never mis-report them.

### Matching in SQL, and the two measurements that shaped the query

`bit_count(a # b)` is native from PG 14; Supabase runs 17.6. The whole ranking is
one query and the table is the index, so an indexer run is live immediately, with
no restart on either deployment (B5 rewritten accordingly).

Two things cost 3× each and both are now closed:

- **`bytea` has no XOR in Postgres.** Only `bit` does. Converting per row per probe
  measured **190 ms**; a `GENERATED ... STORED` `bit(64)` mirror (migration **030**)
  brings it to **64 ms**. The hash stays `bytea` because that is what round-trips to
  a JS bigint; the generated column means no writer can set one and forget the other.
- **A parameter is not a constant at plan time.** The probe hashes have to be fenced
  in a `MATERIALIZED` single-row CTE or Postgres re-runs the hex→bit conversion per
  row per probe — the identical trap on the query side of the XOR.

Live cloud numbers: **22,652 rows × 34 geometry probes = 770k popcounts, 69 ms of
server time**, 98 ms wall from this Pi. Metadata hydration and the `indexSize` count
are folded into the same statement, so a scan costs the connection budget exactly
one query (B2). End to end from the Pi through Vercel: 340–430 ms warm.

Also fixed in passing: `bit_count` returns **BIGINT**, which node-pg hands back as a
*string*. `distance` was reaching the client as `"0"`. It only looked correct
because `"0" <= 9` coerces. Cast `::int`.

### Upload path

Vercel rejects a request body over 4.5 MB before the handler runs, and iOS hands the
file picker HEIC that no server-side decoder here reads. Both are one fix in the
client: anything large or unsupported is redrawn through a canvas and re-encoded as
a ≤1400px JPEG, which also bakes in EXIF rotation — a portrait phone shot was
previously at risk of being hashed sideways, which no ±12° rotation probe recovers.
Small JPEG/PNG/WebP still go byte-for-byte, so catalog art self-matches at 0.
`MAX_UPLOAD` drops 15 MB → 4 MB, and an oversize body now answers 413 with a reason
instead of 500 (body-parser's `entity.too.large` was reaching the generic handler).

### Proof

Against the **live cloud index**, not a fixture: 20/20 sampled cards self-match at
distance 0 — and the query hash computed on this arm64 Pi is byte-identical to the
one the x86-64 function computes for the same file, so the pipeline is deterministic
across architectures, which a shared index depends on.

Then 60 cards × 7 degradations = **389 scans**: re-encode, JPEG noise, 4° and 8°
tilt on a mat, off-centre on a mat, 7.5% keystone, dim + glare.

| | distance to the correct card |
|---|---|
| p50 | 3 |
| p90 | 8 |
| p95 | 9 |
| p99 | 12 |

Five synthetic no-card frames (gradient, plasma, noise, bare mat, printed text)
bottom out at **10, 15, 15, 15, 13**. So the threshold stays **9**: 96.9% of correct
scans fire, every junk frame is rejected, and 10 would already admit the plasma
frame. The old 99.6% figure was measured on the v2 pipeline against a different
degradation set and does not carry over; 96.9% is the honest number for v3.

Verified in a real browser on deckpal.app as a throwaway confirmed user (since
deleted), at 1440 and at **390** — the reporter's viewport. Uploaded a deliberately
messy Base Set Charizard (6° tilt on a grey mat, noise, q62) through the actual file
input: five matches, best **Charizard · Base Set 2 #004 · 92% · dist 5**, Base Set
#004 behind it at 91% · dist 6. Zero console errors. The page's own copy reads
"22,652-card catalog", pulled live from the query's count — so the SQL path is
demonstrably what rendered.

That top-two pair is not a defect worth hiding: Base Set and Base Set 2 share the
identical artwork, so no perceptual hash can separate those prints from a photo. The
UI shows both rather than guessing, which is the same posture as `matched: false`.

### Known gap

120 Trainer Gallery cards (`swsh9tg`/`10tg`/`11tg`/`12tg`, 30 each) still carry v2
rows and are excluded from matching: their cached art sits under the post-rename
`swshN.5tg` ids, so the indexer found no file to hash. Same root cause as the
image_asset orphans already logged under #21, and it resolves when that art is
re-keyed. Coverage is 22,652 of 23,546 cards; the rest have no cloud art at all.

### Note on the commit

The code landed inside `4185bc1` ("fix(profile): no hole in the avatar disc…"). That
commit staged one explicit path; the mechanism was subtler and is worth writing down
for anyone else sharing a working tree: **`git commit` commits the whole index**, and
these seven scanner files were already staged in that same index. Explicit `git add`
is not sufficient isolation when several agents share one checkout — only the
pathspec form is:

```
git commit -F <msgfile> -- <path> ...   # commits ONLY these paths, whatever else is staged
```

The content is correct and pushed, so it was not rewritten — rebasing shared history
under a live swarm costs more than the mislabelling. This entry is the record
`git log` cannot give for `apps/api/src/scan/{phash,router}.ts`,
`apps/web/src/routes/Scan.tsx` and migration 030. Deployed as
`dpl_GYaFaG7YzgRrcCkV7bguyrP8kBEb`.

---

