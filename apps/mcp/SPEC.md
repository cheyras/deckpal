# deckpal-mcp — SPEC (design contract)

> **deckpal-mcp** is the MCP face of DeckPal: a thin tool layer that lets Claude (Code, claude.ai,
> iOS) retrieve collection/catalog/price/deck data and log collection changes with attribution.
> This file is the build contract; implementation
> agents follow it exactly. Deviations get recorded here and in `DECISIONS.md`.

## 1. Identity & placement

| Thing | Value |
|---|---|
| App dir | `/home/cheyras/deckpal/apps/mcp` (pnpm workspace picks up `apps/*` automatically) |
| Package name | `deckpal-mcp` (matches `deckpal-api` / `deckpal-sync` style) |
| MCP server name | `deckpal-mcp`, version from package.json |
| Port | **3704**, bind `127.0.0.1` only (3702 = TCGdex escape-hatch slot, 3703 = dev server, per DECISIONS.md) |
| Env vars | `DECKPAL_MCP_PORT=3704`, `DECKPAL_MCP_KEY=<hex secret>`, `DECKPAL_API_BASE=http://127.0.0.1:3700/deckpal/api`, `PGPOOL_MAX_MCP=1`, `PGAPPNAME=deckpal-mcp` — all in repo-root `.env` (mode 600, gitignored), loaded via `loadEnv()` from `@deckpal/db` |
| Process name | `deckpal-mcp`, `max_memory_restart: '300M'` |
| MCP endpoint | `POST/GET/DELETE http://127.0.0.1:3704/mcp` (+ plain `GET /health` JSON for supervisors) |

## 2. Stack (verified 2026-07-29 — do not substitute from memory)

- Node ≥ 20, ESM (`"type": "module"`), TS config extends root (`module Node16`, strict). Scripts
  identical in shape to sibling apps: `dev` = `tsx watch src/index.ts`, `build` = `tsc`,
  `typecheck` = `tsc --noEmit`, `start` = `node dist/index.js`. tsc stays out of the runtime path.
- **MCP SDK v2** (released 2026-07-27, the stable line): `@modelcontextprotocol/server@^2.0.0`,
  `@modelcontextprotocol/express@^2`, `@modelcontextprotocol/node@^2`, `express` (match the major
  `deckpal-api` uses), `zod@^4.2` (v2 requires ≥4.2 — 4.0/4.1 silently drops `.describe()`).
- Core wiring (verified against SDK v2 docs; adapt only if the installed package's types disagree —
  read `node_modules` types, not blog posts):

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

