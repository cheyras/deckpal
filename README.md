<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo/deckpal-logo-white.svg">
  <source media="(prefers-color-scheme: light)" srcset="apps/web/public/logo/deckpal-logo-dark.svg">
  <img src="apps/web/public/logo/deckpal-logo-dark.svg" alt="DeckPal" width="440">
</picture>

</div>

An open-source (AGPL-3.0) Pokemon TCG collection and agentic strategy platform. Browse a full card catalog, track your
collection across printings, see prices, connect Claude (or another AI app that
takes custom MCP connectors) to collaboratively build decks with battle-log
intelligence, and set completion goals. A card scanner is in limited testing.
Built for Pokemon but the data model, image storage, and scanner are
**game-agnostic**.

deckpal.app is the hosted service, on a pay-what-you-want basis (below). All of
the code in this repository is AGPL-3.0 — anyone can fork and self-host. The
architecture is cloud-first: Vercel + Supabase for the hosted path, plain
Postgres for self-hosters.

---

## Features

- **Administration** — one tiered role per account, protected Owner controls, feature lifecycle/opt-ins, consent-based AI usage review, and metered AI credits (charged at the actual model cost plus a markup) with credit packs. Contributors use a separate Dev tools directory and retain personal self-service. See [the owner guide](ADMINISTRATION.md).

- **Full card catalog** -- series, sets, cards, and variant-level detail
  (reverse holos, foils, stamps, promos), imported from TCGdex open data.
- **Collection tracking** -- quantity and condition per printing (a reverse
  holo and a holo count separately), notes per card, and graded copies. Want
  and trade piles are lists.
- **Price history** -- daily prices from TCGCSV (TCGplayer) and Cardmarket bulk
  dumps. Every price in the UI shows "as of {date}" -- honest by construction.
  Agents can pull per-card OHLC history through the `card_price_history` tool
  in complete-record pages, following `next_offset` to retrieve the rest, with
  the same rollup/interpretation contract documented by the REST endpoint.
- **Upcoming sets** -- announced expansions appear with a release date and a
  "Coming Soon" label, and retire automatically when the real catalog entry
  arrives or the announcement expires.
- **Deck builder** -- PTCG Live format import/export, legality validation,
  ownership across legal gameplay-identical reprints and basic Energy of the
  same type, exact-printing pins, and battle-log intelligence (record matches,
  track win rates, get strategy analysis).
