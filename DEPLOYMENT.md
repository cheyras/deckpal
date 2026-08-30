# DeckPal — Deployment Guide

Two deployment paths: **Vercel + Supabase** (recommended, multi-user with auth
and CDN) or **self-host** (plain Postgres behind your own reverse proxy).

---

## Path A — Vercel + Supabase (cloud)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Note your project's **URL**, **anon key**, **service role key**, and the
   **direct connection string** (Settings > Database > Connection string > URI).
3. Enable the required Postgres extensions in the Supabase dashboard
   (Database > Extensions):
   - `pg_trgm` — trigram index for card name search
   - `unaccent` — accent-insensitive search

> **Storage cost note:** The full card-art corpus is ~1.9 GB. Supabase Free
> tier includes 1 GB of storage, which is not enough for the full image set.
> **Supabase Pro ($25/month)** includes 100 GB and is the recommended tier. On
> Free, you can serve only low-resolution images (~400 MB) or defer image
> migration and serve from upstream CDNs.

### 2. Run migrations

The project uses its own migration runner with SHA-256 checksums (not the
Supabase CLI's migration system). Run against the **direct** connection (not
the pooled one). The runner reads discrete `PG*` variables — the standard libpq
names — not a connection string:

```bash
# Clone the repo and install
git clone https://github.com/cheyras/deckpal.git
cd deckpal
pnpm install

# Point the runner at Supabase. These are the libpq variables; the runner reads
# these, not SUPABASE_DB_URL/DATABASE_URL.
export PGHOST="db.<project>.supabase.co"
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER=postgres
export PGPASSWORD="<password>"
export PGSSLMODE=require        # Supabase terminates TLS with its own CA

# Build the db package and run all migrations
pnpm --filter @deckpal/db build
pnpm --filter @deckpal/db migrate

# Verify
pnpm --filter @deckpal/db migrate:status

# Fill the card-identity index (migration 047 onward). Idempotent; ~6s.
pnpm --filter deckpal-api fingerprint:index
```

> **On `fingerprint:index`.** `card.playable_fingerprint` says which catalogue
> rows are the SAME CARD rather than merely the same name — 218 of 1,409
> Standard-legal names are more than one card, and two agent tools tell the
> model to pick "the cheapest printing", which is only safe when something
> knows the difference. The hash covers child tables the importer writes after
> the card row exists, so it cannot be an importer column or a generated one;
> it is a pass. `scripts/refresh-catalog.sh` runs it after every import, so
> this line is only needed on a fresh database or a manual migrate. It exits
> non-zero if nothing hashes or if no name resolves to several cards — the two
> shapes that mean the hash is broken rather than the catalogue being small.
> After changing `fingerprint.ts` itself, run it once with `--all`.

> **On `PGSSLMODE`.** Supabase serves a certificate chain that is not in the
> system trust store, so a *verifying* mode fails with `self-signed certificate
> in certificate chain`. `require` is the right answer and means what libpq says
> it means — encrypt the connection, do not verify the chain. DeckPal
> implements the libpq semantics itself (`packages/db/src/pool.ts`) rather than
> inheriting node-postgres's, which verifies for every mode:
>
> | `PGSSLMODE` | Behaviour |
> |---|---|
> | unset, `disable` | no TLS — the self-host default (local socket / trusted LAN) |
> | `allow`, `prefer` | encrypt, do not verify |
> | `require` | encrypt, do not verify — **use this for Supabase** |
> | `verify-ca` | encrypt, verify the chain, ignore the hostname |
> | `verify-full` | encrypt, verify the chain and the hostname |
>
> To verify against Supabase rather than trust-on-first-use, download the
> project's CA certificate from the Supabase dashboard and point
> `PGSSLROOTCERT` at it; `require`, `verify-ca` and `verify-full` all honour it.
> An unrecognised value is rejected outright — a typo must not silently
> downgrade the connection to plaintext.

Whether a migration is platform-agnostic or Supabase-only is a per-file marker,
not a numbered range: a migration whose first line is `-- @supabase-only` (021's
RLS policies + `auth.users` link, and the later RLS/Storage companions) is
skipped automatically when `SUPABASE_MODE` is unset (`packages/db/src/migrate.ts`);
everything else runs on any Postgres 15+.

> **Fresh-project note:** Migration 013 seeds a default `app_user` row for
> self-host use. On a fresh Supabase project this row's UUID has no matching
> `auth.users` entry, which would cause 021's foreign key to fail. The migration
> runner detects this: when `SUPABASE_MODE` is set, it automatically deletes any
> `app_user` rows with no `auth.users` match immediately before applying 021.
> The Supabase signup trigger (created by 021) will create `app_user` rows for
> real users going forward. No manual intervention is needed.

### 3. Set up the Storage bucket

Create a public storage bucket named `card-art` in the Supabase dashboard
(Storage > New bucket). Enable public access — card art is not user-private.

The object key inside the bucket is exactly the `image_asset.relative_path` the
self-host disk cache uses, so a bulk backfill is a straight upload of the local
`cache/` tree with no remapping:

```
card-art/
  images/<lang>/<serie>/<set>/<localId>.low.webp
  images/<lang>/<serie>/<set>/<localId>.high.webp
  sets/<setId>/logo.webp
  sets/<setId>/symbol.webp
  sprites/<dexId>.png                            # Pokédex pixel art
  sprites/shiny/<dexId>.png
  sprites/other/official-artwork/<dexId>.png
  sprites/other/official-artwork/shiny/<dexId>.png
```

**You do not have to fill this bucket up front.** The `/deckpal/images/*`
serverless function (`api/images.mjs` → `apps/api/src/images/handler.ts`) fills
it lazily: a request for an object that is not there yet looks the asset up in
the `image_asset` manifest, fetches it from the `source_url` that row recorded,
writes bytes and row together through the choke point in `@deckpal/storage`,
and then redirects to the public object URL. Every later request for that asset
is a 302 to Supabase's CDN, so the function does no work at all. Cold assets
that cannot be filled (no manifest row, or upstream no longer serves them) get
the same small placeholder WebP the self-host service serves, with a short TTL
so they self-heal — an image URL never answers with HTML.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are all this needs; the service
role is required because Storage writes are server-side only.

Species sprites are filled the same way, from the PokeAPI commit SHA pinned in
`scripts/fetch-sprites.sh` (they are the one asset class with no per-file
manifest row — the pinned SHA *is* their provenance).

**Backfilling from a local cache.** Lazy fill can only recover what upstream
still serves, and TCGdex does drop and re-encode assets. If you have a populated
self-host cache, mirror it into the bucket — the object key is the same relative
path, so it is a plain copy:

