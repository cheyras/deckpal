# DeckPal — Architecture

**Status:** Target architecture for the cloud pivot, drafted 2026-08-09. This
document supersedes the prior self-hosted architecture. Historical design
decisions are preserved in `DECISIONS.md`.

This document is the synthesis. It states *what we are building and why*, and
points at the research documents that justify each choice. It deliberately does
not repeat their evidence -- where a number appears here, the citation tells you
where it was measured.

| Document | What it settles |
|---|---|
| [Data Layer (wiki)](https://github.com/cheyras/deckpal/wiki/Data-Layer) | Catalog ingest, prices, images, storage engine, sync jobs |
| `research/SCHEMA.md` | Tables, DDL, indexes |
| `research/DECK-FORMATS.md` | Legality rules, PTCGL grammar, format data sources |
| [Dex Data (wiki)](https://github.com/cheyras/deckpal/wiki/Dex-Data) | Species mapping, sprites, capture semantics |
| `research/BEHAVIOR-SPEC.md` | Product behavior -- the three goals, variants, lists |
| `research/ROUTE-MAP.md` | URL structure / IA |
| [UI Spec (wiki)](https://github.com/cheyras/deckpal/wiki/UI-Spec) | Design tokens, components, layout |
| [Frontend Research (wiki)](https://github.com/cheyras/deckpal/wiki/Frontend-Research) | Frontend stack + performance plan |
| [Prior Art (wiki)](https://github.com/cheyras/deckpal/wiki/Prior-Art) | What to borrow, what to avoid, license posture |
| `DECISIONS.md` | Locked decisions + corrections to the original brief |

---

## 1. The one-paragraph version

DeckPal is a multi-user Pokemon TCG collection platform deployed on Vercel
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

**Base path:** The API serves at `/api/*` (previously `/deckpal/api/*` behind
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

### Request identity — the one accessor

The single-user choke point (`defaultUserId()`) is not removed; it becomes one
of two branches behind a single seam, `apps/api/src/identity.ts`. Routes never
learn which deployment they are running in:

```ts
const userId = currentUserId(req);   // string, always — the only supported read
```

`resolveIdentity` (mounted once in `index.ts`, ahead of every user-scoped
router) settles it per request:

| | Cloud | Self-host |
|---|---|---|
| Credential present | JWT `sub`, or the personal access token's owner | same |
| No credential | **401** — no fallback exists | the single local user (`defaultUserId()`) |

The self-host branch is gated on *any* Supabase environment being absent
(`SUPABASE_URL`, `SUPABASE_JWT_SECRET` **or** `SUPABASE_MODE`), so a
half-configured cloud deployment fails closed rather than serving one tenant's
rows to anonymous callers. Cloud identity derives from the verified JWT and
nothing else.

A second, narrower seam sits beside it for routes that don't require a user
at all: `resolveOptionalIdentity` / `optionalUserId()` resolve to
`string | null`, where `null` means *settled: nobody*, not *nobody asked
yet*. Search, series/set/card pages, the Pokédex and its insights are
anonymous-readable; every other per-user route still 401s exactly as before.
The `null` is bound as a SQL parameter, so ownership joins evaluate to
UNKNOWN for anonymous rows by the query's own three-valued logic, and the
pool runs those requests as Postgres role `anon` under RLS rather than
`postgres` (which owns every table and bypasses RLS) -- the gap that made
this safe to ship (DECISIONS.md 2026-08-10, "The catalog goes public").

The original pivot instead rewrote ~40 call sites to `req.user!.id`. That is
correct in cloud and silently `undefined` in self-host, where `authMiddleware`
is deliberately a no-op — see DECISIONS.md 2026-08-10. `currentUserId()`
returns `string` or throws, so there is nothing for `!` to assert; a pure test
(`__tests__/identity.test.ts`, run in CI via `test:auth`) exercises all three
branches without a database and fails if a route reaches for `req.user` again.

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

`image_asset` records the asset's **identity and provenance** — shared across
tiers, because where bytes came from does not change when you copy them.
`image_object` (migration 025) records **one row per physical copy**, keyed
`(cache_key, tier)` with `tier IN ('disk','object')`, holding that copy's
`byte_size`, `content_type` and storage `etag`. The two copies genuinely differ:
TCGdex re-encodes between the day the disk cache was warmed and the day the
bucket was filled. Each choke point writes only its own tier, and
`image_object.cache_key` is a foreign key to `image_asset`, so a stored copy of
something with no provenance record cannot be represented at all.
`manifest:check --object-store` reconciles the object tier against a listing of
the real bucket, which is what makes the "every byte has a row" claim falsifiable
on the cloud side rather than self-reported.

**CDN:** the API still emits the same relative paths self-host uses
(`/deckpal/images/en/<serie>/<set>/<localId>/<low|high>.webp`, built by
`cardImages()` in `apps/api/src/db.ts` and `setAssetUrl()` in
`apps/web/src/components/ui.tsx`), and `vercel.json` still rewrites that prefix
to `/api/images?p=…`, a serverless function (`apps/api/src/images/handler.ts`)
that lazily fills the bucket on demand: a MISS reads the `image_asset` row,
fetches the bytes from its `source_url` (or, for card art, the canonical
derivation of the request path), writes them through `putAsset()`, then 302s to
the public object URL; a genuine FAIL serves the same ~1 KB placeholder
self-host uses, or 404 for set imagery. An image URL never answers with HTML
-- the invariant that closed the bug where every `<img>` on deckpal.app was
silently serving the index shell (DECISIONS.md 2026-08-10, "Cloud image tier:
lazy cache-on-demand out of Supabase Storage"). Image transforms (resize,
format conversion) are available on Pro.

**The fill has a destination control, not only a content check.** The bytes for
a MISS come from `image_asset.source_url`, and `packages/storage/src/upstream.ts`
holds the allow-list of hosts that URL is permitted to name — `assets.tcgdex.net`
and `raw.githubusercontent.com`, the only two any code path derives. It is
enforced with `redirect: 'manual'` and re-checked on every hop, because a check
that only ever sees the first URL is bypassed by a `302`; the resolved addresses
are checked too, so an allow-listed name pointing at loopback or `169.254.169.254`
is refused. The request is rebuilt from the allow-list's own constant origin, so
the host we actually open a socket to is selected rather than carried through.
That sits *alongside* the older content check (image content-type
plus magic-byte sniff), which exists for a different failure —
`assets.tcgdex.net` answering `200 text/html` for an asset it does not have.
One is about the body, the other about the destination; neither substitutes for
the other. The object KEY is likewise checked at each exported Storage function
rather than only at `parseImagePath`, so the bulk paths that address the bucket
from database rows get the same guarantee as a request does
(`packages/storage/src/object-path.ts`). Both were added on 2026-08-27 to close
GitHub issue #96; `SECURITY.md` records what they do and do not cover.

**But on the cloud the SPA no longer asks the function first.** Since
DECISIONS.md 2026-08-26 the browser addresses the public object URL DIRECTLY
(`apps/web/src/lib/cardArt.ts`, applied by `CardImage`, `SpriteTile`, `SetLogo`
and `SetSymbolTile`), deriving it with the same `parseImagePath` the tier itself
parses requests with, imported from the `@deckpal/storage/paths` subpath export.
The relative path is a pure function of the request path (B6) and the bucket is
public, so the function and its redirect are simply not needed for an asset that
is already there.

That matters because a HIT was never free: the function still had to be invoked
and still probed Storage before answering `302`, so every tile cost a serverless
invocation plus two sequential round trips. Measured on production before the
change: 89-320 image requests per page, **100% of them 302s**, card art arriving
at p50 1954 ms / p90 4154 ms / slowest 12.6 s.

**The proxied path remains, as the fallback.** A cold or genuinely absent object
fails the direct request, `CardImage` retries through `/deckpal/images/…`, and
the lazy fill runs exactly as described above -- so nothing lost the ability to
self-heal, and self-host (no Supabase URL, so no direct base) is untouched. Art
is fetched `crossorigin="anonymous"`, which the bucket allows, so the service
worker caches CORS-readable responses rather than opaque ones the browser pads
against the origin's storage quota (`apps/web/src/sw.ts`, cache `deckpal-img-v2`).

**Warming is a first-class step, not a side effect of traffic.**
`pnpm --filter deckpal-images warm:cloud` (`apps/images/src/cloudWarm.ts`) drives
the tier's own fill across the whole catalog from the public API, with no
credentials. Before it existed the bucket held only what someone had happened to
look at -- 18,840 of 21,066 cards had no object at all -- because every other
warmer targets the self-host disk cache and `storage:backfill` only mirrors one
that already exists. Run it after a catalog import or a set release.

A second public bucket, `user-avatars`, holds profile photos independently of
`image_asset`/`putAsset()` -- the record lives on `user_profile` (migration
029) instead, keyed by a random 32-hex object name rather than anything
derived from the user id, and re-encoded server-side to 256×256 WebP
(DECISIONS.md 2026-08-10, "Profile photos").

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

The split is a per-file marker, not a numbered range: a migration whose first
line is `-- @supabase-only` is applied only when `SUPABASE_MODE` is set, and
skipped automatically otherwise (`packages/db/src/migrate.ts`). The marked
files are the Supabase-integration migrations -- 021's RLS policies +
`auth.users` FK and the later per-feature RLS/Storage companions -- while a
feature's own schema migration (e.g. 022 `bug_report`) is plain Postgres and
runs everywhere.

Self-host deployments run every unmarked migration and skip the
`-- @supabase-only` ones. Auth is handled by the reverse proxy. Images are
served by `apps/images`. Sync jobs run via cron or any scheduler.

## 10. The agent tool layer — one definition, two front-ends

**`packages/agent-tools` (`@deckpal/agent-tools`) is the single definition of
what an agent may do in DeckPal.** 23 tools (12 read, 11 write, 4 of those
also destructive), each a `ToolDefinition`: a zod input schema, `annotations`
(`readOnlyHint` is required in the type, not optional as MCP's own SDK has
it — a tool that forgets to state it fails to compile rather than defaulting
into whatever reads the flag), and a handler written against `Ctx` alone
(`{ db, api, userId }`) with no protocol details in it. Reads go straight to
Postgres; writes and all deck/list operations go through deckpal-api on the
same host (`apps/mcp/SPEC.md` §3), so write logic — upsert, `collection_event`
append, `recomputeSetProgress`, one transaction — stays defined exactly once
in `apps/api/src/routes/*`, however many surfaces call it.

Two adapters translate that one definition into a protocol:

- **`apps/mcp/src/adapters/mcp.ts`** — the only file that knows the tools are
  being spoken to over MCP. `registerAllTools(server, ctx)` walks `allTools()`
  and calls `server.registerTool(...)` per tool, translating `ToolResult` to
  MCP's `CallToolResult`. This is where "Registration: `server.registerTool`"
  now lives; the tool modules themselves import nothing from the MCP SDK.
- **`apps/api/src/decke/adapters/aisdk.ts`** — the AI SDK's `tool()`, one per
  definition, wrapping the handler so it cannot throw into the stream (a
  thrown tool kills the turn; a returned error is a sentence the model can
  react to) and clamping output to a character budget for the chat tier only
  (`DEFAULT_MAX_TOOL_CHARS`, §15c). Read [§15c](#15c) for how Deck-E calls it.

A tool added or changed for Claude over MCP appears for Deck-E in the same
commit, and vice versa — there is now only one place a tool can be added.
`apps/mcp`'s own tool modules were proved behaviour-preserving three ways when
they moved (byte-identical `tools/list` JSON-RPC response, a static dump of
every tool's schema, and a whitespace-insensitive diff): see DECISIONS.md
2026-08-21, "One definition of what an agent can do in DeckPal". The one
deliberate change made in that move: `search_cards`, `get_card` and
`set_progress` now append a series slug to their output (a trailing field, no
row reordered), because the set route needs one and no slug is derivable from
a set's name.

### MCP server — live and multi-user

`deckpal-mcp`'s 23 tools are served to any signed-up user at
`https://deckpal.app/mcp` (`apps/mcp/src/cloud.ts`), authenticated per-user by
a personal access token (`dsk_…`, SHA-256 hashed, shown once at creation,
revocable from Profile). Each call resolves the token to a `user_id` and runs
inside the same `withUserContext` per-request RLS transaction the REST API
uses, so a tool has two independent locks: its own `WHERE user_id = $1` and
migration 021's RLS policies underneath it. Self-host is unaffected and keeps
the original single-user `x-brain-key` process (`apps/mcp/src/index.ts`).
Cross-user isolation was verified against production with a throwaway
account: all ten hostile writes against another user's real ids failed
closed, and read tools reported zero owner data (DECISIONS.md 2026-08-10,
"MCP goes multi-user").

**Connecting without a manual token.** As of 2026-08-10 the token above can
also be minted automatically: a real OAuth 2.1 authorization server
(`apps/api/src/oauthServer.ts` for the public RFC 7591 dynamic-client-
registration + RFC 6749 token-exchange endpoints, `apps/api/src/routes/
oauth.ts` for the session-gated consent decision, `apps/web/src/routes/
Authorize.tsx` for the `/authorize` consent screen) sits in front of the same
credential. Any MCP-spec client (claude.ai, ChatGPT, Gemini, Claude Code) adds
just `https://deckpal.app/mcp` and chooses "Connect"; the client
self-registers, the user signs in and approves a consent screen naming the
client and its exact permissions, and the token endpoint mints an ordinary
`api_token` row — the OAuth layer is a bridge onto the pre-existing
credential, not a second one. `cloud.ts`'s 401 responses advertise the flow
via `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-
protected-resource"` so a compliant client discovers it automatically
(DECISIONS.md 2026-08-10, "a real OAuth 2.1 authorization server for /mcp").

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

### Card scanner — the table is the index

A photo becomes a 64-bit dHash; the catalog's ~22.7k hashes live in
`card_image_phash`; the match is one SQL query that ranks them by Hamming
distance. There is no in-process index and no vector extension:

```sql
LEAST(bit_count(hash_bits # probe.p0), …, bit_count(hash_bits # probe.pN))
```

`bit_count` is native Postgres 14+. `hash_bits` is a generated `bit(64)` mirror of
the `bytea` hash — the hash is stored as `bytea` because that round-trips to a JS
bigint, but Postgres has bitwise XOR only for `bit`, and converting per row per
probe costs 3x (190 ms vs 64 ms measured). Query time on the live index: 22.6k
rows × 34 geometry probes, ~69 ms of server time.

Accuracy is measured, not assumed: 60 cards × 7 realistic degradations (389
scans -- re-encode, JPEG noise, tilt, off-centre, keystone, dim/glare) against
five synthetic no-card frames. Threshold 9 admits **96.9%** of correct scans
while rejecting every no-card frame tested. `ALGO` is `dhash8v3` -- bumped from
the ImageMagick-era pipeline, whose hashes land 0-9 bits away (median 2) from
`sharp`'s, enough to invalidate the old index outright. The old **~99.6%**
figure was measured on that superseded pipeline against a different
degradation set and does not carry over (DECISIONS.md 2026-08-10, issue #20).

Two consequences worth stating plainly. **An indexer run is live immediately** —
no restart, on either deployment. And **index-time and query-time hashing must be
one pipeline**: the same decoder, the same resample. Both sides run `sharp`, which
is also why they can: a serverless function has no system ImageMagick, and the
shelled-out decoder the scanner shipped with is exactly what made the hosted
scanner match nothing (issue #20). `ALGO` names the pipeline; changing either side
means bumping it and re-indexing.


## 13. Frontend

Built against [UI Spec (wiki)](https://github.com/cheyras/deckpal/wiki/UI-Spec). Full rationale: [Frontend Research (wiki)](https://github.com/cheyras/deckpal/wiki/Frontend-Research).

**Stack:** React 19, TanStack Router, TanStack Query, TanStack Virtual, Vite,
Tailwind 4. Charts via `d3-scale`/`d3-shape`; drag-and-drop via `@dnd-kit`
(both lazy-loaded).

**Offline is tiered, and honest about phones.** Tier 0: app shell, ~5-6 MB,
always. Tier 1: visited art, LRU-capped ~2,000 images. Tier 2: opt-in pack
(owned cards + tracked sets). Offline means full metadata browse, search and
edit everywhere; real art for what you own.

**Nothing may block first paint without a deadline, and the auth session is the
one that did.** `supabase.auth.getSession()` reads localStorage only while the
stored access token is more than 90 s from expiry; inside that margin — and on
every cold load after the token has expired — it refreshes over the network
first, and `@supabase/auth-js` attaches no `AbortSignal` and no timeout to that
fetch. So a request that never SETTLES (a socket stranded by a network change or
a sleep/resume, a captive portal, a stalled H2 connection) held it open forever,
and three places awaited it before anything could render: `main.tsx`'s index
route in `beforeLoad`, `AuthGuard`, and `api.ts`'s `authHeaders()` before every
single request. The visible result was issue #75 — a blank dark page, or the
public catalog as chrome with no content — and the inline "Loading DeckPal"
state could not cover it, because React's first commit had already replaced it.

`lib/sessionDeadline.ts` bounds the read; `lib/authSession.ts` is the only
module allowed to call the client directly, and
`apps/web/scripts/check-auth-deadlines.mjs` fails the build if a raw
`auth.getSession()` / `auth.refreshSession()` reappears anywhere else — a bound
one call site can opt out of silently is not a bound. **A timeout means UNKNOWN,
never "signed out."** Every caller falls back somewhere non-destructive (`/`
routes to the public catalog, `AuthGuard` says "still checking", a request goes
out unauthenticated and takes a finite 401 rather than waiting), and a late
answer settles the UI through `onLate` with no reload. Behind all of it, an
inline watchdog in `index.html` replaces an unexplained blank page with a
message and a Reload button after 12 s whatever the cause — that one is a
backstop for the failures nobody has diagnosed yet, not for this one.
`scripts/visual-harness/probe-first-paint.mjs` asserts the property against a
real browser with the token endpoint held open.

## 14. Design system and the /design editor

The visual language is a token system in `apps/web/src/theme.css`: three brand
hue scales (cyan / pink / amber, Tailwind-4 values) feed ~77 flat semantic
roles (surfaces on the warm stone scale, text/borders re-derived in OKLCh to
match, actions, status, energy types, variant accents, z-layers). Two type
roles — Figtree (body/UI) and Fraunces (display, reserved for the app's
proper nouns) — with a 14px floor and named exceptions. Shared primitives
live in `apps/web/src/components/ui/` (Button, Tabs, Progress, StatTile,
SelectableCard, EmptyState, CounterBox, Field/FormAlert/StatusPanel,
useDismiss), each with a co-located `*.gallery.tsx` that type-checks its
catalog entry against the real prop surface. The premium visual pass
(`premium.css`) is scoped entirely under `[data-skin='premium']` — a
reversible skin, toggleable live (`?skin=classic`), same for the top-bar
treatment (`?topbar=flat`).

**The `/design` surface** renders the token panel, the gallery catalog, and
the componentization ledger. It has two modes with one structural rule:
*write capability exists only in the dev server.*

- **Dev:** a Vite dev-server plugin (`apps/web/vite-plugins/design-editor.ts`)
  serves `/__design/*` endpoints — token reads, anchored single-declaration
  writes to `theme.css` (Lane A), and a JSON change-request queue drained by
  an agent with judgment (Lane B, `design-requests/`). The endpoints exist
  only while `vite dev` runs; they are absent from build output by
  construction, not by configuration.
- **Production:** the route ships in the bundle but is gated to the owner:
  `GET /me` returns a server-verified `designEditor` flag (cloud: the account
  named by `DESIGN_EDITOR_USER_ID`; self-host: the single user), and the
  route's `beforeLoad` renders not-found for anyone else. The page detects
  the missing dev endpoints and runs read-only — tokens parsed client-side
  from the bundled `theme.css` text by the same parser the plugin uses
  (`routes/design/themeTokens.ts`), saves and composers hidden, live
  ephemeral overrides still available.

## 15. Deck-E — the 3D character runtime

**Status: complete. Ships to production, owner-only.** Route `/dev/decke`,
gated the same way as `/design`: `beforeLoad` checks the server-verified `owner`
flag on `GET /me` and throws `notFound()` for everyone else, so for any other
visitor the route is indistinguishable from one that never existed. The identity
check lives server-side (`DESIGN_EDITOR_USER_ID`), so nothing about who the owner
is enters the bundle, and an unset variable means nobody — it fails closed.

Shipping it means the chunk is emitted (~1.17 MB of three.js and the runtime,
measured 2026-08-22 and approximate on purpose — the precise figure drifts with
every dependency bump, and `scripts/check-precache.mjs` rather than any number
written here is what actually enforces that none of it reaches the precache) and
the 5.6 MB of assets sit in `public/models/`. Neither is downloaded by anyone who
does not open the route, because the import is lazy — **provided both stay out of
the PWA precache**, which is eager and would otherwise pull 6.5 MB into every
visitor's cache on first load for a route exactly one account can open.
`vite.config.ts` excludes `models/**` and `assets/Decke-*.js`; measured, the
precache is unchanged at 25 entries / 1964 KiB with the route shipping.

**The precache is not the only door, and that sentence used to end here.** It
was wrong for months. Issue #75 (2026-08-24) found the character chunk being
fetched by every visitor anyway — not by the service worker but by
`index.html`, as `<link rel="modulepreload">`, ahead of first paint. An
`advancedChunks` group absorbs the DEPENDENCIES of the modules it matches, so
`character/decke/cardSource.ts` importing `lib/api.ts` pulled `lib/api.ts`
(and `supabase.ts`, `landingRoute.ts`, `returningVisitor.ts`) into the character
chunk; the entry imports those from ~50 places, so the entry gained a static
edge to three.js and Vite preloaded it. Cold first content measured 6.3 s on a
throttled connection against 0.3 s warm.

Two things hold the line now. `vite.config.ts` claims `src/lib/**` and
`src/character/*.ts` into a higher-priority `app-lib` group so the character
group cannot own them — which is also why `viewport.ts`, `beacon.ts` and
`cardSource.ts` live directly under `character/` rather than in `decke/`: they
import no three.js, the app shell imports them statically, and inside `decke/`
each such import was another rope tying the entry to the engine. And
`check-precache.mjs` gate THREE fails the build if anything `index.html`
references directly contains three.js. **When adding a "this must not ship to
everyone" rule, enumerate the doors** — a name-based or single-door guard will
pass while the payload uses the other one.

Deck-E is a stylized robot deck box who IS the AI assistant's body: the LLM
drives his animation from the conversation, and when he presents part of the UI
he parks beside that element facing inward. §15b covers that layer — the runtime
below is only the body. He is authored in
Blender in a separate working directory (`~/Documents/DeckPal Character`, which
carries its own wiki) and re-implemented here.

### Shape of it

```
apps/web/src/character/decke/
  DeckE.ts        the controller — owns the scene, the loop, the public API
  stage.ts        renderer, camera, colour management, the six-light rig
  rig.ts          binds glTF nodes; applies a 47-channel pose to them
  field.ts        the analytic deformation field (ported from the wiki's Python)
  riders.ts       everything that is not a shell, kept attached to the shells
  playbook.ts     the 27 authored states, compiled to per-channel curves
  sustain.ts      the loop window per state, plus synthesized idle/sleep/outro clips
  curve.ts        Blender-compatible bezier evaluation, and cyclic seams
  procedural.ts   idle float, blink, gaze — seeded, deterministic
  look.ts         where the pupils point (the camera constraint that could not export)
  framing.ts      how he is SEEN wherever he stands — yaw, lean, vertical angle
  beacon.ts       where the off-screen chip goes, and how far to scroll for him
  flight.ts       the travel solver
  dom.ts          DOM element -> a place to stand, and the keep-out region
  commands.ts     the JSON command surface an LLM drives
  cards.ts        the orbit, the hands, the presented card and the stash flight
  eyeSocket.ts    Eye_Rig's VERTEX_3 parenting to the morphed lid
  materials.ts    fixups for what the glTF exporter flattened
  eyes/           the analytic eye shader
apps/web/src/components/ui/elementHighlight.ts   the chasing ring he presents WITH,
                          which is a design-system primitive and not his
apps/web/src/components/ui/DeckeBeacon.tsx       the off-screen chip's DOM half
apps/web/scripts/decke/   generators for the playbook, cards and parity fixtures,
                          plus shrink.mjs (the asset compression step)
apps/web/public/models/decke/   .glb, playbook.json, markers.json, HDRI, atlas
```

### The load-bearing decisions

- **Nothing is fetched until somebody asks.** In the app he is loaded by
  `DeckeButton`'s `onWarm` — pointer-enter, touch-start, focus — and by `onOpen`,
  and by nothing else. There is no idle or timer warm; an entitled visitor who
  never touches the launcher downloads no character asset on any page. The
  launcher's waking state (a travelling ring, not a pulse and not a progress bar
  — there is no total until the first response header lands) is load-bearing UI
  while that download runs, and it stays mounted until he has genuinely arrived,
  rising above the chat scrim so it is not covered by the surface it is standing
  in for. A load that fails says so and offers the way back. A phone has no
  hover, so mobile trades "already there" for "tap, then wait"; a question typed
  before he lands is held, shown on the transcript within a frame of the press,
  and asked when he arrives.
- **Loading finishes at entry scale 0**, and the entrance is a rig-root screen
  space scale on `DeckE_Root` with a pivot correction, not a camera move.
  `setCharacterHeight` dollies the CAMERA with the height in the denominator, so
  "grow from nothing" would ask the camera to travel to infinity and is not a
  number at zero; minimum scale is 1e-3 for the same reason. Nothing below the
  root has to know — `riders.ts` and `eyeSocket.ts` premultiply their parent's
  inverse world matrix, the eye shader works in object space and `look.ts` solves
  a ratio, so the factor cancels. What does have to know is anything measuring
  him in the world: `screenRect` and the beacon are both told. Finishing at zero
  is what keeps warming-on-hover from putting the 3D body and the launcher chip
  on screen together, which is the invariant the whole well design exists to
  protect.
- **There is a region he may not stand in.** `dom.ts` holds a keep-out region
  whose bands the HOST measures from real CSS-sized elements (`--app-header-h`
  plus `env(safe-area-inset-top)` at the top; the install-pill clearance at the
  bottom, zero while the chat is open because his phone park box deliberately
  overlaps the composer) and the engine applies. It is a clamp, not a veto:
  asked to present a nav item in the header he is pushed down until his head
  rests on the band, still in the item's column and still turned back across it.
  It applies to PLACEMENTS — a flight, a re-park after a resize, a band change —
  and never to the per-frame scroll track, because he has to be able to leave the
  viewport vertically for the off-screen beacon to exist at all. A band of zero
  is no band, so every non-host caller (`/dev/decke` included) keeps the previous
  behaviour exactly.
- **The host owns the media query; the engine owns the behaviour.** Nothing in
  `character/decke/` calls `matchMedia`. `DeckeHost` reads
  `prefers-reduced-motion`, watches it live, and passes it to `DeckE` as a flag;
  entry, flight and escort legs each have a real instant-arrive mode behind it,
  so the same host code is the reduce path with no branch.
- **No `AnimationMixer`.** Motion is a 47-channel normalised pose evaluated per
  frame, not TRS tracks. See the 2026-08-18 entry in `DECISIONS.md` for why —
  briefly, one channel fans out to several rig targets through non-linear
  mappings, and the channel semantics are what the LLM driver needs.
- **A state is ongoing, not a one-shot.** Every clip runs
  `intro → sustain → outro`, where the sustain LOOPS a window of the clip until
  something else is asked for; `setState` also takes `durationMs` and `then` so
  the driver can spend a state as a beat instead of a mood. Without this a clip
  holds its last beat forever, and since nearly every last beat is the rest pose,
  "be happy" decays to "be nothing". `idle` is synthesized, because the playbook
  has no such state and `boot` was standing in for it — badly, since `boot`'s
  modulation freezes the float and the blink. 2026-08-20 in `DECISIONS.md`.
- **Constraints do not export, and one of them was load-bearing.** The pupils
  track the camera in the `.blend`; glTF emitted the target as a childless root
  node, so the port wrote the gaze into the void and rendered the bind pose,
  which is a baked sample of the very constraint that was missing. `look.ts`
  rebuilds the aim. Worth remembering as a class: a frozen constraint is
  invisible to any parity check taken at the frame it was frozen on.
- **A sustain is its own cyclic clip.** The loop window is compiled once at load
  into a clip whose tail beat is a COPY of its head and whose seam carries one
  shared tangent, so the two ends agree in value AND in velocity by construction
  rather than by inspection. Choosing plausible beat times is not enough: beats
  are sparse and an omitted channel reads as REST, which is how `curious` came to
  drop 0.04 units and put them back once a second. A stepped channel still steps
  across the wrap, because `confused`, `frustrated` and the alerts are authored in
  a robot register and that tick is the point. 2026-08-20 in `DECISIONS.md`.
- **Where he stands and how he is SEEN are different problems.** The Blender
  camera is fixed and aimed at the origin, so parking him anywhere else changes
  the 3/4 angle the whole facing system is defined against and keystones him into
  a lean. `framing.ts` gives every position its own view frame and rotates him
  into it, then deliberately gives back the ELEVATION so his vertical angle still
  follows his height on the page. At the staging origin the solve is exactly the
  identity, which is what keeps parity meaningful, and a test pins that. The
  lighting rig and the environment take the same transform, because a character
  who presents the same view of himself everywhere should be lit the same way
  too.
- **Where he is parked is a STATION, not a coordinate.** An element station is a
  promise to stay beside a DOM rect, so it is re-solved when the page scrolls or
  resizes — which is also how he starts at home rather than dead centre. Scroll
  him out of the viewport and the beacon appears: a chip at the edge holding a
  LIVE second render of the scene, drawn as a scissored second pass on the same
  canvas rather than in a second WebGL context.
- **Vanilla three.js, not react-three-fiber.** The character is driven
  imperatively; the controller never imports React.
- **The deformation field is evaluated live**, so continuous channel values
  produce a correct rig rather than an interpolation between authored poses.
- **The eyes are a custom shader**, not a texture. Every feature — pupil, shine,
  lids, alert glyph — is analytic maths evaluated in the fragment shader, so it
  stays sharp at any zoom.

### Verification

Parity against Blender is a build-time concern, not a vibe. Three fixtures are
generated by EXECUTING the character wiki's own Python rather than
re-transcribing it, so the port is compared against ground truth:

| Harness | Checks |
|---|---|
| `scripts/decke/gen-field-fixture.py` | the deformation field, to 1e-9 on position and 1e-6 on the rider matrix |
| `scripts/decke/gen-proc-fixture.py` | the PRNG, idle float and blink curve, to 1e-12 |
| `scripts/decke/gen-playbook.py --check` | the playbook still matches its sources |
| `?parity=1` on the route | reproduces Blender's exact camera and backdrop for image diffing |

| `scripts/decke/gen-cards.py --check` | the card waypoints still match the baked F-curves |

`markers.json` maps every Blender timeline frame to its state, which is what
makes frame-by-frame comparison possible at all. Silhouette IoU across eight
reference poses runs **0.90–0.99**; `apps/web/src/character/decke/PARITY.md`
carries the per-frame numbers and, importantly, the list of things that are
knowingly *not* matched and why.

The largest of those: the idle float and the blink are **seeded procedural
layers** in the port and baked curves in Blender. They cannot be frame-matched
and should not be — he has to idle and blink indefinitely rather than replay 5211
frames — so they account for most of the remaining centroid error, and make two
of the eight frames swing by up to 0.05 IoU between identical runs.

### The asset

The shipped `decke.glb` is 2.92 MB, down from a 7.48 MB raw export, via
`scripts/decke/shrink.mjs`. Two hard rules live in that script and are worth
repeating here: **never Draco** (`KHR_draco_mesh_compression` structurally cannot
carry morph targets, and every body deformation on this character is one), and
**never quantize** (`KHR_mesh_quantization` parks a de-quantisation transform on
each mesh's node, which the rider system then overwrites — it inflates
`Hinge_Pin_R` into a cylinder wider than the character).

Run the unit tests with:

```bash
pnpm --filter deckpal-web test:decke
```

Three of those are PROPERTY tests over a whole input range rather than examples,
and two of the three found real defects while they were being written: the stash
fan cannot produce two overlapping cards at any batch size from 1 to 12 (the
first, polar, layout failed at five), no card stands in front of his face, and no
gaze flit ever lands closer than the gate to the one before it (the schedules
were rebuilding from scratch every ten minutes, which made the gate a property of
one generation rather than of the run).


## 15b. Deck-E — the assistant layer

**Status: merged to `main` (PR #74, 2026-08-22); whether it is live on
deckpal.app is a deployment question this file cannot answer.** The layer as
described in §15b–§15g — the agent-tools port, the metered deep tier, the write
approvals, the grounding and narration controls, the chat surface — is on `main`.
Verification of it has been done against previews and against the live backend as
the QA account, never the owner's, per contract B12. It needs
`DECKE_VERCEL_AI_GATEWAY_KEY` in the
Vercel project; it fails closed without one and reports its own readiness on
`/api/health`. He now holds all 23 of `packages/agent-tools`' tools (§15c) —
the write half held behind an approval round trip (§15e) rather than filtered
out — plus a metered deep tier (§15d), against the six cosmetic tools of the
original ship.

Where §15 is the body, this is everything that decides what the body does. Four
boundaries carry the design.

**The command channel is invisible.** The model never emits animation syntax into
its prose. It calls an `express` tool, whose `execute` validates the commands and
writes them to a **transient** data part — `writer.write({ type: 'data-decke',
…, transient: true })`. Transient parts reach the browser and never enter message
history, so there is no token for a half-parsed command to leak through and
nothing for the next turn to imitate. The same mechanism carries `showScreen`.

**Everything the model can point at is allowlisted.** `uiTools.resolveTarget`
resolves a selector only if it lands inside `[data-decke-landmark]`, and
navigation only to `ROUTE_ALLOWLIST`. The screen palette is the same rule applied
to markup: `screens.ts` defines a closed set of block kinds whose props are
enums, numbers and plain strings, and `DeckeScreen.tsx` is a switch that renders
`null` for anything it does not recognise. There is no field anywhere in that
schema that carries HTML, a class name, a style, a URL or a selector — so it is
not a sanitised injection surface, it is not an injection surface.

**Who may talk to him, and how much, is decided on the server.** The browser's
own gate (`entitlement.ts`) only decides whether to draw a button; `POST
/api/chat` re-checks it before the request body is parsed
(`DECKE_ENTITLED_USER_IDS` plus the owner — a list, not a single id, because
several of the plan's browser gates run as the QA account, never the owner,
per B12) and meters every account against a durable daily cap in Postgres
(`decke_usage`, migrations 039/040) — chat turns and deep calls capped
separately, ~250x apart in price. See SECURITY.md for the reasoning; this is
the mechanism.

**One controller, one writer.** `runtime.ts` holds a single WebGL context with
deferred disposal so React StrictMode's double-mount does not build two. Exactly
one place computes his height, because two writers fought over it and the
ResizeObserver won.

```
apps/web/src/character/host/
  DeckeHost.tsx    mounted beside the shell, so he survives route changes;
                   owns the load-on-intent lifecycle, the reduced-motion query
                   and the measured keep-out bands
  DeckeChat.tsx    the chat, which IS the content pane; the ChatMessage model
  useDeckeChat.ts  hand-rolled SSE reader, client-tool execution, one round
  uiTools.ts       flyTo / highlight / goTo / scrollToMe / click + the allowlists
  journey.ts       the client-side journey sequencer (§15g)
  DeckeScreen.tsx  the renderer half of the screen palette
  DeckeBubble.tsx  speech bubble placement — never covers what he highlights
  chat/            the transcript's presentation kit (§15g): ChatMarkdown(Body),
                   ToolRow, ThinkingRow, CardRow, ApprovalCard, and a pure
                   state module per row so each is testable without a DOM
  ripSession.ts    pack-rip dedup state machine (pure)
  ripCommit.ts     cardId -> variantId, one batched write
  ripPresence.ts   the rarity heuristic ONLY — the rip reaction was removed
                   rather than disabled, with the reasoning in the file
  runtime.ts       lazy engine load + single-controller guard
  entitlement.ts   the single gate
  approval.ts      the write-approval round trip, as two pure functions (§15e)
apps/web/src/lib/markdownSafety.ts   what model-written markdown may become,
                   shared by the chat renderer and the deck strategy view (§15g)

apps/api/src/decke/
  ctx.ts               builds a Ctx from the caller's JWT; lazy Ctx.db (§15c)
  rls.ts               the per-tool-call RLS session + its watchdog (§15c)
  entitlement.ts        DECKE_ENTITLED_USER_IDS + the owner gate
  meter.ts              the daily chat_turns / deep_calls cap, check-and-charge in one statement
  models.ts             which model each job gets, and why (measured, not assumed)
  adapters/aisdk.ts     ToolDefinition -> the AI SDK's tool(), plus the approval policy (§15c, §15e)
  noOp.ts               "would this write change anything?" -- no dialog if not (§15e)
  focus.ts              which tools he can SEE on a given step (§15f)
  grounding.ts          the card ids a tool actually returned this turn (§15f)
  narration.ts          tool syntax that reached the reader as prose, removed (§15f)
  deep.ts               the four sub-agent tools -- the deep tier (§15d)
  prompt.ts, tools.ts, screens.ts, gate.ts   system prompt, express/showScreen, screen palette, owner gate
api/chat.mjs          the standalone serverless brain
```

`api/chat.mjs` is deliberately standalone rather than a route on the Express app:
production needs streaming under the RLS-authenticated request, and the two did
not compose. It is a web-standard handler using `createGateway({ apiKey })` —
passing the key as a header is silently ignored and bills the wrong account.

The turn ends when one step both **spoke and acted**, where acting is `express`
or `showScreen`. Stopping on the tool call alone silenced him, because he does
not reliably speak before he moves; leaving it out entirely made him deliver two
near-identical closing lines. Both were measured.

### 15c. Deck-E's data access

He carries no credential of his own. `api/chat.mjs` verifies the caller's
Supabase JWT the same way the Express app does, and `ctx.ts` builds a `Ctx`
from it — `apiBaseFor()` derives the API base from the request's own `Host`
header rather than a hardcoded one, so a preview deployment talks to itself
rather than to production. `Ctx.api` forwards that same JWT to deckpal-api, so
every write a deep tool makes runs under RLS as the person in the
conversation, not as a service role — there is no service-role credential
anywhere on this path, and the write logic it calls into is the same
`apps/api/src/routes/*` code the REST API and the web UI use (§10).

**`Ctx.db` is lazy.** It looks like an open connection and is not — it checks
one out on the tool's *first* query (`openRlsSession()` in `rls.ts`, the same
`BEGIN; SELECT set_config('request.jwt.claims', …); SET LOCAL role =
'authenticated'` shape §5's `withUserContext` and the MCP server's own RLS
session use) and releases it the moment the tool call returns. Roughly half
the 23 tools never touch Postgres at all — writes go through the REST API — so
an eager session would spend a pooled connection on tool calls that run no
query. An ordinary conversational turn with no data tool touches the database
not at all.

**The watchdog the other two RLS doors don't need.** Aborts are routine on
this path — the client aborts the previous stream on every new send, and there
is a stop button — and when the socket dies mid tool-call, Vercel freezes the
instance with a checked-out client still inside an open transaction.
`openRlsSession()` starts a timer (`DECKE_PGRLS_MAX_HOLD_MS`, default 10 s —
deliberately far below the API's own 30 s `PGRLS_MAX_HOLD_MS`, because the unit
here is one tool call, not a whole request) and, on timeout or abort,
**destroys** the connection (`client.release(true)`) rather than returning it
to the pool: a connection mid-statement inside another user's RLS claims must
never be handed to the next request. A destroyed connection costs one
reconnect; a shared one costs a cross-user data leak.

**The connection story.** `api/chat.mjs` is a *separate* Vercel function from
the Express catch-all, with its own small pool (`PGPOOL_MAX_CHAT`, default 2,
lazily created on first use, contract B2's `request` role). It shares no
memory with `apps/api/src/index.ts`, so `/api/health`'s live pool census
(`total/idle/waiting`, B2) structurally cannot see it — `/health` instead
reports the chat pool's *configured* size (`deckeLimits.chatPoolMaxConfigured`)
rather than pretending to measure something it cannot reach.

### 15d. The deep tier — sub-agents, not a router

Four tools in `deep.ts` give Deck-E the ability to think rather than only
fetch, each its own sub-agent with its own model, tool subset and wall-clock
budget: `plan_deck` and `analyze_collection` (Claude, the read tools),
`write_strategy_guide` (Claude, the read tools plus `deck_strategy` — the one
write, because that tool is dumb, idempotent storage and the sub-agent is what
actually writes the guide), and `research_meta` (`openai/o3-deep-research`,
**no tools at all**). Escalation is a tool call the conversational model
chooses to make, not a classifier in front of every turn — a call appears in
the tool log, so "did he actually think about this" has an answer; a
classifier would tax every turn and a misroute would be invisible.

Every deep call is charged against the `deep_calls` meter **before** the
sub-agent model runs (a refusal costs one query, not a model call), runs under
a wall-clock budget (`DECKE_DEEP_BUDGET_MS`, default 210 s) below the
function's own `maxDuration` (300 s, raised from 60 — see DECISIONS.md
2026-08-21, which argues explicitly why this does not reopen the 2026-08-19
decision against raising it for writes: a research turn holds no database
connection while it runs, so the cliff is not moved, a different workload is
given a different ceiling), and streams so a timeout returns **partial
findings labelled as incomplete** rather than nothing.

`research_meta` holds no tools by design, not oversight: text fetched from the
open web is the least trustworthy input in the system, and the only guarantee
that it cannot become an action is giving the thing that reads it no actions
to take. Its output is framed as fetched data, every time, into a
conversational model already told never to act on instructions found inside
data (SECURITY.md has the fuller security framing).

**Not shipped:** foil/variant auto-detection. `research/FOIL-DETECTION.md` has
the measurement — the signal is real but not lighting-invariant, so the printing
is a one-tap reader choice in the rip list instead.

### 15e. Writes ask permission, and the asking is the SDK's

Every write tool declares `needsApproval`: the turn pauses, the reader answers,
and nothing is written until they do. That is a mechanism rather than an
instruction, verified against the pinned `ai@7.0.66` rather than read from a
changelog — with `needsApproval: true` a tool's `execute` ran exactly **0
times** while the wire carried
`{"type":"tool-approval-request","approvalId":"…","toolCallId":"call_w"}`. This
codebase has already recorded "a prompt is not an enforcement mechanism" twice,
once about `click` and once about asking a model not to repeat itself; "wait for
confirmation before writing" would have been the third.

What needs approval is derived from annotations and schema, never from the verb
in the name: anything `destructiveHint` always, any real write always, and a
preview never — being made to authorise something before being told what it
would do is the opposite of the point. When a call is classified as a preview
the server writes `dry_run: true` into the arguments explicitly rather than
trusting the tool's default, so classification and coercion agree by
construction, and only an explicit boolean `false` counts as permission to
write, because `'false'`, `0`, `null`, `''` and a missing field are the values a
model actually produces when it stringifies a boolean. The prompt the reader
clicks through shows the dry run's OWN output rather than his description of it.
A denial goes back as an answer, so he can say "alright, left it alone" instead
of stopping mid-turn with no explanation, and an abort resolves the question as
a denial — otherwise pressing stop with an approval on screen parks the turn's
promise for ever.

**Two calls are answered without a dialog, and both are refusals to interrupt
somebody for nothing.** A call whose (tool, arguments) the reader has already
declined in this conversation is refused with a sentence rather than asked a
second time (`decke/declined.ts`; measured at four re-asks each for
`research_meta` and `deck_strategy` across one corpus). And a write that would
change nothing is not a write: `decke/noOp.ts` answers "would this change
anything?" for the tools that can answer it cheaply, and `deck_strategy` sending
back the guide already stored is neither asked about nor run. Measured against
the live model, n=44, asked for insights about a deck: eight proposed guide
writes, **every one of them byte-identical to the stored guide**.

Both consult the same predicate from `needsApproval` AND from `execute`, because
`needsApproval: false` means "raise no dialog" and never "run it" — the two
halves disagreeing is an unapproved write, which is strictly worse than the
nuisance either fixes. Every path that cannot answer returns "it changes
something", so a thrown fetch or an unresolvable deck costs a dialog and can
never cost a silent write.

**The answer travels back as the whole tool call, replayed with the verdict
attached**, and that construction has now produced two shipped defects.
`apps/web/src/character/host/approval.ts` holds the two ends of it as two pure
functions — `pendingApprovalFromChunk`, which captures what the
`tool-approval-request` chunk carries, and `approvalReplayPart`, which rebuilds
the call. It is a separate module rather than two closures in `useDeckeChat.ts`
for a load-bearing reason and not a tidiness one: that hook imports
`lib/supabase`, which reads `import.meta.env` at module scope, so under `node
--test` there is no Vite and merely importing the hook throws before a single
test runs. The logic was therefore unreachable by any test, which is how both of
these shipped:

1. **A bare `{type:'tool-approval-response', …}` part.** `isToolUIPart` in
   `ai@7.0.66` is `type.startsWith('tool-')`, so `convertToModelMessages` read
   consent as a call to a tool NAMED "approval-response", with no `toolCallId`
   at all, and the next leg died in `standardizePrompt`.
2. **A dropped `signature`.** `experimental_toolApprovalSecret` makes the SDK
   sign each approval and verify it coming back; `DECKE_APPROVAL_SECRET` is set
   in Production and Preview, so `validateApprovedToolApprovals` threw
   `InvalidToolApprovalSignatureError: missing signature` and every approved
   write failed. Turning the security control ON is what broke it, which is why
   no test that ran without the secret could see it — and none did.

Both had the same reader-facing shape: preview, "Go ahead", an apology, and
nothing written — consent given, nothing happened, arriving through the control
that exists to prevent exactly that. `__tests__/approval.test.ts` drives both
functions through the REAL `convertToModelMessages` from the pinned package, and
includes one test that feeds the bug-1 shape in and asserts it is still broken,
so an SDK upgrade that fixes it fails the test rather than leaving a stale
explanation in the codebase. Both bugs were re-introduced afterwards to prove
the tests are load-bearing: 3 red and 2 red respectively, the real-SDK test
among them each time.

**The reader is asked by the CALL, and the prompt must not ask as well.**
`prompt.ts` opens the write protocol by saying that calling the tool IS how the
reader gets asked, says explicitly that nothing has changed while a call is
held, and forbids ending a turn on *"Confirm?"*. That is not politeness: while
the prompt told him to preview and wait, he previewed and waited — `get_card`,
"Confirm and I'll log it?", zero `log_cards` calls, zero approval requests,
nothing written, measured 0/15 on the opening turn from `/series`. There were
three consent mechanisms on this path and only one of them was real; the prose
was spending the feature to duplicate a control the SDK already enforces.
Rewriting those four lines took it to 21/30 on the opening turn and 12/12 on
gate 9's three-turn script. DECISIONS.md 2026-08-22 carries the full bisection,
including the five hypotheses that measured 0/5 and the harness bug that made an
earlier fix look like it worked. Gate 9 of `scripts/decke-gates.mjs` pins it.

**The card the reader answers is segmented by variant provenance.** A held
`log_cards` gets a real dry run at hold time, whose rows the server streams as a
`data-decke-approval-preview` part keyed by `toolCallId` — every field from a
real invocation of the real handler with `dry_run` forced, because a fabricated
row on a consent dialog is a fabricated authorisation, and no chip is emitted
for it because that work happened for the dialog rather than for the reader. The
card then has two sections — what he knows, and *"what was the variant on
these?"* — and **no confidence number**: miscalibrated model confidence
measurably degrades decisions, where provenance is a fact that cannot be
miscalibrated. Classification keys on **candidate count, not resolution status**,
because an omitted variant on a multi-printing card resolves *successfully* to
the primary, so a status-keyed field would file exactly the row worth asking
about under "known". `pickVariant`'s silent-default semantics are unchanged and
pinned by a test; the classification is a new field beside it.

That card **cannot** be expressed through the approval protocol above, and this
is the load-bearing consequence: the SDK signs over the held input, so any
client-side edit invalidates the signature by construction. So there are two
paths. An unedited accept — the common case — takes today's signed path
unchanged, every existing property intact. An **edited** accept never touches
the held arguments: it commits a corrected batch from the browser through
`POST /collection/batch` (the reader's own JWT, the same endpoint and the same
RLS as the rip flow — no new authority, and see SECURITY.md), and only *then*
settles the held call `approved: false` with a reason built from the real
response, which `convertToModelMessages` turns into `execution-denied` so his
account of the turn stays true. Commit-then-settle is correct by discipline
rather than by primitive, so the ordering is pinned by a test. The idempotency
key is scoped to the held call rather than to content, because a caller-supplied
key is honoured unbucketed and unbounded and a pure-content key would have made
the second identical correction anyone ever made write nothing while reciting
the first one's numbers as fresh. `editable: false` is the safe answer and is
taken often — any tool that is not `log_cards`, a dry run that failed, a
`structured` row with no certainty field (the rolling-deploy case: new browser,
old server) — and the card then renders as the plain dialog on the signed path,
because a broken preview must degrade the UI and never the write.

**One behaviour change worth knowing before someone files it as a bug:** a card
with more than one printing and no stated variant used to be silently resolved
to the primary *and written*. It is now asked about, and not written if the
question is ignored.

### 15f. Fabrication is bounded, not cured

Nine defects were found by deploying this branch to a preview and asking it real
questions. None were caught by tests — 88 API tests, 183 web tests, a clean
typecheck across nine workspaces, CI, CodeQL and an adversarial review were all
green — and several could not have been (DECISIONS.md 2026-08-22, "Nine defects
that only a deployment could find"). What they share matters more than any one
of them: **wherever a tool's output cannot answer the obvious next question, the
model fills the gap.** An empty result under a filter that could never match
reads as "not found" rather than "wrong index"; a summary that names cards
without returning their ids invites the caller to invent the missing key.

So the fixes are in the tools rather than the prompt, and because the tools live
in `packages/agent-tools` (§10) the MCP front-end gets them in the same commit.
`search_cards` now leads its description with what it does NOT match — `query`
matches CARD names, never a set name, however many ways you spell it — and, on a
`set_id` no set has, says in as many words that an empty result is not evidence
the card does not exist. `collection_summary` returns ids. `set_progress`'s
unknown-id error names the recovery. This is a better frame than "the model is
unreliable", because a contract gap is findable, fixable and testable, and an
instruction not to guess is none of those.

**And the fix belongs in the shared helper, not the caller that reported it.**
`resolve.ts` compared a card reference's `set_id` raw, so `search_cards`
understood `sv3.5` and `add_cards`/`log_cards` did not — a bug that works
wherever it is tested and fails wherever it writes. `get_card` had been patched
individually, which is exactly how a fix stays half-applied. The same shape
appears once more in the name field: a rarity written into it (`Tatsugiri
Illustration Rare`) matches no printed name, returns nothing, and is read as
"that card does not exist" — after which a price gets quoted from memory. Both
are now handled inside `resolve.ts` and `entities.ts`, so the next tool to take
a card reference gets them without knowing they exist. The rarity vocabulary is
read from `card.rarity` rather than hardcoded, because it grows with every set.

**That unknown-set result is a `fail`, not an `ok`, and the difference is not
cosmetic.** `grounding.ts` collects the card ids tools actually returned this
turn, and `screens.ts`'s `sanitizeScreen` drops any id in a grid that was not
among them — the control on the defect where he drew five card ids the account
does not own, twice, with different ids each run. It is a Set lookup, no model
call, sub-millisecond, chosen over chain-of-verification and self-consistency on
cost for a latency-critical path. But `grounding.observe` harvests
card-id-shaped tokens from every SUCCESSFUL tool result, and the unknown-set
message echoes the model's own guessed `set_id` back at it, which is right — it
needs to know which id was wrong. A guess of `sv1-25` is card-id-shaped; through
`ok` it would have grounded ITSELF, and a grid built on it would then have been
waved through. Errors are excluded from grounding, and `fail` is the honest
shape anyway. With nothing observed at all, everything passes: this is a check
for CONTRADICTED ids, not for unproven ones.

**He still narrates.** Asked to add 4000 of a card, the deployed preview emitted
`<express><commands><op>state</op><value>alert_dizzy</value></commands></express>`
as ordinary visible text and produced zero `data-decke` chunks — a character
reading his stage directions aloud while standing perfectly still.
`apps/api/src/decke/narration.ts` strips that syntax out of visible text; the
stream transform moved there out of `api/chat.mjs`, which keeps only a
`console.warn`, because a Vercel function is untyped, unimportable and driven
only by a live deployment, and the ordering bugs were in exactly that half (the
held tail was flushed under a literal `id: 'narration'`, naming a block no
`text-start` ever opened — our own reader concatenates and does not care, a
conformant one drops it, and what it drops is the end of a real sentence). The
filter is deliberately narrow, anchored on our own tool names in any namespace
and in the `name="…"` attribute form the gate suite caught on the preview, so
`<b>` and `10% < 15%` survive. That list is DERIVED from `COSMETIC_TOOLS` in
`tools.ts` rather than written out. It was a hand-written seven while
`buildTools` exposed nine, so a leaked `<journey>` or `<xai:escort>` walked
straight past the filter for as long as those two tools had existed — no type
error, no failing test, and the only symptom a reader seeing markup in a speech
bubble (issue #90). `tools.test.ts` now pins `COSMETIC_TOOLS` to the tools that
factory actually returns, and `narration.test.ts` asserts every one of them is
stripped in all three shapes, so a tool cannot be added without the filter
learning it. The 23 data tools and 4 deep tools stay deliberately out of scope:
their names are ordinary English (`decks`, `lists`, `health`, `revert`) and the
attribute rule strips a whole element on a bare `name="…"` match, which trades a
leak nobody has measured for false positives on prose that happens daily. It
also says plainly what it cannot do: four of
five observed failures were not markup but bare prose — `flyTo
[data-decke-goal-switcher] point=true` — and no pattern catches that without
also eating sentences he is supposed to say.

The only thing that moved that behaviour was the model. Five prompt rewrites
scored 0/5 each on `flyTo`; the same prompt with the same 34 tools on
`spacexai/grok-4.20-non-reasoning` called it 5/5, with zero narration across 32
turns, so that is the chat model now. `models.ts` records the inconvenient half
too, because a file of measurements is worth nothing if the awkward numbers are
left out: 7.49x the cost rather than the pricing page's 6.25x (the gap is
caching — 98.4% cache-hit and 365 no-cache input tokens per turn, against 67.1%
and 10,078), ~340 ms slower TTFT in every scenario rather than on average, and a
restraint regression accepted as a direction by the owner.

**Per-step tool narrowing, recorded with its uncertainty intact.** `focus.ts`
recomputes `activeTools` per step through `prepareStep`: on the first step he
sees 24 of his 34 tools, everything except the ten heavy deck-and-list writes,
and everything returns on step two. `log_cards` stays visible from step one,
because "add these cards" is the request this feature exists to serve. The
bisection that motivated it — 34 tools narrated 5/5, 23 tools 1/5, 10 tools 3/5,
so fewer was NOT better — **did not replicate**: a follow-up run saw 0/24 on the
primary trigger, found a real bug in its own harness, and could not rule out an
analogous gap in the first. The narrowing stays because it removes no capability
and costs nothing measurable, not because the numbers are settled, and
`focus.ts` says so at the top of the file rather than keeping the flattering
half.

### 15g. The chat surface — a transcript, and a way to walk somebody there

**The panel is the content pane.** On desktop it occupies the space between the
sidebar and the right edge, below the header; both stay sharp and usable. On a
phone the scrim starts below the app header **by offset, not by z-index**, and
that distinction is the mechanism rather than a preference: `backdrop-filter`
samples whatever composites behind it regardless of paint order, so a scrim
dropped below the header would still blur what is under it. The blurred element
must not extend under the header at all. Both offsets come from custom
properties `AppShell` publishes — `--app-header-h` and `--app-sidebar-w` —
because the only thing that knows the sidebar's current width is the component
that collapses it, and a custom property reflows on its own where a measured
rect needs an observer and a duplicated number drifts. The panel itself is glass
and pointer-transparent on both platforms; the composer is the opaque thing, a
card rather than a pill floating on the scrim, and it takes
`max(12px, env(safe-area-inset-bottom))` as his park box does, or padding the
composer up without moving his mark would break the relationship that puts him
*beside* the input.

**A turn is an ordered list of parts.** `ChatMessage` is `{ id, role, parts }`
where a part is text, a tool row or a screen; `text` and `tools` are derived by
helpers rather than stored. Three parallel arrays had no order between them, so
a lookup that happened halfway through a sentence rendered above the sentence it
interrupted, updating a chip filtered-and-appended so every settled row moved to
the end, and only one screen per turn was expressible. An update is now an update
in place, which is what lets movement tools emit rows from their real results and
lets rows interleave with prose in occurrence order.

**Rows are quiet by default; failure is the deliberate exception.** A `partial`
or an `error` row gets a distinct tone, an explicit label in words, its real
detail already expanded, and a retry — because the owner read *"The analyze tool
timed out before it could finish reading your full collection"* on camera, called
it a great response, and did not notice it had failed. `partial` is a wire phase
in its own right: a deep call that runs out of wall clock, output budget or steps
resolves `partial`, never `ok`, and both `previewOf` and the replayed evidence
record stopped filtering on `ok` alone — the replay labels partials as incomplete
rather than dropping them, or the next turn quotes a half-finished reading with
more confidence than the first. A turn that spends its whole step budget without
speaking says so instead of leaving an empty bubble; the discriminator is the
step count and not the finish reason, because a turn ending on tool calls with no
text is the normal shape of a navigation handoff. Between send and first token
there is a real thinking row that appears immediately, counts, and carries only
status lines the server actually emitted at a real tool boundary.

**Closing the chat ends the turn.** It aborts, settles any pending approval as a
denial — the correct reading of walking away from the question — and records on
the transcript that it was stopped. Letting a turn run invisibly is worse than it
sounds, because a turn can navigate: the page would move under someone who has
just said they were done, with no surface left to explain why.

**Markdown is rendered under a URL and image allowlist.** `lib/markdownSafety.ts`
is shared by the chat renderer and `routes/deck/MarkdownView.tsx`, which draws
the guide Deck-E's own `deck_strategy` tool writes. Links are limited to
`http`/`https`/`mailto` plus relative, and **no remote image is ever fetched** —
the alt text is shown instead. SECURITY.md carries the reasoning.

**A journey is one plan, executed in the browser.** The `journey` tool takes an
ordered, capped step list (`say`, `goTo`, `flyTo`, `highlight`, `click`,
`ensure`; at most ten) and `character/host/journey.ts` runs it as a timeline —
one leg, not one model turn per hop, which is possible at all because the
selectors are constructible from ids the data tools return before anything moves.
Steps take **landmark references, never free CSS**: a free selector is a
capability, and the plan is validated at parse time so a bad one is refused whole
before step 0. There is no wait verb and no duration field — every step that
names a landmark waits for that landmark, bounded, because a fixed delay after a
click is wrong on a slow connection and making it inexpressible beats a rule
against it. `ensure` exists because the determinism premise is false: on
`/series` the uncollected series appear only after a one-shot disclosure. A
trusted-event guard is load-bearing, since the sequencer performs its own clicks
and without `isTrusted` the first would cancel the journey running it; a real
click or scroll from the reader does cancel it, and it says where it left off. A
hidden control is still a clickable control — below the nav breakpoint the
sidebar links are `display: none` but present — so a step that needs him to be
SEEN refuses a target with no box. A journey that stops half way is `partial`,
not `error`, and its summary is built from what ran rather than from what was
planned. Cost is the argument: a four-leg escort re-bills ~17k prompt tokens, one
journey leg ~5.1k.

**Navigation invalidates his state.** The character host subscribes to the route:
the speech bubble retires, the minimised bar clears, and a park anchored to a
selector on the page just left is re-solved. A journey step is exempt via an
explicit flag rather than via `travelling`, which only means "a UI tool moved him
at some point this turn" and would therefore have exempted the case the owner
actually hit.

---

## The write path (revised 2026-08-19)

Two shapes of collection write, deliberately:

| | per-variant | batch |
|---|---|---|
| endpoint | `PATCH /collection/variants/:id`, `POST …/increment` | `POST /collection/batch` |
| caller | the web UI's stepper | `log_cards`, imports |
| transaction | one per variant | ONE for the whole batch |
| progress recompute | one per call | one per DISTINCT SET |
| idempotency | none (a human pressing again means it) | keyed |

The batch endpoint exists because the per-variant shape does not scale to a
pack-opening haul. Driving it in a loop from the MCP cost **0.65 s per item** in
production — two SQL round trips to resolve, one HTTPS hop, one transaction, one
full-set CTE — which put a 99-item batch past the serverless wall clock and
produced the 2026-08-19 silent-success incident (DECISIONS.md). The batch path is
~25 round trips instead of ~1200.

Its statement order matters and is load-bearing:

1. **insert the idempotency row** — first, so a duplicate collides before
   anything changes;
2. **materialise `collection_item` placeholders at quantity 0** — Postgres cannot
   lock a row that does not exist, and "I just pulled this card" is exactly when
   it does not; without this, two concurrent batches both read 0 and both write
   1, losing a delta;
3. **lock**, ordered by `card_variant_id` (as is step 2's source list, so two
   overlapping batches cannot deadlock);
4. compute in JS from the locked values;
5. one multi-row UPDATE, one first-acquisition query, one event INSERT;
6. `recomputeSetProgress` per distinct set, ordered by set id;
7. **explicit COMMIT before the response** (`commitRequestTx`) — the RLS
   middleware otherwise commits on `res.on('finish')`, i.e. after the response
   has flushed, which for this endpoint would be the incident's own failure mode
   in miniature.

## The mutation log

`mutation_batch` (one row per operation) and `mutation_event` (one row per thing
changed, with `before` and `after`) sit alongside `collection_event` rather than
replacing it: that table is the collection's activity feed and predates this by
seven migrations. `collection_event.batch_id` joins them, so one row can answer
both "what happened to this card" and "which operation did it belong to".

`mutation_event` is append-only at the policy level — SELECT and INSERT, no
UPDATE — so a revert appends compensating events rather than editing history.
See SECURITY.md for why that matters on Supabase specifically.
