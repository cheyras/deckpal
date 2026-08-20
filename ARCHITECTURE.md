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

**CDN:** Supabase Storage includes a CDN, but the SPA does not link to it
directly -- it requests the same relative paths self-host does
(`/deckpal/images/en/<serie>/<set>/<localId>/<low|high>.webp`, built by
`cardImages()` in `apps/api/src/db.ts` and `setAssetUrl()` in
`apps/web/src/components/ui.tsx`). `vercel.json` rewrites that prefix to
`/api/images?p=…`, a serverless function (`apps/api/src/images/handler.ts`)
that lazily fills the bucket on demand: a HIT 302s straight to the public
object URL (`max-age=31536000, immutable`, so a warm asset costs the function
nothing after the first request per edge); a MISS reads the `image_asset`
row, fetches the bytes from its `source_url`, writes them through
`putAsset()`, then 302s; a genuine FAIL serves the same ~1 KB placeholder
self-host uses, or 404 for set imagery. An image URL never answers with HTML
-- the invariant that closed the bug where every `<img>` on deckpal.app was
silently serving the index shell (DECISIONS.md 2026-08-10, "Cloud image tier:
lazy cache-on-demand out of Supabase Storage"). Image transforms (resize,
format conversion) are available on Pro.

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

## 10. MCP server — live and multi-user

`deckpal-mcp`'s 21 tools are served to any signed-up user at
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

Shipping it means the chunk is emitted (~945 kB of three.js and the runtime) and
the 5.6 MB of assets sit in `public/models/`. Neither is downloaded by anyone who
does not open the route, because the import is lazy — **provided both stay out of
the PWA precache**, which is eager and would otherwise pull 6.5 MB into every
visitor's cache on first load for a route exactly one account can open.
`vite.config.ts` excludes `models/**` and `assets/Decke-*.js`; measured, the
precache is unchanged at 25 entries / 1964 KiB with the route shipping.

Deck-E is a stylized robot deck box who will eventually be the AI assistant's
body: the LLM drives his animation from the conversation, and when he presents
part of the UI he parks beside that element facing inward. He is authored in
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
  dom.ts          DOM element -> a place to stand
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
