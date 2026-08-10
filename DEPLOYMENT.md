# DeckScout — Deployment Guide

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
Supabase CLI's migration system). Run against the **direct** connection string
(not the pooled one):

```bash
# Clone the repo and install
git clone https://github.com/cheyras/deckscout.git
cd deckscout
pnpm install

# Set the direct connection string
export SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres"

# Build the db package and run all migrations (001-024)
pnpm --filter @deckscout/db build
pnpm --filter @deckscout/db migrate

# Verify
pnpm --filter @deckscout/db migrate:status
```

Migrations 001-020 are platform-agnostic (any Postgres 15+). Migration 021 adds
RLS policies and links `app_user` to `auth.users` (Supabase-specific; skipped
automatically when `SUPABASE_MODE` is unset).

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

**You do not have to fill this bucket up front.** The `/deckscout/images/*`
serverless function (`api/images.mjs` → `apps/api/src/images/handler.ts`) fills
it lazily: a request for an object that is not there yet looks the asset up in
the `image_asset` manifest, fetches it from the `source_url` that row recorded,
writes bytes and row together through the choke point in `@deckscout/storage`,
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
pnpm --filter deckscout-images storage:backfill -- --prefix sets

# just the art that can NEVER be lazily recovered (rows with no source_url)
pnpm --filter deckscout-images storage:backfill -- --missing-source

# the whole corpus — ~2.1 GB, needs Supabase Pro (Free's 1 GB is not enough)
pnpm --filter deckscout-images storage:backfill -- --prefix images

# record per-tier rows for objects already in the bucket (repairs a partial run,
# or bytes some other writer published)
pnpm --filter deckscout-images storage:backfill -- --reconcile
```

Every upload goes through the same choke point the lazy fill uses
(`packages/storage/src/put-asset.ts`), so it refuses to publish a file with no
`image_asset` row — bytes whose origin you cannot state never get published — and
it records the per-tier `image_object` row for the copy it just wrote. It is
idempotent and resumable: an object already in the bucket is not re-sent, but its
per-tier row is still recorded.

> **`scripts/storage-backfill.mjs` is superseded.** It writes objects directly
> rather than through the choke point, so it cannot record `image_object` rows;
> objects it creates will be reported by `manifest:check --object-store` as
> "objects with no row". Use the command above.

**Auditing the bucket.** The disk tier proves "no byte without a row" by walking a
directory; the object tier proves it by listing the bucket:

```bash
# point PG* at the cloud database, then:
pnpm --filter deckscout-images manifest:check -- --object-store
```

### 4. Create a Vercel project

1. Import the repo on [vercel.com](https://vercel.com).
2. Set the following build configuration:
   - **Build Command:** `pnpm --filter deckscout-web build`
   - **Output Directory:** `apps/web/dist`
   - **Root Directory:** (leave as repo root)
   - **Install Command:** `pnpm install`

3. Set environment variables in the Vercel dashboard:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Server-side only |
| `SUPABASE_DB_URL` | `postgresql://postgres:<pw>@db.<project>.supabase.co:5432/postgres` | Direct connection (migrations) |
| `DATABASE_URL` | `postgresql://postgres.<project>:<pw>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true` | Pooled connection (API) |
| `API_BASE_PATH` | `/api` | |
| `NODE_ENV` | `production` | |

4. **(Optional) Bug reporter → GitHub issues:** Create a fine-grained Personal
   Access Token at `github.com/settings/personal-access-tokens/new` with
   **Issues: Read and write** permission scoped to your `deckscout` repo. Set
   the two environment variables:

   | Variable | Value |
   |---|---|
   | `GITHUB_TOKEN` | `github_pat_...` |
   | `GITHUB_REPO` | `cheyras/deckscout` |

   When set, in-app bug reports create GitHub issues automatically. The
   reporter's identity is stored privately in the `bug_report` DB table and
   never appears in the public issue. If Supabase Storage is configured
   (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), screenshots are uploaded to
   a `bug-reports` storage bucket and linked in the issue body.

5. Deploy. The `vercel.json` in the repo carries the real build command and the
   rewrites, in this order (order matters — the SPA fallback must stay last, or
   it swallows everything):
   - `/deckscout/images/*` → the image function (`api/images.mjs`), which serves
     card art and set logos/symbols out of the `card-art` bucket
   - `/api/*` → the Express catch-all serverless function (`api/index.mjs`)
   - everything else → the SPA (`index.html`)

### 5. Run the data-migration script (existing data)

If you have an existing local database to migrate (e.g., from a prior self-hosted
installation):

```bash
# Dump the local database
pg_dump -Fc -f deckscout-local.dump <local-db-name>

# Run the migration script
# (connects to both the local DB and Supabase, copies data with user_id
# mapped to your Supabase Auth UUID)
pnpm --filter deckscout-sync migrate-to-cloud
```

The script (`scripts/migrate-to-cloud.ts`):
1. Copies catalog tables row-by-row (idempotent via ON CONFLICT)
2. Copies per-user tables with user_id mapped to your Supabase Auth UUID
3. Handles the BIGINT-to-UUID type transformation
4. Preserves all FKs and IDs

