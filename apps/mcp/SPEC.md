# rotom-mcp — SPEC (design contract)

> **rotom-mcp** is the MCP face of pokedex: a thin tool layer that lets Claude (Code, claude.ai,
> iOS) retrieve collection/catalog/price/deck data and log collection changes with attribution.
> Named after Rotom, the games' AI assistant. This file is the build contract; implementation
> agents follow it exactly. Deviations get recorded here and in `DECISIONS.md`.

## 1. Identity & placement

| Thing | Value |
|---|---|
| App dir | `/home/cheyras/pokedex/apps/mcp` (pnpm workspace picks up `apps/*` automatically) |
| Package name | `pokedex-mcp` (matches `pokedex-api` / `pokedex-sync` style) |
| MCP server name | `rotom-mcp`, version from package.json |
| Port | **3704**, bind `127.0.0.1` only (3702 = TCGdex escape-hatch slot, 3703 = dev server, per DECISIONS.md) |
| Env vars | `POKEDEX_MCP_PORT=3704`, `ROTOM_MCP_KEY=<hex secret>`, `POKEDEX_API_BASE=http://127.0.0.1:3700/pokedex/api`, `PGPOOL_MAX_MCP=1`, `PGAPPNAME=pokedex-mcp` — all in repo-root `.env` (mode 600, gitignored), loaded via `loadEnv()` from `@pokedex/db` |
| pm2 name (later) | `pokedex-mcp`, `max_memory_restart: '300M'` |
| MCP endpoint | `POST/GET/DELETE http://127.0.0.1:3704/mcp` (+ plain `GET /health` JSON for supervisors) |

## 2. Stack (verified 2026-07-29 — do not substitute from memory)

- Node ≥ 20, ESM (`"type": "module"`), TS config extends root (`module Node16`, strict). Scripts
  identical in shape to sibling apps: `dev` = `tsx watch src/index.ts`, `build` = `tsc`,
  `typecheck` = `tsc --noEmit`, `start` = `node dist/index.js`. tsc stays out of the runtime path.
- **MCP SDK v2** (released 2026-07-27, the stable line): `@modelcontextprotocol/server@^2.0.0`,
  `@modelcontextprotocol/express@^2`, `@modelcontextprotocol/node@^2`, `express` (match the major
  `pokedex-api` uses), `zod@^4.2` (v2 requires ≥4.2 — 4.0/4.1 silently drops `.describe()`).
- Core wiring (verified against SDK v2 docs; adapt only if the installed package's types disagree —
  read `node_modules` types, not blog posts):

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