```bash
# set imagery only — ~5 MB, makes every set logo/symbol upstream-independent
pnpm --filter deckpal-images storage:backfill -- --prefix sets

# just the art that can NEVER be lazily recovered (rows with no source_url)
pnpm --filter deckpal-images storage:backfill -- --missing-source

# the whole corpus — ~2.1 GB, needs Supabase Pro (Free's 1 GB is not enough)
pnpm --filter deckpal-images storage:backfill -- --prefix images

# record per-tier rows for objects already in the bucket (repairs a partial run,
# or bytes some other writer published)
pnpm --filter deckpal-images storage:backfill -- --reconcile
```

Every upload goes through the same choke point the lazy fill uses
(`packages/storage/src/put-asset.ts`), so it refuses to publish a file with no
`image_asset` row — bytes whose origin you cannot state never get published — and
it records the per-tier `image_object` row for the copy it just wrote. It is
idempotent and resumable: an object already in the bucket is not re-sent, but its
per-tier row is still recorded.

> **These commands are the only supported way to publish bytes.** Anything that
> uploads to the bucket directly, bypassing `packages/storage/src/put-asset.ts`,
> cannot record `image_object` rows — objects it creates get reported by
> `manifest:check --object-store` as "objects with no row". Repair such a bucket
> with `storage:backfill -- --reconcile`.

**Auditing the bucket.** The disk tier proves "no byte without a row" by walking a
directory; the object tier proves it by listing the bucket:

```bash
# point PG* at the cloud database, then:
pnpm --filter deckpal-images manifest:check -- --object-store
```

### 4. Create a Vercel project

