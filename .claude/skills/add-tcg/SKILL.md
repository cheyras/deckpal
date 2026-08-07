---
name: add-tcg
description: Onboard a new trading card game into this collection tracker — or fill catalog/image gaps in an existing one. The agent researches the best open data + image sources for the game, maps them to the game-agnostic schema, populates the catalog, sources and optimizes card art (with fallbacks), and rebuilds the scan index. Use when the user wants to add a TCG (Magic, Yu-Gi-Oh, Lorcana, One Piece, …), refresh a catalog after a new set, or fix missing card images. The reference implementation is Pokémon (TCGdex + TCGCSV + pkmn.gg).
---

# add-tcg — populate a TCG catalog and its imagery

This app was built for Pokémon but the **data model, image cache, and scanner are
game-agnostic**. This skill is the playbook for pointing an agent at *any* TCG and having it
research the sources, load the catalog, source + optimize the card art, and index it for the
scanner. It also covers **filling image/catalog gaps** in a game that's already loaded.

**Golden rule: verify, don't trust.** Every step ends by checking the real artifact (query
the DB, `curl` a served image, scan a known card) — never a source's own success report. Most
of the hard lessons below came from a report saying "done" when nothing had actually landed.

---

## The mental model — four layers, one schema

A TCG in this app is four data layers, in dependency order:

1. **Catalog** — series → sets → cards → variants/printings. The spine everything hangs off.
2. **Images** — card art (two resolutions) + set logos/symbols, served from a local WebP cache.
3. **Prices** *(optional)* — per (variant, source, currency), append-only history + latest.
4. **Scan index** *(optional)* — a perceptual hash per cached card image, derived from layer 2.

The **schema is already game-neutral** (`research/SCHEMA.md` is canonical — read it before
mapping anything). The core tables:

| Table | Holds | Notes |
|---|---|---|
| `series` / `card_set` | eras and sets | `tcgdex_id`/`slug`/`name`/release date; images keyed off these |
| `card` | one row per card | `set_id`, `local_id` (opaque text) + `local_id_numeric`, `serie`/`set` used for the image path |
| `variant_kind` | the *global* vocabulary of printings | open-enum-as-data; typed facet columns (finish/foil/stamp/…); a new printing is an INSERT, never DDL |
| `card_variant` | one row per (card, printing) | the unit of ownership + pricing + third-party ids |
| `price_current` / `price_observation` | latest + history | keyed by (variant, source, currency) |
| `card_image_phash` | dHash per (card, quality) | drives the offline scanner |

**Why this is TCG-agnostic:** every game expresses "the same card in different printings"
(MTG: nonfoil/foil/etched/promo; Yu-Gi-Oh: rarities/editions; Pokémon: normal/reverse/holo/
1st-edition/stamps; Lorcana: normal/foil/enchanted). All of them map onto
`variant_kind` (the printing vocabulary) + `card_variant` (the per-card instance). You add a
game by mapping its source's fields onto these columns — you do **not** change the schema.

---

## The workflow

### Step 1 — Research the sources (do this first, write it down)

For the target game, find the best **catalog** source and **image** source (often the same
one). Produce a short research note the user can approve before you load anything. Evaluate
each candidate on:

- **Coverage** — every set + card, including promos/energies/tokens/special products (these
  are exactly the sets that get omitted; see the gaps lesson below).
- **Structure & stable IDs** — machine-readable, one stable id per card/set, printings modeled.
- **Bulk vs per-request** — strongly prefer a bulk/compiled download or dump over per-card
  API calls. Per-card fan-out over 20k cards is slow and rude.
- **Images** — resolutions available, direct URLs vs signed/expiring URLs, a CDN vs the API.
- **Prices** *(optional)* — is there an open price feed keyed to the same ids?
- **Licensing / posture** — caching assets locally for a personal single-user tool is this
  project's accepted posture (see `DECISIONS.md` "Sprites are fetched, never committed" and
  the image-caching notes). **Do not commit card art or bulk catalog dumps into git** (the
  cache dir is gitignored). Surface any license concern to the user rather than deciding it.

**Known-good starting points (verify before trusting — these change):**

| Game | Catalog + images | Prices |
|---|---|---|
| **Pokémon** (reference) | TCGdex (compiled JSON) for catalog; pkmn.gg (`[redacted host]`) for art TCGdex lacks | TCGCSV (TCGplayer mirror), Cardmarket via TCGdex |
| **Magic: The Gathering** | **Scryfall** bulk data — catalog + images + prices in one, excellent IDs, CC0-ish data | Scryfall (USD/EUR/tix) |
| **Yu-Gi-Oh!** | YGOPRODeck API (bulk cardinfo + images) | YGOPRODeck price fields |
| **Lorcana / One Piece / Digimon** | community APIs / datasets (e.g. lorcana-api, an OP TCG API) — vet coverage carefully | often none; may be TCGplayer-derived |

