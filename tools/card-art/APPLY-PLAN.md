# Apply plan — replacing the out-of-policy card-art bytes

**Project Holo subtask 2c. PREP artifact, UNTRACKED. Nothing here has been run
against production; every step below is for the operator.**

Prepared 2026-08-31. Companion documents: `STORAGE-MAP.md` (where the bytes are,
with citations), `research/CARD-ART-SOURCES.md` (the source policy).

---

## What PREP produced (everything under `tools/card-art/`, all untracked)

| File | Role | Commit it? |
|---|---|---|
| `STORAGE-MAP.md` | where a card image lives end to end, with citations | optional — good `research/` material |
| `APPLY-PLAN.md` | this file | no |
| `dump-affected.sql` | the one read-only row dump | **yes** — it is the reproducible measurement |
| `build-crosswalk.mts` | builds the crosswalk from two public APIs | **yes** |
| `crosswalk.json` | the built crosswalk (regenerable) | optional; large |
| `resource-assets.mts` | the re-sourcing pipeline | **yes** |
| `rederive-residue.mts` | re-measures `card-art-residue.json`'s 504 against the crosswalk | **yes** |
| `http.mts` | politeness + retry layer both scripts share | **yes** |
| `affected.sample.json` | synthetic fixture used to smoke-test the pipeline | no |
| `tsconfig.check.json` | typechecks the `.mts` files standalone | optional |
| `.raw/`, `stage/`, `out/`, `affected.json` | caches, bytes, generated output | **no** — add to `.gitignore` |

Suggested `.gitignore` additions if any of this is committed:

```
tools/card-art/.raw/
tools/card-art/stage/
tools/card-art/out/
tools/card-art/affected.json
```

---

## 0. Preconditions

- [ ] The owner has approved **pokemontcg.io** as a card-art source
      (`research/CARD-ART-SOURCES.md` §7 asks for exactly this decision and it
      is still open). Nothing below should run before that.
- [ ] A DECISIONS.md entry recording the approval, the date, and the licensing
      basis — required by `packages/storage/src/upstream.ts:60-67`.
- [ ] `.env` loaded: `set -a && . ./.env && set +a`. Needs `DATABASE_URL`/`PG*`,
      `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Decide **`--encode`** (step 3). Measured: verbatim PNG is ~9.5× the bytes
      of WebP — roughly 800 MB vs ~85 MB across the affected rows.

---

## 1. Dump the affected rows (read-only, one round trip)

```bash
psql "$DATABASE_URL" -X -A -t -P pager=off -v ON_ERROR_STOP=1 \
     -f tools/card-art/dump-affected.sql > tools/card-art/affected.json

node -e "const j=require('./tools/card-art/affected.json'); \
         console.log(j.summary); console.log(j.manifestTotals); console.log(j.byHost)"
```

**Check against the 2026-08-31 measurements before going further:**
`summary.nullSource` should be ≈ **1,854**, `summary.unapprovedHost` ≈ **58**,
and `bySeries` should look like swsh 660 / sm 460 / mc 332 / sv 120 / ecard 94 /
me 56 / ex 54 / hgss 18 / xy 8 / pop 4 / misc 2 / pl 2 / bw 2. A large
disagreement means the dump is measuring something other than what the plan was
built for — stop and reconcile rather than proceeding.

Also note `summary.orphanRows` (manifest rows whose card is not in the catalog)
and `cardsWithNoAssetRow` (the `card-art-residue.json` population, ~592) — both
feed the no-art list.

## 2. Build the crosswalk (read-only, public APIs) — ALREADY DONE

**Built 2026-08-31. `tools/card-art/crosswalk.json`, 6.3 MB.**

| | |
|---|---|
| TCGdex sets covered | **173 mapped / 45 unmapped** of 218 |
| match rungs | 118 `id`, 29 `manual`, 26 `name+count`, 0 `name`-only (so **nothing carries `review: true`**), 2 `known-absent` |
| TCGdex cards resolved | **20,368 of 23,546** |
| refusals *inside* mapped sets | **61** — 31 `ambiguous`, 17 `name-mismatch`, 13 `no-such-number` |
| **swsh-TG (the 120)** | **120/120**, all four sets, identical set ids and identical `TG01…TG30` numbers, zero name mismatches, every card has both image sizes |

Of the 45 unmapped sets, 4 hold no cards (`wp`, `jumbo`, `sp`, `rc`), 20 are the
TCG-Pocket / JP catalogues (`A*`, `B*`, `P-A`) which the EN image tier does not
serve, and the rest are the classes `CARD-ART-SOURCES.md` §2.2 already measured
as absent: the 17 non-EX Trainer Kits, `mfb`, `xya`, `ex5.5`, `exu`, `miscp`,
`fut2020`, `mee`, `mep`, `2023sv`, `2024sv`.

**Two refusal classes are worth a human look before step 4** — the crosswalk
refuses them on purpose, but both are almost certainly safe to accept by hand:

- 16 `sve` basic-energy cards: TCGdex says `Grass Energy`, pokemontcg.io says
  `Basic Grass Energy`. Numbers match exactly.
- `base4-102`: TCGdex `Impostor Professor Oak` vs pokemontcg.io
  `Imposter Professor Oak` — one letter.

Do not loosen `cardNamesAgree` to sweep these in; add them to `MANUAL_SET_MAP`'s
sibling (a per-card override) or accept them individually with the evidence
recorded. The other 44 refusals (`ecard2` 50a/50b-class splits, `svp` promo
reprints, `sve` 17-24) are genuinely ambiguous and must stay refused.

### To rebuild it

```bash
npx tsx tools/card-art/build-crosswalk.mts
```

Re-run only to refresh. It caches raw upstream JSON in `tools/card-art/.raw/`
(183 files, already populated), so a re-run after an interruption resumes and a
re-run with the cache intact is nearly free. **From cold, expect 45-90
minutes** —
`api.pokemontcg.io` fails ~30% of requests at random and goes fully dark for a
minute at a time; the retry ladder in `http.mts` is tuned for exactly that and
its comment records the measurements.

## 3. Dry run, then fetch

```bash
# resolve everything, download nothing — read the report first
npx tsx tools/card-art/resource-assets.mts
cat tools/card-art/out/report.md