1. Import the repo on [vercel.com](https://vercel.com).
2. Set the following build configuration:
   - **Build Command:** `pnpm --filter deckpal-web build`
   - **Output Directory:** `apps/web/dist`
   - **Root Directory:** (leave as repo root)
   - **Install Command:** `pnpm install`

3. Set environment variables in the Vercel dashboard:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Server-side only |
| `PGHOST` | `aws-0-us-east-1.pooler.supabase.com` | Pooled connection (API) — the runtime reads `PG*`, not a URL |
| `PGPORT` | `6543` | |
| `PGDATABASE` | `postgres` | |
| `PGUSER` | `postgres.<project>` | |
| `PGPASSWORD` | `<pw>` | |
| `PGSSLMODE` | `require` | See "On `PGSSLMODE`" above |
| `SUPABASE_DB_URL` | `postgresql://postgres:<pw>@db.<project>.supabase.co:5432/postgres` | Reference only — read by `scripts/migrate-to-cloud.mjs`, not by the API |
| `API_BASE_PATH` | `/api` | |
| `NODE_ENV` | `production` | |
| `DECKE_VERCEL_AI_GATEWAY_KEY` | `<Vercel AI Gateway key>` | **Deck-E's brain. Unset = his chat is off.** The credential `POST /api/chat` uses to reach the Vercel AI Gateway. **Unset means every chat request 503s** and the client hides the character's entry point — fail-closed, and reported rather than silent: the API warns on boot and returns `deckeGate` on `GET /health` (`configured` / `unset` / `borrowed`). **It must be a key with paid credits attached.** A free-tier key authenticates fine and lists every model, then returns a bare `429` — no `retry-after`, no `x-ratelimit-*` headers — on *every* model, so a model fallback does not help and retrying only burns budget. **Deliberately separate from `AI_GATEWAY_API_KEY`**, which belongs to the marketing image generator (`scripts/gen-marketing-images.mjs`): two keys means Deck-E's per-user spend is legible on its own and revocable without breaking a build script. Local development falls back to `AI_GATEWAY_API_KEY` when this is unset; **production never falls back**, because quietly billing the wrong key is worse than being off. |
| `DESIGN_EDITOR_USER_ID` | `<auth.users UUID>` | **Set this, or two features are dead.** Gates two surfaces. It names the deployment's **owner**: the one account allowed to open the read-only `/design` design-system reference and the `/dev/decke` character preview in production (`GET /me` returns `designEditor: true` and `owner: true` for it). **Unset = nobody**, so both fail closed — which is correct, but was silent until 2026-08-18: `/design` shipped gated on this and the variable was never set, so the route was shut to its only user for four days. The API now warns on boot and reports `ownerGate` on `GET /health` when it is missing (AGENTS.md B11). The name is historical — it means "the owner", and `/design` was simply the first thing that needed one. Editing the design system always requires the local dev server; this only gates viewing. |
| `DECKE_ENTITLED_USER_IDS` | `<uuid>,<uuid>` | **Who may talk to Deck-E, beyond the owner.** Comma-separated `auth.users` UUIDs. `POST /api/chat` refuses anything not on this list and not `DESIGN_EDITOR_USER_ID` with **403**, checked server-side before the body is parsed. Until 2026-08-21 there was no server-side check at all — the gate lived in the browser, so any signed-in account could `curl` a full model turn onto the owner's Gateway key (verified against the deployed endpoint, not hypothesised). **Unset means owner-only**, which is a real intended configuration rather than a failure, so `GET /health` reports `deckeEntitlement.status` as `owner-only` — or `nobody` when `DESIGN_EDITOR_USER_ID` is also unset, which shuts Deck-E to everybody and warns on boot. Health reports the STATUS and a COUNT, never the ids: `/health` is unauthenticated. **This is also what makes the feature verifiable**: the QA account (`.qa-account`, AGENTS.md B12) is deliberately an ordinary user, and the browser gates for Deck-E include ones that write, which may never run as the owner. Put the QA account's UUID here. |
| `DECKE_MAX_TURNS_PER_DAY` | `120` (default) | Per-account daily cap on Deck-E conversation, enforced in Postgres (`decke_usage`, migration 039). **One "turn" is one BILLED MODEL REQUEST, not one thing the reader typed** — a client-side tool ends the server turn, so a journey ("take me to that set") spends up to four. At a measured $0.000143 a turn the default is under two cents a day per account. Over cap returns **429** with a spoken refusal, not a 500. Empty falls back to the default; an explicit `0` switches the tier off. |
| `DECKE_MAX_DEEP_CALLS_PER_DAY` | `10` (default) | The same, for the analysis/research tier (`plan_deck`, `write_strategy_guide`, `research_meta`, `analyze_collection`). Capped **separately and far tighter** because it is ~250x the price: `models.ts` measures one analysis call at $0.0356, and a realistic `plan_deck` — large collection context plus research plus thinking — at $0.50-$1. Owner's standing decision: Claude Sonnet by default, Opus only on an explicit ask. |
| `PGPOOL_MAX_API` | **unset** in cloud | Size of the Express API's `request` pool (`apps/api/src/db.ts`), and the ONE knob that can override contract B2's role/backend sizing. **Leave it unset here.** Unset means `makePool` picks the role default — **12** against the Supabase transaction pooler, hard-capped at 24 — which is the number the pooler's whole design assumes: it multiplexes, so clients need not ration. `2` is the DIRECT-Postgres self-host number and belongs only to that deployment; `.env.example` stopped shipping it on 2026-08-11 for exactly this reason (DECISIONS.md). **Setting it low in cloud is invisible until it isn't**: in SUPABASE_MODE the RLS middleware holds one pooled connection for the whole lifetime of every request, so this value IS the server's maximum concurrency, and exceeding it does not queue politely — requests block until `connectionTimeoutMillis` (10 s) and answer **500 `Internal server error`** with a bare `pg-pool` connect-timeout stack. Boot logs the chosen value (`[db] pool role=request … max=…`) and now warns when it is below the pooled default; `GET /health`'s pool census (`waiting > 0` with `idle: 0`) is the live symptom. |
| `PGPOOL_MAX_CHAT` | `2` (default) | Size of the pool `api/chat.mjs` opens for the meter. **A separate process from the Express app**, so `/health`'s live pool census cannot see it and never will — health reports the configured value under `deckeLimits.chatPoolMaxConfigured` and says which it is. Two is enough because the connection is held for ONE statement before the stream starts and released immediately; nothing inside the stream touches the pool. Contract B2's `request` role. |
| `DECKE_METER_TIMEOUT_MS` | `5000` (default) | Watchdog on the meter's connect and query. A database that has stopped answering must not turn every Deck-E request into a hung socket holding a pooled connection on an instance Vercel is about to freeze. On timeout the meter **fails open** and logs loudly — accounting fails open, access control does not, and they are separate checks for exactly that reason. |
| `DECKE_PGRLS_MAX_HOLD_MS` | `10000` (default) | How long ONE Deck-E tool call may hold its pooled connection. Deliberately far below the API's 30 s `PGRLS_MAX_HOLD_MS`, because the unit differs: that budget covers a whole request, this one covers a single `search_cards`. A read taking ten seconds is not slow, it is stuck, and on a conversational path the reader gave up several seconds ago. On expiry the connection is **destroyed rather than pooled** — it may be mid-statement inside an open transaction carrying that turn's RLS claims, and returning it would let the next request race a still-running query from someone else's session. |
| `DECKE_DEEP_BUDGET_MS` | `210000` (default) | Wall-clock ceiling for ONE deep-tier sub-agent (`plan_deck`, `write_strategy_guide`, `research_meta`, `analyze_collection`). Must stay comfortably under `api/chat.mjs`'s `maxDuration` (300 s) — the gap is not slack, it is the time needed to write the partial answer out, let the conversational model comment on it, and close the stream properly. A sub-agent that hits this returns **what it has so far, labelled incomplete**, rather than being killed: it streams for exactly that reason, since a call that is simply killed produced nothing and was billed anyway. |
| `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_MESSAGE` | set by Vercel | **Not set by hand — but the feature that reads them can be switched off by accident.** Deck-E's transcript history stamps every turn with the build that served it, so *"did this get worse, and when"* is a query rather than a guess. The PR number is parsed from the squash-merge subject (`Title (#78)`) and the sha is the commit. Both arrive as ordinary runtime environment variables **only while the project's "Automatically expose System Environment Variables" setting is ON** (Vercel → Project → Settings → Environment Variables). Turn it off and every new turn records `buildPr: null, buildSha: null` — silently, and indistinguishably from a run of preview deploys, which is the failure this row exists to make findable. Nothing else depends on them; the history keeps working and simply stops being correlatable. Verified live: a turn recorded on a preview came back stamped with the deploying commit. |
| `DECKE_CREDITS_ENABLED` | unset (default) | **Switches Deck-E from the daily two-counter meter to a single credit balance.** Unset or anything other than the exact string `true` keeps `decke_usage` (migration 039) and changes nothing. Set to `true` and every turn and every deep call spends from `decke_credit_balance` (migrations 041/042) instead, with a HARD STOP at zero — the owner's call: *"I can use him while I have credits. If I'm out, I can't use him."* **Do not set this before granting balances.** 041 creates every balance at `0`, so switching it on first makes Deck-E unavailable to every account at once, the owner's included. The order is: run the migrations, grant balances, then set the flag. 039's tables are left in place so the flag is reversible. Prices live in `apps/api/src/decke/credits.ts`, derived from measured per-call cost via `CREDIT_USD` — the retail price of a top-up is a separate decision and is not encoded anywhere yet. |

### Static asset caching (`vercel.json` → `headers`)

Vercel serves every static file as `public, max-age=0, must-revalidate` by
default, so the browser re-asks about **every** asset on **every** page load.
Two rules in `vercel.json` fix that. They are split because the two directories
have opposite safety properties, and merging them would be a bug:

| Path | Header | Why |
|---|---|---|
| `/assets/(.*)` | `public, max-age=31536000, immutable` | Vite CONTENT-HASHES these (`index-Dx7HewrO.js`). The filename changes whenever the bytes do, so a stale copy is unreachable by construction and caching forever is free. This is the whole app's JS and CSS. |
| `/models/decke/(.*)` | `public, max-age=3600, stale-while-revalidate=86400` | Deck-E's assets are **not** hashed — the runtime asks for them by name as string literals so `apps/web/scripts/check-precache.mjs` can prove they exist. A long `max-age` here would pin people to an old character across a deploy, so this bounds staleness at an hour, then serves stale for a day while refreshing behind the reader. |

**`index.html` and `sw.js` are deliberately absent, and must stay absent.** Both
have to keep revalidating. `index.html` is what points at the hashed assets, so
caching *it* is the thing that would actually strand someone on an old deploy;
and a stale `sw.js` cannot be corrected by a later deploy at all, because the
stale worker is what would have to fetch the fix. Vercel's default is correct
for both, which is why no rule matches them — **do not add a catch-all rule.**

When a `/models/decke/` asset has to change incompatibly, **rename it** rather
than relying on the hour. That is what `studio_small_09_1k.hdr` →
`studio_small_09_256.hdr` was for (DECISIONS.md, 2026-08-24).

Repeat visits are handled separately and more aggressively by the service
worker's Tier 2 route (`apps/web/src/sw.ts`), which serves the character from
the device instantly and revalidates in the background. These headers are what
the visit *before* the worker takes over gets, plus every browser where a
service worker never activates.

### Turning Deck-E's credits on

**The order is not the obvious one.** Migration 041 creates every balance at
`0`, so setting the flag first makes Deck-E unavailable to every account at
once — the owner's included.

```bash
# 1. Create the tables. Changes no behaviour on its own.
set -a && . ./.env.prod && set +a
pnpm --filter @deckpal/db migrate

# 2. Put credits on the accounts that need them, BEFORE the flag.
node scripts/decke-credits-grant.mjs --email you@example.com --credits 2000
node scripts/decke-credits-grant.mjs --qa --credits 2000
node scripts/decke-credits-grant.mjs --email you@example.com --show   # verify

# 3. Only now, the flag — and it needs a redeploy to take effect.
vercel env add DECKE_CREDITS_ENABLED production   # value: true
vercel env add DECKE_CREDITS_ENABLED preview      # value: true
vercel --prod                                     # or redeploy the preview
```

**To turn it back off**, remove the variable and redeploy: migration 039's
`decke_usage` is left in place and the daily counters resume exactly as before.
No data is lost either way — balances and the event log simply stop being read.

**A re-run of the grant script on the same day is refused**, not doubled: the
event's `ref` defaults to `<reason>:<email>:<date>` and 041 puts a unique index
on it. Pass `--ref` to grant deliberately again.

**What things cost** is printed by the script and lives in
`apps/api/src/decke/credits.ts` — a conversational turn is 1 credit, an analysis
call 4, a deck plan 75, and the panel starts showing a balance at 100.

| `DECKE_APPROVAL_SECRET` | `<long random string>` | **Signs Deck-E write approvals so they cannot be forged.** Every write is held for a human to approve — but the SDK verifies the approval's signature ONLY when this is set (`ai/dist/index.js:5164`); unset, the approval is taken at face value. That matters because Deck-E's client replays the whole conversation on every leg, so a crafted caller could append `state: "approval-responded", approval: { approved: true }` to a tool call it was never granted — or approve "add 1 card" and send back "add 4000" against the same approval. The tool INPUT is inside the signature; without it nothing binds them. **Unset is not broken** (it is what every deployment did before this existed) so it does not fail closed, but it is a security control that is OFF: the API warns at boot and `GET /health` reports `deckeApprovals: "unsigned"`. Generate with `openssl rand -base64 32` and set it in Production and Preview. |

   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be present at **runtime**
   as well as build time. They are what `GET /api/public-config` serves, which is
   how a contributor's `pnpm dev` configures itself against this deployment
   without the repo committing any key (AGENTS.md B12). Both are already public —
   they are compiled into the SPA bundle this deployment serves — so exposing
   them on an endpoint reveals nothing new. A self-host deployment has neither,
   answers `mode: 'self-host'` with empty strings, and a dev server pointed at it
   refuses with an explanatory error instead of half-configuring itself.

   If you rotate the anon key, redeploy: every developer's next `pnpm dev` picks
   the new one up automatically, with no commit and no coordination.

   **Card-art delivery (optional):**

   | Variable | Effect |
   |---|---|
   | `VITE_CARD_ART_BUCKET` | Storage bucket the SPA addresses card art in **directly**, skipping the `/deckpal/images` function and its redirect (DECISIONS.md 2026-08-26). Build-time only. Defaults to `card-art`, which is the same default the server uses (`CARD_ART_BUCKET`, `packages/storage/src/config.ts`) — **set it only if you renamed the bucket, and set it to the same value on both.** Getting it wrong does not break images: the direct URL 404s, `CardImage` falls back to the image tier, and you silently get the slower pre-2026-08-26 behaviour. `VITE_SUPABASE_URL` must be set at build time for the fast path to exist at all; without it every image uses the proxy (expected on self-host, and the dev build warns). |

   After a catalog import or a set release, warm the new art or the first person
   to view it pays a ~1.5–2.5 s fill per image:

   ```bash
   pnpm --filter deckpal-images warm:cloud                 # whole catalog, low + high
   pnpm --filter deckpal-images warm:cloud -- --set sv11   # just the new set
   ```

   It needs no credentials (the catalog and image routes are public), is
   idempotent and resumable, and reports the assets upstream genuinely cannot
   serve rather than counting them as filled.

   **Dev-server-only variables** (never set these on a deployment):

   | Variable | Effect |
   |---|---|
   | `DECKPAL_DEV_ORIGIN` | Deployment `pnpm dev` proxies to. Default `https://deckpal.app`. Point it at a preview URL or a fork. |
   | `DECKPAL_DEV_BACKEND` | `local` forces the full local stack. Equivalent to `pnpm dev --local`. |
   | `DECKPAL_DEV_API_PORT` | Worktree lanes; selects `local` automatically (roadmap/ORCHESTRATION.md). |
   | `DECKPAL_DEV_ALLOW_BUGS` | `1` re-enables `POST /api/bugs` from the dev server. Off by default so UI verification cannot file real issues. |

4. **(Optional) Bug reporter → GitHub issues:** Create a fine-grained Personal
   Access Token at `github.com/settings/personal-access-tokens/new` with
   **Issues: Read and write** permission scoped to your `deckpal` repo. Set
   the two environment variables:

   | Variable | Value |
   |---|---|
   | `GITHUB_TOKEN` | `github_pat_...` |
   | `GITHUB_REPO` | `cheyras/deckpal` |

   When set, in-app bug reports create GitHub issues automatically. The
   reporter's identity is stored privately in the `bug_report` DB table and
   never appears in the public issue. If Supabase Storage is configured
   (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), screenshots are uploaded to
   a `bug-reports` storage bucket and linked in the issue body.

5. Deploy. The `vercel.json` in the repo carries the real build command and the
   rewrites, in this order (order matters — the SPA fallback must stay last, or
   it swallows everything):
   - `/deckpal/images/*` → the image function (`api/images.mjs`), which serves
     card art and set logos/symbols out of the `card-art` bucket
   - `/api/*` → the Express catch-all serverless function (`api/index.mjs`)
   - everything else → the SPA (`index.html`)

### 5. Run the data-migration script (existing data)

If you have an existing local database to migrate (e.g., from a prior self-hosted
installation):

```bash
# Dump the local database
pg_dump -Fc -f deckpal-local.dump <local-db-name>

# Run the migration script
# (connects to both the local DB and Supabase, copies data with user_id
# mapped to your Supabase Auth UUID)
pnpm --filter deckpal-sync migrate-to-cloud
```

The script (`scripts/migrate-to-cloud.ts`):
1. Copies catalog tables row-by-row (idempotent via ON CONFLICT)
2. Copies per-user tables with user_id mapped to your Supabase Auth UUID
3. Handles the BIGINT-to-UUID type transformation
4. Preserves all FKs and IDs

**Verify after migration:**
- Card count matches (`SELECT COUNT(*) FROM card` = 23,546 as of 2026-08-22,
  verified against production's own `/api/search` rather than copied forward —
  this line read 23,444 for a fortnight after the 2026-08-10 catalog refresh,
  which made a correct migration look like a failed one)
- Variant count matches (`SELECT COUNT(*) FROM card_variant` = 35,648+)
- Collection items are owned by the correct user
- Run reconcile to recompute progress

### 6. GitHub Actions sync setup

Four data workflows, all driven by the same five secrets below. Three are
scheduled; `price-rollup.yml` is dispatch-only until its first supervised run.

| Workflow | Schedule | What it does |
|---|---|---|
| `catalog-refresh.yml` | Sundays 04:30 UTC | `card` / `card_set` in step with upstream TCGdex |
| `price-refresh.yml` | every 15 min, plus 02:10 and 21:10 UTC | polls TCGCSV's `last-updated.txt` and ingests on change; nightly Cardmarket ingest, all-users value snapshot, set-progress reconcile |
| `price-backfill.yml` | manual only | replays TCGCSV daily archives into `price_observation` for a past range |
| `price-rollup.yml` | 3rd of the month, 04:20 UTC (armed 2026-08-30) | tiered retention: rolls old months into weekly/monthly OHLC `price_bucket` rows, verifies them against the source, then retires and later DROPS the daily partition |

**`price-refresh.yml` is what keeps prices and the Insights charts alive on the
cloud tier.** Until 2026-08-29 nothing did: `apps/sync` is a long-running
node-cron process that has to be running *somewhere*, `vercel.json` has no
`crons`, and this section previously said in as many words that the price and
snapshot ingests "are not yet wired to Actions". Every scheduled job stopped on
2026-08-08 and nothing noticed for three weeks — the app served prices "as of 22
days ago" and every Insights range chip drew the same ten days. See DECISIONS.md
2026-08-29.

The 15-minute tick is a POLL, not an ingest: TCGCSV publishes once a day (~20:05
UTC), so `ingestTcgcsvPrices` checks `last-updated.txt` first and returns
`{skipped:true}` when the stamp is unchanged. ~95 of the ~96 daily ticks are one
30-byte request and a single-row query.

**Verifying it is alive:** `GET /api/health` → `syncs` reports the last
successful run per job, straight from `sync_run`. That block is what diagnosed
the original outage and is the authoritative check — a green Actions run only
says the workflow executed.

**`price-rollup.yml` destroys data by design, so its `schedule:` shipped
COMMENTED OUT and was armed only after a supervised first run.** Daily price rows
forever are ~6.6 GB/year against a Supabase Pro allowance of 8 GB. The catch-up
ran against the live database on 2026-08-30: 23 months oldest-first, every
verification exact, **2.374 GiB → 0.495 GiB**. The order in the workflow's own
header — backfill complete → `dry_run` → supervised chunks → record the
before/after totals → then the cron — is the order to repeat if this ever has to
be redone.

Steady state is one small run a month. If a run goes red, read `haltedAt` and
`notAttempted` in its summary first: the job stops at a month it cannot finish
rather than rolling past it, and the months behind it are deliberately left
alone.

**There is a repair deadline, and it is finite.** A month with days nobody
ingested is refused by the rollup (and the run HALTS there rather than rolling
past it), so the normal outcome of an ingest outage is a red rollup naming the
missing days — replay them with `price-backfill.yml` and re-run. The
`allow_gaps` input exists for days TCGCSV genuinely never published; using it
makes the hole permanent, because after the partition is dropped the buckets are
the only copy. On the monthly cron the window between an outage and its month
becoming eligible is roughly 35-65 days.

One disclosed cost of the tiers, unrelated to outages: `prices snapshot-backfill`
can honestly skip a small number of days just after a weekly quarter is dropped,
where the nearest bucket close is older than the tier's window allows. Those days
are reported by date, not silently omitted.

Its retention windows (30 days daily / ~6 months weekly / monthly forever) are
NAMED CONSTANTS in `apps/sync/src/prices/rollup.ts`, deliberately not environment
variables — so per B11 there is no runtime configuration here that can be
silently unset. If they ever become tunable they gain a row in the table below
in the same commit.

`price-backfill.yml` is manual because its range is a decision with a storage
bill attached: one archived day is ~44k price rows, so a two-year replay is ~32M
rows and ~3-4 GB. It is chunked (`limit` days per run), skips days already
ingested, and self-chains until `remaining` reaches 0.

Add these repository secrets — Settings → Secrets and variables → Actions → *New
repository secret*. The values are exactly the matching lines of your cloud env
file, `.env.prod`.

> **This section said `.env.cloud` until 2026-08-29, and no such file exists.**
> That is not a cosmetic slip: the runbook pointed at a file nobody had, the
> four secrets were therefore never created, and `catalog-refresh.yml` failed
> its credentials preflight on every scheduled run from the day it shipped —
> silently, because a red weekly job nobody is watching looks like no job at
> all. **Resolved 2026-08-29:** the secrets were set from `.env.prod`, and both
> `price-refresh` and `catalog-refresh` completed successfully within the hour —
> the catalog's first green run ever. Verify with `gh secret list` (expect five)
> and `GET /api/health` → `syncs`, which reports the last successful run per job
> from `sync_run` and is the authoritative check; a green Actions run only says
> the workflow executed.


| Secret | Value (from `.env.prod`) | Required |
|---|---|---|
| `SUPABASE_DB_HOST` | `PGHOST` — the Supabase pooler host | yes |
| `SUPABASE_DB_NAME` | `PGDATABASE` | yes |
| `SUPABASE_DB_USER` | `PGUSER` | yes |
| `SUPABASE_DB_PASSWORD` | `PGPASSWORD` | yes |
| `SUPABASE_DB_PORT` | `PGPORT` | no — defaults to `5432` |

Nothing else is needed. The importer talks to Postgres only: no service-role key,
no Storage access, no extra GitHub token. `PGSSLMODE=require` and `PGPOOL_MAX=1`
are set in the workflow itself because they are configuration, not credentials.

Until the secrets exist the job's first step fails with a one-line error naming
the missing ones, rather than a confusing connection error later on.

**What the run tells you.** The job summary reports cards before → after, sets
before → after, and `renamedSets` / `renamedCards`. Those last two matter: card
art is addressed by a set's `tcgdex_id` (AGENTS.md B6), so when upstream re-keys a
set, the catalog moves and the cached images do not — every card in that set then
serves a placeholder. **The job deliberately fails when that happens**, after the
import has committed, and prints the exact `rekey:set` commands to run. The
catalog is already correct at that point; re-run the workflow once the re-key is
done and it goes green (the importer sees no rename the second time).

**Running it by hand** — the same thing the workflow does, from a checkout with
`.env.prod` present:

```bash
ENV_FILE=.env.prod scripts/refresh-catalog.sh     # extract (B3-safe) + import
SKIP_IMPORT=1 scripts/refresh-catalog.sh          # extract + delta report only
```

`scripts/refresh-catalog.sh` never starts the TCGdex API server (contract B3 — it
loads all 18 languages per worker and will OOM the box); it `docker create`s a
container purely to `docker cp` the compiled JSON out of. The importer is
idempotent (B8), so re-running is a no-op beyond whatever upstream actually
changed, and it never deletes user-owned rows.

**If a run reports a rename**, re-address the cached art — do not re-warm it. The
bytes are already correct, and for some sets the upstream URL now 404s, so a
refetch would destroy art rather than restore it:

```bash
# disk tier (self-host cache; PG* pointed at that box's database)
pnpm --filter deckpal-images rekey:set --rename <old>:<new>
# object tier (Supabase Storage; .env.prod loaded)
pnpm --filter deckpal-images rekey:set --object-store --rename <old>:<new>
# then prove both tiers
pnpm --filter deckpal-images manifest:check
pnpm --filter deckpal-images manifest:check --object-store
```

### 7. AI issue triage (optional)

**`.github/workflows/issue-triage.yml` — runs on every issue opened via the
in-app reporter.**  A cheap AI model (Claude Haiku) reviews the report and posts
a draft analysis as a comment — noting missing details for bugs, and ranking
against current priorities from the wiki.  The comment is clearly labeled as
AI-generated and non-authoritative; the workflow never modifies labels or issue
state.

Add one repository secret:

| Secret | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | An Anthropic API key (any tier — Haiku is very cheap) | yes |

```bash
gh secret set ANTHROPIC_API_KEY --repo cheyras/deckpal
# paste the key when prompted
```

Until this secret exists the workflow exits cleanly with a notice — it does not
fail, because a missing optional enrichment should not break anything.  No other
secrets are needed: the built-in `GITHUB_TOKEN` is sufficient for posting the
comment and reading the public wiki.

### Transactional email (custom SMTP)

Supabase's built-in sender is shared infrastructure capped at **2 emails/hour**
across the whole project. That is fine while you are the only account and fatal
the moment strangers can sign up, so wire your own sender before opening signups.

DeckPal uses [Resend](https://resend.com) (free tier: 3,000/month, 100/day).
Any SMTP provider works — only the DNS records differ.

**1. Verify a sending domain.** Domain management needs a **Full access** API key;
a *Sending access* key returns `401 restricted_api_key` here, even though it
authenticates against SMTP perfectly well. Create the domain, then publish the
three records Resend returns. If your DNS is on Vercel:

```bash
# --scope is REQUIRED. Without it the CLI reports "You don't have permission to
# list the domain record" -- a scope-resolution problem wearing a permissions error.
vercel dns add <domain> resend._domainkey TXT "p=<dkim-public-key>" --scope <team>
vercel dns add <domain> send MX feedback-smtp.us-east-1.amazonses.com 10 --scope <team>
vercel dns add <domain> send TXT "v=spf1 include:amazonses.com ~all" --scope <team>
```

Resend's API labels these `DKIM` and `SPF` in its `record` field. Those are
*purposes, not DNS types* — everything is TXT except the row carrying a
`priority`, which is MX. Both SPF rows share the name `send`.

**2. Point Supabase at it.** Dashboard → Authentication → SMTP Settings, or the
Management API:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"smtp_host":"smtp.resend.com","smtp_port":"465","smtp_user":"resend",
       "smtp_pass":"<SENDING-ONLY key>","smtp_admin_email":"noreply@<domain>",
       "smtp_sender_name":"DeckPal","rate_limit_email_sent":100}'
```

`smtp_port` must be a **string**; `465` as a number is rejected with
`expected string, received number`, while `rate_limit_email_sent` on the same
request takes a real number.

Use the **sending-only** key as `smtp_pass`. The full-access key is needed only to
create the domain and can be deleted afterwards — the credential that lives
permanently in third-party config should be the one that can do the least.

**3. Prove it, and do not fool yourself.** Test with an address that has **no
account yet** — a `+alias` reaches the same inbox:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you+smtptest@gmail.com","password":"<throwaway>"}'
```

Signing up an address that already exists returns **HTTP 200 with a fabricated
user id and sends nothing** — Supabase does that so signup cannot be used to
enumerate accounts. A green status code there is not evidence. Confirm against the
provider's own delivery log (`GET https://api.resend.com/emails`) and check the
sender reads your domain rather than a `supabase.io` address.

Note that a send-only domain needs no MX record, so it can never *receive* mail —
password reset will not work for any account at that domain.

---

## Path B — Self-host (plain Postgres)

> **Deck-E is not available on this tier.** His turn endpoint is `POST
> /api/chat`, which exists only as the Vercel serverless function
> `api/chat.mjs`; `apps/api` serves no Express equivalent, so a self-host
> deployment has nothing to answer a conversation with. The client gates the
> entry point off accordingly (`apps/web/src/character/host/entitlement.ts`)
> rather than drawing a button that fails only after the reader has opened the
> chat and typed something. Every `DECKE_*` row in the environment table above
> is cloud-only for the same reason. Nothing else in the product is withheld
> from this tier.

### 1. Create the database role and database

```bash
PW=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)

sudo -u postgres psql -c "CREATE ROLE deckpal LOGIN PASSWORD '$PW' \
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"
sudo -u postgres psql -c "CREATE DATABASE deckpal OWNER deckpal \
  ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"

sudo -u postgres psql <<'SQL'
ALTER ROLE deckpal SET work_mem                            = '16MB';
ALTER ROLE deckpal SET maintenance_work_mem                = '64MB';
ALTER ROLE deckpal SET statement_timeout                   = '30s';
ALTER ROLE deckpal SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE deckpal SET synchronous_commit                  = off;
ALTER ROLE deckpal SET jit                                 = off;
ALTER ROLE deckpal SET random_page_cost                    = 1.5;
SQL
```

### 2. Configure environment

```bash
cp .env.example .env
chmod 600 .env
# Edit .env -- set PGPASSWORD to the password from step 1
```

### 3. Install, migrate, build

```bash
pnpm install
pnpm --filter @deckpal/db build
pnpm --filter @deckpal/db migrate     # auto-skips `-- @supabase-only` migrations (SUPABASE_MODE unset)
pnpm --filter deckpal-sync import:catalog   # optional arg: dataDir (default data/catalog/en)
pnpm --filter deckpal-web build
pnpm --filter deckpal-api build
```

### 4. Run

```bash
node apps/api/dist/index.js
```

The API serves the built SPA. The image server (`apps/images`) serves cached
card art from the local disk. Run it alongside the API if you need card art
served locally.

### 5. Configure a reverse proxy

The API has no built-in authentication in self-host mode. Place a reverse proxy
(e.g., nginx with an SSO gateway, Caddy with SSO, or any auth-capable proxy) in front
of the API. See [`SECURITY.md`](SECURITY.md) for details.

### 6. Set up sync jobs

`deckpal-sync` runs the price and collection-snapshot jobs on its own node-cron
schedule. The **catalog** entry there is a logging stub on purpose: refreshing the
catalog needs Docker to extract the upstream JSON, so it is a scheduled GitHub
Actions job for the cloud path (`.github/workflows/catalog-refresh.yml`) and a
cron/systemd timer calling the script directly for self-host:

```bash
# Weekly catalog refresh — extract upstream JSON (B3-safe) and import it
scripts/refresh-catalog.sh                # uses .env
SKIP_IMPORT=1 scripts/refresh-catalog.sh  # extract + delta report only

# One price ingest by hand (otherwise the deckpal-sync scheduler runs it)
pnpm --filter deckpal-sync run-once prices-tcgcsv
```

Requires Docker on the host. If a refresh reports `renamedSets > 0`, the cached
card art for those sets is stranded under the old set id — re-address it with
`pnpm --filter deckpal-images rekey:set --rename <old>:<new>` and confirm with
`manifest:check`. See the cloud section above for why this is a re-key and never
a re-warm.

---

## Connect an AI assistant (MCP)

DeckPal speaks the **Model Context Protocol**, so an assistant can answer
questions about *your* collection: what you own, what a set still needs, what a
deck costs, how it has been performing. The cloud deployment serves it at
`https://deckpal.app/mcp` (Streamable HTTP) for every signed-up user; a
self-host deployment runs the same server as its own process.

### 1. Connect

Works with claude.ai, ChatGPT, Gemini, Claude Code, or any client that speaks
the MCP Authorization spec (OAuth 2.1 + PKCE + dynamic client registration —
`apps/api/src/oauthServer.ts`).

1. In your client, add a custom MCP connector pointed at
   `https://deckpal.app/mcp` and choose **Connect** (not a manual-header
   option).
2. Your client registers itself, then opens `https://deckpal.app/authorize`
   in a browser tab. Sign in to DeckPal if you aren't already.
3. Approve the consent screen — it names the client asking and exactly what
   it can do (read/write your collection, decks, lists, battle logs; not your
   password, not your account settings).
4. You're bounced back to the client, already connected. No token to copy.

Under the hood, approving mints an ordinary personal access token (below) named
after the client — it shows up in **Profile → Agent access** exactly like one
you created by hand, with the same **Revoke** button.

### 2. If your client doesn't support MCP OAuth — a personal access token

Some clients (or older versions) only take a static URL or header. For those:

1. Sign in at <https://deckpal.app> and open **Profile** (the avatar, top
   right).