const handler = createMcpHandler(() => buildServer(ctx)); // fresh McpServer per request
const app = createMcpExpressApp({
  host: '0.0.0.0', // hostname validation list below is what actually gates
  allowedHosts: ['127.0.0.1', 'localhost'],  // production hosts in MCP_ALLOWED_HOSTS env
});
app.get('/health', ...);              // plain JSON, no auth — supervisor probe
app.use('/mcp', requireBrainKey);     // auth BEFORE the handler
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));
app.listen(PORT, '127.0.0.1', ...);
process.on('SIGTERM'/'SIGINT', async () => { await handler.close(); await pool.end(); ... });
```

- **Auth** (house convention, copied from the Deno MCP fleet): header `x-brain-key` (fallback
  `?key=` query) must equal `DECKPAL_MCP_KEY`; `OPTIONS` passes; failure → bare `401`, **no
  `WWW-Authenticate` header** (claude.ai treats 401+WWW-Authenticate as an OAuth trigger).
  Fatal-exit at startup if `DECKPAL_MCP_KEY` unset.
- Startup self-check: ping Postgres (`SELECT 1`) and `GET ${DECKPAL_API_BASE}/health`; log clearly
  and `process.exit(1)` if the DB is unreachable (the supervisor restarts). API unreachable = warn only
  (read tools still work; API-backed tools will fail per-call).
- Entry-point detection must handle process-manager fork mode like `apps/api/src/index.ts` does
  (`process.env.pm_exec_path ?? process.argv[1]`).

## 3. Data access — the hybrid rule

**Reads go straight to Postgres. Writes (and all deck/list operations) go through deckpal-api on
`127.0.0.1:3700`.** Rationale: read queries need MCP-shaped compact aggregation the REST API
doesn't offer; write logic (upsert → `collection_event` append → `recomputeSetProgress`, one
transaction) lives in `apps/api/src/routes/collection.ts` and must stay single-sourced.

- Pool: `makePool(1)` from `@deckpal/db`, module scope. This is a **4th** connection against the
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

## 3b. Cloud mode — multi-user, per-token (added 2026-08-10)

Everything above describes the **self-host** server: one long-lived process, one user, one shared
`x-brain-key`. The cloud deployment serves the *same 23 tools* to any signed-up user from a single
Vercel function. Only the way the context is built differs; no tool was rewritten.

| Thing | Self-host (`src/index.ts`) | Cloud (`src/cloud.ts` → `api/mcp.mjs`) |
|---|---|---|
| Endpoint | `http://127.0.0.1:3704/mcp` behind a reverse proxy | `https://deckpal.app/mcp` (vercel.json rewrite → `api/mcp.mjs`) |
| Credential | `x-brain-key: <shared secret>` | `Authorization: Bearer dsk_…`, **or** the token as the last path segment (`/mcp/dsk_…`) — personal access tokens, migration 026 |
| User | lowest `app_user.id`, resolved once at startup | `api_token.user_id` for the presented token, resolved per request |
| DB access | process pool, no RLS | per-request client inside `withUserContext` — `SET LOCAL role = 'authenticated'` + `request.jwt.claims.sub`, so migration 021's policies fire on every tool query |
| API-backed tools | unauthenticated call to `127.0.0.1:3700` | same token forwarded as `Authorization: Bearer`, so `deckpal-api` resolves the identical user |
| Lifetime | one `McpServer` factory, many requests | one `McpHttpHandler` per HTTP request, closed before the transaction commits |

- `Ctx.db` is a `Queryable` (`pg.Pool` **or** `pg.PoolClient`), which is what lets one set of tools
  run against a process pool and against a per-request RLS transaction unchanged.
- `Ctx.userId` is a **string** — `app_user.id` has been a UUID since migration 020.
- Token verification lives in `@deckpal/db` (`src/tokens.ts`) so the API (which mints them) and
  the MCP edge (which checks them) can never disagree about the hashing rule. SHA-256 of the raw
  value; the raw value is returned once, at creation, and never stored.