# then actually fetch + measure + stage
npx tsx tools/card-art/resource-assets.mts --fetch            # WebP, the default
# or, for byte-exact upstream provenance at ~9.5x the storage:
npx tsx tools/card-art/resource-assets.mts --fetch --encode none
```

Downloads run at ≤5 req/s and ≤2 concurrent (the same budget
`apps/images/src/config.ts` uses for TCGdex). Resumable: a staged file that
still measures correctly is not re-fetched.

Outputs land in `tools/card-art/out/`:

| File | What it is |
|---|---|
| `report.md` | the human summary — read this before applying anything |
| `plan.json` | per-row decision, resolved URL, measured dimensions, md5/sha256 |
| `apply-source-urls.sql` | the provenance UPDATEs (guarded, idempotent) |
| `apply-unavailable.sql` | the manifest DELETEs for cards with no approved source |
| `delete-objects.json` | the bucket objects to remove for those same cards |
| `card-art-unavailable.json` | the published no-art list (copy into `research/`) |

Bytes land in `tools/card-art/stage/`, laid out **exactly** as
`IMAGE_CACHE_ROOT` — `images/en/{serie}/{set}/{localId}.{quality}.webp`.

**Review `report.md` before step 4.** In particular the `undersized` count (an
asset smaller than the `srcSet` width the app advertises) and every reason in
the unavailable table.

## 4. Publish the bytes — through the shipped choke point

```bash
IMAGE_CACHE_ROOT="$PWD/tools/card-art/stage" \
  pnpm --filter deckpal-images storage:backfill -- --prefix images --force --dry-run

IMAGE_CACHE_ROOT="$PWD/tools/card-art/stage" \
  pnpm --filter deckpal-images storage:backfill -- --prefix images --force --concurrency 3
```

- `--force` skips the "already there?" HEAD and uploads, which is what a
  **replacement** needs. `uploadObject` sends `x-upsert: true`
  (`packages/storage/src/object-store.ts:159-186`), so the old bytes are
  overwritten in place. **There is no delete step for a replaced asset.**
- The work-list is every `image_asset` row under `images/`, but only the ~1,850
  files that exist in the stage tree are uploaded; the rest are counted as
  `missingFiles` and skipped (`cloudBackfill.ts`, the `stat` branch). That is
  the intended behaviour, not an error.
- `--concurrency 3`: Supabase Storage answers `429 too_many_connections` above
  about five parallel uploads (measured 2026-08-10, recorded in
  `object-store.ts`).
- `--missing-source --force` is a tighter work-list (exactly the
  `source_url IS NULL` rows, ~1,854 instead of ~42,000) and is valid **only
  while step 5 has not run yet** — after the UPDATEs those rows no longer match.
  It also misses the ~58 unapproved-host rows, so `--prefix images` is the one
  that covers everything in a single pass.

## 5. Attribute the bytes

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tools/card-art/out/apply-source-urls.sql
```

**After the upload, never before** — the file's own header explains why: a
failed upload after a successful UPDATE leaves a manifest row that lies about
where the bytes came from, whereas a failed UPDATE after a successful upload
leaves a row that is merely still silent.

## 6. Remove what has no approved source