2. Scroll to **Agent access** and press **New token**.
3. Name it after the client — e.g. `claude.ai` or `Claude on my laptop` — and
   press **Create token**.
4. Copy the value **immediately.** DeckPal stores only a SHA-256 hash, so the
   token is shown exactly once and can never be recovered. Alongside it you also
   get a **personal connector URL** of the form
   `https://deckpal.app/mcp/dsk_…` — copy that too.

Tokens are listed afterwards by their `dsk_…` prefix with their creation and
last-used dates, and can be revoked from the same panel at any time — same as
an OAuth-connected client, because it's the same underlying credential.

**A · If the dialog has a "Request headers" section**

1. Remote MCP server URL: `https://deckpal.app/mcp`
2. Open **Request headers**. Choose the header name `authorization` and set the
   value to `Bearer <your token>` — the word `Bearer`, one space, then the
   token. Mark it **Required**.
3. Click **Add**.

**B · If there is no header field either — use your personal connector URL**

1. Remote MCP server URL: paste `https://deckpal.app/mcp/dsk_…` (the personal
   connector URL from step 4 above).
2. Add no headers. Click **Add**.

That URL *contains* your token, so treat the whole string like a password:
don't paste it into a screenshot, a shared doc, or a bug report. It is
revocable and scoped to exactly one user — revoking the token kills the URL.
The token is in the URL **path**, never a query parameter (the MCP
authorization spec forbids credentials in the query string).

