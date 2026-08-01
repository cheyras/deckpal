# pokedex-api — read API contract

The React frontend's contract. TypeScript/Express, port **3700**, bound to
`127.0.0.1`; nginx (LAN) / Authelia (remote) is the sole ingress and the only auth
boundary. **Every route is under the `/pokedex/` sub-path** — the app never assumes
the domain root. Reads are cached per §Caching; the **collection write endpoints**
(§Write endpoints) mutate `collection_item` + `collection_event` and recompute the
affected set's `user_set_progress` rows in one transaction. All queries parameterized,
connection budget **2** (shared `@pokedex/db` pool, hard-capped at 3).

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

---

## Write endpoints — collection mutation

The only writers in the app. The single default user owns the collection (no auth;
nginx/Authelia is the ingress). Each mutation runs in **one transaction**: upsert
`collection_item` to the new quantity, append a `collection_event` for the non-zero
delta, then **recompute the affected set's three `user_set_progress` rows** and
return them authoritatively. Idempotent (setting the same quantity writes no event).
Bodies are JSON; all queries parameterized. Responses are `private, no-cache`.

Tier drives which goals a variant advances (SCHEMA §5.3, AUTH-CAPTURES §4/§8/§11):
**Complete** = own the card in ≥1 variant of any tier (card fraction); **Master** =
own each `(card, standard-variant)` pair (over `master_required_variant`);
**Grandmaster** = own each `(card, any-variant)` pair. `totalQuantity` is per-goal
(sum over that goal's counted variants). Dupes = a card whose owned quantity ≥ 2.

**Shared success body** (returned by all three):
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
`card_variant.id`. Body `{ "quantity": N }` (integer 0–100000). Setting 0 keeps a
qty-0 row (SCHEMA §9.1). `404` if the variant doesn't exist; `400` on a bad quantity.

### POST /pokedex/api/collection/variants/:variantId/increment
Adjust the owned quantity by a **signed delta** (default `+1`). Body `{ "delta": N }`
(non-zero integer; floors at 0 — decrementing below 0 is a no-op with `delta:0`).

### POST /pokedex/api/collection/cards/:cardId/have
Tile-level Have/Need toggle. `:cardId` is the card tcgdex id. Body `{ "have": bool }`.
`have:true` owns the primary variant (sets it to 1 only if currently 0; never lowers
a higher quantity). `have:false` zeroes **every** variant of the card (Need = own
nothing). One transaction, one recompute.

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

## Deck intelligence — strategy, versions, battle logs

Additions from migration 019 (SCHEMA §8.7). Decks carry a `version` (int, from 1)
and a `strategyMd` markdown guide; battle logs attach to the version they were
played with. **Auto-bump rule (LOCKED):** a card-list or format change creates a
new version only when the current version already has ≥1 battle log — otherwise
it amends the current snapshot in place. Strategy edits and rename/favorite/cover
changes never bump. All deck writes accept an optional `source` (attribution,
shape `^[a-z0-9][a-z0-9._-]{0,39}$`, default `web`) — **except `POST
/decks/import`, where `source` was already the decklist syntax, so attribution
rides as `writeSource`**. Card ops (`POST/PATCH/DELETE /decks/:id/cards…`, and
`PATCH /decks/:id` when it changes the format) also accept `versionNote` (≤500),
which lands on the resulting `deck_version` row.

Existing payload changes: deck rows in `GET /decks` gain `version` and
`record: { "wins", "losses", "ties" }` (aggregate over **all** versions); the
detail payload's `deck` object gains `version` and `strategyMd`.

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
