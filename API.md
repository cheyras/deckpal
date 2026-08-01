# pokedex-api — read API contract

The React frontend's contract. TypeScript/Express, port **3700**, bound to
`127.0.0.1`; nginx (LAN) / Authelia (remote) is the sole ingress and the only auth
boundary. **Every route is under the `/pokedex/` sub-path** — the app never assumes
the domain root. The surface is ~55 routes: pure-catalog reads (`/series`, `/sets`,
`/cards`, `/search`, `/dex`, the PDF exports), the **collection write endpoints**
(§Collection) that mutate `collection_item` + `collection_event` and recompute the
affected set's `user_set_progress` rows in one transaction, list/deck CRUD, the
deck engine (validate / import / export / test-hand / pricing / versions / battle
logs), the insights/gamification router, a perceptual-hash card scanner, and an
in-app bug reporter. All queries parameterized, connection budget **2** (shared
`@pokedex/db` pool, hard-capped at 3).

Base path: **`/pokedex/api`**. All examples below omit the host (`http://the.grid`).

## Conventions

- **Money.** Prices are per `(variant, source, currency)`. Amounts are returned in
  **major units** (e.g. `800.43`) with a `currency` code. A missing price is
  `null` / an empty `prices` array — **never `0`**. Every price carries `pricedAt`
  (the source's observation time, not fetch time). Sources: `tcgcsv` (TCGplayer
  bulk, USD), `tcgdex-cardmarket` (Cardmarket, EUR), `tcgdex-tcgplayer`.
- **Images.** The API returns image **paths**, never bytes. Card images resolve to
  `/pokedex/images/en/{serie}/{set}/{localId}/{low|high}.webp`, served by the image
  service on 3701 (behind nginx at the same base). Set chrome (`logoUrl`,
  `symbolUrl`, `backgroundUrl`) are stored upstream URLs and may be `null`.
- **PDF routes.** `GET /decks/:id/pdf`, `GET /lists/:id/pdf`, and
  `GET /sets/:setId/checklist.pdf` stream `application/pdf` with a
  `Content-Disposition: attachment` filename. They are mounted at the `/pokedex/api`
  base **before** the `/decks`, `/lists`, `/sets` routers so the `…/pdf` and
  `checklist.pdf` paths resolve to the PDF renderer (those routers define no such
  routes — explicit ordering removes the ambiguity). Rendered with pdfkit
  (pure-JS/ARM-safe); `private, no-cache`.
- **Progress.** Read from `user_set_progress` for the single default user. **Complete
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

---

## GET /pokedex/api/
A tiny index so hitting the base is not a 404. Returns the service name and a flat
list of the registered endpoint paths (method-prefixed where the method is not
GET). `public` cached for 1 h.
```json
{ "name": "pokedex-api",
  "endpoints": [ "/health", "/series", "/series/:seriesSlug", "/sets/:setId",
                 "PATCH /collection/variants/:variantId", … ] }
```

## GET /pokedex/api/health
DB liveness + latest run per sync job. Never cached.
```json
{ "status": "ok", "db": "up",
  "syncs": [ { "job": "prices-tcgcsv", "status": "ok",
               "finishedAt": "2026-07-24T23:01:18.752Z",
               "sourceStamp": "2026-07-24T20:11:00+0000" } ] }
```
`503 { "status": "degraded", "db": "down", "error": … }` if the DB is unreachable.

## GET /pokedex/api/series
The English-catalogue series list (newest-era ordering via `sortOrder`), each with
the default user's per-series completion rollup (owned/total cards summed across
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

## GET /pokedex/api/series/:seriesSlug
Sets in a series, each with the three-goal completion summary for the default user.
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

## GET /pokedex/api/sets/:setId
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
               "images": { "low":"/pokedex/images/en/sv/sv03.5/001/low.webp","high":"…/high.webp" },
               "price": { "market": 0.42, "currency":"USD" },
               "ownership": { "totalQuantity":0,"requiredCount":2,"ownedRequired":0,
                              "have":false,"need":true,"dupe":false } } ] }