### 3. Check that it works

Start a new chat, enable DeckPal in the tools menu, and ask:

> what is my collection worth, and which set am I closest to finishing?

You should get your own numbers back. The token's **Last used** date in
Profile → Agent access updates within a minute.

### 4. Claude Code

```bash
claude mcp add --transport http deckpal https://deckpal.app/mcp
```

Claude Code runs the OAuth flow itself and opens `/authorize` in your browser.
To use a static token instead: `claude mcp add --transport http deckpal
https://deckpal.app/mcp --header "Authorization: Bearer <your token>"`.

`claude mcp list` should then print:

```
deckpal: https://deckpal.app/mcp (HTTP) - ✔ Connected
```

Remove it with `claude mcp remove deckpal`.

### 5. If it doesn't connect

- Use `https://deckpal.app` **exactly** — not `www.deckpal.app`. The `www`
  host 308-redirects to the apex, and a redirect to a different host silently
  drops the `Authorization` header (and breaks the OAuth redirect_uri
  exact-match check).
- Landing on `/authorize` and seeing "Invalid connection request" means the
  client sent a malformed request (missing `client_id` or PKCE parameters) —
  usually a client that doesn't actually implement MCP OAuth yet. Use the
  personal access token instead (§2).
- *"Couldn't reach the MCP server"* or an authorization failure with a manual
  token almost always means the token is missing, truncated, or revoked. A
  token cannot be shown twice, so a partial copy is unrecoverable — create a
  fresh one and re-paste.