- Missing / malformed / unknown / revoked token ⇒ bare `401` **with** `WWW-Authenticate: Bearer
  resource_metadata="<origin>/.well-known/oauth-protected-resource"` (added 2026-08-10, issue #29).
  A spec-compliant client that reads this hint runs real OAuth discovery and lands on a working
  `/authorize` — see below — instead of guessing one and 404ing against the SPA.
- **Three credential paths, one credential.** OAuth 2.1 + PKCE + dynamic client registration
  (`apps/api/src/oauthServer.ts` for `/register` + `/token` + the two `.well-known/*` metadata
  documents; `apps/web/src/routes/Authorize.tsx` for the browser-facing `/authorize` consent
  screen) is the primary path now — any MCP-spec client that runs OAuth ends up, after the user
  approves, with an ordinary `api_token` row minted by the token endpoint calling the exact same
  `createToken()` Profile → Agent access uses. Claude Code takes arbitrary headers
  (`--header "Authorization: Bearer …"`) as a second path. claude.ai's custom-connector dialog
  exposes headers only through its beta *Request headers* section (allowlisted names, rolled out
  per account); for clients with neither OAuth nor a header field, the URL carries the secret as a
  third path: `https://deckpal.app/mcp/<token>`. The token goes in the **path**, never the query
  string — the MCP authorization spec's "access tokens MUST NOT be included in the URI query
  string" and Anthropic's own "not recommended" both name the query string specifically. The UI
  labels that URL as a password. All three paths resolve to the same `api_token` table and the
  same `resolveToken()` at the `/mcp` edge — OAuth and dynamic client registration are a front
  door onto the existing credential, not a parallel one.
- `MCP_ALLOWED_HOSTS` still gates the `Host` header; the cloud default is
  `deckpal.app,www.deckpal.app,localhost,127.0.0.1` plus any `*.vercel.app` alias.
- The REST base is derived from the (already validated) request host — `https://<host>/api` — so
  there is no environment variable to get wrong. `DECKPAL_API_BASE` still overrides.

## 4. Tool conventions

- **The 23 tool definitions live in `packages/agent-tools/src/tools/*.ts`** (`@deckpal/agent-tools`),
  each a `ToolDefinition` — `{ name, title, description, inputSchema, annotations, handler }` — written
  against `Ctx` alone, with no MCP SDK import anywhere in that package. `apps/mcp/src/adapters/mcp.ts`
  is the only file that turns one into an MCP registration: it walks `allTools()` and calls
  `server.registerTool(name, { title, description, inputSchema, annotations }, handler)` per tool,
  branching on whether `inputSchema` is present (the SDK calls a no-arg tool's handler as
  `(serverCtx)`, not `(args, serverCtx)` — `health` needs the with-args branch skipped or its handler
  receives the server context in the position it expects its own args). `apps/api/src/decke/adapters/
  aisdk.ts` is the sibling adapter onto the AI SDK's `tool()`, for Deck-E — same 23 definitions, a
  different protocol. A tool added or changed here appears on both fronts in the same commit.
  Every tool has `title` + annotations: `readOnlyHint: true` on all reads; `destructiveHint: true` on
  `delete_deck` / `delete_list`; `idempotentHint` where true. `readOnlyHint` is required in this
  package's `ToolDefinition` type (MCP's own SDK type leaves it optional) — a tool that omits it fails
  to compile rather than defaulting into whatever the approval-gate logic assumes.
- Every handler wraps in try/catch and returns the house envelope — `ok()` →
  `{ content: [{ type:'text', text }] }` (optionally `structuredContent`), `fail(msg)` →
  `{ isError: true, content:[...] }`. `apps/mcp/src/adapters/mcp.ts`'s `toCallToolResult()` is what
  turns that envelope into MCP's `CallToolResult` on the wire. Never throw to the transport.
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

## 5. Tool surface (23 tools + 1 resource)

### Reads — direct SQL (`readOnlyHint: true`)

1. **`health`** — no args. DB ok + API ok **with round-trip latency for each**, catalog counts
   (cards/variants/sets), owned totals, last `sync_run` per job (+status), price freshness
   (`max(price_current.fetched_at)` per source), and a one-line statement of the write budget.
   The "is my data fresh / is it slow right now" tool. Latency was added 2026-08-19: during the
   silent-success incident this tool answered `db: ok · api: ok` truthfully while the actual
   problem — the MCP function's own wall clock — was something it did not measure.
2. **`collection_summary`** — `{ top_n?: 1–25 = 10 }`. Distinct cards owned, total quantity,
   sets with ownership, estimated USD value (Σ qty × best `market_minor` across sources per
   owned variant; unpriced count reported), top `top_n` owned cards by value, 5 nearest-complete
   sets for the user's default goal (`user_settings`). **The default entry point** — description
   says so. Also backs the `collection://summary` resource.
3. **`search_cards`** — `{ query?, set_id?, category?, rarity?, owned_only? = false,
   standard_legal?, min_value_usd?, page?, page_size? }`. Catalog+ownership search over
   `card` (trgm + unaccent on `name_normalized`), joined to owned qty and best market price.
   Compact lines + total count. Each line ends with a trailing `series <slug>` cell (added
   2026-08-21, `packages/agent-tools` extraction) — the web route for a card is
   `/series/<seriesSlug>/<setId>/<number>` and no field elsewhere in the line supplies the slug.
   Trailing addition only: no existing field moved, changed or was removed.
4. **`get_card`** — `{ card_id? | name? + set_id? + number? }`. Card core (category, rarity, HP,
   regulation mark, legality flags, set + local number), then per-variant rows: kind code,
   display name, tier (from `variant_tier_resolved` — never re-derive), owned qty, market price,
   TCGplayer link when present. Ambiguous → candidate list. Same trailing `series <slug>` addition
   as `search_cards`.