```
`price` is `null` when the representative variant has no price.

## GET /pokedex/api/cards/:cardId
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
            "images": { "low":"/pokedex/images/en/base/base1/4/low.webp","high":"…" },
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
mapping at all. `quantity` is the default user's owned count of that variant (0 if
unowned) — the initial value for the card-detail quantity stepper.

## GET /pokedex/api/search
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

## GET /pokedex/api/dex
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
= the default user owns ≥1 card featuring the species.

## GET /pokedex/api/dex/:speciesId
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

The only writers against `collection_item`. The single default user owns the
collection (no auth; nginx/Authelia is the ingress). Each mutation runs in
**one transaction**: upsert `collection_item` to the new quantity, append a
`collection_event` for the non-zero delta, then **recompute the affected set's
three `user_set_progress` rows** and return them authoritatively. Idempotent
(setting the same quantity writes no event). Bodies are JSON; all queries
parameterized. Responses are `private, no-cache`.

Tier drives which goals a variant advances (SCHEMA §5.3, AUTH-CAPTURES §4/§8/§11):
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

### PATCH /pokedex/api/collection/variants/:variantId
Set the **absolute** owned quantity for a variant. `:variantId` is the numeric
`card_variant.id`. Body `{ "quantity": N, "source"?, "note"? }` (integer 0–100000).
Setting 0 keeps a qty-0 row (SCHEMA §9.1). `404` if the variant doesn't exist;
`400` on a bad quantity.

### POST /pokedex/api/collection/variants/:variantId/increment
Adjust the owned quantity by a **signed delta** (default `+1`). Body
`{ "delta": N, "source"?, "note"? }` (non-zero integer; floors at 0 — decrementing
below 0 is a no-op with `delta:0`).

### POST /pokedex/api/collection/cards/:cardId/have
Tile-level Have/Need toggle. `:cardId` is the card tcgdex id. Body
`{ "have": bool, "source"?, "note"? }`. `have:true` owns the primary variant (sets
it to 1 only if currently 0; never lowers a higher quantity). `have:false` zeroes
**every** variant of the card (Need = own nothing, one event per zeroed variant).
One transaction, one recompute.

### POST /pokedex/api/collection/reconcile
Internal nightly consistency sweep — recomputes the three `user_set_progress` rows
for **every** set that has progress rows, from the live catalog + collection
(bumps `recomputed_at` AND `reconciled_at`). On a quiet system this never changes
derived values; it exists to heal drift. One transaction per set, strictly
sequential (connection budget: the API owns 2 connections total). Called by the
pokedex-sync `reconcile` cron over HTTP. Any request body is ignored.
```json
{ "sets": 218, "ms": 412 }
```

### GET /pokedex/api/collection/events
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
- **static** — an ordered **bag** of `card_variant` references; duplicates allowed,
  each row carries its own `static_quantity` (≥1). No collection tie, no progress.
- **pokedex_binder** — one slot per dex species (`list_item.dex_id`). Read-through
  "captured?" from the collection (owns ≥1 card of that species).

Single default user, `user_id` threaded everywhere. Writes go through `withTx` so
the item write + position bookkeeping are atomic. `:id` is a UUID;
`400`-as-`404` on a non-UUID id.

### GET /pokedex/api/lists
All lists for the default user, favorite-first then `updated_at DESC`, each with
summary aggregates.
```json
{ "lists": [ { "id": "47333f45-…", "kind": "dynamic", "name": "Wants",
               "description": null, "visibility": "private", "isFavorite": false,
               "coverRender": "full", "pocketSize": null,
               "itemCount": 12, "progress": { "owned": 3, "total": 12, "pct": 25, "copies": 4 },
               "marketValueUsd": 67.12,
               "coverImage": { "low": "…", "high": "…" },
               "createdAt": "…", "updatedAt": "…" } ] }