**Verify after migration:**
- Card count matches (`SELECT COUNT(*) FROM card` = 23,444)
- Variant count matches (`SELECT COUNT(*) FROM card_variant` = 35,648+)
- Collection items are owned by the correct user
- Run reconcile to recompute progress

### 6. GitHub Actions sync setup

Catalog and price imports run as scheduled GitHub Actions workflows. Set the
following repository secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
|---|---|
| `SUPABASE_DB_HOST` | `db.<project>.supabase.co` |
| `SUPABASE_DB_PASSWORD` | Your Supabase database password |

The workflows:
- `.github/workflows/sync-catalog.yml` — weekly catalog sync (Sunday 03:00 UTC)
- `.github/workflows/sync-prices.yml` — daily price sync
- `.github/workflows/sync-snapshot.yml` — daily collection value snapshot

---

## Path B — Self-host (plain Postgres)

### 1. Create the database role and database

```bash
PW=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)

sudo -u postgres psql -c "CREATE ROLE deckscout LOGIN PASSWORD '$PW' \
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"
sudo -u postgres psql -c "CREATE DATABASE deckscout OWNER deckscout \
  ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"

sudo -u postgres psql <<'SQL'
ALTER ROLE deckscout SET work_mem                            = '16MB';
ALTER ROLE deckscout SET maintenance_work_mem                = '64MB';
ALTER ROLE deckscout SET statement_timeout                   = '30s';
ALTER ROLE deckscout SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE deckscout SET synchronous_commit                  = off;
ALTER ROLE deckscout SET jit                                 = off;
ALTER ROLE deckscout SET random_page_cost                    = 1.5;
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
pnpm --filter @deckscout/db build
pnpm --filter @deckscout/db migrate     # applies migrations 001-020 (skip 021+ for self-host)
pnpm --filter deckscout-sync catalog:run
pnpm --filter deckscout-web build
pnpm --filter deckscout-api build
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

Use cron, systemd timers, or any scheduler to run the importers periodically:

```bash
# Weekly catalog sync
pnpm --filter deckscout-sync catalog:run

# Daily price sync
pnpm --filter deckscout-sync prices:run
```

---

## Connect an AI assistant (MCP)

DeckScout speaks the **Model Context Protocol**, so an assistant can answer
questions about *your* collection: what you own, what a set still needs, what a
deck costs, how it has been performing. The cloud deployment serves it at
`https://deckscout.io/mcp` (Streamable HTTP) for every signed-up user; a
self-host deployment runs the same server as its own process.

### 1. Create a personal access token

In the app: **Profile → Agent access → New token**. Name it after the client
(“Claude on my laptop”), then copy the value **immediately** — DeckScout stores
only a SHA-256 hash of it, so it is shown exactly once and can never be
recovered. If you lose it, revoke it and make another.

Tokens are listed by their `dsk_…` prefix with their creation and last-used
dates, and can be revoked at any time from the same panel.

### 2a. claude.ai (custom connector)

1. **Settings → Connectors → Add custom connector**.
2. URL: `https://deckscout.io/mcp`
3. Add a header: `Authorization` = `Bearer <your token>`
4. Save, enable the connector in a chat, and ask something like *“what Base Set
   cards am I still missing, and what would they cost?”*

### 2b. Claude Code (CLI)

```bash
claude mcp add --transport http deckscout https://deckscout.io/mcp \
  --header "Authorization: Bearer <your token>"
```

Check it with `claude mcp list`, and remove it with
`claude mcp remove deckscout`.

### 2c. Any other MCP client

Point it at `https://deckscout.io/mcp` over **Streamable HTTP** and send the
token in an `Authorization: Bearer …` header. There is no OAuth flow — the
endpoint deliberately answers `401` without a `WWW-Authenticate` header so
clients do not try to start one.

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
pnpm --filter deckscout-mcp build
ROTOM_MCP_KEY=$(openssl rand -hex 32) node apps/mcp/dist/index.js
```

| Variable | Meaning |
|---|---|
| `ROTOM_MCP_KEY` | Shared secret required in the `x-brain-key` header. Startup fails without it. |
| `MCP_ALLOWED_HOSTS` | Comma-separated `Host` allowlist (DNS-rebinding protection). Default `127.0.0.1,localhost`. |
| `DECKSCOUT_MCP_PORT` | Listen port. Default `3704`. |
| `DECKSCOUT_API_BASE` | Where the REST API lives. Default `http://127.0.0.1:3700/deckscout/api`. |

Expose it through your reverse proxy at whatever path you like, add the
`x-brain-key` header there (or have the client send it), and point your MCP
client at that URL. Personal access tokens created in the UI still work as
`Authorization: Bearer` credentials against the REST API itself.

Self-hosters who want the per-user endpoint instead can run
`node apps/mcp/dist/cloud.js` (defaults to `127.0.0.1:3705`), which is the same
code the cloud function serves and expects `Authorization: Bearer dsk_…`.