- In option A above, include the word `Bearer` and one space before the token.
  claude.ai sends the header value exactly as typed and adds no scheme of its
  own.

### 6. Revoking

**Profile → Agent access → Revoke.** It takes effect immediately, on every
client, whether it connected via OAuth or a manual token — both are the same
`api_token` row. The row stays in the list, struck through and marked
*Revoked*, so you can see it happened. Then delete the connector in your
client or reconnect to get a new one.

### Any other MCP client

Point it at `https://deckpal.app/mcp` over **Streamable HTTP** and either let
it run OAuth discovery (`.well-known/oauth-protected-resource` →
`.well-known/oauth-authorization-server` → register → `/authorize` → `/token`),
or give it an `Authorization: Bearer <token>` header, or point it at
`https://deckpal.app/mcp/<token>` with no header at all.

### What the token grants

The token acts as **you**, limited to your own data. Whoever holds it can read
and change your collection, lists, decks and battle logs — the same things you
can do while signed in — and nothing else: every query it makes runs inside your
row-level-security context, so it cannot see another user's rows. It cannot
change your password, and it cannot create or revoke tokens (that needs a real
browser session). Treat it like a password, and revoke it the moment a client no
longer needs it.

### Tools

21 tools: `health`, `collection_summary`, `collection_log`, `collection_value`,
`search_cards`, `get_card`, `set_progress`, `decks`, `save_deck`, `delete_deck`,
`deck_strategy`, `add_battle_log`, `battle_logs`, `deck_history`,
`edit_battle_log`, `delete_battle_log`, `lists`, `edit_list`, `delete_list`,
`log_cards`, `set_cart`. See `apps/mcp/SPEC.md` for the full contract.