```
`progress` is `null` for `static` lists (no collection tie).

### GET /pokedex/api/lists/:id
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

### POST /pokedex/api/lists
Create a list. Body `{ "name" (required, ≤120), "kind"? = "dynamic"\|"static"\|
"pokedex_binder", "description"? (≤2000), "visibility"? = "private"\|"public" }`.
A `pokedex_binder` gets a default `pocketSize` of 9. `201` returns the summary.
```json
{ "list": { …summary shape… } }
```

### PATCH /pokedex/api/lists/:id
Rename / edit description / visibility / favorite / cover / pocket size / reorder.
Body fields are all optional; only the ones present are applied.
`{ "name"?, "description"?, "visibility"?, "isFavorite"?, "coverRender"? =
"full"\|"art", "pocketSize"? = 4\|9\|12\|16, "coverCardVariantId"? (positive
integer or null), "itemOrder"? (array of itemIds — rewrites positions 0..n-1;
items not named keep a high position, appended after) }`. Returns the summary.

### DELETE /pokedex/api/lists/:id
`{ "deleted": "<uuid>" }`. `404` if the list doesn't exist.

### POST /pokedex/api/lists/:id/items
Add a card/variant (or a species slot for a binder). Body depends on the list kind:
- dynamic / static: `{ "cardVariantId" | "variantId" (positive int, required),
  "position"? (int ≥0, default end), "note"? (≤500), "staticQuantity"? (static
  only, int ≥1, default 1) }`.
- pokedex_binder: `{ "dexId" (positive int, required), "position"?, "note"? }`.

`dynamic` and `pokedex_binder` dedupe silently (unique constraint) and return
`200 { "itemId": null, "alreadyPresent": true, "list": … }`; `static` always
inserts a fresh row (`201`). Returns the updated list summary.

### DELETE /pokedex/api/lists/:id/items/:itemId
`{ "deleted": "<itemId>", "list": …summary or null… }`. `404` if the item isn't in
the list. Bumps the list's `updated_at`.

---

## Decks — builder, engine, intelligence

Persistence + validation + interchange on top of the verified deck engine in
`apps/api/src/deck`. `deck` is keyed by UUID; `deck_card` is **variant-agnostic**
(keyed by `card.id`, a print — same print on two import lines is summed).
Unresolved import lines cannot be stored (`card_id NOT NULL`, FK) and are reported
to the caller, never dropped silently. Single default user; every write carries
optional `source` attribution and (for card ops + format-changing `PATCH`) a
`versionNote` that lands on the `deck_version` row.

**Deck detail payload** (returned by create, GET, PATCH, card ops, strategy,
revert): `{ deck, counts, cards, validation, cardRefs, glcTypes }` — the deck
metadata (incl. `version`, `strategyMd`, `totalCount`, `valueUsd`, `legal`), the
{total, pokemon, trainer, energy, distinctNames} counts, the grouped card rows
(each with owned/have/price/images), the engine's `ValidationResult`, a
`cardRefs` map keyed by numeric card id (for in-place violation highlighting),
and the GLC type vocabulary.

### GET /pokedex/api/decks
Index, favorite-first then `updated_at DESC`. Each row carries `record:
{ wins, losses, ties }` aggregated over **all** versions (one query), plus the
same metadata shape as the detail's `deck` (validated under the stored format).
```json
{ "decks": [ { "id": "…", "name": "Hide 'n' Sneak", "formatCode": "standard",
               "formatName": "Standard", "isFavorite": false, "version": 3,
               "totalCount": 60, "valueUsd": 124.30, "legal": true,
               "record": { "wins": 3, "losses": 1, "ties": 0 }, … } ] }
