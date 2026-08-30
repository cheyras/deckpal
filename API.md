# deckpal-api — read API contract

The React frontend's contract. TypeScript/Express, ~55 routes.

**Scope.** This documents the surface the web frontend's data layer consumes.
Registered on the same app but documented elsewhere, not repeated here: OAuth
2.1 + personal-access-token management (`/oauth`, `/tokens`) in
`apps/mcp/SPEC.md`; Deck-E's history and owner-gate/account routes (`/decke`,
`/me`) — and his chat function (`api/chat.mjs`) — in `DECKE-AGENT-SPEC.md`;
the profile-avatar routes (`/avatar`) in `DECISIONS.md` 2026-08-10.

**Deployment modes:**

| Mode | Base path | Port | Auth boundary |
|------|-----------|------|---------------|
| Self-host | `/deckpal/api` | 3700 (127.0.0.1) | reverse proxy with auth |
| Cloud (Vercel) | `/api` | serverless | Supabase JWT (Bearer token) |

The base path is set by `API_BASE_PATH` (defaults to `/deckpal/api`). On Vercel
the Express app is mounted as a catch-all serverless function at `api/index.ts`.

Pure-catalog reads (`/series`, `/sets`, `/cards`, `/search`, `/dex`, the PDF
exports), the **collection write endpoints** (§Collection) that mutate
`collection_item` + `collection_event` and recompute the affected set's
`user_set_progress` rows in one transaction, list/deck CRUD, the deck engine
(validate / import / export / test-hand / pricing / versions / battle logs),
the insights/gamification router, a perceptual-hash card scanner, and an
in-app bug reporter. All queries parameterized; pool sizing is role- and
backend-aware — see `AGENTS.md` B2 (a direct-Postgres self-host keeps the
historical cap of 3).

Base path: **`/deckpal/api`** (self-host) or **`/api`** (Vercel). Examples below
omit the host.

## Conventions

- **Identity.** Every request resolves to one `user_id`, and every per-user read
  and write below is scoped to it — "the requesting user". Cloud mode: the
  Supabase JWT (or personal access token) names the user (§Authentication).
  Self-host mode: no built-in auth — the reverse proxy is the auth boundary,
  and every request maps to the single local user.
- **Money.** Prices are per `(variant, source, currency)`. Amounts are returned in
  **major units** (e.g. `800.43`) with a `currency` code. A missing price is
  `null` / an empty `prices` array — **never `0`**. Every price carries `pricedAt`
  (the source's observation time, not fetch time). Sources: `tcgcsv` (TCGplayer
  bulk, USD), `tcgdex-cardmarket` (Cardmarket, EUR), `tcgdex-tcgplayer`.
- **Images.** The API returns image **paths**, never bytes. Card images resolve to
  `/deckpal/images/en/{serie}/{set}/{localId}/{low|high}.webp`. Self-host serves that
  path from `apps/images` on 3701 (behind nginx at the same base); on cloud it is a
  serverless function that fills the object store on demand and `302`s to the public
  object URL. **Since 2026-08-26 the SPA does not request that path first on cloud** —
  it derives the public object URL itself and requests the object directly, keeping
  `/deckpal/images/…` as the fallback that fills a cold asset (DECISIONS.md
  2026-08-26). The path in the payload is unchanged and remains the contract; what
  changed is only which URL the browser ends up fetching. A card the image tier
  cannot source answers a ~1 KB placeholder WebP with `200` and `X-Placeholder: 1` —
  **a valid image, not an error**, so a client cannot detect it via `onError`.
  Set chrome (`logoUrl`, `symbolUrl`, `backgroundUrl`) are stored upstream URLs and
  may be `null`.
- **PDF routes.** `GET /decks/:id/pdf`, `GET /lists/:id/pdf`, and
  `GET /sets/:setId/checklist.pdf` stream `application/pdf` with a
  `Content-Disposition: attachment` filename. They are mounted at the `/deckpal/api`
  base **before** the `/decks`, `/lists`, `/sets` routers so the `…/pdf` and
  `checklist.pdf` paths resolve to the PDF renderer (those routers define no such
  routes — explicit ordering removes the ambiguity). Rendered with pdfkit
  (pure-JS/ARM-safe); `private, no-cache`.
- **Progress.** Read from `user_set_progress` for the requesting user. **Complete
  is a card fraction; Master and Grandmaster are `(card,variant)` pair fractions** —
  the three totals differ (e.g. sv03.5: 207 / 373 / 384). `pct` is one-decimal,
  round-half-up. `setLevel` (0–5) is on the Complete goal only.
- **View state in the URL.** Filter/sort/goal/ownership/pagination are query params
  by design; omit a param to accept its default.
- **Identifiers.** `:setId` and `:cardId` are TCGdex ids (`sv03.5`, `base1`,
  `base1-4`). `:seriesSlug` is the kebab slug (`scarlet-violet`). `:speciesId`
  accepts the numeric dex id **or** the slug (`6` or `charizard`). `:id` on
  `/lists`, `/decks`, and the PDF routes is a UUID. `:variantId` is the numeric
  `card_variant.id`. `:v` (deck version) and `:logId`/`:itemId` are positive integers.
- **Attribution.** Every collection/deck/list write accepts an optional `source`
  (writer handle, shape `^[a-z0-9][a-z0-9._-]{0,39}$`, default `web`) and most
  accept a free-text `note`/`versionNote` (trimmed, length-capped). The one
  exception is `POST /decks/import`, where `source` was already the decklist syntax,
  so attribution rides as `writeSource`.
- **Errors.** `{ "error": { "code", "message" } }` with status 400 (bad request),
  404 (not found), 500/503 (server/DB). Success bodies are documented per route.
- **Caching.** Pure-catalog responses (`/series` list, `/search`, the `/` index)
  send `Cache-Control: public, max-age=…`. Anything mixing in the user's
  collection or prices sends `private, no-cache, must-revalidate`.

## Authentication

In **cloud mode** (`SUPABASE_JWT_SECRET` is set), the API verifies Supabase JWTs:

- All requests pass through `authMiddleware` which decodes the `Authorization:
  Bearer <token>` header (HS256) and attaches `req.user` with the user's UUID.
- **Public routes** (no auth required): `GET /health`, `GET /`, `GET /search`.
- **Protected routes** (require a valid JWT): everything else (series with
  progress, sets, cards, collection mutations, lists, decks, insights, scan,
  bugs, PDF exports). Returns `401 { "error": { "code": "unauthorized" } }`
  without a valid token.
- The user UUID comes from the JWT `sub` claim. All SQL queries use this UUID
  as `user_id`.

In **self-host mode** (no `SUPABASE_JWT_SECRET`), the auth middleware is a no-op.
The reverse proxy is the auth boundary. All requests pass through.

---

## GET /deckpal/api/
A tiny index so hitting the base is not a 404. Returns the service name and a flat
list of the registered endpoint paths (method-prefixed where the method is not
GET). `public` cached for 1 h.
```json
{ "name": "deckpal-api",
  "endpoints": [ "/health", "/series", "/series/:seriesSlug", "/sets/:setId",
                 "PATCH /collection/variants/:variantId", … ] }
```

## GET /deckpal/api/health
DB liveness + latest run per sync job. Never cached.
```json
{ "status": "ok", "db": "up",
  "syncs": [ { "job": "prices-tcgcsv", "status": "ok",
               "finishedAt": "2026-07-24T23:01:18.752Z",
               "sourceStamp": "2026-07-24T20:11:00+0000" } ] }
```
`503 { "status": "degraded", "db": "down", "error": … }` if the DB is unreachable.

## GET /deckpal/api/series
The English-catalogue series list (newest-era ordering via `sortOrder`), each with
the requesting user's per-series completion rollup (owned/total cards summed across
the series' sets for the Complete goal, from the materialised `user_set_progress`).
Pokémon TCG Pocket (`tcgp`) is a separate game and is excluded. `private` cached.
```json
{ "series": [ { "slug": "scarlet-violet", "tcgdexId": "sv", "name": "Scarlet & Violet",
                "firstReleaseOn": "2023-03-31T…", "sortOrder": 18,
                "setCount": 24, "cardCount": 5123,
                "repSetId": "sv01", "repHasSymbol": true,
                "progress": { "owned": 0, "total": 5123, "pct": 0 } } ] }
```
`repSetId`/`repHasSymbol` describe the series' namesake/flagship set (the set
sharing the series name, else the earliest non-promo set with a logo).