### Self-host

The MCP server is a separate long-lived process (`apps/mcp`), not part of the
API. It binds `127.0.0.1:3704` and is gated by a single shared secret rather
than per-user tokens, because a self-host deployment has one user:

```bash
pnpm --filter deckpal-mcp build
DECKPAL_MCP_KEY=$(openssl rand -hex 32) node apps/mcp/dist/index.js
```

| Variable | Meaning |
|---|---|
| `DECKPAL_MCP_KEY` | Shared secret required in the `x-brain-key` header. Startup fails without it. |
| `MCP_ALLOWED_HOSTS` | Comma-separated `Host` allowlist (DNS-rebinding protection). Default `127.0.0.1,localhost`. |
| `DECKPAL_MCP_PORT` | Listen port. Default `3704`. |
| `DECKPAL_API_BASE` | Where the REST API lives. Must be an **absolute** URL (scheme + host); every tool path is resolved against it with `new URL()` and rejected if it lands outside. Default `http://127.0.0.1:3700/deckpal/api`. |

Expose it through your reverse proxy at whatever path you like, add the
`x-brain-key` header there (or have the client send it), and point your MCP
client at that URL. Personal access tokens created in the UI still work as
`Authorization: Bearer` credentials against the REST API itself.

Self-hosters who want the per-user endpoint instead can run
`node apps/mcp/dist/cloud.js` (defaults to `127.0.0.1:3705`), which is the same
code the cloud function serves and expects `Authorization: Bearer dsk_…`.