```

### POST /pokedex/api/decks
Create an **empty** deck (seeds the v1 snapshot). Body `{ "name" (required,
≤120), "formatCode"|"format"? = "standard"\|"expanded"\|"glc"\|"unlimited",
"description"? (≤2000), "glcType"? (required for `glc`, defaults to the first
type), "source"? }`. `201` returns the full detail payload.

### GET /pokedex/api/decks/:id
The full detail payload for one deck. `404` if the deck doesn't exist (non-UUID
ids are also a `404`).

### PATCH /pokedex/api/decks/:id
Rename / edit description / format / glcType / favorite / cover render. Body
fields all optional: `{ "name"?, "description"?, "formatCode"|"format"?,
"glcType"?, "isFavorite"?, "coverRender"?, "source"?, "versionNote"? }`. A
**format change** alters what the list means and goes through the same auto-bump
path as a card edit; rename/favorite/cover changes never bump. Returns the detail
payload.

### DELETE /pokedex/api/decks/:id
`{ "deleted": "<uuid>" }`. Cascades to `deck_card`, `deck_version`,
`battle_log`.

### POST /pokedex/api/decks/:id/cards
Additive upsert of a card (quantity clamped to 60). Body `{ "cardId"|"card"
(required — tcgdex id or numeric catalogue id), "quantity"? = 1, "source"?,
"versionNote"? }`. On conflict the quantity is **added** (then clamped). Records
a version snapshot via the auto-bump rule. `201` returns the detail payload.

### PATCH /pokedex/api/decks/:id/cards/:cardId
Set the **absolute** quantity for a card in the deck. Body
`{ "quantity" (int 0–60, required), "source"?, "versionNote"? }`. `quantity: 0`
removes the row. `:cardId` is a tcgdex id or numeric catalogue id. Records a
version snapshot. Returns the detail payload.

### DELETE /pokedex/api/decks/:id/cards/:cardId
Remove a card from the deck. `:cardId` is a tcgdex id or numeric catalogue id.
Body `{ "source"?, "versionNote"? }` (optional). Records a version snapshot.
Returns the detail payload.

### GET /pokedex/api/decks/:id/validate
Run the legality engine and return `{ validation, cardRefs }` without persisting
anything. Query `?format=` overrides the stored format for the check (defaults to
the deck's `format_code`).

### POST /pokedex/api/decks/import
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

### GET /pokedex/api/decks/:id/export
Serialize the deck to interchange text. Query `?format=ptcgl|massentry` (default
`ptcgl`). Returns `{ "format", "text", "warnings" }`. PTCGL output uses real
PTCGL vocabulary (set codes, brace Energy, stripped zeros) with structured
warnings for anything Live cannot resolve; Mass Entry output uses the stored
per-variant token when present, else a bare name line.

### GET /pokedex/api/decks/:id/testhand
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

### GET /pokedex/api/decks/:id/pricing
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

### PUT /pokedex/api/decks/:id/strategy
Body `{ "strategyMd": "# …" | null, "source"? }` (≤40000 chars; `null`/`''`
clears). Updates `deck.strategy_md` **and** the current version's snapshot in
place — never bumps. Returns the full deck detail payload.

### GET /pokedex/api/decks/:id/versions
The version timeline, newest first.
```json
{ "current": 3,
  "versions": [ { "version": 3, "note": "added a second attacker", "source": "rotom-mcp",
                  "createdAt": "2026-07-30T…", "cardCount": 60, "formatCode": "standard",
                  "battleLogs": { "total": 0, "wins": 0, "losses": 0, "ties": 0 },
                  "isCurrent": true } ] }
```

### GET /pokedex/api/decks/:id/versions/:v
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

### POST /pokedex/api/decks/:id/revert
Body `{ "toVersion": 1, "includeStrategy"?: true, "note"?, "source"? }`.
Non-destructive: reconciles `deck_card` to the old snapshot **through the same
auto-bump path** (bumps if the current version has logs, else amends), note
auto-set to `Reverted to v<k>`. `400` when `toVersion` is already current.
Returns the deck detail payload plus
`"revert": { "toVersion", "version", "bumped", "skippedCards": [ { "cardId", "tcgdexId", "name" } ] }`
(`skippedCards` = snapshot entries whose print has vanished from the catalog —
near-impossible under `ON DELETE RESTRICT` — reported, never silently dropped).

### GET /pokedex/api/decks/:id/logs
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

### POST /pokedex/api/decks/:id/logs
Body `{ "rawLog" (required, ≤50000), "result"?, "opponent"?, "opponentDeck"?,
"notes"? (≤2000), "playedAt"? (ISO), "playerName"?, "source"? }`. Runs the PTCG
Live parser; parser-derived `result` / `opponent` / `opponentDeck` (deck guess)
fill any fields the caller omitted. Attaches to the deck's **current** version.
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

### GET /pokedex/api/decks/:id/logs/:logId
The full row — same `log` shape as the 201 above (summary fields + `rawLog` +
`parsed` + `createdAt`).

### PATCH /pokedex/api/decks/:id/logs/:logId
Body: any of `{ "result", "opponent", "opponentDeck", "notes", "playedAt" }`.
Metadata only — the raw log and its version attachment are immutable. Explicit
`null` clears everything except `playedAt`. Returns `{ "log": … }` (full shape).

### DELETE /pokedex/api/decks/:id/logs/:logId
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

### GET /pokedex/api/sets/:setId/massentry
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

### GET /pokedex/api/decks/:id/massentry
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
`/pokedex/api` base **before** the `/decks`, `/lists`, `/sets` routers.

### GET /pokedex/api/decks/:id/pdf
A printable deck list for `:id` (UUID). Loads the deck + cards, runs the legality
engine (`validateDeck`, with a reprint oracle for pool-checked formats) for the
verdict, and renders Pokémon/Trainer/Energy sections with owned counts, set codes
(PTCGL alias), per-section counts, distinct-name count, and a generated-at stamp.
`404` for a non-UUID id or a missing deck.

### GET /pokedex/api/lists/:id/pdf
A printable export of list `:id` (UUID). Renders the list items (card rows with
variant label + owned flag; `pokedex_binder` species as `Pokédex #<n>`), the
item/owned counts, and progress for `dynamic`/`pokedex_binder` lists (static
lists have no progress). `404` for a non-UUID id or a missing list.