## GET /deckpal/api/series/:seriesSlug
Sets in a series, each with the three-goal completion summary for the requesting user.
Zero-card catalogue artifacts (e.g. `base/wp`, `miscellaneous/jumbo`) are hidden.
```json
{ "series": { "slug": "base", "tcgdexId": "base", "name": "Base", "firstReleaseOn": … },
  "sets": [ { "setId": "base1", "slug": "base-set", "name": "Base Set",
              "releasedOn": "1999-01-09T…", "isPromo": false,
              "printedCount": 102, "secretCount": 0, "cardCountTotal": 102,
              "logoUrl": "…", "symbolUrl": "…",
              "progress": {
                "complete":    { "owned": 0, "total": 102, "pct": 0, "setLevel": 0 },
                "master":      { "owned": 0, "total": 102, "pct": 0 },
                "grandmaster": { "owned": 0, "total": 409, "pct": 0 } } } ] }
```

## GET /deckpal/api/sets/:setId
Set detail: header, the three goals, and the paginated card list.

**Query params**
| param | values | default |
|---|---|---|
| `goal` | `complete` \| `master` \| `grandmaster` | `complete` |
| `own` | `all` \| `have` \| `need` \| `dupes` | `all` |
| `sort` | `number` \| `name` \| `price` \| `rarity` \| `artist` | `number` |
| `dir` | `asc` \| `desc` | `asc` |
| `variant` | variant-kind code, **repeatable** (`?variant=holo-unlimited&variant=…`) | none (all) |
| `q` | free text (card name or number, accent-insensitive) | — |
| `page`, `pageSize` | int ≥1, 1–250 | 1, 60 |

The active `goal` + `variant` filter narrow which `(card,variant)` pairs the
`own`/have/need/dupes predicate is judged over. `price` sort uses the primary
variant's TCGplayer/tcgcsv USD market (nulls sink last regardless of `dir`).

```json
{ "set": { "setId": "sv03.5", "slug": "151", "name": "151",
            "series": { "slug": "scarlet-violet", "name": "Scarlet & Violet", "tcgdexId": "sv" },
            "releasedOn": "2023-09-21T…", "isPromo": false,
            "printedCount": 165, "secretCount": 42, "cardCountTotal": 207,
            "images": { "logoUrl": …, "symbolUrl": …, "backgroundUrl": null },
            "marketValueUsd": 1985.09,
            "mostExpensiveCard": { "cardId": "sv03.5-199", "name": "Charizard ex",
                                   "number": "199", "marketUsd": 399.43 } },
  "progress": { "complete": { "owned":0,"total":207,"pct":0,"totalQuantity":0,"setLevel":0 },
                "master":      { "owned":0,"total":373,"pct":0,"totalQuantity":0 },
                "grandmaster": { "owned":0,"total":384,"pct":0,"totalQuantity":0 } },
  "query": { "goal":"complete","own":"all","sort":"number","dir":"asc","variant":[],"q":null,"page":1,"pageSize":60 },
  "pagination": { "page":1, "pageSize":60, "total":207, "pageCount":4 },
  "cards": [ { "cardId":"sv03.5-1","number":"001","numberSort":"000000001","name":"Bulbasaur",
               "category":"Pokemon","rarity":"…","artist":"…","variantCount":2,
               "images": { "low":"/deckpal/images/en/sv/sv03.5/001/low.webp","high":"…/high.webp" },
               "price": { "market": 0.42, "currency":"USD" },
               "ownership": { "totalQuantity":0,"requiredCount":2,"ownedRequired":0,
                              "have":false,"need":true,"dupe":false } } ] }
```
`price` is `null` when the representative variant has no price.

## GET /deckpal/api/cards/:cardId
Card detail: attributes, types/subtypes/tags, attacks/abilities/weaknesses/
resistances, dex species links, image refs, and every variant with composed
display name, resolved tier, TCGplayer buy URL, and per-variant prices across all
sources/currencies.
```json
{ "card": { "cardId":"base1-4","number":"4","numberSort":"000000004","printedTotal":102,"name":"Charizard",
            "category":"Pokemon","rarity":"Rare","artist":"Mitsuhiro Arita","hp":120,
            "stage":"Stage2","suffix":null,"evolvesFrom":"Charmeleon","retreat":3,"regulationMark":null,
            "effect":null,"releasedOn":"1999-01-09T…",
            "legal": { "standard":false,"expanded":false },
            "flags": { "aceSpec":false,"radiant":false,"prismStar":false,"ruleBox":false },
            "set": { "setId":"base1","name":"Base Set","slug":"base-set","logoUrl":…,"symbolUrl":… },
            "series": { "slug":"base","name":"Base","tcgdexId":"base" },
            "images": { "low":"/deckpal/images/en/base/base1/4/low.webp","high":"…" },
            "types":["Fire"], "subtypes":[], "tags":[],
            "attacks":[ { "name":"Fire Spin","cost":"…","damage":"100","effect":"…" } ],
            "abilities":[], "weaknesses":[ { "type":"Water","value":"×2" } ], "resistances":[],
            "species":[ { "speciesId":6,"slug":"charizard","name":"Charizard","generation":1 } ] },
  "variants": [
    { "variantId":15,"kind":"holo-unlimited","displayName":"Holofoil","provenance":"Found in Booster Packs",
      "tier":"standard","tierSource":"derived","isPrimary":true,"isSynthesized":false,
      "source":"tcgdex","fillConfidence":null,"quantity":0,
      "buyUrl":"https://www.tcgplayer.com/product/…?Printing=…&Condition=Near+Mint",
      "prices":[ { "source":"tcgcsv","sourceLabel":"TCGplayer (via TCGCSV bulk)","marketplace":"tcgplayer",
                   "currency":"USD","market":800.43,"low":510,"mid":null,"high":null,"directLow":null,
                   "trend":null,"avg1":null,"avg7":null,"avg30":null,
                   "pricedAt":"2026-07-24T20:11:00.000Z","isFallback":false },
                 { "source":"tcgdex-cardmarket","currency":"EUR","market":421.11, … } ] },
    { "variantId":16,"kind":"holo-shadowless-stamp-1st-edition","displayName":"1st Edition Holofoil Shadowless",
      "tier":"special","isPrimary":false,"source":"tcgdex","buyUrl":"…","prices":[] } ] }
```
`tier`: `standard` counts toward Master; `special` is Grandmaster-only.
`source:"tcgcsv"` variants are cross-filled reverse holos and count for real.
Empty `prices` ⇒ render "no price". `buyUrl` is `null` when there is no TCGplayer
mapping at all. `quantity` is the requesting user's owned count of that variant (0 if
unowned) — the initial value for the card-detail quantity stepper.

## GET /deckpal/api/cards/:cardId/prices
Observed market price over time, one series per PRINTING, at whatever GRAIN that
stretch of history still exists in.

| param | kind | notes |
|---|---|---|
| `range` | `30d`\|`3m`\|`6m`\|`1y`\|`18m`\|`2y` | default `3m`; same vocabulary as the Insights value chart |
| `currency` | `USD`\|`EUR`\|`JPY` | default `USD` |

```json
{ "currency":"USD", "range":"2y",
  "series":[ { "variantId":15, "kind":"holo-unlimited", "displayName":"Holofoil", "tier":"standard",
               "points":[
                 { "grain":"month","start":"2025-03-01","end":"2025-03-31",
                   "open":780.10,"high":812.00,"low":749.55,"close":801.20,
                   "highOn":"2025-03-09","lowOn":"2025-03-22",
                   "mean":779.40,"median":781.00,"n":31 },
                 { "grain":"week","start":"2026-02-23","end":"2026-03-01",
                   "open":800.43,"high":806.10,"low":795.00,"close":802.75,
                   "highOn":"2026-02-25","lowOn":"2026-02-28",
                   "mean":800.90,"median":801.10,"n":7 },
                 { "grain":"day","start":"2026-08-15","end":"2026-08-15",
                   "open":812.34,"high":812.34,"low":812.34,"close":812.34,
                   "highOn":"2026-08-15","lowOn":"2026-08-15",
                   "mean":812.34,"median":812.34,"n":1 } ] } ] }
```

