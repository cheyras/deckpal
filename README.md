# pokedex

A self-hosted, single-user [pkmn.gg](https://www.pkmn.gg/) clone running entirely on
**TheGrid** (Raspberry Pi 5). It holds its own copy of the Pokémon TCG catalog, its own
cached card art, and its own accumulating price history — so it keeps working if every
upstream disappears. No third-party account, no cloud, no paid API.

Design docs live alongside this file (`ARCHITECTURE.md`, `DECISIONS.md`, `BRIEF.md`,
`PRIOR-ART.md`, `UI-SPEC.md`) and the deep research is under `research/`. The database
model is specified in `research/SCHEMA.md`; this repo implements it.

> **Status:** Phase 2, task 2 — repository scaffold + database + **the TCGdex catalog
> importer**. The catalog (series/sets/cards/variants + variant vocabulary) now loads from
> the compiled TCGdex JSON. No prices, no images, no frontend yet, and **nothing is wired
> into pm2 or nginx**. See the checklist at the bottom.

---

## What's here

```
pokedex/
├── package.json               # pnpm workspace root
├── pnpm-workspace.yaml         # packages/* + apps/*
├── tsconfig.json               # strict base config (tsc kept OUT of the deploy path)
├── ecosystem.config.cjs        # pm2 process defs — TEMPLATE, not activated
├── .env                        # secrets, mode 600, gitignored (created at setup)
├── deploy/nginx/               # nginx location fragments — for a later task
├── packages/
│   └── db/                     # @pokedex/db — pg pool, migration runner, SQL migrations
│       └── src/migrations/     # 001…013 numbered .sql (the authoritative schema)
└── apps/
    ├── api/                    # pokedex-api  (:3700) — REST + SPA host (skeleton)
    ├── images/                 # pokedex-images (:3701) — WebP cache server (skeleton)
    └── sync/                   # pokedex-sync — node-cron scheduler (stubs, no network)
        └── src/catalog/        # the TCGdex catalog importer (transform.ts + import.ts + cli.ts)
```

**Why this shape:** it mirrors the existing `/home/cheyras/thegrid-api/` pnpm workspace
(the six pm2 services the box already runs) — same `apps/*` layout, same
`type: module` + `Node16` TS config, same `tsx`-for-dev / `tsc`-for-build split, same pm2
conventions. Shared DB/domain code lives in `packages/db` so all three services import one
pool and one schema. `tsc` is deliberately kept out of the runtime path (it is the memory
hog on this box, per `research/FRONTEND.md §9`); type-checking is a separate `typecheck`
script.

**Why plain SQL migrations over an ORM:** `research/SCHEMA.md` is 2,985 lines of
hand-written, authoritative SQL — range partitioning, generated columns, partial unique
indexes, CHECK/FK constraints and views an ORM would fight or paper over. The runner
(`packages/db/src/migrate.ts`) is ~90 lines: numbered `.sql` files applied in order, each
in one transaction, tracked with a sha256 checksum in `schema_migrations`. Shipped
migrations are immutable (a checksum change is a hard error) — add a new file, never edit.

---

## Runtime & storage (decided, see `DECISIONS.md`)

- **Node/TS + pm2 + nginx** — matching the box, **not** Docker Compose or Python/FastAPI.
- **Host Postgres 17.9**, a dedicated `pokedex` database + role, connection pool
  **hard-capped at 3** (API 2, sync 1). No `postgresql.conf` change, no Postgres restart —
  all tuning is role-scoped.
- Ports **3700–3709**, bound to `127.0.0.1` only; nginx is the sole ingress.
- Card art / sprites are **fetched at setup, never committed** to git.

---

## First-run setup

Prereqs (already true on TheGrid): Node 20, pnpm 10, host Postgres 17.9, passwordless
`sudo -u postgres`.

### 1. Create the database role and database

Generate a random password, create a **non-superuser** role and an owned database, and
apply role-scoped tuning (never `ALTER SYSTEM`):

```bash
PW=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)

sudo -u postgres psql -c "CREATE ROLE pokedex LOGIN PASSWORD '$PW' \
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"
sudo -u postgres psql -c "CREATE DATABASE pokedex OWNER pokedex \
  ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"

sudo -u postgres psql <<'SQL'
ALTER ROLE pokedex SET work_mem                            = '16MB';
ALTER ROLE pokedex SET maintenance_work_mem                = '64MB';
ALTER ROLE pokedex SET statement_timeout                   = '30s';
ALTER ROLE pokedex SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE pokedex SET synchronous_commit                  = off;
ALTER ROLE pokedex SET jit                                 = off;
ALTER ROLE pokedex SET random_page_cost                    = 1.5;
SQL
```

### 2. Write `.env`

Create `/home/cheyras/pokedex/.env` (mode **600**, already gitignored) with the generated
password:

```ini
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=pokedex
PGUSER=pokedex
PGPASSWORD=<the password from step 1>

# HARD CAP 3 total (API 2 + sync 1). Never raise past 5 without raising
# max_connections, which needs a Postgres restart and the user's permission.
PGPOOL_MAX_API=2
PGPOOL_MAX_SYNC=1
PGPOOL_MAX=3

POKEDEX_API_PORT=3700
POKEDEX_IMAGES_PORT=3701
IMAGE_CACHE_ROOT=/home/cheyras/pokedex/cache
```

```bash
chmod 600 .env
```

### 3. Install and migrate

```bash
pnpm install
pnpm migrate            # applies packages/db/src/migrations/*.sql in order
pnpm migrate:status     # [x] per applied migration
```

`pnpm migrate` is idempotent: re-running applies nothing. On a fresh empty `pokedex`
database it applies all migrations cleanly in order.

### 4. Verify (optional)

```bash
pnpm typecheck          # strict tsc --noEmit across all packages
# smoke-run a service (Ctrl-C to stop) — binds 127.0.0.1 only:
pnpm --filter pokedex-api dev
#   curl http://127.0.0.1:3700/api/pokedex/health  -> {"status":"ok","db":"up",...}
```

---

## Catalog import (Phase 2, task 2)

The importer populates `series`, `card_set`, `card` (+ the `card_type`/`card_attack`/
`card_ability`/`card_matchup` attribute junctions), the variant vocabulary
(`variant_kind` + `variant_kind_stamp` + the facet/stamp/print-run lookups) and
`card_variant`, from the compiled TCGdex English JSON.

```bash
# 1. stage the compiled JSON (the weekly job does this via `docker save | tar`, ARCHITECTURE §5.1)
mkdir -p data/catalog/en          # data/ is gitignored
cp <extract>/generated/en/{cards,sets,series}.json data/catalog/en/

# 2. run it (uses 1 pooled connection; one transaction per set)
pnpm --filter pokedex-sync import:catalog          # or: … import:catalog <dataDir>
```

Idempotent — re-running is a no-op (upserts on `card.id`, `card_variant (card_id,
variant_kind_code)`, etc.; user ownership on `card_variant` is never deleted). Loads the
full English corpus (**23,444 cards, 35,719 variant rows** — 35,648 upstream rows, 4
intra-card exact-duplicate facet tuples collapsed by the unique key, + 75 synthesized
`normal` variants for the zero-variant cards) in ~9 s at RSS well under the budget.

Facets are decomposed into the vocabulary tables; the pack-pulled **tier** is derived by
rule v3 (SCHEMA §5.3); variant **display names** are composed and stored (SCHEMA §5.4.2,
verified against the authenticated captures); per-variant TCGplayer/Cardmarket/CardTrader
ids are stored where present and modelled as genuine `NULL` (with `id_source`) where not.
Every row is written with `source='tcgdex'`, so the next task's reverse-holo cross-fill
can land provisional `source='tcgcsv'` rows on the same `(card_id, variant_kind_code)` slot
via `ON CONFLICT DO UPDATE`. Prices, images, dex data and the cross-fill are **later tasks**.

> Two schema corrections this task forced (see `packages/db/src/migrations/014_*.sql`):
> `card_variant` gained the `source`/`fill_confidence` columns ARCHITECTURE §8.1 specifies,
> and the `tcgdex_variant_id` **UNIQUE** constraint was dropped — the compiled catalog has
> only 324 distinct `variantId` values across 35,648 rows (a facet-tuple hash, one sentinel
> `"generated"` covering ~10k rows), so it is not a per-row key; the real idempotency key is
> `UNIQUE (card_id, variant_kind_code)`.

---

## What this task did **not** do (deliberately)

- **No prices, images, dex data, or reverse-holo cross-fill** — each is its own later task.
- **No pm2 process** was created and `thegrid-api`'s `ecosystem.config.cjs` was not
  touched. `pokedex/ecosystem.config.cjs` is a template for later.
- **No nginx change.** `deploy/nginx/*.conf` are fragments to paste in later, with the
  user's permission.
- **No frontend.** A later phase.
- **No `docker pull`, no long-running service, no Postgres restart.**

---

## Backup, restore & export (BRIEF §5)

Data ownership is enforced by three scripts under `scripts/` — full details and the
restore drill are in **`deploy/BACKUP.md`**.

```bash
scripts/backup.sh            # pg_dump the pokedex DB (only) + tar the image cache
                             #   → ~/pokedex-backups/<ts>/  (outside the repo)
scripts/restore.sh <dir>     # role+DB bootstrap, pg_restore, image untar (--force to clobber)
node scripts/export.mjs      # collection/lists/decks → CSV + full JSON + per-deck PTCG Live text
                             #   → ~/pokedex-exports/<ts>/
```

- Dumps **one database** (`pokedex`), never the cluster or the brain DBs.
- ~1.9 GB per backup (DB dump ~5 MB + image cache ~1.9 GB); sprites are re-fetchable
  and intentionally excluded.
- **Schedule:** a nightly `crontab` entry calling `scripts/backup.sh` (matches the box's
  existing `fuel` cron); a systemd timer is an equally-fine alternative. See `deploy/BACKUP.md §2`.
- Restore is proven by a scratch-DB drill that never touches prod (`deploy/BACKUP.md §3`).

---

## Later tasks (not this one)

Catalog import (TCGdex extract) → image warm → price sync (TCGCSV + Cardmarket) →
core API → frontend → deck builder → gamification → hardening (pm2 + nginx + backup/PWA).
See `BRIEF.md §6` and `ARCHITECTURE.md`.