const handler = createMcpHandler(() => buildServer(ctx)); // fresh McpServer per request
const app = createMcpExpressApp({
  host: '0.0.0.0', // hostname validation list below is what actually gates
  allowedHosts: ['cheyrasnet.tplinkdns.com', 'the.grid', 'thegrid', 'thegrid.local',
                 '192.168.68.76', '127.0.0.1', 'localhost'],
});
app.get('/health', ...);              // plain JSON, no auth — pm2/nginx probe
app.use('/mcp', requireBrainKey);     // auth BEFORE the handler
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));
app.listen(PORT, '127.0.0.1', ...);
process.on('SIGTERM'/'SIGINT', async () => { await handler.close(); await pool.end(); ... });
```

- **Auth** (house convention, copied from the Deno MCP fleet): header `x-brain-key` (fallback
  `?key=` query) must equal `ROTOM_MCP_KEY`; `OPTIONS` passes; failure → bare `401`, **no
  `WWW-Authenticate` header** (claude.ai treats 401+WWW-Authenticate as an OAuth trigger).
  Fatal-exit at startup if `ROTOM_MCP_KEY` unset.
- Startup self-check: ping Postgres (`SELECT 1`) and `GET ${POKEDEX_API_BASE}/health`; log clearly
  and `process.exit(1)` if the DB is unreachable (pm2 restarts). API unreachable = warn only
  (read tools still work; API-backed tools will fail per-call).
- Entry-point detection must handle pm2 fork mode like `apps/api/src/index.ts` does
  (`process.env.pm_exec_path ?? process.argv[1]`).

## 3. Data access — the hybrid rule

**Reads go straight to Postgres. Writes (and all deck/list operations) go through pokedex-api on
`127.0.0.1:3700`.** Rationale: read queries need MCP-shaped compact aggregation the REST API
doesn't offer; write logic (upsert → `collection_event` append → `recomputeSetProgress`, one
transaction) lives in `apps/api/src/routes/collection.ts` and must stay single-sourced.

- Pool: `makePool(1)` from `@pokedex/db`, module scope. This is a **4th** connection against the
  documented budget of 3 (API 2 + sync 1). Headroom verified (DECISIONS.md 2026-07-24: 7 spare).
  The budget docs (`.env` comment, `CLAUDE.md`, `DECISIONS.md` dated entry) get updated to
  "4 TOTAL (API 2 + sync 1 + mcp 1)" as part of this build.
- The `pokedex` role carries `statement_timeout=30s` — design every query to finish well under
  that; a timeout surfaces as an `isError` tool result with a "narrow the query" hint.
- API client: native `fetch`, thin helper in `src/api.ts` (`apiGet`, `apiSend`), JSON in/out,
  surfaces the API's `{ error: { code, message } }` envelope as tool errors. No retries on 4xx;
  one retry on ECONNREFUSED after 500 ms.
- User: single-user box. Resolve `defaultUserId` = lowest `app_user.id` once at startup (same
  rule as `apps/api/src/db.ts`).
- Identifiers exposed to Claude are **TCGdex ids** (`set_id` like `me05`, `card_id` like
  `me05-84`) and numeric `card_variant.id` for variants — matching the REST API convention.
- Money: DB stores integer minor units (`price_current.market_minor` etc.). Tools always render
  majors with currency (`$3.12`), NULL price = "unpriced", **never $0**. Unpriced counts are
  reported separately in any valuation sum.

## 4. Tool conventions

- Registration: `server.registerTool(name, { title, description, inputSchema: z.object({...}),
  annotations }, handler)`. Every tool has `title` + annotations: `readOnlyHint: true` on all
  reads; `destructiveHint: true` on `delete_deck` / `delete_list`; `idempotentHint` where true.
- Every handler wraps in try/catch and returns the house envelope — `ok()` →
  `{ content: [{ type:'text', text }] }` (optionally `structuredContent`), `fail(msg)` →
  `{ isError: true, content:[...] }`. Never throw to the transport.
- Descriptions state what the tool does, when to use it, **and when not to** (e.g. "for a single
  card use `get_card` instead"). Zod `.describe()` on every field — it's the only arg docs the
  model gets.
- **Context-window discipline is a correctness requirement.** List-returning tools: `page`
  (default 1) + `page_size` (default 50, hard cap 200). Compact line format, one row per line,
  e.g. `Charizard ex | me05-84 | Double Rare | holo x2 | $31.20` — not JSON dumps. Every
  truncated response states the total and how to page. `collection_summary` should answer most
  questions in one call.
- Card resolution (shared helper, used by `get_card` and `log_cards`): accept `card_id` (TCGdex)
  OR `name` (+ optional `set_id`, `number`); normalized/trigram/unaccent match against
  `card.name_normalized` (extensions from migrations 001/017). **Ambiguity is returned, not
  guessed**: >1 plausible card → return the candidate list as the result. Variant resolution:
  explicit `variant_id` or variant kind code wins; omitted → the card's primary variant
  (`card_variant.is_primary`); "set absolute quantity" on a card where the user owns multiple
  variants and no variant was given → refuse with the owned-variant list.

## 5. Tool surface (14 tools + 1 resource)

### Reads — direct SQL (`readOnlyHint: true`)

1. **`health`** — no args. DB ok + API ok, catalog counts (cards/variants/sets), owned totals,
   last `sync_run` per job (+status), price freshness (`max(price_current.fetched_at)` per
   source). The "is my data fresh" tool.
2. **`collection_summary`** — `{ top_n?: 1–25 = 10 }`. Distinct cards owned, total quantity,
   sets with ownership, estimated USD value (Σ qty × best `market_minor` across sources per
   owned variant; unpriced count reported), top `top_n` owned cards by value, 5 nearest-complete
   sets for the user's default goal (`user_settings`). **The default entry point** — description
   says so. Also backs the `collection://summary` resource.
