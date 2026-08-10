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
Supabase CLI's migration system). Run against the **direct** connection (not
the pooled one). The runner reads discrete `PG*` variables — the standard libpq
names — not a connection string:

```bash
# Clone the repo and install
git clone https://github.com/cheyras/deckscout.git
cd deckscout
pnpm install

# Point the runner at Supabase. These are the libpq variables; the runner reads
# these, not SUPABASE_DB_URL/DATABASE_URL.
export PGHOST="db.<project>.supabase.co"
export PGPORT=5432
export PGDATABASE=postgres
export PGUSER=postgres
export PGPASSWORD="<password>"
export PGSSLMODE=require        # Supabase terminates TLS with its own CA

# Build the db package and run all migrations (001-024)
pnpm --filter @deckscout/db build
pnpm --filter @deckscout/db migrate

# Verify
pnpm --filter @deckscout/db migrate:status
```

> **On `PGSSLMODE`.** Supabase serves a certificate chain that is not in the
> system trust store, so a *verifying* mode fails with `self-signed certificate
> in certificate chain`. `require` is the right answer and means what libpq says
> it means — encrypt the connection, do not verify the chain. DeckScout
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

> **These commands are the only supported way to publish bytes.** Anything that
> uploads to the bucket directly, bypassing `packages/storage/src/put-asset.ts`,
> cannot record `image_object` rows — objects it creates get reported by
> `manifest:check --object-store` as "objects with no row". Repair such a bucket
> with `storage:backfill -- --reconcile`.

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
| `PGHOST` | `aws-0-us-east-1.pooler.supabase.com` | Pooled connection (API) — the runtime reads `PG*`, not a URL |
| `PGPORT` | `6543` | |
| `PGDATABASE` | `postgres` | |
| `PGUSER` | `postgres.<project>` | |
| `PGPASSWORD` | `<pw>` | |
| `PGSSLMODE` | `require` | See "On `PGSSLMODE`" above |
| `SUPABASE_DB_URL` | `postgresql://postgres:<pw>@db.<project>.supabase.co:5432/postgres` | Reference only — read by `scripts/migrate-to-cloud.mjs`, not by the API |
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

**`.github/workflows/catalog-refresh.yml` — weekly catalog refresh (Sundays
04:30 UTC), plus `workflow_dispatch`.** This is the only scheduled data workflow
that exists today; price and snapshot ingests still run from the `deckscout-sync`
process (Path B below) and are not yet wired to Actions.

Add these repository secrets — Settings → Secrets and variables → Actions → *New
repository secret*. The values are exactly the matching lines of your `.env.cloud`:

| Secret | Value (from `.env.cloud`) | Required |
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
`.env.cloud` present:

```bash
ENV_FILE=.env.cloud scripts/refresh-catalog.sh    # extract (B3-safe) + import
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
pnpm --filter deckscout-images rekey:set --rename <old>:<new>
# object tier (Supabase Storage; .env.cloud loaded)
pnpm --filter deckscout-images rekey:set --object-store --rename <old>:<new>
# then prove both tiers
pnpm --filter deckscout-images manifest:check
pnpm --filter deckscout-images manifest:check --object-store
```

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

`deckscout-sync` runs the price and collection-snapshot jobs on its own node-cron
schedule. The **catalog** entry there is a logging stub on purpose: refreshing the
catalog needs Docker to extract the upstream JSON, so it is a scheduled GitHub
Actions job for the cloud path (`.github/workflows/catalog-refresh.yml`) and a
cron/systemd timer calling the script directly for self-host:

```bash
# Weekly catalog refresh — extract upstream JSON (B3-safe) and import it
scripts/refresh-catalog.sh                # uses .env
SKIP_IMPORT=1 scripts/refresh-catalog.sh  # extract + delta report only

# One price ingest by hand (otherwise the deckscout-sync scheduler runs it)
pnpm --filter deckscout-sync run-once prices-tcgcsv
```

Requires Docker on the host. If a refresh reports `renamedSets > 0`, the cached
card art for those sets is stranded under the old set id — re-address it with
`pnpm --filter deckscout-images rekey:set --rename <old>:<new>` and confirm with
`manifest:check`. See the cloud section above for why this is a re-key and never
a re-warm.