---

## Migrations 036–038 (2026-08-19): mutation log + soft delete

Three new migrations ship together. **037 is `@supabase-only`** — the local
runner skips it unless `SUPABASE_MODE` is set, so a plain `pnpm migrate` against
a self-host database applies 036 and 038 and nothing else. That is correct
(self-host has no `auth` schema and no `authenticated` role; its access control
is the parameterised `WHERE user_id = $1` in every query), but it means **037 is
never exercised by a local run**.

Migration 028 exists because that gap bit once already: 021 shipped with a
missing INSERT policy and every cloud collection write 500'd. So before applying
to a live Supabase, run the whole set against a scratch Postgres with auth stubs:

```bash
sudo -u postgres psql -c "CREATE DATABASE deckpal_rlstest OWNER <your db user>"
sudo -u postgres psql -d deckpal_rlstest <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB DEFAULT '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid;
$$ LANGUAGE sql STABLE;
CREATE ROLE authenticated NOLOGIN;  CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
-- the auth objects must be owned by the migrating user
ALTER SCHEMA auth OWNER TO <your db user>;
ALTER TABLE auth.users OWNER TO <your db user>;
ALTER FUNCTION auth.uid() OWNER TO <your db user>;
SQL

PGDATABASE=deckpal_rlstest SUPABASE_MODE=1 pnpm migrate
```

Then prove the policies actually fire, as two different users under
`SET LOCAL role = 'authenticated'`: each sees only their own rows, neither can
insert on the other's behalf, and **nobody can UPDATE `mutation_event`** — that
last one is the append-only guarantee, and it is a policy property, not a code
one (see SECURITY.md).

Applying to production:

```bash
set -a && . ./.env.prod && set +a && pnpm migrate      # SUPABASE_MODE is set in .env.prod
```

Then, before deploying code, confirm the tables answer under a real token:

```bash
curl -s -H "authorization: Bearer dsk_…" https://deckpal.app/api/mutations?limit=1
```

Rolling back is `DROP TABLE mutation_event, mutation_batch;`,
`ALTER TABLE collection_event DROP COLUMN batch_id;`, and
`ALTER TABLE card_list DROP COLUMN deleted_at; ALTER TABLE deck DROP COLUMN deleted_at;`
plus deleting the three `schema_migrations` rows — but note that the deployed
code requires all three, so roll the code back first.

---

## DeckPal Family on Netlify

Netlify builds the React PWA into `apps/web/dist` and bundles
`netlify/functions/api.mts` as the same-origin `/api/*` backend. Configure the
following in the Netlify environment-variable UI with Functions scope; never
put their values in `netlify.toml` or a committed `.env` file.

| Name | Exposure | Purpose |
|---|---|---|
| `DATABASE_URL` | Server secret | Supabase pooled Postgres connection |
| `SUPABASE_MODE=true` | Server | Enables cloud JWT/RLS behaviour |
| `SUPABASE_JWT_SECRET` | Server secret | Verifies family member JWTs |
| `SUPABASE_URL` | Server | Supabase project URL for storage and auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server secret | Server-only sync/storage operations |
| `VITE_SUPABASE_URL` | Public | Browser authentication project URL |
| `VITE_SUPABASE_ANON_KEY` | Public | Browser anon key, constrained by RLS |
| `API_BASE_PATH=/api` | Server | Mounts Express at the Netlify API route |
| `DESIGN_EDITOR_USER_ID` | Server | Administrator Supabase user UUID |
| `FAMILY_OWNER_USER_ID` | Server | Account allowed to initialise the family |
| `FAMILY_INVITE_REDIRECT_URL` | Server | Invite callback, normally `https://your-site.netlify.app/auth/invite` |
| `CARD_ART_BUCKET` | Server, optional | Card-art bucket override |

Enable Netlify AI Gateway for the site. Netlify supplies
`ANTHROPIC_BASE_URL` automatically; do not add a personal Anthropic token to
the browser or repository. The scanner uses `claude-haiku-4-5-20251001` and
stores token counts plus a cost estimate in `ai_scan_event`, never the image.
At the current published rate used by the application, the estimate is US$1/M
input tokens and US$5/M output tokens. Confirm current pricing in the Netlify
dashboard before production because provider prices can change.

Apply migrations 052 through 057 after backing up the Supabase project. They
add family membership/RLS, AI metering, and moderated family prices. The family
owner then opens the app once to initialise the family and invites each member.
New members begin with empty collections.

The admin collection-import panel accepts JSON
`{"items":[{"cardId":"sv3-125","finish":"normal","quantity":1,"condition":"NM"}]}`
or CSV `cardId,finish,quantity,condition`. It previews all matches before using
the existing idempotent collection batch writer; the uploaded text is not
stored. The selected condition is persisted on the admin's collection row. A
file that assigns two conditions to the same physical printing is rejected for
manual correction because DeckPal stores one condition per printing.

A draft deploy must use a separate Supabase development project. Run
`pnpm test:netlify`, `pnpm check:netlify-config`, `pnpm build`, and
`pnpm --filter deckpal-web build` before creating that preview. Production is
not published until the family administrator explicitly chooses the Netlify
site and Supabase project.