**Three tiers, one point shape.** Daily rows forever do not fit the disk
(~6.6 GB/year at three TCGs), so history is kept daily for ~30 days, as weekly
OHLC buckets for ~6 months, and as monthly buckets forever — see
`research/SCHEMA.md` §7.5. A DAY is a **degenerate bucket**:
`open = high = low = close`, `start = end = highOn = lowOn`, `n = 1`. A client
that only wants a line reads `close` and never branches on `grain`.

Points are ordered oldest first, month → week → day, and are contiguous — the
rollup HALTS rather than rolling past a month it cannot finish, precisely so
that the daily floor never jumps over a month whose rows would then be visible
at no grain at all. The one edge that is not covered is the window's own left
edge: a bucket that starts before `range` begins is excluded, so a 1y or 2y
chart can begin up to a month after its nominal start. Two seams overlap by up
to six days each — the tiers are not a clean tiling (a month
bucket and its own week buckets describe the same days at two grains) and an
overlap was chosen over a gap deliberately: a chart with a hole in it reads as
missing data. `n` is the number of days actually observed in the bucket, so a
week with `n: 5` had a two-day ingest gap.

**What may be asserted from a bucket** — this is a CONTRACT, and it ships
verbatim in the endpoint's JSDoc because rollup destroys real information:

- **MAY**: open/close/high/low/mean/median of a bucket; the exact dates and
  values of the period's high and low (`highOn`/`lowOn` are true daily facts
  that survive the rollup); trend across buckets; volatility DERIVED from OHLC
  (Parkinson / Garman-Klass — there is no stored variance, because
  `corr(stddev, high-low) = 0.9878` measured over 633,431 real weekly buckets,
  and no VWAP, because TCGCSV supplies no volume).