**Never stand up a heavy upstream server on the host.** The Pokémon lesson (`DECISIONS.md`
2026-07-24): TCGdex's own API server statically loads all languages into RAM per worker and
OOM'd the Pi. Extract the **compiled data** instead (for TCGdex: `docker create` the image +
`docker cp` the `generated/<lang>/{cards,sets,series}.json` out — never `docker run` it). For
other games, download the bulk JSON. Extraction ≠ running the service.

### Step 2 — Map the source to the schema

Read `research/SCHEMA.md` and `research/DATA-LAYER.md`, then write a mapping from the source's
fields to the tables above. Decisions you'll make per game:

- **Variant/printing model.** Enumerate the game's printings and map each to a `variant_kind`
  (with the right facet columns) — foil/finish, edition, promo-stamp, rarity-as-printing, etc.
  A new printing type is a row insert, not a migration.
- **The "master set" tier** *(if the game/UI has a completion goal beyond "own the card").*
  Which printings count toward it is game-specific and often not in the source data — derive
  it from facets and allow human overrides (Pokémon uses `variant_tier_override` +
  `variant_tier_resolved`; see `SCHEMA.md` §5). For a game without that concept, keep it flat.
- **Set-code crosswalks.** When catalog and image (or price) sources use different set/card
  ids, build a crosswalk keyed on **multiple forms** (id case-insensitive, slug, normalized
  name, an explicit override map) — a single key will miss (Pokémon needed all four; a JP/EN
  slug collision silently matched the wrong set). Match within the right language/category.
- **Local id normalization.** `local_id` is opaque text (`'004'`, `'TG01'`, `'SV107'`); keep a
  numeric shadow (`local_id_numeric`) and match on it to survive zero-padding differences.

### Step 3 — Populate the catalog (idempotent, resumable, verified)

Mirror the reference importer (`apps/sync/src/catalog/{cli,import,transform}.ts`, run via
`pnpm --filter pokedex-sync import:catalog <dataDir>`). Properties to preserve:

- **Idempotent** — `ON CONFLICT … DO UPDATE`; re-running is a no-op / clean update.
- **Batched, one txn per batch, pooled connection** — respect the connection budget (this
  deploy caps the app pool at 3; a one-off importer should use **one** connection).
- **Resumable** and safe to interrupt.
- **Synthesize a default variant** for any card the source ships with zero printings, so it's
  ownable (Pokémon marks these `is_synthesized`).

**Verify:** counts match the source; spot-check a few (set, number, name) tuples; confirm one
primary variant per card; 0 duplicate `(card_id, variant_kind_code)`.

### Step 4 — Source + optimize the images (the crux)

