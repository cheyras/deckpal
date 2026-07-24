# pokedex-api — read API contract

The React frontend's contract. TypeScript/Express, port **3700**, bound to
`127.0.0.1`; nginx (LAN) / Authelia (remote) is the sole ingress and the only auth
boundary. **Every route is under the `/pokedex/` sub-path** — the app never assumes
the domain root. All routes are read-only, all queries parameterized, connection
budget **2** (shared `@pokedex/db` pool, hard-capped at 3).

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
- **Progress.** Read from `user_set_progress` for the single default user. **Complete
  is a card fraction; Master and Grandmaster are `(card,variant)` pair fractions** —
  the three totals differ (e.g. sv03.5: 207 / 373 / 384). `pct` is one-decimal,
  round-half-up. `setLevel` (0–5) is on the Complete goal only.
- **View state in the URL.** Filter/sort/goal/ownership/pagination are query params
  by design; omit a param to accept its default.
- **Identifiers.** `:setId` and `:cardId` are TCGdex ids (`sv03.5`, `base1`,
  `base1-4`). `:seriesSlug` is the kebab slug (`scarlet-violet`). `:speciesId`
  accepts the numeric dex id **or** the slug (`6` or `charizard`).
- **Errors.** `{ "error": { "code", "message" } }` with status 400 (bad request),
  404 (not found), 500/503 (server/DB). Success bodies are documented per route.
- **Caching.** Pure-catalog responses (`/series`, `/search`) send
  `Cache-Control: public, max-age=…`. Anything mixing in the user's collection or
  prices sends `private, no-cache, must-revalidate`.

---

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
The English-catalogue series list (newest-era ordering via `sortOrder`).
```json
{ "series": [ { "slug": "scarlet-violet", "tcgdexId": "sv", "name": "Scarlet & Violet",
                "firstReleaseOn": "2023-03-31T…", "sortOrder": 18,
                "setCount": 24, "cardCount": 5123 } ] }
```

## GET /pokedex/api/series/:seriesSlug
Sets in a series, each with the three-goal completion summary for the default user.
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
| `q` | free text (card name or number) | — |
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
{ "card": { "cardId":"base1-4","number":"4","printedTotal":102,"name":"Charizard",
            "category":"Pokemon","rarity":"Rare","artist":"Mitsuhiro Arita","hp":120,
            "stage":"Stage2","evolvesFrom":"Charmeleon","retreat":3,"regulationMark":null,
            "releasedOn":"1999-01-09T…",
            "legal": { "standard":false,"expanded":false },
            "flags": { "aceSpec":false,"radiant":false,"prismStar":false,"ruleBox":false },
            "set": { "setId":"base1","name":"Base Set","slug":"base-set" },
            "series": { "slug":"base","name":"Base","tcgdexId":"base" },
            "images": { "low":"/pokedex/images/en/base/base1/4/low.webp","high":"…" },
            "types":["Fire"], "subtypes":[], "tags":[],
            "attacks":[ { "name":"Fire Spin","cost":"…","damage":"100","effect":"…" } ],
            "abilities":[], "weaknesses":[ { "type":"Water","value":"×2" } ], "resistances":[],
            "species":[ { "speciesId":6,"slug":"charizard","name":"Charizard","generation":1 } ] },
  "variants": [
    { "variantId":15,"kind":"holo-unlimited","displayName":"Holofoil","provenance":"Found in Booster Packs",
      "tier":"standard","tierSource":"derived","isPrimary":true,"isSynthesized":false,
      "source":"tcgdex","fillConfidence":null,
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
mapping at all.

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
| `q` | free text | card name or number |
| `sort` | `name`\|`number`\|`price`\|`rarity`\|`released` | default `name` |
| `dir`, `page`, `pageSize` | | `asc`, 1, 60 (max 250) |
| `facets` | `1` | also return the available filter vocabularies |

```json
{ "query": { … echoed … },
  "pagination": { "page":1,"pageSize":60,"total":104,"pageCount":2 },
  "cards": [ { "cardId":"swsh9-154","number":"154","name":"Charizard V","category":"Pokemon",
               "rarity":"Ultra Rare","artist":"…","hp":220,
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