5. **`set_progress`** — `{ set_id?, goal? ∈ complete|master|grandmaster, rarity?, rarity_exclude?,
   page?, page_size? }`. Every missing row carries its **rarity**, and `rarity`/`rarity_exclude`
   filter on it (case-insensitive; an unknown name is an error listing the vocabulary, never a
   silently empty result). Rarity is NOT `variant_tier_resolved.tier`: an Illustration Rare and a
   Special Illustration Rare are both tier `standard`, which is why a tier filter could not
   express "no special illustrations" and reading `rarity` per card was the only way. Same trailing
   `series <slug>` addition as `search_cards` (2026-08-21).
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

### Decks & lists — via deckpal-api (read parts `readOnlyHint: true`)

Exact request/response shapes: **read `apps/api/src/routes/decks.ts` / `lists.ts` first**; the
routes are the contract (`GET/POST /decks`, `GET/PATCH/DELETE /decks/:id`, `POST /decks/:id/cards`,
`PATCH/DELETE /decks/:id/cards/:cardId`, `GET /decks/:id/{validate,export,testhand,pricing}`,
`POST /decks/import`, `PUT /decks/:id/strategy`, `GET /decks/:id/versions[/:v]`,
`POST /decks/:id/revert`, `GET/POST /decks/:id/logs`, `GET/PATCH/DELETE /decks/:id/logs/:logId`;
`GET/POST /lists`, `GET/PATCH/DELETE /lists/:id`, `POST /lists/:id/items`,
`DELETE /lists/:id/items/:itemId`).

8. **`decks`** — `{ deck_id?, include?: subset of [cards, validate, pricing, testhand] }`.
   No id: deck index (id, name, format, version, card count, battle record). With id: deck +
   an intelligence headline (W/L record, battle-log count, strategy-guide presence as first
   heading + char count) + requested includes. `pricing` include **is the gap analysis**:
   per-card owned vs needed, missing list with cost to close, TCGplayer mass-entry lines,
   plus the cart deep link(s) from `GET /decks/:id/massentry` (one line per URL — the user
   opens them; each adds to the same cart) and the Cart Optimizer consolidation tip
   (the API computes all of it; link failure degrades to lines-only).
9. **`save_deck`** — `{ deck_id?, name?, format?, cards?: [{card_id, quantity}], ptcgl_text?,
   version_note?, dry_run? = true }`. Create (POST /decks, or POST /decks/import when
   `ptcgl_text` given), rename (PATCH), and reconcile the card list to `cards` via the
   per-card routes — every write attributed `source: 'deckpal-mcp'` (`writeSource` on the
   import route, whose `source` names the decklist syntax). `version_note` rides as
   `versionNote` on card ops and format PATCH and lands on the deck_version snapshot (§6b).
   Dry run returns the would-be diff (current vs proposed lines) and changes nothing.
10. **`delete_deck`** — `{ deck_id, dry_run? = true }`. `destructiveHint: true`. The dry run
    (and the deed) spell out that the deck's version history and battle logs cascade with it.
11. **`lists`** — `{ list_id? }`. Index or one list with items (compact).
12. **`edit_list`** — `{ list_id?, name?, add_cards?, remove_item_ids?, dry_run? = true }`.
    Creates the list when `list_id` omitted. Item payload shape comes from `lists.ts`.
13. **`delete_list`** — `{ list_id, dry_run? = true }`. `destructiveHint: true`.

### Collection writes — via deckpal-api