- **MAY NOT**: any specific day's price inside a week or month bucket other than
  the two extremes; the path between them; durations ("stayed under \$5 for
  eleven days"); a second or third dip within one bucket.

"It dipped to \$4.00 on the 12th" is licensed if and only if `lowOn` says the
12th and `low` says \$4.00.

No agent tool exposes price history today (`get_card` serves current prices
only). Any that later does must carry the block above unchanged.

## GET /deckpal/api/search
The 12-filter advanced search. AND across fields, OR within a multi-value field.

| param | kind | notes |
|---|---|---|
| `cardType` | repeatable | supertype: `Pokemon`\|`Trainer`\|`Energy` |
| `energyType` | repeatable | `Fire`, `Water`, … (11) |
| `subType` | repeatable | **vocabulary EMPTY in data** (subtypes/tags not imported) |
| `set` | repeatable | set tcgdex id |
| `rarity` | repeatable | 40 values |
| `weakness` / `resistance` | repeatable | energy type |
| `retreat` | repeatable int | 0–5 |
| `hp` | repeatable int (exact) | plus `hpMin` / `hpMax` range |
| `attack` | free text | matches attack name/effect |
| `ability` | free text | matches ability name/effect |
| `artist` | repeatable | 413 values |
| `q` | free text | card name or number (accent-insensitive) |
| `sort` | `name`\|`number`\|`price`\|`rarity`\|`released` | default `name` |
| `dir`, `page`, `pageSize` | | `asc`, 1, 60 (max 250) |
| `facets` | `1` | also return the available filter vocabularies |

```json
{ "query": { … echoed … },
  "pagination": { "page":1,"pageSize":60,"total":104,"pageCount":2 },
  "cards": [ { "cardId":"swsh9-154","number":"154","name":"Charizard V","category":"Pokemon",
               "rarity":"Ultra Rare","artist":"…","hp":220,"regulationMark":"F",
               "set": { "setId":"swsh9","name":"Brilliant Stars" }, "releasedOn":"…",
               "variantCount":2,"images": { … },
               "price": { "market":334.37,"currency":"USD" } } ],
  "facets": {            // only when ?facets=1
    "subType": { "label":"Sub-Type","populated":false,"values":[] },
    "energyType": { "label":"Energy Type","populated":true,
                     "values":[ { "value":"Water","label":"Water","count":2837 }, … ] },
    "hitPoints": { "label":"Hit Points","populated":true,"range":{ "min":30,"max":340 } },
    "attack": { "label":"Attack Search","populated":true,"freeText":true }, … } }
```
`public` cached for 2 min (pure catalog, no user state).

## GET /deckpal/api/dex
National-dex species list.

| param | values | default |
|---|---|---|
| `generation` | 1–9 | all |
| `own` | `all` \| `captured` \| `uncaptured` | `all` |
| `q` | free text (name or slug) | — |
| `page`, `pageSize` | int, 1–1025 | 1, 200 |

```json
{ "completion": { "captured": 0, "total": 1025 },
  "pagination": { "page":1,"pageSize":200,"total":151,"pageCount":1 },
  "species": [ { "speciesId":6,"slug":"charizard","name":"Charizard","genus":"…",
                 "generation":1,"totalCardCount":124,"types":["fire","flying"],
                 "captured":false } ] }
```
`totalCardCount` is computed live from `card_species` (the stored
`dex_species.total_card_count` column is unpopulated — 0 everywhere). `captured`
= the requesting user owns ≥1 card featuring the species.

## GET /deckpal/api/dex/:speciesId
A species and every card featuring it (card→species is many-to-many, so tag-team
cards appear on both species). `sort` = `number`\|`price`\|`rarity`\|`artist`\|
`released`, `dir` = `asc`\|`desc`.
```json
{ "species": { "speciesId":6,"slug":"charizard","name":"Charizard","genus":"…",
                "generation":1,"types":["fire","flying"],"totalCardCount":124,"captured":false },
  "cards": [ { "cardId":"pl4-1","number":"1","name":"Charizard","category":"Pokemon",
               "rarity":"…","artist":"…","set": { "setId":"pl4","name":"…" },
               "variantCount":3,"owned":false,"ownedQuantity":0,
               "images": { … }, "price": { "market":67.67,"currency":"USD" } } ] }
```

---

## Collection — mutation & activity log

The only writers against `collection_item`. Each mutation runs in
**one transaction**: upsert `collection_item` to the new quantity, append a
`collection_event` for the non-zero delta, then **recompute the affected set's
three `user_set_progress` rows** and return them authoritatively. Idempotent
(setting the same quantity writes no event). Bodies are JSON; all queries
parameterized. Responses are `private, no-cache`.

Tier drives which goals a variant advances (SCHEMA §5.3):
**Complete** = own the card in ≥1 variant of any tier (card fraction); **Master** =
own each `(card, standard-variant)` pair (over `master_required_variant`);
**Grandmaster** = own each `(card, any-variant)` pair. `totalQuantity` is per-goal
(sum over that goal's counted variants). Dupes = a card whose owned quantity ≥ 2.

**Shared success body** (returned by the three variant/card writers):
```json
{ "variantId": 15, "quantity": 1, "delta": 1, "isFirstAcquisition": true,
  "card": { "cardId": "base1-4",
            "variants": [ { "variantId":15,"quantity":1 }, { "variantId":16,"quantity":0 } ],
            "ownership": { "totalQuantity":1,"have":true,"need":false,"dupe":false } },
  "setId": "base1",
  "progress": { "complete":    { "owned":1,"total":102,"pct":1,"totalQuantity":1,"setLevel":1 },
                "master":      { "owned":1,"total":102,"pct":1,"totalQuantity":1 },
                "grandmaster": { "owned":1,"total":409,"pct":0.2,"totalQuantity":1 } } }
```
The `/cards/:cardId/have` response omits `variantId`/`delta`/`isFirstAcquisition`
and adds `cardId` at top level; `card`, `setId`, `progress` are identical in shape.

### PATCH /deckpal/api/collection/variants/:variantId
Set the **absolute** owned quantity for a variant. `:variantId` is the numeric
`card_variant.id`. Body `{ "quantity": N, "source"?, "note"? }` (integer 0–100000).
Setting 0 keeps a qty-0 row (SCHEMA §9.1). `404` if the variant doesn't exist;
`400` on a bad quantity.

### POST /deckpal/api/collection/variants/:variantId/increment
Adjust the owned quantity by a **signed delta** (default `+1`). Body
`{ "delta": N, "source"?, "note"? }` (non-zero integer; floors at 0 — decrementing
below 0 is a no-op with `delta:0`).

### POST /deckpal/api/collection/cards/:cardId/have
Tile-level Have/Need toggle. `:cardId` is the card tcgdex id. Body
`{ "have": bool, "source"?, "note"? }`. `have:true` owns the primary variant (sets
it to 1 only if currently 0; never lowers a higher quantity). `have:false` zeroes
**every** variant of the card (Need = own nothing, one event per zeroed variant).
One transaction, one recompute.

### POST /deckpal/api/collection/reconcile
Internal nightly consistency sweep — recomputes the three `user_set_progress` rows
for **every** set that has progress rows, from the live catalog + collection
(bumps `recomputed_at` AND `reconciled_at`). On a quiet system this never changes
derived values; it exists to heal drift. One transaction per set, strictly
sequential (the API's request pool is deliberately small — `AGENTS.md` B2). Called by the
deckpal-sync `reconcile` cron over HTTP. Any request body is ignored.
```json
{ "sets": 218, "ms": 412 }
```

### GET /deckpal/api/collection/events
The collection activity log, newest first, each event resolved to human fields
(card/set names, number, variant label, images). Powers the stream overlay
("just added Charizard, Base Set, #4") and an Activity view.

| param | values | default |
|---|---|---|
| `limit` | int 1–200 | 50 |
| `since` | ISO-8601 timestamp (events strictly newer) | — (invalid → 400) |
| `source` | writer handle (exact match, same shape rule as writes) | — (invalid → 400) |

The `kind` field is derived from the append-only `delta` + `quantity_after` +
`is_first_acquisition` (the table stores no categorical kind): `added`
(0→n, first acquisition), `quantity-increased`, `removed` (n→0),
`quantity-decreased`.
```json
{ "events": [ { "eventId": 42, "occurredAt": "2026-07-30T…", "kind": "added",
                "cardId": "base1-4", "cardName": "Charizard", "setId": "base1",
                "setName": "Base Set", "number": "4", "variantId": 15,
                "variantName": "Holofoil", "quantityDelta": 1, "newQuantity": 1,
                "isFirstAcquisition": true, "source": "web", "note": null,
                "images": { "low": "…", "high": "…" } } ] }
```
Empty collection returns `{ "events": [] }`.

---

## Lists — dynamic, static, Pokédex binder

Three list kinds, straight from the live schema (`card_list.kind ∈ {dynamic,
static, pokedex_binder}`):

- **dynamic** — an ordered set of `card_variant` references. Membership is the
  stored references; **ownership is read through from the collection at read
  time** and never stored on the list, so the progress cluster (owned/total,
  copies) auto-syncs with the collection live. Mirrors pkmn.gg's Dynamic List.
- **dynamic + rule** ("smart list", migration 050) — the dynamic list carries a
  saved query instead of stored rows: the `addMissing` spec (`setId`, `goal`,
  `finishes`, `rarity`, `rarityExclude`, `maxPriceUsd`, `pricedOnly`) plus
  `exclude` (variant ids removed by hand) and a server-resolved `setName`.
  Membership is re-evaluated on EVERY read via `missingForGoal` — own a card
  and it leaves the list. Item add/bulk-add/reorder are refused with a 400
  ("membership is its rule"); DELETE of the synthetic `rule-<variantId>` item
  id records an exclusion instead of deleting a row. `PATCH { "rule": null }`
  PINS the list: the current evaluation is materialised into stored rows and
  the rule detached. Rule set/exclusion are undoable (`list.rule.set`,
  `list.rule.exclude` in the mutation log).
- **static** — an ordered **bag** of `card_variant` references; duplicates allowed,
  each row carries its own `static_quantity` (≥1). No collection tie, no progress.
- **pokedex_binder** — one slot per dex species (`list_item.dex_id`). Read-through
  "captured?" from the collection (owns ≥1 card of that species).

The requesting user's `user_id` is threaded everywhere. Writes go through `withTx` so
the item write + position bookkeeping are atomic. `:id` is a UUID;
`400`-as-`404` on a non-UUID id.

### GET /deckpal/api/lists
All lists for the requesting user, favorite-first then `updated_at DESC`, each with
summary aggregates.
```json
{ "lists": [ { "id": "47333f45-…", "kind": "dynamic", "name": "Wants",
               "description": null, "visibility": "private", "isFavorite": false,
               "coverRender": "full", "pocketSize": null,
               "itemCount": 12, "progress": { "owned": 3, "total": 12, "pct": 25, "copies": 4 },
               "marketValueUsd": 67.12,
               "coverImage": { "low": "…", "high": "…" },
               "coverImages": [ { "low": "…", "high": "…" } ],
               "createdAt": "…", "updatedAt": "…" } ] }
```
`progress` is `null` for `static` lists (no collection tie) **and for smart
lists** (owned is 0 by construction — an owned card is no longer missing, so
it is no longer a member; their tiles show count + cost-to-finish instead).
Summaries carry `rule` (the saved query, or `null`) and `ruleEvaluatedAt`;
a smart list's `itemCount`/`marketValueUsd`/`coverImages` come from evaluating
its rule at read time. `coverImages` is
up to 8 DISTINCT CARDS in list order with the explicit cover pick first —
the index tile's mosaic (distinct by card, because a static list holding four
copies of one card is a quantity, not four tiles). `coverImage` remains the
first-tile shorthand.

### GET /deckpal/api/lists/:id
One list's summary plus its resolved items in position order. Card items carry
variant metadata, owned-from-collection quantity, market price, and per-item
routing slugs (a list spans many sets). `pokedex_binder` items are shaped as a
CardRow (`cardId: "dex-<n>"`) with a representative card image resolved for the
species, so the same grid/binder view renders them.
```json
{ "list": { …same summary shape as the index… },
  "items": [ { "itemId": "…", "position": 0, "kind": "card",
               "cardId": "sv01-25", "variantId": 30,
               "variant": { "kind": "holo-unlimited", "displayName": "Holofoil",
                            "tier": "standard", "isPrimary": true },
               "number": "25", "name": "…", "category": "Pokemon", "rarity": "…",
               "artist": "…", "variantCount": 2,
               "seriesSlug": "scarlet-violet", "setId": "sv", "setName": "…",
               "images": { … }, "price": { "market": 1.20, "currency": "USD" },
               "note": null, "staticQuantity": null, "ownedQuantity": 1,
               "ownership": { "totalQuantity": 1, "requiredCount": 1,
                              "ownedRequired": 1, "have": true, "need": false, "dupe": false } },
             { "itemId": "…", "position": 1, "kind": "species", "dexId": 6,
               "cardId": "dex-6", "number": "6", "name": "Charizard",
               "category": "Pokemon", "generation": 1, "variantCount": 1,
               "images": { … }, "price": null, "note": null,
               "ownership": { "totalQuantity": 1, "requiredCount": 1,
                              "ownedRequired": 1, "have": true, "need": false, "dupe": false } } ] }
```

### POST /deckpal/api/lists
Create a list. Body `{ "name" (required, ≤120), "kind"? = "dynamic"\|"static"\|
"pokedex_binder", "description"? (≤2000), "visibility"? = "private"\|"public" }`.
A `pokedex_binder` gets a default `pocketSize` of 9. `201` returns the summary.
```json
{ "list": { …summary shape… } }
```

### PATCH /deckpal/api/lists/:id
Rename / edit description / visibility / favorite / cover / pocket size / reorder.
Body fields are all optional; only the ones present are applied.
`{ "name"?, "description"?, "visibility"?, "isFavorite"?, "coverRender"? =
"full"\|"art", "pocketSize"? = 4\|9\|12\|16, "coverCardVariantId"? (positive
integer or null), "itemOrder"? (array of itemIds — rewrites positions 0..n-1;
items not named keep a high position, appended after) }`. Returns the summary.

### DELETE /deckpal/api/lists/:id
`{ "deleted": "<uuid>" }`. `404` if the list doesn't exist.

### POST /deckpal/api/lists/:id/items
Add a card/variant (or a species slot for a binder). Body depends on the list kind:
- dynamic / static: `{ "cardVariantId" | "variantId" (positive int, required),
  "position"? (int ≥0, default end), "note"? (≤500), "staticQuantity"? (static
  only, int ≥1, default 1) }`.
- pokedex_binder: `{ "dexId" (positive int, required), "position"?, "note"? }`.

`dynamic` and `pokedex_binder` dedupe silently (unique constraint) and return
`200 { "itemId": null, "alreadyPresent": true, "list": … }`; `static` always
inserts a fresh row (`201`). Returns the updated list summary.

### DELETE /deckpal/api/lists/:id/items/:itemId
`{ "deleted": "<itemId>", "list": …summary or null… }`. `404` if the item isn't in
the list. Bumps the list's `updated_at`.

---

## Decks — builder, engine, intelligence

Persistence + validation + interchange on top of the verified deck engine in
`apps/api/src/deck`. `deck` is keyed by UUID; `deck_card` is **variant-agnostic**
(keyed by `card.id`, a print — same print on two import lines is summed).
Unresolved import lines cannot be stored (`card_id NOT NULL`, FK) and are reported
to the caller, never dropped silently. Every write carries
optional `source` attribution and (for card ops + format-changing `PATCH`) a
`versionNote` that lands on the `deck_version` row.

**Deck detail payload** (returned by create, GET, PATCH, card ops, strategy,
revert): `{ deck, counts, cards, validation, cardRefs, glcTypes }` — the deck
metadata (incl. `version`, `strategyMd`, `totalCount`, `valueUsd`, `legal`), the
{total, pokemon, trainer, energy, distinctNames} counts, the grouped card rows
(each with owned/have/price/images, plus `setCode` — the expansion code PRINTED
on the card, e.g. `"PBL"`, resolved from the vendored PTCGL alias table and
`null` for sets that have no such code; `setId` beside it is TCGdex's internal
id, which is printed nowhere), the engine's `ValidationResult`, a
`cardRefs` map keyed by numeric card id (for in-place violation highlighting),
and the GLC type vocabulary.

### GET /deckpal/api/decks
Index, favorite-first then `updated_at DESC`. Each row carries `record:
{ wins, losses, ties }` aggregated over **all** versions (one query), plus the
same metadata shape as the detail's `deck` (validated under the stored format).
```json
{ "decks": [ { "id": "…", "name": "Hide 'n' Sneak", "formatCode": "standard",
               "formatName": "Standard", "isFavorite": false, "version": 3,
               "totalCount": 60, "valueUsd": 124.30, "legal": true,
               "record": { "wins": 3, "losses": 1, "ties": 0 }, … } ] }
```

### POST /deckpal/api/decks
Create an **empty** deck (seeds the v1 snapshot). Body `{ "name" (required,
≤120), "formatCode"|"format"? = "standard"\|"expanded"\|"glc"\|"unlimited",
"description"? (≤2000), "glcType"? (required for `glc`, defaults to the first
type), "source"? }`. `201` returns the full detail payload.

### GET /deckpal/api/decks/:id
The full detail payload for one deck. `404` if the deck doesn't exist (non-UUID
ids are also a `404`).

### PATCH /deckpal/api/decks/:id
Rename / edit description / format / glcType / favorite / cover render. Body
fields all optional: `{ "name"?, "description"?, "formatCode"|"format"?,
"glcType"?, "isFavorite"?, "coverRender"?, "source"?, "versionNote"? }`. A
**format change** alters what the list means and goes through the same auto-bump
path as a card edit; rename/favorite/cover changes never bump. Returns the detail
payload.

### DELETE /deckpal/api/decks/:id
`{ "deleted": "<uuid>" }`. Cascades to `deck_card`, `deck_version`,
`battle_log`.

### POST /deckpal/api/decks/:id/cards
Additive upsert of a card (quantity clamped to 60). Body `{ "cardId"|"card"
(required — tcgdex id or numeric catalogue id), "quantity"? = 1, "source"?,
"versionNote"? }`. On conflict the quantity is **added** (then clamped). Records
a version snapshot via the auto-bump rule. `201` returns the detail payload.

### PATCH /deckpal/api/decks/:id/cards/:cardId
Set the **absolute** quantity for a card in the deck. Body
`{ "quantity" (int 0–60, required), "source"?, "versionNote"? }`. `quantity: 0`
removes the row. `:cardId` is a tcgdex id or numeric catalogue id. Records a
version snapshot. Returns the detail payload.

### DELETE /deckpal/api/decks/:id/cards/:cardId
Remove a card from the deck. `:cardId` is a tcgdex id or numeric catalogue id.
Body `{ "source"?, "versionNote"? }` (optional). Records a version snapshot.
Returns the detail payload.

### GET /deckpal/api/decks/:id/validate
Run the legality engine and return `{ validation, cardRefs }` without persisting
anything. Query `?format=` overrides the stored format for the check (defaults to
the deck's `format_code`).

### POST /deckpal/api/decks/import
Paste a decklist and create a new deck from it. Body `{ "text" (required, ≤20000),
"source"? = "ptcgl"\|"massentry" (the decklist syntax — defaults `ptcgl`),
"writeSource"? (writer attribution, since `source` is taken), "formatCode"|
"format"?, "glcType"?, "name"? (default "Imported Deck") }`. Mass Entry set codes
(a third namespace — TCGplayer abbrevs) are resolved by name only. Same print on
two lines is summed (clamped to 60). Unresolved lines are reported, not dropped.
`201` returns the detail payload plus an `import` summary:
```json
{ …detail payload…,
  "import": { "source": "ptcgl", "resolvedEntries": 59, "distinctCards": 24,
              "unresolved": [ "Could not resolve 'Old Mysterious Card'" ],
              "warnings": [ { …non-UNRESOLVED import warnings… } ] } }
```

### GET /deckpal/api/decks/:id/export
Serialize the deck to interchange text. Query `?format=ptcgl|massentry` (default
`ptcgl`). Returns `{ "format", "text", "warnings" }`. PTCGL output uses real
PTCGL vocabulary (set codes, brace Energy, stripped zeros) with structured
warnings for anything Live cannot resolve; Mass Entry output uses the stored
per-variant token when present, else a bare name line.

### GET /deckpal/api/decks/:id/testhand
Draw a randomized opening hand + prize cards from the deck. Query `?seed=` (uint32;
omit for a random seed, which is returned). Returns:
```json
{ "seed": 12345, "deckSize": 60, "basicPokemonCount": 14,
  "mulligans": 0, "opponentDraws": 0, "mulliganChancePct": 12.3,
  "hand":  [ { "cardId": "…", "name": "…", "number": "…", "category": "Pokemon",
               "isBasicPokemon": true, "image": "…" } ],
  "prizes": [ …same shape… ],
  "note": "Keepable opening hand (contains a Basic Pokémon)." }
```
`opponentDraws` = this player's mulligan count (the opponent may draw one card per
extra mulligan). `mulliganChancePct` is the hypergeometric probability of a
mulligan for this deck's basic count.

### GET /deckpal/api/decks/:id/pricing
Per-card and roll-up pricing for the deck against the collection. Primary-variant
tcgcsv USD market per card; `owned` is summed across all variants of the print.
Returns total / owned / missing value, a per-card `cards` array, and a `missing`
array (cards where owned < deck quantity) with `buyUrl`, a `massEntry` line, and
image. `massEntryText` joins the missing lines.
```json
{ "currency": "USD", "totalUsd": 124.30, "ownedValueUsd": 80.10,
  "missingValueUsd": 44.20,
  "cards": [ { "cardId": "…", "name": "…", "number": "…", "setId": "…",
               "quantity": 4, "owned": 2, "unitPrice": 1.20, "lineTotal": 4.80,
               "currency": "USD" } ],
  "missing": [ { "cardId": "…", "name": "…", "number": "…", "setId": "…",
                 "missingQty": 2, "unitPrice": 1.20, "lineTotal": 2.40,
                 "buyUrl": "https://www.tcgplayer.com/…",
                 "massEntry": "2 Charizard [SVI] 25", "image": "…" } ],
  "massEntryText": "2 Charizard [SVI] 25\n…" }
```

### PUT /deckpal/api/decks/:id/strategy
Body `{ "strategyMd": "# …" | null, "source"? }` (≤40000 chars; `null`/`''`
clears). Updates `deck.strategy_md` **and** the current version's snapshot in
place — never bumps. Returns the full deck detail payload.

### GET /deckpal/api/decks/:id/versions
The version timeline, newest first.
```json
{ "current": 3,
  "versions": [ { "version": 3, "note": "added a second attacker", "source": "deckpal-mcp",
                  "createdAt": "2026-07-30T…", "cardCount": 60, "formatCode": "standard",
                  "battleLogs": { "total": 0, "wins": 0, "losses": 0, "ties": 0 },
                  "isCurrent": true } ] }
```

### GET /deckpal/api/decks/:id/versions/:v
One snapshot plus the diff vs `v-1` (`diff` is `null` for v1).
```json
{ "version": 2, "isCurrent": false, "formatCode": "standard",
  "note": "…", "source": "web", "createdAt": "…", "strategyMd": "# …",
  "cardCount": 60,
  "cards": [ { "cardId": 123, "tcgdexId": "sv01-25", "name": "…", "quantity": 2 } ],
  "battleLogs": { "total": 4, "wins": 3, "losses": 1, "ties": 0 },
  "diff": { "added":   [ { "name": "Dhelmise", "tcgdexId": "sv06-22", "quantity": 2 } ],
            "removed": [ { "name": "Switch",   "tcgdexId": "sv01-194", "quantity": 1 } ],
            "changed": [ { "name": "Ultra Ball", "tcgdexId": "sv01-196", "from": 3, "to": 4 } ] } }
```

### POST /deckpal/api/decks/:id/revert
Body `{ "toVersion": 1, "includeStrategy"?: true, "note"?, "source"? }`.
Non-destructive: reconciles `deck_card` to the old snapshot **through the same
auto-bump path** (bumps if the current version has logs, else amends), note
auto-set to `Reverted to v<k>`. `400` when `toVersion` is already current.
Returns the deck detail payload plus
`"revert": { "toVersion", "version", "bumped", "skippedCards": [ { "cardId", "tcgdexId", "name" } ] }`
(`skippedCards` = snapshot entries whose print has vanished from the catalog —
near-impossible under `ON DELETE RESTRICT` — reported, never silently dropped).

### GET /deckpal/api/decks/:id/logs
`?version=` (filter to one version) `&page=` `&pageSize=` (default 50, cap 200).
Summaries only — never `rawLog`. `totals` covers the same filter scope.
```json
{ "version": null,
  "logs": [ { "id": 7, "deckVersion": 1, "result": "win", "opponent": "Robni16",
              "opponentDeck": "Dragapult ex / Dusknoir", "turns": 14,
              "prizes": { "me": 6, "opponent": 5 }, "notes": null,
              "playedAt": "2026-07-30T…", "source": "web" } ],
  "totals": { "total": 4, "wins": 3, "losses": 1, "ties": 0 },
  "pagination": { "page": 1, "pageSize": 50, "total": 4, "pageCount": 1 } }
```

### POST /deckpal/api/decks/:id/logs
Body `{ "rawLog" (required, ≤50000), "result"?, "opponent"?, "opponentDeck"?,
"notes"? (≤2000), "playedAt"? (ISO), "playerName"?, "source"? }`. Runs the PTCG
Live parser; parser-derived `result` / `opponent` / `opponentDeck` (deck guess)
fill any fields the caller omitted — **explicit caller values always win over
the parser** (2026-08-29, `mergeLogFields`). Attaches to the deck's **current**
version.
`400` when the parser cannot tell which player owns the deck **and** neither
`playerName` nor an explicit `result` was given (the message says which to pass).
```json
201 { "attachedToVersion": 2,
      "log": { "id": 7, "deckVersion": 2, "result": "win", "opponent": "Robni16",
               "opponentDeck": "Dragapult ex / Dusknoir", "turns": 14,
               "prizes": { "me": 6, "opponent": 5 }, "notes": null,
               "playedAt": "…", "source": "web", "createdAt": "…", "rawLog": "Setup…",
               "parsed": { "players": { "me": "cheyras", "opponent": "Robni16" },
                           "confidence": "high", "result": "win", "wentFirst": "opponent",
                           "totalTurns": 14, "prizesTaken": { "me": 6, "opponent": 5 },
                           "knockouts": { "byMe": ["Dusknoir","…"], "byOpponent": ["…"] },
                           "opponentPokemon": ["Dreepy","…"], "myPokemon": ["Poltchageist","…"],
                           "opponentDeckGuess": "Dragapult ex / Dusknoir" } } }
```

### POST /deckpal/api/decks/log-preview
Added 2026-08-29 for battle-log deck inference. Body `{ "log" (required,
≤50000), "player_name"? }` (camelCase `playerName` also accepted). Parses the
log **without writing anything** and scores it against the 40 most-recently-updated
non-deleted decks' current-version card lists (name overlap strengthened by
normalized PTCG Live card codes; both players considered, so an unidentified
owner still ranks) — a per-user recency cap rather than a full scan.
```json
200 { "parsed": { "result": "win", "opponent": "Robni16", "turns": 14,
                  "prizes": { "me": 6, "opponent": 5 }, "confidence": "high",
                  "myPokemon": ["Poltchageist","…"],
                  "opponentDeckGuess": "Dragapult ex / Dusknoir" },
      "candidates": [ { "deckId": "…", "name": "Toolbox Slowking", "format": "standard",
                        "version": 3, "score": 11, "matchedNames": 9, "total": 26 } ] }
```
`candidates` is sorted by score descending, capped at 5, and `[]` when nothing
scores above zero.
```json
429 { "error": "rate_limited", "message": "Too many log-preview calls.", "retryAfterSeconds": 3 }
```
Rate-limited at **20 log-preview calls/min per user** — a JSON error envelope, not
a bare status. The counter is **best-effort per instance** (not shared across
replicas), so a burst may slip through; retry after the pause rather than
re-pasting the log. Consumed by the agent tool `add_battle_log` when `deck_id`
is omitted.