- **Card scanner** (limited to accounts given access while it is tested) --
  one capture flow: point the camera at cards and keep going, so a whole
  booster pack goes in without stopping between cards. Captures are matched
  against the stored card art (a perceptual-hash index, plus a pgvector
  embedding index where `SCAN_EMBED_MATCH` is on), then you review them as a
  list or card by card with swipes and save them in one write. The scanner
  matches artwork, so it names the card and you say which printing -- a card
  and its reverse holo are the same picture. An opt-in beta lets you say it out
  loud while you scan ("that one's a reverse holo", "two of those", "remove
  it").
- **Completion goals** -- Complete Set, Master Set, Grandmaster tiers with
  accurate progress tracking.
- **Pokedex** -- species data from PokeAPI, linked to the cards they appear on.
- **Image storage** -- about 2 GB of WebP card art at two resolutions. Cloud
  deployments serve it straight off the Supabase Storage CDN (the browser
  addresses the object directly; the image function stays as the fallback that
  fills a cold asset); self-host uses a local disk cache with a dedicated image
  server. `warm:cloud` warms the whole catalog into the cloud tier.
- **MCP server** ("deckpal-mcp") -- 31 tools (20 read, 11 write) for Claude
  (tested end to end), or ChatGPT, Gemini and other apps with remote MCP
  connectors (going by their docs; not yet tested), to query the collection,
  catalog, prices, decks, battle logs and
  per-card price history, to work out a deck's opening-hand, draw and Prize
  odds, to simulate games between decks, and to log collection changes with
  attribution. Live
  and multi-user on cloud: connect with one click via OAuth 2.1
  (`https://deckpal.app/mcp`, choose "Connect"), or a personal access token for
  clients without MCP OAuth support. See [`apps/mcp/README.md`](apps/mcp/README.md)
  for connecting, tokens and which tools write; the full tool reference,
  [`apps/mcp/TOOLS.md`](apps/mcp/TOOLS.md), is generated from the registry.
- **Changes are logged, and most are undoable.** Collection quantities, list
  changes, deck deletes and strategy-guide rewrites record a before/after
  snapshot; `mutation_history` shows what an operation did and `revert` undoes
  it (dry-run first; an item it cannot undo exactly is reported as a conflict
  and skipped, never half-applied). A deck's card list is versioned once it has
  battle logs, and `deck_history` restores an earlier version; an edit to a
  version with no logs replaces it in place. Battle-log edits and deletes
  cannot be undone. `log_cards` and `save_deck` carry an idempotency key, so
  retrying after a timeout returns the original result instead of applying
  twice. Deleting a list or deck is reversible -- *Recently deleted* on each
  index restores it.
- **PWA** -- installable, offline-capable (tiered: the app shell is
  precached; visited card and set art is cached, about 2,000 images with the
  least recently used dropped first; Deck-E's character assets are cached too).
- **Pay what you want** — the hosted deckpal.app asks what you would like to pay
  per month and takes **$0** for an answer. Nothing is gated on payment: there
  is no entitlement column in the schema, and paying more unlocks nothing. (A
  few features, such as the card scanner and Deck-E, are limited to staff or
  opted-in accounts while they are tested; that has nothing to do with
  payment.) Payment is handled entirely by Stripe (the card number never
  touches DeckPal), with cards and whichever wallets the Stripe account offers,
  and the amount is changeable or stoppable from your profile at any time.
  Self-host builds have no billing tier at all.
- **Multi-user with row-level security** -- Supabase Auth (email and password)
  with per-user RLS policies on all collection data. Catalog and pricing data is
  shared and world-readable.

---

## Architecture

pnpm monorepo, deployed on Vercel + Supabase (cloud) or plain Postgres
(self-host):

| App | Role |
|---|---|
| `apps/api` (`deckpal-api`) | Express API (endpoints inventoried in [`API.md`](API.md)), deployed as a Vercel catch-all serverless function |
| `apps/sync` (`deckpal-sync`) | Catalog import, dex import, price ingest (GitHub Actions scheduled jobs) |
| `apps/web` (`deckpal-web`) | React 19 + Vite + Tailwind 4 SPA/PWA, deployed as Vercel static output |
| `apps/images` (`deckpal-images`) | Self-host image server (local disk cache); cloud path uses Supabase Storage |
| `apps/mcp` (`deckpal-mcp`) | **deckpal-mcp** -- MCP server, live and multi-user on cloud |
| `packages/db` (`@deckpal/db`) | Shared Postgres pool + numbered immutable SQL migrations |
| `packages/storage` (`@deckpal/storage`) | Shared image path algebra + the provenance choke point used by `apps/images` and the cloud image function |
| `packages/agent-tools` (`@deckpal/agent-tools`) | The 31 agent tool definitions shared by `deckpal-mcp` and Deck-E, the AI assistant (plus three capability-gated readers served only over MCP) |
| `packages/matching` (`@deckpal/matching`) | The scanner's card-identity embedding: one versioned input spec shared by the phone, the API and the catalogue job, with bit-exact TypeScript/Python parity |
| `packages/sim` (`@deckpal/sim`) | The battle simulator: a pure, seeded Pokémon TCG rules engine plus the batch runner and report behind the read-only `simulate_battles` agent tool |

For the full topology, data flow, and design rationale, see
[`ARCHITECTURE.md`](ARCHITECTURE.md). The schema of record is
`packages/db/src/migrations/`; [`research/SCHEMA.md`](research/SCHEMA.md) is the
dated design research behind it.

---

## Quickstart

### Option A — Deploy your own on Vercel + Supabase

This is the recommended path. You get Supabase Auth, row-level security,
Supabase Storage CDN for card art, and Vercel's serverless deployment.

See **[`DEPLOYMENT.md`](DEPLOYMENT.md)** for the full connect-your-accounts
runbook.

### Option B — Self-host (plain Postgres)

Self-hosting runs the same code without Supabase. You provide your own Postgres
15+ database and a reverse proxy for authentication.

Prerequisites: Node 20.19+ (or 22.12+; Vite 8 needs one of those), pnpm 10,
Postgres 15+ with the pgvector extension installed (`postgresql-<major>-pgvector`;
migration 051 refuses to run without it), and Docker plus bash for the catalog
extract.

1. **Create a Postgres database and role** (see [`DEPLOYMENT.md`](DEPLOYMENT.md)
   for detailed instructions).

2. **Configure environment:**
   ```bash
   cp .env.example .env
   chmod 600 .env
   # Edit .env -- fill in your Postgres credentials (PG*) and IMAGE_CACHE_ROOT.
   # Then DELETE the API_BASE_PATH=/api line. A self-host build is served at
   # /deckpal/ and calls the API at /deckpal/api, which is the API's default;
   # /api is the cloud path. If you run the MCP server, set DECKPAL_API_BASE to
   # http://127.0.0.1:3700/deckpal/api to match.
   ```

3. **Install, build the shared packages, migrate, and verify** (the build
   order is CI's: other workspaces resolve these through their `dist/`):
   ```bash
   pnpm install
   pnpm --filter @deckpal/db build
   pnpm --filter @deckpal/storage build
   pnpm --filter @deckpal/agent-tools build
   pnpm --filter @deckpal/matching build
   pnpm --filter @deckpal/sim build
   pnpm --filter @deckpal/db migrate       # skips `-- @supabase-only` files, printing SKIPPED
   pnpm --filter @deckpal/db migrate:status # [x] per applied migration
   ```

4. **Fetch and import the card catalog.** The catalog JSON is not in the repo.
   `scripts/refresh-catalog.sh` pulls TCGdex's published image, copies the
   compiled English catalog into `data/catalog/en` (`docker create` +
   `docker cp`; the container is never started), imports it, and then builds
   the two indexes the importer cannot fill (`fingerprint:index` and
   `identical-prints:index`, which only work once cards exist):
   ```bash
   scripts/refresh-catalog.sh
   ```
   Re-running it later is safe: the import is idempotent.

5. **Build, then fill the card-art cache:**
   ```bash
   pnpm --filter deckpal-web build      # no VITE_SUPABASE_URL, so it builds for /deckpal/
   pnpm --filter deckpal-api build
   pnpm --filter deckpal-images build
   pnpm --filter deckpal-images warm    # about 2 GB into IMAGE_CACHE_ROOT; resumable
   ```
   The self-host image server never fetches upstream on a miss (it serves a
   placeholder), so the cache has to be warmed.

6. **Run the API and the image server** (both bind 127.0.0.1):
   ```bash
   node apps/api/dist/index.js      # :3700 -- /deckpal/api, and the built SPA at /deckpal/
   node apps/images/dist/index.js   # :3701 -- /deckpal/images
   ```

7. **Configure a reverse proxy** with authentication (e.g., nginx + an SSO
   gateway, Caddy with auth) in front of both: `/deckpal/` and `/deckpal/api`
   to :3700, `/deckpal/images` to :3701. The API has no built-in auth in
   self-host mode -- the proxy is the auth boundary. See
   [`SECURITY.md`](SECURITY.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md).

Self-host deployments skip the migrations marked `-- @supabase-only` (the
runner skips them automatically when `SUPABASE_MODE` is unset) and use the
`apps/images` Express server for card art instead of Supabase Storage.

---

## Data sources and credits

DeckPal is built on open data from several sources:

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

DeckPal is licensed under the [GNU Affero General Public License v3.0
(AGPL-3.0-only)](LICENSE). If you modify DeckPal and make it available over a
network, AGPL section 13 requires you to offer the corresponding source to
users of that service.

---

## Documentation

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Target architecture, RLS model, storage design, sync design |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Deploy-your-own runbook (Vercel + Supabase) and self-host setup |
| [`ADMINISTRATION.md`](ADMINISTRATION.md) | Owner/contributor guide to access, defaults, AI credits, payment readiness and recovery |
| [`research/SCHEMA.md`](research/SCHEMA.md) | Dated data-model research -- variant taxonomy, tier/goal derivation (schema of record: `packages/db/src/migrations/`) |
| [`API.md`](API.md) | REST API contract -- the endpoint inventory lives here |
| [`DECISIONS.md`](DECISIONS.md) | Guide to the per-decision audit trail and historical index |
| [`AGENTS.md`](AGENTS.md) | Engineering contracts and conventions for AI agents |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guide -- setup, workflow, code conventions |
| [`SECURITY.md`](SECURITY.md) | Security model (auth, RLS, self-host) and disclosure policy |
| [`apps/mcp/README.md`](apps/mcp/README.md) | Connecting an AI assistant to the MCP server: clients, tokens, read vs write tools, example sessions |
| [`apps/mcp/TOOLS.md`](apps/mcp/TOOLS.md) | Every MCP tool with its arguments and annotations — generated from the registry (`pnpm mcp:tools-doc`) |