**Warm every slot in the catalog.** `image-slots.md` (in this skill dir) is the growable
Image-Slot Catalog — one entry per *kind* of image (card art, set logo/symbol, and any slots
added later via the `add-image-slot` skill), each with its exact source, cache path, and
verification. When onboarding a game, warm every `status: active` slot that applies; a new slot
type is added there (with the user's approval) by the `add-image-slot` skill, never ad hoc.

**The cache-layout contract (do not deviate — the image service reads exactly this):**

```
<IMAGE_CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp   ← card art
<IMAGE_CACHE_ROOT>/sets/<setId>/<logo|symbol>.webp                        ← set imagery
```

Served by `apps/images` (`GET /pokedex/images/<lang>/<serie>/<set>/<localId>/<low|high>.webp`
and `/pokedex/images/sets/<setId>/<logo|symbol>.webp`). A cache **miss serves a ~1 KB
placeholder** — that's the "no image" users report. See `apps/images/src/layout.ts` for the
authoritative path functions; replicate them, don't guess.

**The provenance contract — write through the choke point, always.** Every byte in the cache must
carry a record of where it came from, in the `image_asset` table. Do NOT write into the cache
directly (`writeFile` / `curl -o` / `cp`) — go through **`apps/images/src/store.ts`**:

```ts
import { putAsset, fromUrl, unknownProvenance } from './store.js';

await putAsset({
  cacheKey, kind, relativePath,          // build these with layout.ts, never by hand
  bytes,
  provenance: fromUrl(sourceUrl, etag),  // REQUIRED — no default, no optional argument
});
```

`putAsset` writes the bytes and the manifest row together, or neither. Provenance is a required
argument: `fromUrl(url)` for anything fetched; `unknownProvenance('<why>')` only when the source
genuinely cannot be established. **Never pass a plausible-but-unverified URL** — an invented
source is worse than an honest blank, because it hides the gap instead of reporting it.
(`ensureRecorded` is the variant for bytes already on disk; it won't overwrite provenance
someone else established.)

**Bytes on disk with no manifest row are a defect.** Prove you created none:

```bash
rtk pnpm --filter pokedex-images manifest:check      # exits non-zero on drift
```

This is how 1,970 orphaned files accumulated before 2026-08-07: ad-hoc gap-fill scripts wrote
straight to the cache path, and the record of where that art came from was lost permanently for
most of them.

**The warmer pattern (layered fallback — this is the whole game):**

1. **Enumerate work from the DB card list, NOT the source's manifest.** A source's manifest
   frequently *omits* promo/energy/token/trainer-kit/special sets even when its CDN has the
   art. Warming off the manifest silently skips exactly the sets users notice. Drive the loop
   off `card` rows and check per-card whether a real cache file already exists.
2. **Primary source first, then fallback(s).** Try the catalog CDN (e.g. TCGdex
   `assets.tcgdex.net/<lang>/<serie>/<set>/<localId>/high.webp`). On a 404/miss, fall back to a
   secondary (for Pokémon: pkmn.gg's `assets.pkmn.gg` art, whose URLs come from
   `[redacted host]/…/v1/card/<set>` — the JSON carries **signed** `largeImageUrl`(→high) +
   `thumbImageUrl`(→low); the signature is in the URL so no auth on the download itself). See
   `apps/images/src/warmFromPkmn.ts` for the working fallback warmer and `PKMN-SYNC-RUNBOOK.md`.
3. **Two resolutions.** `high` (detail view) and `low` (grid + the scanner). WebP.
4. **Validate every download** — content-type + magic bytes (RIFF/WEBP), reject tiny/placeholder
   bodies (`< ~800 B`); then hand the bytes to `putAsset`, which does the temp-file +
   atomic-`rename` and records the row for you (mirror `apps/images/src/fetch.ts` for the
   validation). Do not hand-roll the write. A body that isn't the format the cache path claims
   is a REJECT, never a rename — 30 cached `.webp` files are actually PNG because one script
   validated only `length >= 800`.
5. **Be polite** — ~5–8 rps, bounded concurrency (2). Run long warms in the background.
6. **Never invent an image.** If no source has a card's art, leave the placeholder and
   **report it** as a genuine upstream gap. Honest residue > a wrong/blank image (`SCHEMA.md`
   §4.6: "15% with no price/image is acceptable; a wrong one is not").

**Optimize:** WebP is the storage format (TCGdex serves it natively; re-encode PNG/JPEG if a
source only offers those — `cwebp`/ImageMagick). Keep the two-tier `low`/`high` split. The
cache has an **LRU cap + evictor** (`apps/images/src/evict.ts`) — respect it; don't disable it.
Set logos/symbols warm the same way into the `sets/` tree.

**Verify (filesystem + service, not the warmer's counter):** the warmer's own "warmed/gap"
tally conflated *already-cached* with *failed* — trust the disk. Count real files
(`find … -size +2k`), and `curl` a sample of served URLs expecting HTTP 200 with real bytes
(not the placeholder). Report `N of M` cards now real, with the residue broken down by set.

### Step 5 — Index for the scanner (if the game should be scannable)

The offline scanner matches an uploaded photo against a **dHash per cached card image**
(`apps/api/src/scan/{index,phash,router}.ts`, table `card_image_phash`, migration
`016_card_image_phash.sql`). After warming new art:

1. **Rebuild the index** — `pnpm --filter pokedex-api scan:index` (idempotent/resumable; hashes
   cards that have a cached image but no hash; `--force` to recompute; `nice`/`ionice` it).
2. **🔴 Restart the scan service** — it loads the index into memory at boot. New hashes are
   invisible until you `pm2 restart pokedex-api`. (This one bites every time: the DB had the
   hash, self-match was distance 0, but the running service still used the boot-time index.)
3. **Verify** — feed a known card's own cached art to `POST /pokedex/api/scan`; it must
   self-match at **distance 0**. Query-side preprocessing (a background-trim variant,
   min-combined with the plain hash) makes real photos-with-background work — keep the *index*
   plain and only trim the *query* (trimming the index shifts bordered cards and breaks
   self-match). Note dHash isn't rotation-invariant and near-identical cards (basic energies)
   are inherently hard — that's a known limit, mitigated by the on-screen alignment guide.

---

## Distilled principles & gotchas (hard-won)

- **Verify against the artifact, never the report.** Query the DB, `curl` the image, scan the
  card. A "done" that you didn't verify is a guess.
- **Idempotent + resumable** everywhere; safe to interrupt and re-run.
- **Enumerate images from the DB, not the source's manifest** (manifests omit sets).
- **Crosswalk on multiple keys** (id/slug/name/override), scoped to the right language.
- **Reindex + restart** the scan service after warming; the index is in-memory.
- **Two image tiers, WebP, LRU-capped**; keep the serving path contract exact.
- **Don't run heavy upstreams on the host** — extract compiled data.
- **Secrets** (a source session/token, e.g. a pkmn.gg cookie) live at runtime only
  (`~/Transfer/…`), read per-run, **never committed or logged**; the token may rotate on
  refresh, so a *single* consumer uses it at a time. If a subagent is blocked from a
  credentialed source by a safety check, the lead performs that step.
- **Never commit** the image cache or bulk catalog dumps (gitignored); report residue honestly.
- **RTK + deploy hygiene:** prefix every shell command (and every `&&` segment) with `rtk`;
  don't reload nginx or touch other pm2 apps; stay within the Postgres connection budget.

### Accumulated sourcing-thoroughness learnings
Generalizable lessons harvested from real gaps by the `fill-missing-assets` skill — each should
make sourcing more thorough for *any* game. Append one tight imperative bullet; don't duplicate;
keep game-specific specifics in `PKMN-SYNC-RUNBOOK.md` / the slot's `image-slots.md` entry instead.

- Enumerate the warm work-list from the **DB card list**, never the source's manifest — manifests
  routinely omit promo / energy / token / trainer-kit / special-product sets whose art *does* exist.
- A source that 404s for a set may still have that art via a **secondary source** — wire a
  fallback before declaring a genuine gap.
- Crosswalk source↔our ids on **multiple keys** (id case-insensitive, slug, normalized name,
  explicit overrides) scoped to the right language — a single key silently mis-matches (JP/EN collisions).
- Trust the **filesystem**, not a warmer's "warmed/gap" counter (it conflates already-cached with
  failed): count real files (`-size +2k`) and `curl` served URLs for real bytes.
- After warming art that feeds the scanner, **reindex AND restart** the scan service (index is in-memory).
- A missing set symbol/logo isn't always a warming gap — whole set *families* (promos, basic-energy,
  licensed tie-ins) have no per-set mark at the source. Prefer a **UI fallback ladder** (authored
  family SVG → derived acronym from the set code → neutral placeholder) over warming a nonexistent asset.