```bash
# a) delete the objects (uses the shipped deleteObject, no new write path)
node --import tsx -e "
  import { deleteObject } from '@deckpal/storage';
  import { readFileSync } from 'node:fs';
  const { objects } = JSON.parse(readFileSync('tools/card-art/out/delete-objects.json','utf8'));
  for (const o of objects) console.log(o.relativePath, await deleteObject(o.relativePath));
"

# b) then the manifest rows (CASCADEs to image_object)
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tools/card-art/out/apply-unavailable.sql
```

Objects first, rows second. The reverse leaves bytes in the bucket that no
manifest row accounts for — the drift contract B1 forbids, one tier up.

### The 592-card residue, re-measured against the crosswalk

```bash
npx tsx tools/card-art/rederive-residue.mts
```

Measured 2026-08-31 — this is a **different population** from the affected rows
(cards with no bytes at all, vs cards with unattributed bytes), and both feed
the no-art list:

| | 2026-08-26 record | re-derived 2026-08-31 |
|---|---|---|
| covered by an approved source | 88 | **107** |
| no approved source | 504 | **485** |

The +19 comes almost entirely from `cel25cc`: `CARD-ART-SOURCES.md` §2.2 could
only hand-check that `CC001` maps to `cel25c/1_A` and stopped. The crosswalk's
name rung resolves all **25 of 25**, because pokemontcg.io reports a distinct
image URL per printing even where four cards share the number `15`. Smaller
gains in `bwp`, `dc1`, `swshp`, `ecard2`, `ecard3`.

The residual 485 is: 437 in unmapped sets (the 17 Trainer Kits are 401 of
those), 40 `set-not-carried` (`mfb` 34, `xya` 6), 7 `ambiguous`, 1
`no-such-number`. **`research/card-art-residue.json`'s `504` should be updated
to `485`** when the no-art list is published, with this script named as the
measurement.

## 7. Publish the no-art list

```bash
cp tools/card-art/out/card-art-unavailable.json research/card-art-unavailable.json
```

Commit it alongside a `research/CARD-ART-SOURCES.md` note pointing at it, and a
DECISIONS.md entry. It satisfies the 2c checklist item *"every `image_asset` row
has an approved `source_url`, or the card is on a published no-art list"*.

---

## What PREP already verified (so you are not re-proving it)

Nothing below touched production. Evidence is in `tools/card-art/out-sample/`.

- **`dump-affected.sql` runs and returns the right shape.** Executed against a
  PGlite instance carrying the real `image_asset` / `image_object` / `card` /
  `card_set` / `series` column definitions, seeded with a null-source row, an
  unapproved-host row, an approved-host row, an orphan row, a non-card row, and
  a card with no asset row at all. Every one landed in the right bucket, the
  `bySeries` / `bySet` / `byHost` rollups were correct, and `objectTiers` folded
  both tiers onto the right key.
- **The pipeline runs end to end.** `resource-assets.mts --fetch` over an
  18-row synthetic dump: 12 staged, 6 correctly refused
  (`set-not-carried` ×2, `number-ambiguous` ×2, `number-no-such-number` ×2). The
  staged tree came out at exactly `images/en/{serie}/{set}/{localId}.{quality}.webp`.
- **The staged bytes are real images at the right sizes.** Re-decoded every one:
  e.g. `swsh9tg/TG01.high.webp` 600×837 at 104 KB, `base1/4.low.webp` 240×330 at
  21 KB (flagged `undersized`, correctly).
- **`apply-source-urls.sql` applies, is idempotent, and its guard works.** Run
  twice against PGlite: 11 rows attributed both times, and a row pre-seeded with
  an `assets.tcgdex.net` `source_url` was left untouched.
- **`apply-unavailable.sql` deletes the right rows and CASCADEs.** 18 rows →
  12, and `image_object` followed 18 → 12.
- **Upstream availability spot-checked**, 27 cards across every era —
  `base1`, `base2`, `neo1`, `ecard1`, `ex1`, `pop1`, `dp1`, `pl1`, `hgss1`,
  `col1`, `bw1`, `xy1`, `sm1`, `sm35`, `det1`, `swsh1`, all four TG sets,
  `cel25c`, `tk2b`, `bp`, `mcd16`, `sv1`, `sv8pt5`, `me2`. 26 of 27 answered
  200 for both sizes; the one 404 was `cel25c/1_A`, which is the composed-URL
  trap and is exactly why the crosswalk stores upstream's own URLs instead.
- **TCGdex genuinely 404s the TG cards**, re-verified today:
  `swsh9tg/TG01` and `swsh12tg/TG01` return 404 for `.webp`, `.png` AND `.jpg`,
  and so does the retired `swsh9.5tg` id.

## Verification

Run all of these; each one is a different way for the work to be wrong.

### The counts that must go to zero