3. **`search_cards`** — `{ query?, set_id?, category?, rarity?, owned_only? = false,
   standard_legal?, min_value_usd?, page?, page_size? }`. Catalog+ownership search over
   `card` (trgm + unaccent on `name_normalized`), joined to owned qty and best market price.
   Compact lines + total count.
4. **`get_card`** — `{ card_id? | name? + set_id? + number? }`. Card core (category, rarity, HP,
   regulation mark, legality flags, set + local number), then per-variant rows: kind code,
   display name, tier (from `variant_tier_resolved` — never re-derive), owned qty, market price,
   TCGplayer link when present. Ambiguous → candidate list.
5. **`set_progress`** — `{ set_id?, goal? ∈ complete|master|grandmaster, page?, page_size? }`.
   No `set_id`: all sets with any progress from `user_set_progress` (owned/total per goal, %
   sorted desc, paged). With `set_id`: all three goals' numbers + the missing cards for the
   requested goal (via `master_required_variant` for master; paged) + **cost-to-complete** (Σ
   cheapest market price of missing required variants; unpriced listed separately, never $0).
6. **`collection_log`** — `{ since?: ISO, source?, limit? = 50 }`. The agentic-logging read
   face: `collection_event` joined to card/variant — `occurred_at | card | variant | Δdelta →
   qty_after | source | note`. Needs migration 018 (below).
7. **`collection_value`** — `{ window? = '30d' ∈ 7d|30d|90d }`. Value now, change over window,
   biggest movers ±. Implement by reading what `apps/api/src/insights/collectionValue.ts` reads
   (`price_observation` partitions / `collection_value_point`) or by calling the API insights
   route — implementer reads that file first and picks the thinner path; label results as
   estimates.

### Decks & lists — via pokedex-api (read parts `readOnlyHint: true`)

Exact request/response shapes: **read `apps/api/src/routes/decks.ts` / `lists.ts` first**; the
routes are the contract (`GET/POST /decks`, `GET/PATCH/DELETE /decks/:id`, `POST /decks/:id/cards`,
`PATCH/DELETE /decks/:id/cards/:cardId`, `GET /decks/:id/{validate,export,testhand,pricing}`,
`POST /decks/import`; `GET/POST /lists`, `GET/PATCH/DELETE /lists/:id`, `POST /lists/:id/items`,
`DELETE /lists/:id/items/:itemId`).

8. **`decks`** — `{ deck_id?, include?: subset of [cards, validate, pricing, testhand] }`.
   No id: deck index (id, name, format, card count). With id: deck + requested includes.
   `pricing` include **is the gap analysis**: per-card owned vs needed, missing list with cost
   to close and TCGplayer mass-entry lines (the API computes all of it).
9. **`save_deck`** — `{ deck_id?, name?, format?, cards?: [{card_id, quantity}], ptcgl_text?,
   dry_run? = true }`. Create (POST /decks, or POST /decks/import when `ptcgl_text` given),
   rename (PATCH), and reconcile the card list to `cards` via the per-card routes. Dry run
   returns the would-be diff (current vs proposed lines) and changes nothing.
10. **`delete_deck`** — `{ deck_id, dry_run? = true }`. `destructiveHint: true`.
11. **`lists`** — `{ list_id? }`. Index or one list with items (compact).
12. **`edit_list`** — `{ list_id?, name?, add_cards?, remove_item_ids?, dry_run? = true }`.
    Creates the list when `list_id` omitted. Item payload shape comes from `lists.ts`.
13. **`delete_list`** — `{ list_id, dry_run? = true }`. `destructiveHint: true`.