### GET /pokedex/api/sets/:setId/checklist.pdf
A printable set checklist. One row per card (number, name, rarity, category) with
an owned checkbox; owned = any variant has qty ≥ 1 (the Complete goal's
card-fraction semantics, matching `/sets/:setId`). Header carries set name, id,
series, release date, printed/total counts, and a `{ owned, total, pct }`
progress rollup.

---

## Insights — gamification & collection value

Mounted at `/insights`. Every GET is read-only over the collection; the one write
is `POST /value/snapshot`, which the pokedex-sync daily cron calls over HTTP
(sync must not import this app — its `db.ts` opens a 2-connection pool at module
load). All `private, no-cache`.

### GET /pokedex/api/insights/overview
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

### GET /pokedex/api/insights/value
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

### POST /pokedex/api/insights/value/snapshot
Internal daily snapshot — appends today's per-currency totals to
`collection_value_point` for the default user. Idempotent per
`(user, observed_on, currency)`: a same-day re-run inserts nothing
(`ON CONFLICT DO NOTHING`) and reports `inserted: 0`. Any request body is
ignored. Returns the snapshot result (`{ currencies, inserted, observedOn }`).

### GET /pokedex/api/insights/pokedex
The gamified species grid (a richer view than `/dex`). Query: `generation` (1–9),
`own` = `all`\|`captured`\|`uncaptured` (default `all`), `q` (free text),
`page`/`pageSize` (1–1025, default 200). Returns the grid payload produced by
`insights/pokedex.speciesGrid` (species rows with capture state + level/shiny
roll-ups).

### GET /pokedex/api/insights/pokedex/:speciesId
One species' cards + capture/level/shiny detail. `:speciesId` accepts the numeric
dex id or the slug. `404` when no such species. Returns the
`insights/pokedex.speciesDetail` payload.

---

## Scan — perceptual-hash card matcher

### POST /pokedex/api/scan
Offline card scanner: image → catalog match. Send the **raw image bytes** as the
request body with an `image/*` Content-Type — **not** multipart, **not** base64
(`curl --data-binary @photo.jpg -H 'Content-Type: image/jpeg' …`). Max upload
15 MB. Query: `k` = 1–25 top matches (default 5); `quality` = `low`\|`high`
(which indexed hash set to match against, default `low`).

Computes the query image's 64-bit dHash, ranks the whole indexed hash set by
Hammed distance (0 = identical, 64 = opposite) across multiple rotation/keystone
probes (the min distance wins), and hydrates card metadata for the top `k`.
`matched` is `true` only when the best distance is within the confidence threshold
(9 — re-measured for the multi-probe matcher so ~99.6% of correct scans fire and
every tested junk frame is rejected). Read-only.
```json
{ "query": { "algo": "dhash-64", "hash": "f0e1…08" },
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

### POST /pokedex/api/bugs
The top-nav "Report a bug" button posts here. Persists each report as a folder
under the repo's `issues/` dir (a developer artefact, not user data — the
`fix-issues` skill walks that dir). No DB. Body (JSON, hence the app-wide 12 MB
JSON limit — every other route posts tiny JSON):
`{ "text" (required, ≤20000), "page"? (current route), "userAgent"?, "viewport"?,
"screenshot"? (a `data:image/(png|jpeg|webp);base64,…` URL, ≤8 MB decoded) }`.
`400` when `text` is missing/empty, the screenshot is not a valid image data URL,
or the decoded screenshot exceeds 8 MB.
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