### GET /deckpal/api/decks/:id/logs/:logId
The full row — same `log` shape as the 201 above (summary fields + `rawLog` +
`parsed` + `createdAt`).

### PATCH /deckpal/api/decks/:id/logs/:logId
Body: any of `{ "result", "opponent", "opponentDeck", "notes", "playedAt" }`.
Metadata only — the raw log and its version attachment are immutable. Explicit
`null` clears everything except `playedAt`. Returns `{ "log": … }` (full shape).

### DELETE /deckpal/api/decks/:id/logs/:logId
`{ "deleted": 7 }`.

---

## TCGplayer Mass Entry — cart deep links

Both endpoints share one builder (`apps/api/src/tcgplayer/massentry.ts`): line
grammar `<qty> <name> [<CODE>] <number>` (research/DECK-FORMATS.md §1.9 — a
stored per-variant `tcgplayer_mass_entry` token wins, else the line is composed
from TCGplayer's set-abbreviation vocabulary fetched from TCGCSV groups, 24h
in-process cache; bare `<qty> <name>` only as last resort), collector numbers
with leading zeros stripped, and the `c=` payload chunked at ~1800 encoded
chars into an **ordered list of URLs** — opening each adds to the same cart.
Printing and condition can never be preselected by link (chosen on TCGplayer's
page); the response's `note` says so. Cards/variants with no TCGplayer product
are returned in `unlinkable`, never silently dropped.

