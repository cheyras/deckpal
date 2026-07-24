# pokedex

A self-hosted, single-user [pkmn.gg](https://www.pkmn.gg/) clone running entirely on
**TheGrid** (Raspberry Pi 5). It holds its own copy of the Pokémon TCG catalog, its own
cached card art, and its own accumulating price history — so it keeps working if every
upstream disappears. No third-party account, no cloud, no paid API.

Design docs live alongside this file (`ARCHITECTURE.md`, `DECISIONS.md`, `BRIEF.md`,
`PRIOR-ART.md`, `UI-SPEC.md`) and the deep research is under `research/`. The database
model is specified in `research/SCHEMA.md`; this repo implements it.

> **Status:** Phase 2, task 1 — repository scaffold + database. Backend/DB/sync
> **skeleton** only. No frontend yet, no catalog data yet, and **nothing is wired into
> pm2 or nginx**. See the checklist at the bottom.

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

## What this task did **not** do (deliberately)

- **No catalog import.** Sets/cards/variants/prices tables are empty by design — that is
  the next task. Only the closed-vocabulary tables (currencies, variant facets, formats)
  and the single default user are seeded.
- **No pm2 process** was created and `thegrid-api`'s `ecosystem.config.cjs` was not
  touched. `pokedex/ecosystem.config.cjs` is a template for later.
- **No nginx change.** `deploy/nginx/*.conf` are fragments to paste in later, with the
  user's permission.
- **No frontend.** A later phase.
- **No `docker pull`, no long-running service, no Postgres restart.**

---

## Later tasks (not this one)

Catalog import (TCGdex extract) → image warm → price sync (TCGCSV + Cardmarket) →
core API → frontend → deck builder → gamification → hardening (pm2 + nginx + backup/PWA).
See `BRIEF.md §6` and `ARCHITECTURE.md`.
