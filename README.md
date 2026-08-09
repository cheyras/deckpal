# DeckScout

A self-hosted, single-user TCG collection tracker. Browse a full card catalog,
track your collection across printings, see prices, explore the Pokedex, build
decks with battle-log intelligence, scan cards with a perceptual-hash scanner,
and set completion goals. Built for Pokemon but the data model, image cache, and
scanner are **game-agnostic**.

DeckScout keeps working if every upstream disappears: the catalog, card art, and
price history all live locally. No third-party account, no cloud, no paid API.

---

## Features

- **Full card catalog** -- series, sets, cards, and variant-level detail
  (reverse holos, foils, stamps, promos), imported from TCGdex open data.
- **Collection tracking** -- own/want/trade at the variant level with quantity,
  condition, and notes.
- **Price history** -- daily prices from TCGCSV (TCGplayer) and Cardmarket bulk
  dumps. Every price in the UI shows "as of {date}" -- honest by construction.
- **Deck builder** -- PTCG Live format import/export, legality validation, and
  battle-log intelligence (record matches, track win rates, get strategy
  analysis).
- **Card scanner** -- perceptual-hash index against the local image cache;
  identify a card from a photo.
- **Completion goals** -- Complete Set, Master Set, Grandmaster tiers with
  accurate progress tracking.
- **Pokedex** -- species data from PokeAPI, linked to the cards they appear on.
- **Local image cache** -- ~1.9 GB of WebP card art cached on disk, served by a
  dedicated image server. No runtime dependency on upstream CDNs.
- **MCP server** ("rotom-mcp") -- 21 tools for Claude (Code, claude.ai, iOS) to
  query the collection, catalog, prices, and decks, and to log collection
  changes with attribution.
- **PWA** -- installable, offline-capable (tiered: app shell always; visited
  art LRU-cached; owned cards opt-in).
- **Backup, restore, and export** -- `pg_dump` + image cache tar for backup;
  CSV + JSON + PTCG Live text export for portability.

---

## Architecture

pnpm monorepo. Five apps + a shared database package:

| App | Port | What |
|---|---|---|
| `apps/api` (`deckscout-api`) | 3700 | REST API (~49 endpoints) + serves the built SPA |
| `apps/images` (`deckscout-images`) | 3701 | Serves the local WebP art cache; disk-only, never proxies upstream |
| `apps/mcp` (`deckscout-mcp`) | 3704 | **rotom-mcp** -- MCP server for Claude: 21 tools for collection/catalog/price/deck access + attributed writes |
| `apps/sync` (`deckscout-sync`) | cron | Catalog import, dex import, price ingest (node-cron scheduler, no listening socket) |
| `apps/web` (`deckscout-web`) | -- | React 19 + Vite + Tailwind 4 SPA/PWA (built, then served by `deckscout-api`) |
| `packages/db` (`@deckscout/db`) | -- | Postgres connection pool + numbered immutable SQL migrations |

Data lives in a host **Postgres** database. All service ports bind `127.0.0.1`
only -- see the security note below.

For the full topology, data flow, and design rationale, see
[`ARCHITECTURE.md`](ARCHITECTURE.md). The authoritative schema is in
[`research/SCHEMA.md`](research/SCHEMA.md).

---

## Quickstart

Prerequisites: Node >= 20, pnpm >= 10, host Postgres >= 17.

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

Copy [`.env.example`](.env.example) to `.env` and fill in the generated
password:

```bash
cp .env.example .env
chmod 600 .env
# Edit .env -- set PGPASSWORD to the password from step 1
```

Key settings in `.env`:

| Variable | Default | Notes |
|---|---|---|
| `PGPOOL_MAX_API` | `2` | API connection pool size |
| `PGPOOL_MAX_SYNC` | `1` | Sync importer pool size |
| `PGPOOL_MAX_MCP` | `1` | MCP server pool size |
| `PGPOOL_MAX` | `3` | Per-process hard cap |
| `DECKSCOUT_API_PORT` | `3700` | |
| `DECKSCOUT_IMAGES_PORT` | `3701` | |
| `DECKSCOUT_MCP_PORT` | `3704` | |
| `IMAGE_CACHE_ROOT` | `./cache` | Path to the WebP image cache |

The cluster-wide connection budget is **4** (API 2 + sync 1 + MCP 1), with a
per-process hard cap of **3**. One-off scripts use one connection. Do not raise
the pool without checking headroom against Postgres `max_connections`.

### 3. Install, migrate, and verify

```bash
pnpm install
pnpm migrate            # applies packages/db/src/migrations/*.sql in order
pnpm migrate:status     # [x] per applied migration
pnpm typecheck          # strict tsc --noEmit across all workspaces
```

### 4. Build and run

```bash
pnpm build              # builds all apps
# Start each service (example using pm2):
pm2 start ecosystem.config.cjs
pm2 save
```

The API serves the built SPA at the configured base path. The image server
serves cached card art. The sync scheduler runs catalog, dex, and price imports
on its configured cron cadence.

---

## Security note

**The API and image server have no built-in authentication.** This is by design.
They bind `127.0.0.1` and are not intended to be exposed directly. **You must
place a reverse proxy with an authentication layer in front of them** (the
reference deployment uses nginx with an SSO gate).

The MCP server (`deckscout-mcp`) has its own key-based authentication via the
`ROTOM_MCP_KEY` environment variable and does not require the same proxy gate,
though it should still be placed behind TLS for remote access.

---

## Data sources and credits

DeckScout is built on open data from several sources:

- **[TCGdex](https://tcgdex.dev/)** -- card catalog (series, sets, cards,
  variants). Open data, compiled JSON extracted from the published container
  image.
- **[TCGCSV](https://tcgcsv.com/)** -- daily TCGplayer price feeds (bulk CSV).
- **Cardmarket** -- daily price dumps.
- **[PokeAPI](https://pokeapi.co/)** -- species and Pokedex data. Licensed
  BSD-3-Clause; see [`data/pokeapi/LICENSE.md`](data/pokeapi/LICENSE.md) for
  the full license and attribution.

Pokemon and Pokemon character names are trademarks of Nintendo.

---

## License

DeckScout is licensed under the [GNU Affero General Public License v3.0
(AGPL-3.0-only)](LICENSE). If you modify DeckScout and make it available over a
network, AGPL section 13 requires you to offer the corresponding source to
users of that service.

---

## Documentation

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Services, ports, topology, data ingest, cache/PWA/offline design |
| [`research/SCHEMA.md`](research/SCHEMA.md) | The data model -- variant taxonomy, tier/goal derivation, full DDL |
| [`API.md`](API.md) | REST API contract (~49 endpoints) |
| [`DECISIONS.md`](DECISIONS.md) | Dated audit trail of every decision, correction, and gotcha |
| [`deploy/BACKUP.md`](deploy/BACKUP.md) | Backup, restore, and export scripts and procedures |
| [`AGENTS.md`](AGENTS.md) | Engineering contracts and conventions for AI agents |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guide -- setup, workflow, code conventions |