### GET /deckpal/api/sets/:setId/massentry
Cart link(s) for every card still needed to finish the set.
Query: `goal` = `complete` (default) | `master` | `grandmaster`; `finish`
(repeatable, master/grandmaster only) = `normal`|`reverse`|`holo`|`lenticular`|`metal`.
```json
{ "set": { "setId": "me05", "name": "Pitch Black" }, "goal": "complete",
  "finishes": null, "setCode": "PBL",
  "needed": { "cards": 81, "items": 81, "unlinkable": 0 },
  "lines": [ "1 Lurantis ex [PBL] 4", … ],
  "text": "1 Lurantis ex [PBL] 4\n…",
  "urls": [ "https://www.tcgplayer.com/massentry?productline=Pokemon&c=…" ],
  "unlinkable": [ { "name": "…", "number": "…", "variant": "…" } ],
  "warnings": [], "note": "Printing … Mass Entry page." }
```

### GET /deckpal/api/decks/:id/massentry
Cart link(s) for the deck's **missing** cards — same math as `/decks/:id/pricing`
(`deck_card.quantity` minus owned copies across all variants of the print).
```json
{ "deck": { "id": "47333f45-…", "name": "Hide 'n' Sneak (Dhelmise)" },
  "needed": { "cards": 7, "items": 23, "unlinkable": 0 },
  "lines": [ "3 Banette [PBL] 34", "4 Telepathic Psychic Energy [POR] 88", … ],
  "text": "3 Banette [PBL] 34\n…",
  "urls": [ "https://www.tcgplayer.com/massentry?productline=Pokemon&c=…" ],
  "unlinkable": [ { "name": "…", "number": "…", "setId": "…", "variant": null } ],
  "warnings": [], "note": "…" }
```
`/decks/:id/pricing`'s per-missing-card `massEntry` field and `massEntryText`
use the same line vocabulary (pricing keeps a bare-name line for unlinkable
cards so its text lists everything; the cart URLs here carry linkable lines only).

