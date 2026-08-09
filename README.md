# DeckScout

An open-core TCG collection platform. Browse a full card catalog, track your
collection across printings, see prices, explore the Pokedex, build decks with
battle-log intelligence, scan cards with a perceptual-hash scanner, and set
completion goals. Built for Pokemon but the data model, image storage, and
scanner are **game-agnostic**.

DeckScout is heading toward a hosted service with paid subscriptions. The open
core is AGPL-3.0 — anyone can fork and self-host. The architecture is
cloud-first: Vercel + Supabase for the hosted path, plain Postgres for
self-hosters.

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
- **Card scanner** -- perceptual-hash index against stored card art; identify a
  card from a photo. *(Cloud: parked for Wave 3 -- see Roadmap.)*
- **Completion goals** -- Complete Set, Master Set, Grandmaster tiers with
  accurate progress tracking.
- **Pokedex** -- species data from PokeAPI, linked to the cards they appear on.
- **Image storage** -- ~1.9 GB of WebP card art. Cloud deployments use Supabase
  Storage with CDN; self-host uses a local disk cache with a dedicated image
  server.
- **MCP server** ("rotom-mcp") -- 21 tools for Claude to query the collection,
  catalog, prices, and decks, and to log collection changes with attribution.
  *(Cloud: parked for Wave 3.)*
- **PWA** -- installable, offline-capable (tiered: app shell always; visited
  art LRU-cached; owned cards opt-in).
- **Multi-user with row-level security** -- Supabase Auth (email + OAuth) with
  per-user RLS policies on all collection data. Catalog and pricing data is
  shared and world-readable.

---

## Architecture

pnpm monorepo. Four apps + a shared database package, deployed on Vercel +
Supabase (cloud) or plain Postgres (self-host):

| App | Role |
|---|---|
| `apps/api` (`deckscout-api`) | Express API (~49 endpoints), deployed as a Vercel catch-all serverless function |
| `apps/sync` (`deckscout-sync`) | Catalog import, dex import, price ingest (GitHub Actions scheduled jobs) |
| `apps/web` (`deckscout-web`) | React 19 + Vite + Tailwind 4 SPA/PWA, deployed as Vercel static output |
| `apps/mcp` (`deckscout-mcp`) | **rotom-mcp** -- MCP server (Wave 3) |
| `packages/db` (`@deckscout/db`) | Shared Postgres pool + numbered immutable SQL migrations |

For the full topology, data flow, and design rationale, see
[`ARCHITECTURE.md`](ARCHITECTURE.md). The authoritative schema is in
[`research/SCHEMA.md`](research/SCHEMA.md).

---

## Quickstart

### Option A — Deploy your own on Vercel + Supabase

This is the recommended path. You get Supabase Auth, row-level security,
Supabase Storage CDN for card art, and Vercel's serverless deployment.

See **[`DEPLOYMENT.md`](DEPLOYMENT.md)** for the full connect-your-accounts
runbook.

### Option B — Self-host (plain Postgres)

Self-hosting runs the open core without Supabase. You provide your own Postgres
15+ database and a reverse proxy for authentication.

Prerequisites: Node >= 20, pnpm >= 10, Postgres >= 15.

1. **Create a Postgres database and role** (see [`DEPLOYMENT.md`](DEPLOYMENT.md)
   for detailed instructions).

2. **Configure environment:**
   ```bash
   cp .env.example .env
   chmod 600 .env
   # Edit .env -- fill in your Postgres credentials
   ```

3. **Install, migrate, and verify:**
   ```bash
   pnpm install
   pnpm --filter @deckscout/db build
   pnpm --filter @deckscout/db migrate       # applies migrations 001-020
   pnpm --filter @deckscout/db migrate:status # [x] per applied migration
   ```

4. **Import the card catalog:**
   ```bash
   pnpm --filter deckscout-sync catalog:run
   ```

5. **Build and run:**
   ```bash
   pnpm --filter deckscout-web build
   pnpm --filter deckscout-api build
   node apps/api/dist/index.js
   ```

6. **Configure a reverse proxy** with authentication (e.g., nginx + an SSO
   gateway, Caddy with auth) in front of the API. The API has no built-in auth
   in self-host mode -- the proxy is the auth boundary. See
   [`SECURITY.md`](SECURITY.md).

Self-host deployments skip Supabase-specific migrations (021+) and use the
`apps/images` Express server for card art instead of Supabase Storage.

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
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Target architecture, RLS model, storage design, sync design |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Deploy-your-own runbook (Vercel + Supabase) and self-host setup |
| [`research/SCHEMA.md`](research/SCHEMA.md) | The data model -- variant taxonomy, tier/goal derivation, full DDL |
| [`API.md`](API.md) | REST API contract (~49 endpoints) |
| [`DECISIONS.md`](DECISIONS.md) | Dated audit trail of every decision, correction, and gotcha |
| [`AGENTS.md`](AGENTS.md) | Engineering contracts and conventions for AI agents |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guide -- setup, workflow, code conventions |
| [`SECURITY.md`](SECURITY.md) | Security model (auth, RLS, self-host) and disclosure policy |

<!-- deploy pipeline verified 2026-08-09 -->
