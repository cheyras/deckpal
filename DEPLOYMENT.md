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