Tip surfaced by the UI/MCP, not the API: after the cart fills, TCGplayer's own
**Cart Optimizer** (inside the cart) has a consolidation mode that finds the
fewest sellers — or one seller with everything — so it ships in one package.

---

## PDF exports

Read-only, parameterized (ids come from the URL), each streams
`application/pdf` with a `Content-Disposition: attachment` filename and
`private, no-cache`. Rendered with pdfkit (pure-JS/ARM-safe). Mounted at the
`/deckpal/api` base **before** the `/decks`, `/lists`, `/sets` routers.

### GET /deckpal/api/decks/:id/pdf
A printable deck list for `:id` (UUID). Loads the deck + cards, runs the legality
engine (`validateDeck`, with a reprint oracle for pool-checked formats) for the
verdict, and renders Pokémon/Trainer/Energy sections with owned counts, set codes
(PTCGL alias), per-section counts, distinct-name count, and a generated-at stamp.
`404` for a non-UUID id or a missing deck.

### GET /deckpal/api/lists/:id/pdf
A printable export of list `:id` (UUID). Renders the list items (card rows with
variant label + owned flag; `pokedex_binder` species as `Pokédex #<n>`), the
item/owned counts, and progress for `dynamic`/`pokedex_binder` lists (static
lists have no progress). `404` for a non-UUID id or a missing list.

### GET /deckpal/api/sets/:setId/checklist.pdf
A printable set checklist. One row per card (number, name, rarity, category) with
an owned checkbox; owned = any variant has qty ≥ 1 (the Complete goal's
card-fraction semantics, matching `/sets/:setId`). Header carries set name, id,
series, release date, printed/total counts, and a `{ owned, total, pct }`
progress rollup.

---

## Insights — gamification & collection value

Mounted at `/insights`. Every GET is read-only over the collection; the one write
is `POST /value/snapshot`, which the deckpal-sync daily cron calls over HTTP
(sync must not import this app — its `db.ts` opens a 2-connection pool at module
load). All `private, no-cache`.

### GET /deckpal/api/insights/overview
Trainer level + collection value + dex summary in one payload.
```json
{ "trainer": { "level": 4, "levelProgress": { "current": 120, "needed": 150, "pct": 80 },
               "uniqueMode": "pairs", "totalCards": 412, "uniqueCards": 318,
               "uniquePairs": 401 },
  "collectionValue": [ { "currency": "USD", "total": 1985.09, "pricedVariants": 312, "quantity": 412 } ],
  "pokedex": { "captured": 87, "total": 1025, "pct": 8.5 } }
```
`uniqueMode` (`cards` or `pairs`) decides whether trainer level counts distinct
cards or distinct `(card, variant)` pairs.

### GET /deckpal/api/insights/value
Collection value over time + top movers. Query: `range` =
`30d`\|`3m`\|`6m`\|`1y` (default `30d`); `currency` = `USD`\|`EUR`\|`JPY`
(default `USD`).
```json
{ "currency": "USD", "range": "30d",
  "current": { "currency": "USD", "total": 1985.09, "pricedVariants": 312, "quantity": 412 },
  "series": [ { "observedOn": "2026-07-30", "total": 1980.00, "pricedVariants": 310 } ],
  "movers": [ { "cardId": "…", "name": "…", "direction": "up",
                "fromMinor": 1200, "toMinor": 1800, "pct": 50 } ] }
```

### POST /deckpal/api/insights/value/snapshot
Internal daily snapshot — appends today's per-currency totals to
`collection_value_point` for the requesting user. Idempotent per
`(user, observed_on, currency)`: a same-day re-run inserts nothing
(`ON CONFLICT DO NOTHING`) and reports `inserted: 0`. Any request body is
ignored. Returns the snapshot result (`{ currencies, inserted, observedOn }`).

### GET /deckpal/api/insights/pokedex
The gamified species grid (a richer view than `/dex`). Query: `generation` (1–9),
`own` = `all`\|`captured`\|`uncaptured` (default `all`), `q` (free text),
`page`/`pageSize` (1–1025, default 200). Returns the grid payload produced by
`insights/pokedex.speciesGrid` (species rows with capture state + level/shiny
roll-ups).

### GET /deckpal/api/insights/pokedex/:speciesId
One species' cards + capture/level/shiny detail. `:speciesId` accepts the numeric
dex id or the slug. `404` when no such species. Returns the
`insights/pokedex.speciesDetail` payload.

---

## Scan — perceptual-hash card matcher

### POST /deckpal/api/scan
Offline card scanner: image → catalog match. Send the **raw image bytes** as the
request body with an `image/*` Content-Type — **not** multipart, **not** base64
(`curl --data-binary @photo.jpg -H 'Content-Type: image/jpeg' …`). Max upload
4 MB (the hosted platform rejects a larger request body before the API sees it;
the web client downscales bigger photos client-side, which also converts iOS
HEIC). Query: `k` = 1–25 top matches (default 5); `quality` = `low`\|`high`
(which indexed hash set to match against, default `low`).

Computes the query image's 64-bit dHash, ranks the whole indexed hash set by
Hamming distance (0 = identical, 64 = opposite) across multiple rotation/keystone
probes (the min distance wins), and hydrates card metadata for the top `k`. The
ranking is a single SQL query — `bit_count(hash_bits # probe)` over
`card_image_phash`, native Postgres 14+, no extension and no in-process index —
so an indexer run takes effect immediately and the endpoint works identically on
a long-lived server and a serverless function. Measured: 22.6k rows × 34 probes
in ~69 ms of server time. `matched` is `true` only when the best distance is
within the confidence threshold (9 — re-measured over 389 degraded scans, so
96.9% of correct scans fire and every tested junk frame is rejected). Read-only.
```json
{ "query": { "algo": "dhash8v3", "hash": "f0e1…08" },
  "matched": true, "threshold": 9, "indexSize": 23104,
  "matches": [ { "cardId": "sv03.5-199", "name": "Charizard ex", "number": "199",
                 "setId": "sv03.5", "setName": "151", "rarity": "Ultra Rare",
                 "images": { "low": "…", "high": "…" },
                 "distance": 3, "confidence": 0.953 } ] }
```
`confidence` is bit-similarity (`1 - distance/64`, 1.0 = identical hash). When no
hashes are indexed yet the response is `matched: false` with a `note` to run the
scan indexer.