```sql
-- 1. No card asset left without an approved source. MUST BE 0.
SELECT count(*) FROM image_asset
 WHERE kind = 'card'
   AND (source_url IS NULL
        OR lower(substring(source_url from '^[a-z]+://([^/:?#]+)'))
             NOT IN ('assets.tcgdex.net','raw.githubusercontent.com','images.pokemontcg.io'));

-- 2. No row anywhere still on a retired host. MUST BE 0.
SELECT count(*) FROM image_asset
 WHERE source_url IS NOT NULL
   AND lower(substring(source_url from '^[a-z]+://([^/:?#]+)'))
        NOT IN ('assets.tcgdex.net','raw.githubusercontent.com',
                'images.pokemontcg.io','archives.bulbagarden.net');

-- 3. Re-running the dump returns an empty `rows` array.
```

`tools/card-art/out/apply-source-urls.sql` already ends with query 1.

### The bytes actually changed

For a sample of ≥10 replaced assets, take `relativePath` and `stored.md5` from
`plan.json` and:

```bash
curl -sI "$SUPABASE_URL/storage/v1/object/public/card-art/<relativePath>" \
  | grep -Ei 'etag|content-length|content-type'
```

Supabase's object `etag` **is the MD5 of the content** — verified twice by this
project (`put-asset.ts`, 1,854 backfilled objects). It must equal
`plan.json`'s `stored.md5`. If it equals the OLD value, the CDN is serving a
cached copy; see the risk note below.

### The tier's own tripwire

```bash
pnpm --filter deckpal-images manifest:check -- --object-store
```

Must report no rows-without-objects, no objects-without-rows, and no
size/etag mismatches for the touched paths.

### The tier's own residue sweep

```bash
pnpm --filter deckpal-images warm:cloud -- --dry-run
```

The residue file it writes should shrink by the number of assets replaced, and
what remains should be exactly the cards in
`research/card-art-unavailable.json`. Compare the two lists directly — a card in
the residue but not on the list is an unaccounted gap.

### Visual spot check

Open ≥10 replaced cards in the app across eras, at 1× and 2×, including at least
two of the 120 swsh-TG cards and two `undersized` ones. Confirm real art, correct
card, no placeholder. The 2c checklist calls out the TG cards specifically.

### The 2c checklist items this closes

- [ ] every `image_asset` row has an approved `source_url`, or the card is on a
      published no-art list
- [ ] the 120 swsh-TG cards are either re-sourced or explicitly listed as
      unavailable

---

## Open risks

1. **CDN staleness.** The image route answers a hit with a 302 carrying
   `immutable, max-age=31536000`, and the object itself is stored with
   `cache-control: max-age=31536000`. An overwrite at the same key may keep
   serving the OLD bytes from Supabase's CDN, Vercel's CDN, and browsers. The
   *origin* object is replaced, so DeckPal no longer hosts the out-of-policy
   bytes — but verify with the etag check above. If Supabase does not invalidate
   on upsert, fall back to delete-then-upload per object (a brief 404 window per
   asset, during which the tier serves its placeholder).

2. **`images.pokemontcg.io` is not on `IMAGE_SOURCE_HOSTS`, and this plan does
   not add it.** Nothing in the plan needs it — the upload reads bytes off local
   disk. The consequence is that a re-sourced asset whose object is later lost
   will **not** self-heal: the lazy fill will try the recorded pokemontcg.io URL,
   the allow-list will refuse it, and the card will serve the placeholder.
   Adding the host is a separate, deliberate decision with its own DECISIONS.md
   entry (`upstream.ts:60-67`). Put it to the owner rather than deciding it here.

3. **The crosswalk's weak rungs.** Sets matched on `name` alone (rather than
   `name+count` or an identical id) carry `review: true` in `crosswalk.json`.
   Skim those before step 4; a wrong set mapping is a whole set of wrong art.

4. **`--encode webp` writes `etag` NULL.** That is deliberate and documented, but
   it means `manifest:check` cannot validate those rows against upstream. Choose
   `--encode none` if that matters more than the ~715 MB.

5. **Deleted assets cost a TCGdex 404 per cold view, forever.** With no object
   and no manifest row, the handler falls through to the canonical TCGdex
   derivation (`handler.ts` `resolveSourceFromManifest`, the "missing row is not
   a dead end" case), gets a 404, and answers the placeholder with a 60-second
   TTL. That is the honest outcome the handler was deliberately written to give
   — but it means a few hundred no-art cards each generate an upstream 404 on
   every cold edge. Acceptable, bounded by the short TTL, and worth naming so it
   is not later mistaken for a bug.

6. **The `card_variant` half of 2c is untouched here.** 103 rows carrying the
   retired `source` value, and the CHECK-narrowing migration, are step 5 of the
   2c task and independent of the bytes. Migration `052_remove_pkmn_source.sql`
   already exists in the tree — confirm whether it has been applied.