14. **`log_cards`** — THE write tool. `{ items: [{ card_id? | name?+set_id?+number?,
    variant_id? | variant_kind?, delta? | quantity? }] (1–250), note? (≤500 chars),
    idempotency_key?, dry_run? = true }`. Per item exactly one of `delta` (signed increment,
    floors at 0) or `quantity` (absolute). Resolution per §4; any unresolvable/ambiguous item is
    reported per-item and **does not block the others**. Dry run: resolved variant +
    `current → new` per item, no writes. Description must say: this edits the local DeckPal
    collection only — nothing external. `readOnlyHint: false`, `destructiveHint: false`,
    **`idempotentHint: true`**.

    **Rewritten 2026-08-19 (see DECISIONS.md).** It used to be a loop: two SQL round trips to
    resolve each item, then one HTTPS call per item, each with its own transaction and its own
    full-set progress recompute. That measured **0.65 s per item** in production against a ~60 s
    function budget, so a 99-item batch outran the wall clock, the response died, and the
    already-committed writes stood. Retrying — which the error invited — inflated quantities up
    to 4×.

    Now: resolution is batched (`resolveCardsBatch` + `variantsOfMany`, two queries for the whole
    batch), and the write is a single `POST /collection/batch` applying everything in ONE
    transaction with one `recomputeSetProgress` per DISTINCT SET. 99 items end-to-end: 177 ms.

    Three properties the contract now guarantees:
    - **Retry is safe.** Each chunk carries an idempotency key derived from its resolved
      contents; a repeat returns the ORIGINAL result and writes nothing, and the text output
      leads with `REPLAYED`.
    - **A timeout tells the truth.** On any API failure the tool asks
      `GET /mutations?idempotency_key=…` what actually landed and reports that, rather than a
      bare error that hides committed work.
    - **Nothing is half-applied.** The batch is one transaction; a chunk either lands entirely
      or not at all, and un-sent chunks are named in the output.

    Budgets: 25 s per API call (under the API's own 30 s `PGRLS_MAX_HOLD_MS`), 40 s outer
    deadline, 250 items and 40 distinct sets per batch — sets are the cost driver, each one
    being a full-set CTE recompute.

    **The idempotency key is bucketed by time (15 minutes, and lookups probe the previous
    bucket too).** Without a bucket the key would be pure content and would live forever, so
    logging "+1 Pikachu" today would make the identical call next month a silent no-op — the
    same dishonesty this tool exists to remove, pointing the other way. With one, a retry
    collides and a genuine second acquisition applies and is FLAGGED (`duplicateOf`).

    One consequence worth knowing: because a key records "this request was processed", logging
    a batch, reverting it, and immediately logging the identical batch again REPLAYS rather than
    re-applying, for up to ~15–30 minutes. That is correct idempotency and the output says
    `REPLAYED`; to genuinely re-apply within the window, pass a different `idempotency_key` (or
    change the batch).

### Deck intelligence — via deckpal-api (migration 019; semantics in §6b)

Numbered 15–20 so the earlier `§5 #N` references in code comments stay stable. All six live in
`packages/agent-tools/src/tools/deckIntel.ts`; writes carry `source: 'deckpal-mcp'`.

15. **`deck_strategy`** — `{ deck_id, markdown? }`. Omit `markdown` → the full guide. Provide it →
    `PUT /decks/:id/strategy` replaces the whole guide (empty string clears); the response names
    the previous guide's first heading + length so an accidental overwrite is visible. Strategy
    edits NEVER bump the deck version (§6b) and the descriptions say so.
16. **`add_battle_log`** — `{ deck_id, log, result?, player_name?, opponent_deck?, notes?,
    played_at? }`. `POST /decks/:id/logs`: the API parses the raw PTCG Live log (result, opponent,
    turns, prizes, KOs, deck guess) and attaches it to the deck's CURRENT version. The
    ambiguous-owner 400 is surfaced verbatim — it tells the agent to retry with `player_name`
    (exact screen name) or an explicit `result`.
17. **`battle_logs`** — `{ deck_id, log_id?, version?, include_raw? = false, page?, page_size? }`.
    List mode: one compact row per game, newest first, W/L footer (`3W–1L–0T`) over the filter
    scope plus a per-version breakdown when unfiltered. `log_id`: full detail incl parsed fields.
    `include_raw` appends raw log text — the synthesis read path; raw logs are huge, so list-mode
    `page_size` then defaults to 10 (result-size budgets, §7). `readOnlyHint: true`.
18. **`deck_history`** — `{ deck_id, version?, revert_to?, include_strategy? = true, note?,
    dry_run? = true }`. No extra args: version timeline with per-version W/L, note, source, card
    count, current marker. `version`: full snapshot + card diff vs the previous version.
    `revert_to`: `POST /decks/:id/revert` — the API has no dry-run mode, so the tool's default
    dry run fetches the target and current snapshots itself and prints the exact diff (and
    whether the revert will bump or amend) before anything is written. Non-destructive by
    design — history is never deleted — hence `destructiveHint: false`.
19. **`edit_battle_log`** — `{ deck_id, log_id, result?|null, opponent?|null, opponent_deck?|null,
    notes?|null, played_at? }`. `PATCH /decks/:id/logs/:logId` — classification-only corrections
    (e.g. the parser left NO RESULT on a non-standard ending); raw log + attached version are
    immutable; nulls clear (not `played_at`); per-version records recompute immediately. Added
    2026-07-31 after an agent had no way to correct a timeout-win misparse (battle #8).
20. **`delete_battle_log`** — `{ deck_id, log_id, dry_run? = true }`. `DELETE
    /decks/:id/logs/:logId` for duplicate/wrong-deck pastes; dry-run gated,
    `destructiveHint: true`, not undoable — descriptions steer corrections to edit_battle_log.

### Shopping — via deckpal-api (`readOnlyHint: true`)

21. **`set_cart`** — exactly one of `{ set_id, goal?, finishes?, rarity?, rarity_exclude? }`,
    `{ list_id, missing_only? }`, or `{ items: [{ variant_id | card_id, quantity? }] }`. Wraps
    `GET /sets/:setId/massentry`, `GET /lists/:id/massentry` and `POST /massentry` — one builder
    (`apps/api/src/tcgplayer/massentry.ts`), shared with the web UI's Purchase Set button.
    Builds links only — never buys anything; the user opens them in their own logged-in browser.

    `list_id` exists because the tool used to take only `set_id` + `goal` and therefore always
    re-derived "what is missing from this whole set", so a carefully filtered list could not be
    carted — the cart put the excluded cards straight back in.

    Lines are `<qty>-<productId>`, aggregated per TCGplayer product id. Name lines were removed:
    a name only resolves when it is unique inside its set, every modern set reprints base-card
    names as Illustration/Special-Illustration rares, and Mass Entry is **all-or-nothing** (one
    unresolvable line adds nothing at all). A variant with no product id is reported as
    unlinkable rather than guessed at; a curated `tcgplayer_mass_entry` token is the only
    fallback and its lines go in separate URLs so a guess cannot void the verified cart.

### History and undo — via deckpal-api

22. **`mutation_history`** — `{ batch_id? | since?, until?, source?, tool?, note?, entity_type?,
    entity_id?, limit?, page? }`. `GET /mutations` / `GET /mutations/:batchId`. Every change made
    through DeckPal, grouped by the operation that made it, with a before/after snapshot per
    thing touched. Answers "what did that call actually do?" — the question that had no answer
    during the 2026-08-19 incident, when recovery meant hand-deriving 92 corrective deltas out of
    `collection_log`. Coverage begins at the migration-036 deploy.
23. **`revert`** — exactly one of `{ batch_id }`, `{ event_id }`, `{ since, until?, source? }`, or
    `{ entity_type, entity_id, at? }`, plus `{ strategy? = inverse, force? = false, note?,
    dry_run? = true }`. `POST /mutations/revert`. Undoes a whole operation, one change, a time
    window, or one entity. `inverse` applies the opposite change so unrelated later edits
    survive; `restore` forces the old value back. Where an exact undo is impossible — the
    original change clamped at zero, the inverse would clamp, or a later call asserted an
    absolute quantity — the item is reported as a CONFLICT and skipped rather than half-applied,
    and the original is never marked reverted. The revert is itself a logged batch, so it can be
    reverted. `destructiveHint: true`, dry-run by default.

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
  'Who wrote this change: web (UI), deckpal-mcp (agent), import/script names. Default web.';
```

API changes (`apps/api/src/routes/collection.ts` + wherever the event INSERT lives):
- `PATCH /collection/variants/:variantId`, `POST .../increment`, `POST /collection/cards/:cardId/have`
  accept optional `source` (validated against the same shape regex, default `'web'`) and `note`
  (trimmed, ≤500); both flow into the `collection_event` insert inside the existing transaction.
- `GET /collection/events` returns `source`/`note` and accepts optional `?source=` filter.
- Update/add API tests in `apps/api/src/__tests__` covering: default source stays `'web'`,
  explicit source+note round-trips through the events feed, invalid source rejected 400.

## 6b. Migration 019 + deck intelligence (prerequisite for §5 15–18)

Migration `019_deck_intelligence.sql` gives decks a strategy guide (`deck.strategy_md`,
markdown, ≤40k chars), an integer `deck.version`, per-version snapshots (`deck_version`:
cards jsonb + strategy + note + source) and battle logs (`battle_log`, raw PTCG Live text +
parser output, FK'd to the deck version it was played on). The authoritative write logic lives
in `apps/api/src/deck/versions.ts` — these tools NEVER reimplement it (§3 hybrid rule holds:
every deck-intel operation goes through the API).

The versioning semantics the tool descriptions must keep teaching (LOCKED in the feature plan):

- **Auto-bump rule**: a card-list or format change to a version that already has ≥1 battle log
  creates a NEW version (post-change snapshot); with no logs, the current snapshot is amended
  in place — a burst of single-card edits with no battles in between stays one version, and
  save_deck's sequential ops compose (first op bumps, the rest amend the new logless version).
- **Strategy edits never bump.** `PUT /strategy` updates `deck.strategy_md` and the current
  snapshot in place.
- **Logs attach to the current version** — the list the game was actually played with — so
  per-version W/L records mean something.
- **Revert is non-destructive**: it re-applies an old snapshot through the same write path
  (same auto-bump rule); history is never deleted.
- **The synthesis loop** these tools exist for: `battle_logs` (read a version's results, raw
  logs via `include_raw`) → `save_deck` with `version_note` / `deck_strategy` (push the
  improved list + guide) → new games log against the new version. Compounding, battle-tested
  deck intelligence.

Attribution extends the §6 convention: every deck write accepts optional `source` (same shape,
default `'web'`) — the tools always send `'deckpal-mcp'` — and card ops + format PATCH accept
`versionNote` (≤500) which lands on the `deck_version` row. On `POST /decks/import` the writer
attribution field is **`writeSource`** because `source` was already the decklist-syntax param
there.

## 7. Non-negotiables (inherited from the repo)

- rtk-prefix every shell command and every `&&` segment. `rtk curl` summarizes JSON — write to a
  file and parse with node when you need the real body.
- Never write `variant_tier_override` (human-asserted). Never touch other running services,
  Postgres config. No `git push` (no remote). Don't commit — the lead agent reviews and
  commits.
- Secrets (`.env`, `token-cache.json`): read at runtime only, never log values, never commit.
- `console.log`/`console.error` with `[deckpal-mcp]` prefix — no logging library.
- Result-size budgets: Claude Code caps tool output ~25k tokens; claude.ai ~150k chars — the
  paging defaults in §4 exist so we never get near either.

## 8. Verification gates (what "done" means)

1. `pnpm --filter deckpal-mcp typecheck` clean; API typecheck + tests still clean after §6.
2. Real MCP round-trips against `127.0.0.1:3704/mcp` (SDK client or `claude mcp add`-registered):
   every tool called at least once; `collection_summary` numbers reconcile with the web UI /
   known totals; `log_cards` dry-run then a real +1/−1 on a cheap card, confirmed in
   `collection_log` with `source='deckpal-mcp'` and in `user_set_progress` recompute; a deck
   round-trip: import small PTCGL list → `decks include=[validate,pricing]` → `delete_deck`.
3. Auth: request without `x-brain-key` → 401; with → 200.
4. Deployment (separate phase): process-manager entry, reverse-proxy routes for
   `/mcp` (key-header auth, allowed-hosts env), reboot-safe.