---

## Bugs — in-app bug reporter

### POST /deckpal/api/bugs
The top-nav "Report a bug" button posts here. Body (JSON, 12 MB limit for the
screenshot data URL):
`{ "text" (required, ≤20000), "page"? (current route), "userAgent"?, "viewport"?,
"screenshot"? (a `data:image/(png|jpeg|webp);base64,…` URL, ≤8 MB decoded) }`.
`400` when `text` is missing/empty, the screenshot is not a valid image data URL,
or the decoded screenshot exceeds 8 MB.

**Cloud mode** (GITHUB_TOKEN + GITHUB_REPO set): inserts a `bug_report` row
(user id and email from the JWT, stored privately — never in the public issue),
then creates a GitHub issue labelled `in-app-report`. If Supabase Storage is
configured, the screenshot is uploaded and a signed URL is included in the issue
body. The returned issue number is stored on the DB row. If GitHub is unreachable
the row still persists and the response is `202` with a `note`.
```json
201 { "id": "<uuid>", "issueUrl": "https://github.com/…/issues/42", "issueNumber": 42 }
202 { "id": "<uuid>", "note": "Report saved but GitHub issue creation failed." }
```

**Self-host mode** (no GITHUB_TOKEN): persists each report as a folder under the
repo's `issues/` dir (a developer artefact, not user data — the `fix-issues`
skill walks that dir). No DB.
```json
201 { "id": "2026-07-30T12-34-56_abc123", "saved": "issues/2026-07-30T12-34-56_abc123/" }
```

---

## Data gaps found while building (real, not fabricated)
- **`subType` / `tags` vocabularies are empty** — `card_subtype` and `card_tag`
  have 0 rows; the subtype/tag filters return nothing until imported. All other 11
  filter vocabularies are populated (Card Type 3, Energy Type 11, Set 218, Rarity
  40, Weakness 11, Resistance 9, Retreat 6, HP range 30–340, Artist 413).
- **`dex_species.total_card_count` is unpopulated** (0 for all 1025 species); the
  API computes the count live from `card_species` instead of trusting the column.
- **`user_dex_state` has 0 rows** for the default user (nothing owned yet), so all
  species read `captured:false` — correct given an empty collection.
- **Prices are sparse on vintage/special variants** — e.g. Charizard base1-4's
  three non-primary variants carry no price; the buy URL for the `1999-2000
  Copyright` variant is `null` (no TCGplayer product mapping). Rendered as "no
  price", never 0.

---

# Batch collection writes, the mutation log, and carts (added 2026-08-19)

## `POST /collection/batch`

Apply many collection changes as ONE transaction. This is what `log_cards` calls;
the per-variant endpoints above still exist and are the right shape for a UI
stepper.

```jsonc
POST /collection/batch
{
  "items": [                       // 1–250, at most 40 DISTINCT SETS
    { "variantId": 37183, "delta": 1 },
    { "variantId": 37184, "quantity": 3 }
  ],
  "source": "deckpal-mcp",         // ^[a-z0-9][a-z0-9._-]{0,39}$, default "web"
  "note": "Aug 2026 pack haul",    // ≤500 chars, stored on every event
  "idempotencyKey": "…",           // optional; see below
  "dryRun": false                  // true previews and consumes no key
}
```

Response:

```jsonc
{
  "batchId": "…", "replayed": false, "applied": 99, "unchanged": 0,
  "items": [{ "variantId": 37183, "cardId": "me05-001", "setId": "me05",
              "before": 1, "after": 2, "delta": 1, "requestedDelta": 1,
              "clamped": false }],
  "progress": { "me05": { "complete": {…}, "master": {…}, "grandmaster": {…} } },
  "folded": [{ "variantId": 37183, "from": [0, 4] }],
  "duplicateOf": { "batchId": "…", "at": "…", "note": "…" }   // when applicable
}
```

**Ordering is defined.** Repeated variants fold in input order: deltas
accumulate, an absolute `quantity` discards everything before it for that
variant, and a delta after an absolute adjusts that value — identical to applying
the items one at a time. `folded` reports which input indices merged.

**Idempotency.** A caller-supplied `idempotencyKey` is honoured indefinitely.
Otherwise the server derives one from the batch's resolved contents plus a
15-minute time bucket. Either way a duplicate returns the ORIGINAL response with
`replayed: true` and writes nothing. An identical batch outside the window is
applied AND flagged via `duplicateOf`.

**The response is sent after COMMIT** (see `commitRequestTx`), so a 200 from this
endpoint means the writes are durable.

Caps are 400s: 250 items, 40 distinct sets. Distinct sets are the cost driver —
each one is a full-set progress recompute.

## `GET /mutations`

The history feed, newest first. Filters: `since`, `until`, `source`, `tool`,
`idempotency_key`, `note` (substring), `entity_type`, `entity_id`, `limit`,
`page`.

```jsonc
{ "total": 42, "page": 1, "pageSize": 25,
  "batches": [{ "batchId": "…", "source": "deckpal-mcp", "tool": "collection.batch",
                "note": "…", "status": "committed", "idempotencyKey": "…",
                "revertsBatchId": null, "startedAt": "…", "finishedAt": "…",
                "eventCount": 99, "revertedEventCount": 0 }] }
```

`?idempotency_key=…` is how a client that lost its response asks what landed.

## `GET /mutations/:batchId`

One operation in full — the batch (including its stored `response`) and every
event, each with `before`, `after`, `requestedDelta`, `effectiveDelta`,
`clamped`, and `undoneByEventId`.

## `POST /mutations/revert`

```jsonc
{ "batchId": "…",          // or eventId, or since (+until, source),
                           // or entityType + entityId (+at)
  "strategy": "inverse",   // "inverse" (default) | "restore"
  "force": false,          // apply conflicted items / re-undo something
  "dryRun": true,          // DEFAULT
  "note": "…", "source": "deckpal-mcp" }
```

Returns a `plan` with one entry per targeted event: the action, `from`/`to`/`delta`
for quantities, a `conflicts` array, and `exact`. Items with conflicts are
skipped unless `force`. Conflicts are raised when the original change clamped,
when the inverse would clamp, or when a later event asserted an absolute quantity
on the same entity. The revert is itself a logged batch.

## Cart routes

- `GET /sets/:setId/massentry?goal=&finish=&rarity=&rarity_exclude=`
- `GET /lists/:listId/massentry?missing_only=true`
- `POST /massentry` — `{ items: [{ variantId | cardId, quantity? }] }` (≤500)
- `GET /decks/:id/massentry`

All four return the same shape:

```jsonc
{ "source": "set" | "list" | "items",
  "needed": { "cards": 111, "items": 151, "unlinkable": 0,
              "exactLines": 111, "bestEffortLines": 0 },
  "lines": ["1-704758", "2-704760"],
  "text": "1-704758\n2-704760",
  "urls": [...], "exactUrls": [...], "bestEffortUrls": [...],
  "unlinkable": [{ "name": "…", "number": "…", "setId": "…", "variant": null }],
  "warnings": [...], "note": "…" }
```

Lines are `<qty>-<productId>`, aggregated per TCGplayer product id.
`exactUrls` and `bestEffortUrls` are never mixed: Mass Entry is all-or-nothing,
so a guess that misses would otherwise void the whole cart.

## List routes

- `POST /lists/:id/items/bulk` — `{ items?: [...], addMissing?: { setId, goal,
  finishes?, rarity?, rarityExclude?, maxPriceUsd?, pricedOnly? }, dryRun?, source? }`.
  One transaction, one batch, whatever the count.
- `POST /lists/:id/restore`, `DELETE /lists/:id?purge=true`
- `GET /lists?deleted=true` — the recycle bin

## Deck routes

- `POST /decks/:id/restore`, `DELETE /decks/:id?purge=true`
- `GET /decks?deleted=true` — the recycle bin

`DELETE /lists/:id` and `DELETE /decks/:id` are now soft by default and answer
`{ deleted, restorable: true, batchId }`; `?purge=true` answers
`{ purged, restorable: false }`.