### Collection writes — via pokedex-api

14. **`log_cards`** — THE write tool. `{ items: [{ card_id? | name?+set_id?+number?,
    variant_id? | variant_kind?, delta? | quantity? }] (1–100), note? (≤500 chars),
    dry_run? = true }`. Per item exactly one of `delta` (signed increment, floors at 0 via the
    API) or `quantity` (absolute). Resolution per §4; any unresolvable/ambiguous item is
    reported per-item and **does not block the others** (partial success, per-item results).
    Dry run: resolved variant + `current → new` quantity per item, no writes. Execute:
    sequential calls to `POST /collection/variants/:id/increment` (`{delta, source, note}`) or
    `PATCH /collection/variants/:id` (`{quantity, source, note}`) with **`source:
    'rotom-mcp'`**. Description must say: this edits the local pokedex collection only —
    nothing external. `readOnlyHint: false`, `destructiveHint: false` (dry-run gated,
    delta-reversible).

### Resource

- **`collection://summary`** — same payload as `collection_summary` (text), so clients can pull
  context without a tool round-trip.

## 6. Migration 018 + API attribution (prerequisite for 6/14)

New file `packages/db/src/migrations/018_collection_event_attribution.sql` (shipped migrations
are immutable — this is a new file, forward-only):

```sql
ALTER TABLE collection_event
  ADD COLUMN source text NOT NULL DEFAULT 'web'
    CONSTRAINT collection_event_source_shape CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  ADD COLUMN note text
    CONSTRAINT collection_event_note_len CHECK (char_length(note) <= 500);
COMMENT ON COLUMN collection_event.source IS
  'Who wrote this change: web (UI), rotom-mcp (agent), import/script names. Default web.';
```

API changes (`apps/api/src/routes/collection.ts` + wherever the event INSERT lives):
- `PATCH /collection/variants/:variantId`, `POST .../increment`, `POST /collection/cards/:cardId/have`
  accept optional `source` (validated against the same shape regex, default `'web'`) and `note`
  (trimmed, ≤500); both flow into the `collection_event` insert inside the existing transaction.
- `GET /collection/events` returns `source`/`note` and accepts optional `?source=` filter.
- Update/add API tests in `apps/api/src/__tests__` covering: default source stays `'web'`,
  explicit source+note round-trips through the events feed, invalid source rejected 400.

## 7. Non-negotiables (inherited from the repo)

- rtk-prefix every shell command and every `&&` segment. `rtk curl` summarizes JSON — write to a
  file and parse with node when you need the real body.
- Never write `variant_tier_override` (human-asserted). Never touch other pm2 apps, nginx,
  `thegrid-api/`, Postgres config. No `git push` (no remote). Don't commit — the lead agent
  reviews and commits.
- Secrets (`.env`, `[redacted path]`, `token-cache.json`): read at runtime only, never
  log values, never commit.
- `console.log`/`console.error` with `[pokedex-mcp]` prefix — no logging library.
- Result-size budgets: Claude Code caps tool output ~25k tokens; claude.ai ~150k chars — the
  paging defaults in §4 exist so we never get near either.

## 8. Verification gates (what "done" means)

1. `pnpm --filter pokedex-mcp typecheck` clean; API typecheck + tests still clean after §6.
2. Real MCP round-trips against `127.0.0.1:3704/mcp` (SDK client or `claude mcp add`-registered):
   every tool called at least once; `collection_summary` numbers reconcile with the web UI /
   known totals; `log_cards` dry-run then a real +1/−1 on a cheap card, confirmed in
   `collection_log` with `source='rotom-mcp'` and in `user_set_progress` recompute; a deck
   round-trip: import small PTCGL list → `decks include=[validate,pricing]` → `delete_deck`.
3. Auth: request without `x-brain-key` → 401; with → 200.
4. Deployment (separate phase): pm2 entry, nginx LAN `/rotom/mcp` + public `/rotom-mcp`
   (Anthropic-IP allowlist + key-injection snippet), reboot-safe.