---

## Connect an AI assistant (MCP)

DeckScout speaks the **Model Context Protocol**, so an assistant can answer
questions about *your* collection: what you own, what a set still needs, what a
deck costs, how it has been performing. The cloud deployment serves it at
`https://deckscout.io/mcp` (Streamable HTTP) for every signed-up user; a
self-host deployment runs the same server as its own process.

### 1. Create a personal access token

1. Sign in at <https://deckscout.io> and open **Profile** (the avatar, top
   right).
2. Scroll to **Agent access** and press **New token**.
3. Name it after the client you are about to connect — e.g. `claude.ai` or
   `Claude on my laptop` — and press **Create token**.
4. Copy the value **immediately.** DeckScout stores only a SHA-256 hash, so the
   token is shown exactly once and can never be recovered. Alongside it you also
   get a **personal connector URL** of the form
   `https://deckscout.io/mcp/dsk_…` — copy that too; step 2 may need it.

Tokens are listed afterwards by their `dsk_…` prefix with their creation and
last-used dates, and can be revoked from the same panel at any time.

### 2. Add the connector in claude.ai

In claude.ai: **Settings → Connectors → Add custom connector**. Name it
`DeckScout`, then use whichever of these the dialog offers you.

**A · If the dialog has a “Request headers” section (preferred)**

1. Remote MCP server URL: `https://deckscout.io/mcp`
2. Open **Request headers**. Choose the header name `authorization` and set the
   value to `Bearer <your token>` — the word `Bearer`, one space, then the
   token. Mark it **Required**.
3. Click **Add**.

Request headers are a beta Anthropic is still rolling out to accounts, so the
section may not be there. If it isn't, use B.

**B · If there is no header field — use your personal connector URL**

1. Remote MCP server URL: paste `https://deckscout.io/mcp/dsk_…` (the personal
   connector URL from step 1).
2. Add no headers. Click **Add**.

That URL *contains* your token, so treat the whole string like a password:
don't paste it into a screenshot, a shared doc, or a bug report. It is
revocable and scoped to exactly one user — revoking the token kills the URL.
The token is in the URL **path**, never a query parameter (the MCP
authorization spec forbids credentials in the query string).

### 3. Check that it works

Start a new chat, enable DeckScout in the tools menu, and ask:

> what is my collection worth, and which set am I closest to finishing?

You should get your own numbers back. The token's **Last used** date in
Profile → Agent access updates within a minute.

### 4. Claude Code instead (optional)

```bash
claude mcp add --transport http deckscout https://deckscout.io/mcp \
  --header "Authorization: Bearer <your token>"
```

`claude mcp list` should then print:

```
deckscout: https://deckscout.io/mcp (HTTP) - ✔ Connected
```

Remove it with `claude mcp remove deckscout`. Claude Code takes arbitrary
headers at add time, so option A always works there.

### 5. If it doesn't connect

- Use `https://deckscout.io` **exactly** — not `www.deckscout.io`. The `www`
  host 308-redirects to the apex, and a redirect to a different host silently
  drops the `Authorization` header.
- *"Couldn't reach the MCP server"* or an authorization failure almost always
  means the token is missing, truncated, or revoked. A token cannot be shown
  twice, so a partial copy is unrecoverable — create a fresh one and re-paste.
- In option A, include the word `Bearer` and one space before the token.
  claude.ai sends the header value exactly as typed and adds no scheme of its
  own.
- There is no OAuth flow. The endpoint answers `401` **without** a
  `WWW-Authenticate` header on purpose, so no client tries to start one.

### 6. Revoking

**Profile → Agent access → Revoke.** It takes effect immediately, on every
client. The row stays in the list, struck through and marked *Revoked*, so you
can see it happened. Then delete the connector in claude.ai or give it a new
token.

### Any other MCP client

Point it at `https://deckscout.io/mcp` over **Streamable HTTP** with an
`Authorization: Bearer <token>` header, or at
`https://deckscout.io/mcp/<token>` with no header at all.

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