- Promo/odd cards can carry **non-numeric collector numbers that differ across sources** (one
  source's `MEW` is another's `001`) — when the number crosswalk misses, fall back to a
  normalized-**name** match before declaring the card absent.
- **Never write cache bytes outside the choke point.** A one-off fill script that writes files
  directly leaves art whose origin nobody can ever reconstruct; route it through
  `apps/images/src/store.ts` and finish with `manifest:check`. If you need a new one-off, add it
  as a command in `apps/images/src/` rather than a loose script — that is where the contract lives.
- **Validate the format, not just the size.** `length >= 800` passes an HTML error page and a PNG
  alike; sniff magic bytes and refuse anything the cache path doesn't claim to be.

## Definition of done (adding a TCG, or a refresh)

1. A research note naming the chosen catalog/image/price sources + licensing posture (approved).
2. Catalog loaded and **verified against the source** (counts, spot-checks, no dup variants).
3. Card art warmed (primary + fallback), **`N of M` real** with residue reported per set;
   set logos/symbols warmed; a sample of served URLs returns real bytes.
4. Prices ingested *(if a source exists)* and progress/derived counters recomputed.
5. Scan index rebuilt + service restarted; a known card self-matches at distance 0.
6. Nothing committed but source code + docs (no art, no dumps, no secrets); the user shown a
   short summary + the honest residue, and asked before any commit/deploy.

## Canonical references in this repo

- `research/SCHEMA.md` — the data model (read before mapping).
- `research/DATA-LAYER.md` — source-field → schema details, price/id coverage.
- `ARCHITECTURE.md` — services, ports, the image cache design.
- `PKMN-SYNC-RUNBOOK.md` — the Pokémon-specific runbook (per-release procedure, the pkmn.gg
  API map, the image-fallback flow) — the concrete instance of this skill.
- Code: `apps/sync/src/catalog` (catalog import), `apps/sync/src/prices` (prices + cross-fill),
  `apps/images/src/store.ts` (**the cache write choke point — read this first**),
  `apps/images/src/{layout,fetch,warmer,setWarmer,evict}.ts` (image cache + warmers),
  `apps/images/src/{warmGaps,warmFromPkmn}.ts` (CDN gap-fill + pkmn.gg fallback warmer),
  `apps/images/src/{manifestCheck,manifestBackfill}.ts` (drift check + provenance backfill),
  `apps/api/src/scan/{index,phash,router}.ts` (scanner).
