# DeckScout — Architecture

**Status:** Target architecture for the cloud pivot, drafted 2026-08-09. This
document supersedes the prior self-hosted architecture. Historical design
decisions are preserved in `DECISIONS.md`.

This document is the synthesis. It states *what we are building and why*, and
points at the research documents that justify each choice. It deliberately does
not repeat their evidence -- where a number appears here, the citation tells you
where it was measured.

| Document | What it settles |
|---|---|
| [Data Layer (wiki)](https://github.com/cheyras/deckscout/wiki/Data-Layer) | Catalog ingest, prices, images, storage engine, sync jobs |
| `research/SCHEMA.md` | Tables, DDL, indexes |
| `research/DECK-FORMATS.md` | Legality rules, PTCGL grammar, format data sources |
| [Dex Data (wiki)](https://github.com/cheyras/deckscout/wiki/Dex-Data) | Species mapping, sprites, capture semantics |
| `research/BEHAVIOR-SPEC.md` | Product behavior -- the three goals, variants, lists |
| `research/ROUTE-MAP.md` | URL structure / IA |
| [UI Spec (wiki)](https://github.com/cheyras/deckscout/wiki/UI-Spec) | Design tokens, components, layout |
| [Frontend Research (wiki)](https://github.com/cheyras/deckscout/wiki/Frontend-Research) | Frontend stack + performance plan |
| [Prior Art (wiki)](https://github.com/cheyras/deckscout/wiki/Prior-Art) | What to borrow, what to avoid, license posture |
| `DECISIONS.md` | Locked decisions + corrections to the original brief |

---

## 1. The one-paragraph version

DeckScout is a multi-user Pokemon TCG collection platform deployed on Vercel
(serverless API + SPA) and Supabase (Postgres with RLS, Auth, Storage CDN). It
holds its own copy of the card catalog, cached card art, and accumulating price
history -- so it keeps working if every upstream vanishes. Card data is imported
from TCGdex's open database, prices come from TCGCSV and Cardmarket bulk dumps,
and both are pulled by scheduled GitHub Actions jobs. The repo is open-core
(AGPL-3.0) and can also be self-hosted with plain Postgres.

## 2. Guiding constraints

1. **Cloud-first, self-host-compatible.** The primary deployment is Vercel +
   Supabase. The repo must also work with plain Postgres and no Supabase (see
   section 9).
2. **Offline resilience is structural, not a fallback.** The read path is
   Postgres + Supabase Storage CDN (or local image cache for self-host). There
   is no proxy-on-demand, so there is no network failure mode to handle in the UI.
3. **Own the data.** Every sync is additive and writes to the database. Price
   history accrues to us and is never re-fetched from a provider's retention.
4. **Multi-user with row-level security.** Every user sees only their own
   collection, decks, and lists. Catalog and pricing data is shared.

## 3. Target topology

```
Clients (browser, PWA, MCP agents)
       |                     |                      |
       | Auth (JWT)          | Data (JWT Bearer)    | Images (public CDN)
       v                     v                      v
Supabase Auth        Vercel Serverless       Supabase Storage
(email + OAuth)      Functions               card-art bucket (~1.9 GB)
                     Express catch-all       CDN + image transforms
                     (api/index.ts)
                            |
                            | service-role or user JWT
                            v
                     Supabase Postgres (RLS)
                     Supavisor connection pool
                            ^
                            | service-role (direct)
                     GitHub Actions
                     Scheduled sync (catalog, prices)
```

**Only the sync jobs cross the network boundary to upstream data sources.**
A user request never leaves the Vercel + Supabase perimeter.

## 4. Repo and deployment shape

**Decision: Keep the Vite SPA + mount the Express app as a single catch-all
Vercel serverless function.**

The Vite SPA (React 19 + TanStack Router + TanStack Query + Tailwind 4) is
mature and explicitly out of scope for a framework migration. The ~55 Express
API endpoints are served by a single catch-all function (`api/index.ts`) that
imports the Express app and exports it as a Vercel serverless handler.

```
api/
  index.ts              <- Vercel catch-all: imports Express app
apps/
  api/src/              <- existing Express app (unchanged)
  web/                  <- Vite SPA (Vercel static output)
vercel.json             <- rewrites + function config
```

**Base path:** The API serves at `/api/*` (previously `/deckscout/api/*` behind
a reverse proxy). The SPA serves from the domain root.

**Why not individual functions or Hono?** The existing SQL is complex (multi-CTE
queries, views, generated columns). Rewriting routes gains nothing -- the SQL
stays the same. Cold-start cost is acceptable for a collection tracker. Hono
migration is documented as a follow-up once the port is stable.

## 5. Auth and multi-user

**Decision: Supabase Auth (email + OAuth) with JWT-based RLS enforcement.**

### Auth flow

1. The SPA uses `@supabase/supabase-js` for auth flows (signIn, signUp, token
   refresh, OAuth providers).
2. API requests carry the Supabase JWT as `Authorization: Bearer <token>`.
3. API middleware verifies the JWT and extracts the user UUID (`sub`).
4. Database queries execute with RLS context set per-request.

### Per-request RLS enforcement

The existing SQL is too complex for PostgREST or the supabase-js query builder.
The API uses raw SQL via the Supavisor connection pooler with per-request
role-switching:

```typescript
async function withUserContext(userId: string, fn: (client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' })
    ]);
    await client.query(`SET LOCAL role = 'authenticated'`);
    return await fn(client);
  } finally {
    client.release();
  }
}
```

For catalog-only reads (search, series list without user progress): the service
role is used (bypasses RLS, since catalog tables are world-readable).

### The `defaultUserId()` replacement

The single-user choke point is replaced by extracting the user UUID from the
verified JWT. Every route already passes `userId` as a parameter to SQL queries;
the change is mechanical across ~40 call sites.

## 6. RLS schema model

### Classification

Every table is either **catalog (shared)** or **per-user**:

- **Catalog tables** (card, series, card_set, card_variant, price_current,
  price_observation, sync_run, image_asset, etc.): world-readable, service-role-
  writable. No `user_id` column. RLS policy: `SELECT: true`.
- **Per-user tables** (collection_item, deck, deck_card, deck_version,
  battle_log, card_list, list_item, binder_placement, user_settings,
  user_profile, etc.): readable/writable only by the owning user. RLS policy:
  `user_id = (SELECT auth.uid())`.

### The user ID migration

`app_user.id` transforms from `BIGINT GENERATED ALWAYS AS IDENTITY` to
`UUID REFERENCES auth.users(id)`. Migration 020 handles this type change across
all FK columns. Migration 021 (Supabase-only) adds the FK to `auth.users`,
enables RLS on all tables, and creates the policies.

The `(SELECT auth.uid())` wrapper (rather than bare `auth.uid()`) is deliberate:
benchmarked at ~95% improvement because the query planner treats the subselect
as a constant.

### Views

Catalog views (`variant_tier_resolved`, `master_required_variant`,
`set_variant_coverage`, `card_without_standard_variant`) have no user_id and
need no RLS change. `collection_dupe_predicate` reads through the RLS'd
`collection_item` table and works correctly.

## 7. Image storage

### Cloud: Supabase Storage

**Bucket:** `card-art` (public)

**Path contract (preserved from the disk cache):**
```
card-art/images/<lang>/<serie>/<set>/<localId>/low.webp
card-art/images/<lang>/<serie>/<set>/<localId>/high.webp
card-art/sets/<setId>/logo.webp
card-art/sets/<setId>/symbol.webp
```

**Provenance choke point:** All writes go through a `putAsset()` wrapper
(`packages/storage/src/put-asset.ts`) that uploads to Supabase Storage via the
service role and upserts the `image_asset` row with provenance. The contract is
identical to the disk-based version: no direct writes to the bucket, every byte
has an `image_asset` row. `provenance` is a required argument.

**CDN:** Supabase Storage includes a CDN. The SPA references Storage public URLs
instead of relative paths. Image transforms (resize, format conversion) are
available on Pro.

### Self-host: local disk cache

Unchanged from the original design. `apps/images/src/store.ts` is the write
choke point. Card art lives at
`<IMAGE_CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp`.
`apps/images` serves the cache. `apps/images/src/layout.ts` is authoritative
for all paths.

### Storage cost

| Supabase tier | Storage included | ~1.9 GB image corpus |
|---|---|---|
| Free | 1 GB | Exceeds free tier |
| Pro ($25/month) | 100 GB | Included |

The free tier cannot hold the full image cache. Options: start on Pro
(recommended), serve only low-res images on Free (~400 MB), or defer image
migration and serve from upstream CDNs.

## 8. Data ingest and sync

### Catalog -- direct import, never the TCGdex API

The weekly catalog job pulls the published container image, streams
`docker save` through `tar`, extracts `generated/en/{cards,sets,series}.json`
and imports it. No container is ever created. The TCGdex API server must never
be run -- it loads all 18 languages into memory per worker (measured 6.4x
JSON-to-object expansion) and would OOM most environments.

### Prices -- daily, and the UI must say so

The TCGplayer feed comes from TCGCSV, once daily. Cardmarket is likewise daily.
Every price in the UI renders "as of {date}" -- honest by construction.

### Sync jobs -- GitHub Actions

The existing importers (`apps/sync/src/`) are idempotent, resumable, and use
exactly 1 connection each. They run unchanged as GitHub Actions scheduled
workflows with the Supabase connection string. Docker is available on GHA
runners for the TCGdex catalog extraction.

### Sync invariants

- **Skip-if-unchanged** is the first step of every job, gated on the upstream's
  own stamp.
- **`captured_at` is the source's timestamp, not `now()`.** Re-running a day's
  sync is a genuine no-op.
- One transaction per group, a resumable cursor, and a `pg_advisory_lock` so a
  manual run cannot race the scheduler.

## 9. Self-host story

**The repo must work with plain Postgres + no Supabase.** The Supabase
integration is an additive layer, not a hard dependency.

### Migration split

```
migrations/
  001-019:  Core schema (any Postgres 15+)
  020:      Multi-user UUID transformation (any Postgres 15+)
  021:      RLS policies + auth.users FK (Supabase-only)
  022:      Storage integration + bug_report (Supabase-only)
```

Self-host deployments run 001-020 and skip 021+. Auth is handled by the reverse
proxy. Images are served by `apps/images`. Sync jobs run via cron or any
scheduler.

## 10. What is parked and why

### Scanner (Wave 3)

The in-memory scanner loads ~23k 64-bit hashes into typed arrays and ranks them
with 26 rotation/keystone probes per query. This is incompatible with serverless
(no persistent memory, no ImageMagick for probe generation).

**Future path:** Hamming distance in SQL. Supabase runs Postgres 15+, which has
`bit_count()`. A single-probe query over 23k rows benchmarks at ~60ms -- well
under 100ms. Multi-probe via a Postgres function + client-side WASM probe
generation can recover most of the current ~99.6% accuracy. The `card_image_phash`
table and data are preserved; only the query path changes.

### MCP server (Wave 3)

The MCP auth model (`x-brain-key` shared secret) is fundamentally single-user.
Multi-user requires per-user PATs or Supabase JWT auth. The 21 existing tools
map cleanly to API calls, so the port is straightforward once auth is settled.
Self-host continues to use `x-brain-key`.

## 11. Correctness traps that shape the design

These are verified findings that a reasonable implementation would otherwise get
wrong. They are listed here because each one is silent when wrong.

| Trap | Consequence if missed |
|---|---|
| TCGdex Cardmarket `*-holo` fields mean **reverse holo**, not holo finish | Wrong prices sitewide, no visible error |
| `legal.standard` is per-print; reprints confer legality | Deck validator rejects most real decks |
| `dexId[0]` does not follow the card name on multi-species cards | Wrong species captured |
| 4 **Trainer** cards carry `dexId` | Trainers silently capture Pokemon; gate on `category='Pokemon'` |
| TCGdex uses both apostrophe codepoints for Farfetch'd | Naive join drops half the prints |
| PTCGL section headers are **line counts**, not card counts | Importer rejects valid decks |
| `assets.tcgdex.net` 200s with HTML for unsupported extensions | Cache fills with garbage |
| TCGdex `card(id:)` prefix-matches; `localId` padding is inconsistent | Wrong card returned; join numerically |
| No upstream English-image fallback exists (hard 404) | Must be application logic |

## 12. Data model

Full DDL, indexes and worked SQL: `research/SCHEMA.md`.

**Variants are the atomic unit.** `card_variant` is the ownership, pricing and
buy-link row. The natural key is `(card_id, variant_kind_code)`.

**The taxonomy is an open enum implemented as data.** A `variant_kind` lookup
table carries typed facet columns decomposed from `variants_detailed`, so a new
stamp is one `INSERT` and never a migration.

**Set progress is split by scope:** single-set derived on read; all-sets
materialized into `user_set_progress`.

**Price history** is append-only and partitioned, keyed
`(variant, source, currency, captured_at)` with `captured_at` from the source.

`user_id` is on every user-owned row; catalog and pricing tables are global.

## 13. Frontend

Built against [UI Spec (wiki)](https://github.com/cheyras/deckscout/wiki/UI-Spec). Full rationale: [Frontend Research (wiki)](https://github.com/cheyras/deckscout/wiki/Frontend-Research).

**Stack:** React 19, TanStack Router, TanStack Query, TanStack Virtual, Vite,
Tailwind 4. Charts via `d3-scale`/`d3-shape`; drag-and-drop via `@dnd-kit`
(both lazy-loaded).

**Offline is tiered, and honest about phones.** Tier 0: app shell, ~5-6 MB,
always. Tier 1: visited art, LRU-capped ~2,000 images. Tier 2: opt-in pack
(owned cards + tracked sets). Offline means full metadata browse, search and
edit everywhere; real art for what you own.
