# PRIOR-ART.md — pokedex

**Research date:** 2026-07-24. Every factual claim below is tagged **[verified: …]** with the URL or
local artefact it came from, or **[unverified]**. Claims carried from
`research/PRIOR-ART-RAW.md` that I could not independently confirm are tagged **[RAW, unconfirmed]**.

Method: `Git-Romer/pokecollector` was shallow-cloned to scratch and read file-by-file (clone deleted
after). TCGdex REST + GraphQL and TCGCSV were queried live. GitHub repo metadata came from the REST
API. PyPI and Docker Hub registry APIs were queried for arm64/aarch64 build viability. No browser was
launched.

---

## 1. Verdict

> **Borrow heavily from `Git-Romer/pokecollector`. Do not fork it. Build the shell clean.**

Concretely: take ~8 backend service modules' worth of hard-won domain logic (§3), and write
everything else — schema, API surface, and the entire front-end — from scratch against `UI-SPEC.md`.

### The three reasons that decided it

**1. Its data model is wrong at exactly the point the brief cares most about — variants.**
pokecollector models variants as four booleans on the card row (`variants_normal`,
`variants_reverse`, `variants_holo`, `variants_first_edition`) plus a free-text `variant` string on
the collection row, and its README states outright that "Variants are now limited to `Normal`,
`Holo`, `Reverse Holo`, and `First Edition`."
[verified: `backend/models.py` L113–116, L155; `README.md` "Collection Management"]
Its `price_history` table is `UNIQUE(card_id, date)` with five EUR-only columns — **no variant
dimension, no currency column, no source column**. [verified: `backend/models.py` L183–197]

The brief (Part C §2) requires independent tracking of "normal, reverse holo, holo, 1st edition,
Pokémon Center / promo stamps, etc." and per-variant price history. Retrofitting that into
pokecollector means rewriting `models.py`, all ~25 price columns, `price_utils.py`,
`card_values.effective_market_price`, `sync_service`, `analytics`, and every price surface in the
front-end. That is not a fork; that is a rewrite wearing a fork's clothes.

Worse, the data we need is *already free and pokecollector ignores it*: TCGdex ships a
`variants_detailed` array per card carrying `type` / `subtype` / `size` / **`stamp`** / **`foil`**.
A single query over set `svp` returns stamps including `pokemon-center`, `staff`, `worlds-2024`,
`player-rewards-program`, `set-logo`, `gamestop`, `eb-games`, and foils `cosmos` / `gold` / `galaxy`
/ `league`, plus variant types beyond the four booleans (`metal`, `lenticular`).
[verified: `POST https://api.tcgdex.net/v2/graphql` — `cards(filters:{id:"svp-"}){variants_detailed{type subtype size stamp foil}}`]
`grep -rn "variants_detailed"` over the entire pokecollector tree returns **zero hits**.
[verified: local clone]

**2. Three of the brief's headline features do not exist in it at all.**
- **No deck builder.** Zero deck code; `grep -rni "deck"` matches only wishlist-binder helper text.
  [verified: local clone]
- **No PTCG Live import/export.** Its own UI strings say "No external decklist formats are parsed
  automatically." [verified: `frontend/src/i18n/*.js` `csvImportErrorBehavior`]
- **No 9-pocket binder.** `BinderCard` has no page or slot column — only
  `(binder_id, card_id, collection_item_id, required_quantity, added_at)` — and `BinderDetail.jsx`
  renders a responsive tile grid (`grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8`), not a
  paginated pocket layout. [verified: `backend/models.py` L216–230; `frontend/src/pages/BinderDetail.jsx` L699]
  pokecollector's "virtual binders" are named card lists with required quantities, not the
  signature pkmn.gg binder.

There is also **no "Buy on TCGplayer" link anywhere** — the only outbound commerce links are
Cardmarket search URLs. [verified: `frontend/src/utils/cardmarket.js`; `grep -rn "tcgplayer.com"` → 0 hits]

So a fork buys collection CRUD and set browsing, and buys nothing for the four features that make
this a pkmn.gg clone rather than another collection tracker.

**3. The front-end is a total loss for our purposes, and it is the bulk of the repo.**
~40 JSX pages/components in **plain JavaScript, no TypeScript**, plus 20 hand-maintained i18n files,
built around its own visual language (9 Pokémon-type colour themes, portal nav, bottom nav).
[verified: `frontend/package.json`; `git ls-files`] Our Phase-1 contract is a `UI-SPEC.md` derived
from observing pkmn.gg. Every one of those files would be deleted or rewritten. Keeping the fork
means inheriting the build (`vite ^8`, `@vitejs/plugin-react ^6`, Tailwind 3) and the JS-not-TS
decision for no benefit.

### The strongest counter-argument

**The AGPL is not the blocker, and I am not recommending "clean-room" out of legal caution.**
For a single-user, LAN-only deployment the AGPL costs essentially nothing (§6), and the brief has
already blessed AGPL compliance. If the user's real priority is *time to working app* over
*architectural fit*, forking is defensible: pokecollector is 34★, 16 forks, pushed daily, has 30
backend tests, working `pg_dump` backup/restore, CSV+PDF export, sealed-product P&L, portfolio
snapshots, and a Pokédex — a lot of finished surface.
[verified: `https://api.github.com/repos/Git-Romer/pokecollector`; `backend/tests/` = 30 files]

The honest rebuttal is that the fork's finished surface is the *easy* half. Collection CRUD over a
card catalogue is a weekend. The variant model, the deck builder, the binder, and the pkmn.gg visual
language are the hard half, and the fork helps with none of them while actively fighting the first.
Its own README opens with "Everything below (and in this repo) is unapologetically vibecoded. Expect
vibes, not guarantees." [verified: `README.md` L1–3] That is a fair self-assessment of a codebase
whose Alembic dependency is declared but unused (§4).

### Decision the user must make at the Phase-1 checkpoint (one-way door)

Because we are borrowing from AGPL-3.0 code, pick a lane **before** any code is written:

- **Lane A (recommended).** Licence the pokedex repo **AGPL-3.0** and allow verbatim porting of
  specific pokecollector modules with attribution. Cheapest, fastest, fully compliant, and for a
  private single-user box the copyleft never bites (§6).
- **Lane B.** Keep the repo MIT/proprietary and take **zero lines** — reimplement from documented
  behaviour only. Facts, APIs, feature lists, and algorithms are not copyrightable; only the
  expression is. Costs maybe 2–3 extra days across the items in §3.

Lane A is the recommendation. Lane B is the right call only if the user might one day relicense,
publish, or commercialise this.

---

## 2. Per-project profiles

### 2a. `Git-Romer/pokecollector`

| Field | Value |
|---|---|
| Exists / public / archived | **Yes / public / not archived** [verified: api.github.com] |
| Stars / forks / watchers | 34 / 16 / 4 [verified] |
| Open issues | **0 real issues** — the 3 "open issues" are all PRs (#295, #296, #298) [verified: `/issues?state=open`] |
| Created / last push | 2026-02-21 / **2026-07-22** (2 days before scan) [verified] |
| Version | `v1.23.7` [verified: `VERSION`] |
| **Licence** | **AGPL-3.0** — real `LICENSE` file, full GNU AGPL v3 text [verified: `LICENSE` L1–2; API `license.spdx_id == "AGPL-3.0"`] |
| Repo size | ~7.3 MB checkout, 219 tracked files [verified: local clone] |
| Live demo | `https://pokecollector.romerg.de/` [verified: API `homepage`] |
| Self-description | "unapologetically vibecoded" [verified: `README.md`] |

**Stack (from manifests, not the README)**

- Backend: **Python 3.11** (`FROM python:3.11-slim`), FastAPI 0.109.2, SQLAlchemy 2.0.27,
  psycopg2-binary 2.9.9, APScheduler 3.10.4, httpx 0.26.0, pandas 2.2.0, reportlab 4.1.0,
  Pillow 12.3.0, openpyxl 3.1.2, slowapi 0.1.9, python-jose, bcrypt, **alembic 1.13.1 (declared but
  unused)**. [verified: `backend/requirements.txt`, `backend/Dockerfile`]
- Front-end: React 18.2, Vite ^8, Tailwind 3.4, TanStack Query 5, react-router-dom 6, recharts 2.12,
  axios, lucide-react, date-fns. **Plain JS/JSX, not TypeScript.** [verified: `frontend/package.json`]
- DB: **PostgreSQL 18** (`postgres:18-alpine`), volume at `/var/lib/postgresql` with a guard script
  that refuses to boot on a PG<18 data dir. [verified: `docker-compose.yml`]
- Compose: 3 services — `postgres` (no host port published), `backend` (host **8000**),
  `frontend` (host **3000**, nginx serving the Vite build). [verified: `docker-compose.yml`]

**Python 3.13 / aarch64 viability — the answer to Part B §7**

The question is moot: **pokecollector pins Python 3.11 inside its own container**
(`FROM python:3.11-slim`), so the Pi's system Python 3.13 is irrelevant to it. [verified: `backend/Dockerfile`]

If we nonetheless wanted to run these exact pins on Python 3.13:

| Package | cp311 aarch64 wheel | cp313 aarch64 wheel | Note |
|---|---|---|---|
| psycopg2-binary 2.9.9 | ✅ manylinux_2_17 | ❌ **none** | needs ≥2.9.10; 2.9.12 has cp313 aarch64 |
| pandas 2.2.0 | ✅ manylinux_2_17 | ❌ **none** | needs ≥2.2.3; source build on a Pi is a 30–60 min OOM risk |
| pillow 12.3.0 | ✅ | ✅ | fine |
| SQLAlchemy 2.0.27 | ✅ | ❌ | pure-Python fallback exists; bump anyway |
| cryptography 49 | ✅ (abi3) | (abi3 covers it) | fine |
| reportlab 4.1.0, openpyxl, uvicorn, fastapi, apscheduler, httpx | pure-Python (`py3-none-any`) | same | fine |

[verified: `https://pypi.org/pypi/<pkg>/<ver>/json` filename inspection]

**Conclusion:** on aarch64, pin **Python 3.11 in-container** (as pokecollector does) and every
dependency installs from a prebuilt wheel with no compiler. If we prefer 3.13, we must bump
psycopg2-binary→≥2.9.12 and pandas→≥2.2.3 (or drop pandas — it is used only for export).

**arm64 image variants — all four confirmed**

| Image | `linux/arm64/v8` present? |
|---|---|
| `python:3.11-slim` | ✅ [verified: registry-1.docker.io manifest list] |
| `postgres:18-alpine` | ✅ [verified] |
| `node:20-alpine` | ✅ [verified] |
| `nginx:alpine` | ✅ [verified] |

One non-obvious risk that checks out: the backend Dockerfile adds the PGDG apt repo and installs
`postgresql-client-18` (needed for the `pg_dump` backup endpoint). **PGDG publishes arm64** for both
bookworm and trixie. [verified: `Architectures: amd64 arm64 ppc64el` in
`http://apt.postgresql.org/pub/repos/apt/dists/bookworm-pgdg/Release`]

Caveat: there are **zero prebuilt images** and **zero mentions of arm64/aarch64/Raspberry Pi**
anywhere in the repo. [verified: `grep -rni "arm64|aarch64|raspberry|arm/v"` → 0 hits; release
workflow publishes a GitHub Release, not a container image] So `docker compose up` on the Pi means
compiling the front-end with Vite on the Pi — a real, if survivable, cost.

**Its DB schema for variants and price history — the part most worth studying, and the part most
worth *not* copying**

```
cards      id = "{tcgdexId}_{lang}"   -- composite PK, e.g. "sv1-1_de"
           tcg_set_id / set_id joined in Python; the FK was DROPPED to allow composite keys
           variants_normal / variants_reverse / variants_holo / variants_first_edition  (4 booleans)
           ~25 flat price columns:  Cardmarket EUR  (market/low/mid/high/trend/avg1/avg7/avg30
                                                     + the same six again with a _holo suffix)
                                    TCGplayer USD   (normal/reverse/holo × low/mid/high/market)
           image_source_lang / data_source_lang / price_source_lang   -- "this value was borrowed"
           last_price_sync_attempt_at / last_price_sync_success_at
           playable_fingerprint, regulation_mark, dex_ids (JSONB), cardmarket_products (JSONB)

collection (card_id, user_id, quantity, condition, variant TEXT NOT NULL DEFAULT 'Normal',
            purchase_price, lang)         -- variant is free text; no FK to a variants table

price_history (card_id, date, price_low, price_mid, price_high, price_market, price_trend)
               UNIQUE(card_id, date)      -- NO variant, NO currency, NO source, EUR only
```
[verified: `backend/models.py`]

Two silent traps in the price columns: `price_market` and `price_mid` are **both** assigned
`cardmarket.avg`, and `price_high` is assigned `cardmarket.avg30` — the column names do not mean
what they say. [verified: `backend/services/pokemon_api.py::extract_prices`]

**How its image cache works — and the RAW doc is wrong about this**

pokecollector does **not** hotlink. `backend/api/images.py` is a caching reverse-proxy:

- Routes `GET /images/card/{card_id}/{small|large}` and `GET /images/set/{set_id}/{logo|symbol}`.
- On miss it fetches the upstream TCGdex URL with httpx and stores the bytes in a **Postgres
  `image_cache` table as `BYTEA`** (`image_key VARCHAR UNIQUE`, `data BYTEA`, `content_type`,
  `cached_at`). Key format `card:{card_id}:{size}:{sha1(url)}` / `set:{set_id}:{logo|symbol}`.
- Serves with `Cache-Control: public, max-age=86400`.
- Falls back: missing card art → 307 redirect to `/cardback.jpg`; missing set logo → a bundled
  `pokemon-logo.svg`; cross-language sibling lookup for set logos when
  `cross_language_image_fallback` is on.
- User-supplied `custom_image_url` goes down a hardened path: HTTPS-only validation
  (`services/image_url_security.py`), manual redirect following capped at 3 hops with re-validation
  at each hop, streamed read with an **8 MiB** ceiling enforced both by `Content-Length` and by
  running total, and a `content-type: image/*` check.

[verified: `backend/api/images.py`; `backend/models.py::ImageCache`; `backend/database.py` migration
creating `image_cache`]

**Path layout: none — it is not on disk. Eviction: none. Size cap: none.** There is no TTL, no LRU,
no prune job, and no configured maximum. The only disk-based cache is a separate one for Pokédex
sprites/artwork at `DECKSCOUT_IMAGE_CACHE_DIR=/app/data/deckscout-images`. [verified: `docker-compose.yml`,
`backend/scripts/cache_pokedex_images.py`]

> **Correction to `PRIOR-ART-RAW.md`:** the RAW doc states "Both also hotlink card images from
> `assets.tcgdex.net` rather than caching them locally." That is **false for pokecollector**
> [verified: `backend/api/images.py`]. The RAW doc then leans on that false premise to argue
> hotlinking "eliminates the multi-GB local image cache" and "solves a hardware problem at the same
> time." The hardware recommendation may still be right, but the evidence cited for it is not.
> (pokecollect's behaviour is **[RAW, unconfirmed]** — I did not re-read that repo.)

**How it consumes TCGdex pricing, including the fallback rules**

- Source: `https://api.tcgdex.net/v2/{lang}` REST. Prices are read from `card.pricing.cardmarket`
  (EUR) and `card.pricing.tcgplayer.{normal|reverse-holofoil|holofoil}` (USD).
  [verified: `services/pokemon_api.py::extract_prices`; live sample below]
- **Prices are only available on the per-card detail endpoint.** I confirmed this against the live
  API: `GET /v2/en/sets/swsh3` returns 201 cards, and **not one** carries `pricing` or `variants` —
  the brief card objects are `{id, image, localId, name}` only.
  [verified: `https://api.tcgdex.net/v2/en/sets/swsh3`]
  There is no batch price endpoint, and GraphQL's `Card` type has **no `pricing` field at all**
  [verified: GraphQL introspection of type `Card`]. So pricing is **1 HTTP request per card**.
- That constraint is why the whole sync design exists. pokecollector never prices the full
  catalogue. It prices **only cards you own / wishlist / have in a binder** (plus cards in "pinned"
  set+language pairs), through a bounded fair queue — see §3 item 1.
- **Selection rule** (`services/card_values.py::effective_market_price`): user setting
  `price_primary` picks the base field (`trend` default; also `market`/`avg`/`avg1`/`avg7`/`avg30`/
  `low`). If the owned variant is **Reverse Holo**, try `<field>_holo` → `<field>` →
  `price_market_holo` → `price_market`. Otherwise `<field>` → `price_market`. Zero and non-positive
  values are treated as **missing**, not as a price of €0.
- **Staleness rule** (`services/price_utils.py::preserve_existing_prices_for_invalid_update`): an
  incoming payload never overwrites a good stored price with `None`, `0`, `NaN`, or `inf`; a
  cross-language *fallback* price never overwrites a *native* price.
- **Cross-language fallback** (`services/card_fallbacks.py`, 462 lines) fills missing
  image/metadata/price from a sibling language row and stamps `*_source_lang` so the UI can badge it.

**The `-holo` semantics — pokecollector is right, and it matters**

pokecollector's docstring asserts that TCGdex/Cardmarket's `*-holo` fields are Cardmarket's
**reverse/alternate listing**, not "the price when the card's finish is holo." I verified this
directly: card `swsh3-136` has `variants: {holo: false, reverse: true, normal: true}` yet its
`pricing.cardmarket` block carries `avg-holo: 0.31, low-holo: 0.04, trend-holo: 0.34, avg1-holo,
avg7-holo, avg30-holo`. A card with **no holo variant** cannot have a holo price; those fields are
the reverse-holo listing. [verified: `https://api.tcgdex.net/v2/en/cards/swsh3-136`]

The RAW doc reports that **pokecollect does the opposite** — uses `*-holo` for true holo and
explicitly excludes reverse **[RAW, unconfirmed]**. If that description is accurate, pokecollect
misprices every reverse-holo card. Either way: **adopt pokecollector's rule and pin it with a
regression test using `swsh3-136` as the fixture.**

**What it does better than we would from scratch:** the price-sync fair queue with starvation
avoidance and no-price cooldown; the price-preservation guard; the reverse-holo pricing rule; the
`playable_fingerprint` reprint-equivalence hash; `pg_dump`-based backup/restore; Postgres advisory-
lock mutual exclusion for long syncs; cross-language fallback with provenance stamps; sealed-product
cost-basis ledger with realized/unrealized P&L. All detailed in §3.

### 2b. `Trust1509/pokecollect`

| Field | Value |
|---|---|
| Exists / public / archived | Yes / public / not archived [verified: api.github.com, re-checked 2026-07-24] |
| Stars / forks | 2 / 0 [verified] |
| Last push | 2026-07-19 [verified] |
| GitHub `language` | TypeScript [verified] |
| **Licence** | **NONE.** API returns `"license": null` and `GET /repos/Trust1509/pokecollect/license` returns **HTTP 404**, despite the README claiming MIT. [verified — re-confirmed today] |

I did **not** re-clone or re-read this repo; the RAW doc already did a thorough pass. Everything
below is **[RAW, unconfirmed]** by me, forwarded because the RAW doc read it from manifests:

- Stack: FastAPI 0.111 / SQLAlchemy 2.0.31 / Postgres 16.3-alpine backend; Next.js 14.2.5 + React 18
  front-end; APScheduler; pytesseract; optional Cardmarket OAuth. Host ports 3010/3011.
- **arm64 / Pi viability [unverified].** Its compose file hardcodes volumes to
  `/mnt/HDDs/Applications/pokecollect/...` (a TrueNAS path) and runs everything as uid/gid 3010,
  so it needs editing for any other host. `postgres:16.3-alpine` has arm64 [unverified — I checked
  `postgres:18-alpine`, not 16.3]. A Next.js production build on a Pi is heavier than a Vite build.
- **The entire source is in German** — identifiers, comments, ADRs (`PreisHistorie`, `folierung`).
- What it does better than we would from scratch: a genuinely positioned **binder** (configurable
  1×1–4×4 pages, drag-and-drop between slots, swipe-to-flip, and filters that **dim** non-matching
  cards instead of removing them so every card keeps its physical slot); a scan pipeline that asks
  the vision model for the four card **corners** so the client can do a homography de-skew; a
  machine-readable scan error taxonomy; and "never write 0 for a missing price."

**Blocking problem: it is unlicensed.** Public visibility on GitHub grants only view-and-fork *on
GitHub*; it is otherwise all-rights-reserved. We can read it for ideas — facts and approaches are
not copyrightable — but we cannot take code. The RAW doc's suggestion to open an issue asking the
author to add a `LICENSE` file remains cheap and worth doing.

**Net for us:** pokecollect is the only project with a real binder, and it is the one project whose
binder code we may not use. Read it for behaviour; implement ours from the observed pkmn.gg spec.

---

## 3. Steal list

Ranked by (value × how hard it would be to rediscover). Costs assume Lane A (verbatim port with
attribution); add ~50% for Lane B (reimplement from the description below).

**1. The bounded fair price-sync queue.**
*What:* `backend/services/sync_service.py::_price_sync_plan` (~170 lines) + the constants block
(L21–28). Builds the candidate set from collection ∪ wishlist ∪ binder (∪ pinned set/lang pairs),
sizes the per-run cap as `clamp(ceil(0.75 × tracked_cards), 1000, 5000)`, splits it 70/30 between
never-priced and refresh-rotation cards, applies a **24 h cooldown** to cards that keep returning no
price so permanently-unpriced upstream rows cannot monopolise every run, sorts deterministically
(oldest attempt first, then most-recently-added, then id), and chunks the DB `IN (...)` at 400 to
stay under parameter limits.
*Why:* TCGdex has no batch price endpoint (verified above), so this is the only shape that works.
The code carries its own bug post-mortem in the docstring: the previous version put IDs through a
Python `set` and sliced the first 500, and "set iteration order is not stable, so larger collections
could leave some cards unsynced forever by accident." That is a bug we would otherwise ship
ourselves. *Port cost:* ~1 day, including re-keying from `card_id` to `(card_id, variant_id)`.

**2. `preserve_existing_prices_for_invalid_update` + `is_valid_price`.**
*What:* `backend/services/price_utils.py` (103 lines). A price is usable only if it is a finite float
`> 0`. An incoming payload never overwrites a stored good price with null/0/NaN/inf, and a
cross-language fallback price never overwrites a native one.
*Why:* TCGdex set endpoints return brief card objects with no pricing, and outages return zeros.
Without this guard your portfolio total silently craters. Both leading projects independently
converged on "never write 0." *Port cost:* ~2 hours.

**3. The reverse-holo price-selection rule + its regression fixture.**
*What:* `backend/services/card_values.py::effective_market_price` (70 lines) — the
`REVERSE_HOLO_VARIANTS` / `HOLO_FIELD_MAP` fallback chain, treating 0 as missing.
*Why:* verified above that TCGdex's Cardmarket `*-holo` fields are the *reverse* listing. Getting
this backwards misprices every reverse holo in the collection, and reverse holos are roughly half of
most modern sets. Pin it with `swsh3-136` (`holo:false, reverse:true`, has `*-holo` prices).
*Port cost:* ~1 hour. Highest correctness-per-minute item on this list.

**4. `playable_fingerprint`.**
*What:* `backend/services/card_gameplay.py` (~140 lines). SHA-256 over a canonically-serialised,
whitespace/case-normalised payload of `{name, category, hp, types, stage, suffix, evolveFrom,
trainerType, energyType, effect, attacks[], abilities[], weaknesses[], resistances[], retreat}`, with
a guard that refuses to fingerprint brief list responses (`_has_full_gameplay_data`) so weak
fingerprints never enter the index.
*Why:* this is "same playable card, different print" as a primitive — and it is exactly what our
**deck builder** needs. The 4-copy rule counts by card identity, not by printing; "buy the missing
cards" must treat any print as satisfying the slot; and rotation legality propagates to old prints
when a card is reprinted with a legal regulation mark (which is precisely how pokecollector's
`standard_legal_fingerprints` works). *Port cost:* ~half a day. Highest leverage for our #1
differentiator.

**5. `pg_dump`-based backup/restore, plus the arm64-safe way to get the client binary.**
*What:* `backend/api/backup.py` (184 lines) shells out to `pg_dump` and streams the result; the
backend Dockerfile installs `postgresql-client-18` from the PGDG apt repo (verified arm64-available)
so the client major version matches the server. Restore is a matching endpoint.
*Why:* satisfies brief §5's "one-command DB dump, restorable on a fresh Pi" directly, and the
version-matching detail is the thing people get wrong. *Port cost:* ~2 hours.

**6. Postgres advisory-lock mutual exclusion for long syncs.**
*What:* `sync_service._full_sync_lock` — `pg_try_advisory_lock(0x506F6B6546756C6C)` taken on a
**dedicated connection** (because the sync commits repeatedly mid-run, which would drop a
transaction-scoped lock or return a session lock to the pool early), with `lock_conn.invalidate()`
if the unlock fails; plus a `sync_log` "running row older than 60 min is orphaned" cutoff so a
crashed sync can never wedge the scheduler forever.
*Why:* on a Pi that reboots, this exact failure mode will happen. *Port cost:* ~2 hours.

**7. Provenance stamps for borrowed data.**
*What:* `image_source_lang` / `data_source_lang` / `price_source_lang` columns on the card row, set
by `services/card_fallbacks.py` whenever a value is filled from a sibling-language row, plus the
rule that a native value always beats a borrowed one and a later native sync clears the stamp.
*Why:* multi-language card data is full of holes; without provenance you cannot tell "we have no
German art" from "we borrowed the English art," and the UI cannot badge it honestly.
*Port cost:* ~half a day (the concept, not the 462-line file).

**8. The two-tier scheduler split.**
*What:* `services/scheduler.py` — APScheduler with two independent interval jobs (full catalogue
sync default every 5 days; price-only sync default every 30 min), both intervals read from the DB
`settings` table and both live-reschedulable via `scheduler.reschedule_job`, and an initial full sync
fired at boot **only when `cards` is empty**.
*Why:* maps 1:1 onto brief §3c, and "config in the DB, reschedulable at runtime" beats env-var-only
config for a box you do not want to restart. *Port cost:* ~3 hours.

**9. The sealed-product cost-basis ledger.**
*What:* `ProductPurchase` → `ProductCard` (`initial_quantity` / `active_quantity` / `sold_quantity`
with four `CheckConstraint`s enforcing `active + sold <= initial`) → `ProductLedgerEntry`
(append-only, denormalised card name/set/number so history survives), with `product_cards.
collection_item_id` **deliberately not a FK** so sold-card history outlives the collection row.
*Why:* correct double-entry-ish modelling for "I opened a box, pulled these, sold two." Only project
in the scan that does it. Optional for MVP; steal it if sealed tracking is in scope.
*Port cost:* ~1 day.

**10. Composite `{tcgdexId}_{lang}` keying — take the idea, reject the implementation.**
*What:* the multi-language modelling decision (one row per card *per language*).
*Why the caveat:* pokecollector had to **drop the `cards.set_id` FK constraint** to make composite
string keys work and now joins Set↔Card in Python with `viewonly=True` relationships and explicit
`primaryjoin`. Take the concept; implement it as a proper composite PK `(tcgdex_id, lang)` or a
surrogate integer PK with a unique index, and **keep the foreign keys**. *Port cost:* n/a — a design
note, not code.

### Items to build *better* than pokecollector (verified opportunities)

- **Bulk catalogue metadata via GraphQL.** pokecollector enriches card metadata with one REST call
  per card, capped at 2000 cards per full sync (`MAX_METADATA_CARDS_PER_FULL_SYNC`), so a full
  catalogue takes many sync cycles. A single GraphQL query returns **all 201 cards of `swsh3`** with
  `rarity`, `regulationMark`, `legal{standard expanded}`, and `variants_detailed{type subtype size
  stamp foil}`. [verified: `POST /v2/graphql` with `cards(filters:{id:"swsh3-"}, pagination:
  {itemsPerPage:250})`] Whole catalogue ≈ one request per set (~180–220) instead of ~23,000.
  Caveat: GraphQL exposes **no `pricing`** and `CardsFilters` has **no `set` field** — the working
  trick is the prefix-matching `id` filter. [verified: introspection of `CardsFilters`]
- **Model variants from `variants_detailed`, not from four booleans** (see §1).
- **Use TCGCSV as the primary USD price feed** (see §7) — pokecollector has zero TCGCSV code.
- **Cap and evict the image cache, and keep it off Postgres** (see §4).

---

## 4. Do-not-copy list

| # | Item | Why not |
|---|---|---|
| 1 | **`ImageCache` as Postgres `BYTEA`, uncapped** | No TTL, no LRU, no prune job, no size ceiling [verified: `models.py`, `api/images.py`, `database.py`]. On a 119 GB microSD with ~65 GB free this grows without bound; every image read is a DB round-trip that loads the whole blob into the FastAPI process; and `pg_dump` backups then include the entire image corpus, so backup size tracks cache size. Use a size-capped, LRU-pruned **filesystem** cache with the DB holding only metadata. |
| 2 | **The migration strategy** | `alembic==1.13.1` is in `requirements.txt` but there is **no `alembic/` directory and no migration files** [verified: `git ls-files`]. Schema is `create_all` plus ~108 hand-ordered raw SQL strings in `database.py::_run_migrations`, Postgres-dialect-locked (`ADD COLUMN IF NOT EXISTS`, `CREATE EXTENSION unaccent`). Same anti-pattern the RAW doc flagged in pokecollect. Use real Alembic revisions. |
| 3 | **The dead `grade` column** | `ALTER TABLE collection ADD COLUMN IF NOT EXISTS grade VARCHAR DEFAULT 'raw'` runs on every boot, but `grade` appears **nowhere** in `models.py` or `schemas.py` [verified: `grep -rn "grade"` → 0 hits in either]. Direct evidence of drift between the migration list and the ORM. |
| 4 | **The four-boolean variant model + free-text `collection.variant`** | See §1. Structurally incompatible with the brief, and it throws away `variants_detailed`. |
| 5 | **`price_history UNIQUE(card_id, date)` with EUR-only columns** | No variant, no currency, no source. Our history table must be keyed `(card_id, variant_id, source, date)` with an explicit currency. |
| 6 | **`price_market` == `price_mid` == `cardmarket.avg`; `price_high` == `avg30`** | Column names that lie. [verified: `extract_prices`] |
| 7 | **`get_all_sets()`'s request fan-out** | Per language it fetches `/sets`, then `/series`, then **each series' detail**, then **each set's detail** — on every full sync, with bare `except: pass` swallowing failures. Replace with one GraphQL `sets` query. |
| 8 | **Host port bindings `8000:8000` and `3000:80`** | Both are already taken on this Pi (Gitea on 3000, another service on 8000) per BRIEF Part B §4. Pick from the free block. |
| 9 | **Default credentials** | `POSTGRES_PASSWORD:-changeme` and an empty-defaulting `ADMIN_PASSWORD`. pokecollect's stricter posture (refuse to boot without a password hash) is the right one. |
| 10 | **Multi-user / social surface** | `users`, roles, `api/social.py`, Leaderboard, Compare, Achievements, `api/trades.py`, `services/supporters.py`, `CONTRIBUTORS.csv`/`SUPPORTERS.csv`, Telegram alerts, Gemini scanning. All dead weight on a single-user box, and every one is another `user_id` column threaded through the schema. |
| 11 | **The whole front-end** | Plain JS/JSX, 20 hand-maintained i18n files, its own design language. Our contract is `UI-SPEC.md`. |
| 12 | **pokecollect — any code at all** | Unlicensed = all rights reserved. [verified: `/license` → HTTP 404] Read for behaviour only. |
| 13 | **`1vcian/Pokemon-TCGP-Card-Scanner` — any code** | Unlicensed [verified: `license: null`]. The browser pHash *technique* is public knowledge; a clean-room implementation from the published algorithm is fine, copying the repo is not. |

---

## 5. Gap analysis vs pkmn.gg

The RAW doc's four-item hypothesis was (a) binder polish, (b) deck builder with format validation,
(c) Pokédex/levelling gamification, (d) profile/showcase. The RAW doc corrected two of them. I
verified those corrections against pokecollector's actual code, **confirmed (b), (c) and (d), and
partially reversed (a).**

### (a) "They lack binder polish" — **RAW said mostly wrong. Partially reversed: it is solved *once*, in code we may not use.**

The RAW doc concluded binders were "already solved twice — match, don't differentiate," citing
pokecollect's binder *and* pokecollector's "virtual binders." The second half does not hold:
pokecollector's `BinderCard` has **no page and no slot column**, and `BinderDetail.jsx` renders a
responsive tile grid, not a pocket layout. [verified: `models.py` L216–230; `BinderDetail.jsx` L699]
Its binders are named card lists with `required_quantity` — closer to a checklist than a binder.

So the real position is: **one** project (pokecollect) has a genuinely good positioned binder — 1×1
to 4×4 pages, drag-and-drop, swipe-to-flip, and filters that *dim* rather than remove so every card
keeps its physical slot **[RAW, unconfirmed]** — and that project is **unlicensed**, so we cannot
take a line of it.

Revised guidance: we **must build the binder ourselves** (it is a brief §2 first-class feature), but
it is a known-solvable UI problem with a documented reference behaviour, not a research risk. Budget
it as work, not as a differentiator. The dim-don't-remove filter rule is the one behaviour worth
copying wholesale — it is a design decision, not code. Still unclaimed anywhere: shareable binder
permalinks, binder theming/covers, per-slot notes.

### (b) "They lack a deck builder with format validation" — **CONFIRMED, and cheaper than the RAW doc assumed.**

Confirmed against pokecollector's tree: no deck models, no deck endpoints, no decklist parsing, and
its own UI strings state that no external decklist formats are parsed. [verified]

But the RAW doc's claim that "no open-source Standard/Expanded/GLC legality engine was found
anywhere" understates what is freely available. **TCGdex ships legality as data:**

- Every card carries `legal: {standard: bool, expanded: bool}` and `regulationMark`.
  [verified: `https://api.tcgdex.net/v2/en/cards/swsh3-136` → `regulationMark: "D"`,
  `legal: {standard: false, expanded: true}`]
- Both fields are queryable in bulk over GraphQL alongside the rest of the card metadata.
  [verified: bulk `swsh3-` query returning 201 cards with `legal{standard expanded}`]
- pokecollector *reimplements* Standard legality from regulation marks anyway
  (`services/standard_legality.py`, 40 lines: mark ≥ `"H"`, **plus** the clever fallback that an
  older-marked card is legal if any card sharing its `playable_fingerprint` has a legal mark — i.e.
  reprints confer legality on old prints). [verified]

So the remaining hand-built work for the deck builder is much smaller than "a legality engine":

| Format | What we still have to build |
|---|---|
| Standard | Card-level flag comes free from TCGdex. Add deck-level rules: 60 cards exactly, ≤4 copies by *card name* (basic Energy exempt), ≤1 ACE SPEC, ≤1 Radiant, banned list. |
| Expanded | Same, plus the Expanded ban list (a short hand-maintained list). |
| Unlimited | Deck-size + 4-copy rule only. |
| GLC | Fully hand-built: single Pokémon type, **singleton** (1 copy of everything but basic Energy), no rule-box Pokémon (ex/V/VMAX/VSTAR/GX/Prime/EX/Radiant). All derivable from TCGdex `suffix`/`subtypes`/`types`. |

Plus the thing **no open-source project does at all**: joining a decklist to the owned collection to
answer *"can I build this, and what am I missing, and what does the gap cost?"* That is the single
largest genuine differentiator available, and `playable_fingerprint` (§3 item 4) is the primitive
that makes it correct across reprints.

### (c) "They lack Pokédex / levelling gamification" — **RAW's split confirmed.**

- Pokédex completion view: **not a gap.** pokecollector has National Pokédex #001–1025 with
  generation filters, `dex_ids` on the card row, a species→card "representative print" mapping, and
  a locally-cached sprite/artwork pipeline. [verified: `api/pokedex.py`, `services/pokedex*.py`,
  `backend/data/pokedex.json`, `frontend/src/pages/Pokedex.jsx`, `PokedexSpecies.jsx`]
- Social/competitive: **not a gap.** Leaderboard, Achievements and Compare all exist.
  [verified: `frontend/src/pages/{Leaderboard,Achievements,Compare}.jsx`, `backend/api/social.py`]
- **XP / Trainer Level / progression curve: CONFIRMED unclaimed.** No XP, no levels, no streaks, no
  quests anywhere. pokecollector's achievements are flat earned/not-earned, not a curve.

### (d) "They lack profile/showcase" — **RAW's correction confirmed, value confirmed near-zero.**

pokecollector has avatars (Pokémon #1–151 sprites), profile names, roles, and cross-trainer
collection viewing — but all inside one instance, meaningful only in multi-user mode.
[verified: `models.py::User.avatar_id`, `frontend/src/pages/UserCollection.jsx`,
`components/TrainerCard.jsx`] No public permalinks, no federation, no curated showcase. For a
single-user LAN box the value is near zero. Build the *model* so screens render like pkmn.gg's;
do not build the sharing.

### New gaps found in this pass (not in the RAW doc)

1. **Per-variant price history is unclaimed by everyone.** pokecollector's `price_history` is
   `UNIQUE(card_id, date)` with EUR-only columns [verified]. pkmn.gg prices variants independently.
   Cheap to do right at schema-design time, expensive to retrofit. This should be a Phase-2
   non-negotiable.
2. **Nobody uses TCGCSV.** Verified zero TCGCSV references in pokecollector. TCGCSV returns
   per-`productId`, **per-variant** (`subTypeName`) USD prices in **bulk** — 217 Pokémon groups
   [verified: `https://tcgcsv.com/tcgplayer/3/groups`], so the entire USD price universe is ~217
   requests/day vs ~23,000 via TCGdex. That makes "price the whole catalogue daily, not just what I
   own" achievable, which is impossible with the TCGdex-only architecture both leaders use.
3. **Nobody uses TCGdex `variants_detailed`** (`stamp` / `foil` / `subtype` / `size`) — the exact
   data the brief's Pokémon-Center/promo-stamp requirement needs. [verified: §1]
4. **Nobody builds TCGplayer buy links.** pokecollector links only to Cardmarket search
   [verified]. TCGCSV product records include the canonical `url`
   (`https://www.tcgplayer.com/product/42346/pokemon-base-set-alakazam`) and TCGdex's
   `pricing.tcgplayer.{variant}.productId` gives the same ID [verified], so brief §3b's "Buy on
   TCGplayer" is a free lookup, not a scrape.
5. **`tcgdex/price-history` exists and nobody uses it** — see §7. Free historical price backfill.
6. Carried forward from the RAW doc, still believed and still unclaimed: browser-side pHash
   recognition for paper TCG; trade/want-list matching; grading/slab tracking; PTCG Live decklist
   round-trip inside a collection manager.

### Revised gap ranking — (genuinely unclaimed × valuable to a single user on a Pi)

| # | Gap | Status | Why it ranks here |
|---|---|---|---|
| 1 | **Deck builder wired to the owned collection**, with Standard/Expanded/Unlimited/GLC validation and "what am I missing / what does it cost" | Wide open | Largest true differentiator; TCGdex `legal` + `regulationMark` + `playable_fingerprint` make it far cheaper than the RAW doc assumed |
| 2 | **Per-variant modelling and per-variant price history** (from `variants_detailed`) | Wide open | Directly required by the brief; free upstream data; cheap now, brutal to retrofit |
| 3 | **TCGCSV bulk ingest as the primary USD feed** + TCGplayer buy links | Wide open | Removes the per-card price bottleneck entirely; makes whole-catalogue pricing feasible on a Pi |
| 4 | **PTCG Live decklist import/export** | Wide open, cheap | Pure text format; pairs with #1 |
| 5 | **Binder (9-pocket, positioned, dim-don't-remove filters)** | Solved once, in unlicensed code | Must build; brief calls it first-class; known-solvable, not a research risk |
| 6 | **XP / Trainer Level progression loop** | Unclaimed | Cheap and fun; achievements + leaderboards are already taken by the AGPL competitor |
| 7 | Browser-side pHash scanner (LLM only on low confidence) | Proven elsewhere, unclaimed for paper TCG | Optional per brief §2; private, free, offline — beats both leaders' Gemini dependency |
| 8 | Shareable binder/showcase permalinks | Unclaimed | Value ≈ 0 without an audience; single-user box |
| 9 | Pokédex completion view | Table stakes | Both leaders have it; match, do not invest |

---

## 6. Licence compliance plan

### The AGPL-3.0 question, reasoned correctly

**First, a correction to the framing in my own task brief.** AGPLv3 §13 is **not** triggered by
"conveying to users over a network." §13 says that if you *modify* the Program and your modified
version *supports remote network interaction*, you must **prominently offer all users interacting
with it remotely through a computer network** an opportunity to receive the Corresponding Source of
your version, gratis, through a network server. The trigger is **remote interaction (i.e. use)**, not
conveying. That is precisely what makes AGPL different from GPL: GPL obligations attach on
distribution; AGPL adds an obligation that attaches on *hosted use*.

Applying that to this deployment:

| Scenario | §13 / §5 / §6 obligations |
|---|---|
| **Single user, LAN-only, only the user reaches it** | The only "user interacting with it remotely" is the copyright licensee himself. The obligation to offer *him* the source is satisfied trivially — he has the source on his own disk. **Nothing to do.** No publication duty. |
| Exposed via `cheyrasnet.tplinkdns.com` behind Authelia, **and another person logs in and uses it** | §13 bites. Those users must be **prominently offered** the Corresponding Source of the modified version, under AGPLv3, gratis, over a network. Note the offer runs **to those users**, not to the public — a "Source" link in the footer serving a tarball, or pointing at a repo those users can reach (the user's own Gitea would do), satisfies it. Low bar, but it must actually be there. |
| Pushed to a **public** GitHub/Gitea repo, or a Docker image shared | That is **conveying** (§5/§6). Full GPL-family obligations: whole combined work licensed AGPL-3.0, `LICENSE` file included, copyright and licence notices preserved, prominent modification notices, Corresponding Source provided. |
| Reading pokecollector for ideas and taking **zero code** | No obligation at all. Facts, feature lists, API shapes, schema *ideas*, and algorithms are not copyrightable — only the expression is. |

**Practical consequence:** for the deployment the brief actually describes — "private homelab app for
one collector," "never redistribute," "Do not build anything that … is exposed to other users" — the
AGPL costs essentially nothing. The RAW doc's stated mechanism is right, but its recommended posture
("study its feature set and take **zero lines** of its code") is over-cautious for this deployment
and should not be treated as binding. Deciding *not* to fork is the right call for the reasons in
§1 — **stack and feature fit, not licence risk.**

### If we derive from AGPL code (Lane A) — the checklist

Do all of these, at the moment the first ported line lands, not later:

1. **Add `LICENSE`** at the repo root containing the full, unmodified GNU AGPL v3 text.
2. **Licence the whole pokedex work AGPL-3.0.** AGPL is not file-scoped: once ported code is
   combined into the app, the combined work is AGPL when conveyed or §13-offered. Say so in
   `README.md`. This forecloses ever relicensing under MIT — flag it to the user before starting.
3. **Add `NOTICE.md`** (or a `## Attribution` section in `README.md`) naming, per ported module:
   the upstream file path, the upstream project (`Git-Romer/pokecollector`), its author
   (Gilles Romer), the upstream licence (AGPL-3.0), the upstream commit SHA, and what we changed.
4. **Preserve copyright and licence notices** in every ported file, and mark modifications —
   AGPL §5(a) requires prominent notices stating that you changed the files and the date.
5. **Ship a source-offer mechanism now, even though it is currently vacuous.** A `/source` route or
   a footer link that serves the running commit's tarball. Cheap to add on day one; the alternative
   is remembering to add it on the day the user first invites someone through Authelia, which is
   exactly the day nobody remembers.
6. **Keep the pokedex git history clean and public-ready** — if a source offer is ever triggered, the
   Corresponding Source must include build scripts and everything needed to build and run the
   modified version. Do not bury secrets in tracked files.
7. **Record ported provenance in commit messages** (`Ported from Git-Romer/pokecollector@<sha>,
   AGPL-3.0`) so the attribution file can be regenerated from history.

### What we must avoid

- **Never take code from an unlicensed repo.** `Trust1509/pokecollect` [verified: `/license` → 404]
  and `1vcian/Pokemon-TCGP-Card-Scanner` [verified: `license: null`] are all-rights-reserved. Public
  visibility on GitHub grants only view-and-fork *on GitHub*. Their behaviours and algorithms are
  fair game; their expression is not.
- **Never relicense ported AGPL code under MIT**, and never claim the pokedex repo is MIT while it
  contains ported AGPL code.
- **Never mix GPL-3.0 and AGPL-3.0 sources without checking compatibility.** They are compatible in
  one direction via AGPL §13's explicit permission, but it is not symmetric — check before touching
  `marcelpanse/tcg-pocket-collection-tracker` (GPL-3.0) [verified].
- **Do not silently open the Authelia gate to a second person** without shipping the §13 source
  offer first.
- **Separately from software licensing: card art is Nintendo/TPC/Creatures/GAME FREAK copyright.**
  No software licence touches it. Cache for personal use, do not re-serve publicly, and keep the
  robots-blocking posture (pokecollector's `PUBLIC_MODE=false` → `robots-block.txt` +
  `noindex, nofollow` is a sensible pattern to copy [verified: `frontend/Dockerfile`]).
- **TCGdex attribution:** MIT, "not affiliated with Nintendo." Include the MIT notice and credit
  TCGdex in the README.

---

## 7. Other prior art worth knowing

### Data layer — the foundation

| Project | ★ | Licence | Last push | arm64 / Pi | Why it matters |
|---|---|---|---|---|---|
| [`tcgdex/cards-database`](https://github.com/tcgdex/cards-database) | 934 | **MIT** | 2026-07-22 | Ships `Dockerfile` + `docker-compose.yml` + `server/`; Bun-based (`bun.lock`). arm64 **[unverified]** — needs a build test. | The card database *and* the self-hostable API. `tcgdex/distribution` and `tcgdex/compiler` are archived and both point here. This is the correct data source. [verified: repo contents listing; org listing] |
| **[`tcgdex/price-history`](https://github.com/tcgdex/price-history)** | 27 | **NONE** | **2025-06-09** | Data only — no runtime | **Not in the RAW doc, and a real find.** ~1.17 GB of per-card daily historical price data laid out `en/{setId}/{localId}.tcgplayer.json`, keyed by **variant-and-condition** (`holo-nearmint`, `holo-good`, `holo-played`, `holo-poor`, `holo-used`) with `{avg, min, max, count}` per day plus rolled-up `avg`/`avg7`/`avg28`. Prices are integers in cents. Sample `en/base1/4.tcgplayer.json` covers 2022-11-14 → 2024-09-22, 372 data days. [verified: GitHub contents API + raw fetch] **Caveats: unlicensed (all rights reserved), ~13 months stale, and 1.17 GB — sparse-checkout only the sets you own.** Treat as *evaluate-then-ask*, not as a drop-in. |
| [`tcgdex/javascript-sdk`](https://github.com/tcgdex/javascript-sdk) | 41 | MIT | 2026-07-14 | Pure TS | Safe to vendor if we go Node. |
| [`tcgdex/java-sdk`](https://github.com/tcgdex/java-sdk) · [`php-sdk`](https://github.com/tcgdex/php-sdk) | 17 / 13 | MIT | 2026-07-14 / 2026-06-19 | — | Wrong languages for us. |
| [`tcgdex/python-sdk`](https://github.com/tcgdex/python-sdk) | 24 | **NONE** | **2026-06-19** | — | **Unlicensed — do not vendor.** Call the REST/GraphQL API directly, as pokecollector does. (RAW doc listed last push as 2026-07-22; actual is 2026-06-19. [verified]) |
| **[TCGCSV](https://tcgcsv.com/)** | — | No explicit licence; free public re-host of TCGplayer API data | Updated **daily ~20:00 UTC** [verified: site copy + `modifiedOn: 2026-07-23T17:28` on category 3] | HTTP only — arch-irrelevant | Endpoints verified live: `/tcgplayer/categories` (90; **Pokemon = 3**, **Pokemon Japan = 85**), `/tcgplayer/3/groups` (**217 groups**), `/tcgplayer/3/{groupId}/products`, `/tcgplayer/3/{groupId}/prices`. Prices are per `productId` **× `subTypeName`** (`Normal`, `Holofoil`, `Reverse Holofoil`) with `low/mid/high/market/directLow`. Products carry `extendedData` (`Number` = `"001/102"`, `Rarity`, `Card Type`, `HP`, `Stage`, card text, attacks) **and a canonical `url`** — the buy link, free. **Documented limitation: no SKU-level data, therefore no per-condition prices.** [all verified live] |
| [`PokemonTCG/pokemon-tcg-data`](https://github.com/PokemonTCG/pokemon-tcg-data) | 835 | **NONE** | 2026-07-17 | Data only | pokemontcg.io's raw data. Brief §3 rules out depending on pokemontcg.io, and the repo is unlicensed anyway. Listed so nobody rediscovers it and thinks it is an option. [verified] |
| [`open-cards/open-cards`](https://codeberg.org/open-cards/open-cards) | — | — | — | — | On Codeberg. **[RAW, unconfirmed]** — I did not fetch it. |

### Deck formats and validators

| Project | ★ | Licence | Last push | Value |
|---|---|---|---|---|
| [`IceMaD/ptcgl-decklist-parser`](https://github.com/IceMaD/ptcgl-decklist-parser) | 0 | **MIT** | 2025-02-11 | Wrong language (PHP), but the PTCG Live decklist **grammar** is MIT-licensed and portable. The most legally-clean starting point for gap #4. [verified] |
| [`Tishinator/PTCGDeckBuilder`](https://github.com/Tishinator/PTCGDeckBuilder) | 10 | **NONE** | 2026-03-08 | The only working PTCGO **and** PTCGL round-trip found, plus ptcgsim.online export. **Unlicensed — behaviour only.** [verified] |
| **TCGdex `legal{standard, expanded}` + `regulationMark`** | — | MIT (data) | live | Not a repo — the point is that the legality *data* is free and neither leader uses it as such. Reduces gap #1's cost materially. [verified live] |
| `pokecollector/services/standard_legality.py` | — | AGPL-3.0 | 2026-07-22 | 40 lines. The reprint-fingerprint legality rule (an old-marked card is legal if a fingerprint-identical card has a legal mark) is the non-obvious idea. [verified] |
| Limitless decklist docs (`docs.limitlesstcg.com/player/decklists`) | — | docs | — | Reference for the human-readable decklist format. **[RAW, unconfirmed]** |

### Collection managers / UI references

| Project | ★ | Licence | Last push | arm64 | Note |
|---|---|---|---|---|---|
| [`marcelpanse/tcg-pocket-collection-tracker`](https://github.com/marcelpanse/tcg-pocket-collection-tracker) | 153 | GPL-3.0 | 2026-07-17 | TS/browser | Best-maintained project in the space, but it targets TCG **Pocket**, not paper. Its trade-matching UX is the reference for gap "trade matching." [verified] |
| [`whoppercheese/open-binder`](https://github.com/whoppercheese/open-binder) | 2 | **MIT** | 2026-06-17 | Next.js/Drizzle | Cleanest licence+stack combination in the scan. Small and early, but MIT means we can copy freely. Worth a read for Drizzle migration hygiene. [verified] |
| [`poketrax/PokeTrax`](https://github.com/poketrax/PokeTrax) | 25 | MIT | 2024-02-23 | Tauri desktop | Offline-first desktop. **Stale ~2.4 years.** [verified] |
| [`bigbadsora/pokemon_tcg_collector`](https://github.com/bigbadsora/pokemon_tcg_collector) | 1 | MIT | 2025-11-16 | Next.js + FastAPI | Same architecture as the leaders but MIT. Tiny. [verified] |
| [`pedrofurst/pokemon-cardfolio`](https://github.com/pedrofurst/pokemon-cardfolio) | 0 | MIT | 2026-07-20 | Python | Only project touching **grading ROI**. MIT, so borrowable. [verified] |
| [`1vcian/Pokemon-TCGP-Card-Scanner`](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner) | 62 | **NONE** | 2026-05-28 | Browser | Client-side RGB pHash + IndexedDB. Best technical idea in the scan space; **unlicensed**, so clean-room only. [verified] |
| `hj3yoo/mtg_card_detector`, `tranhd95/tcg-scanner`, `em4go/PokeCard-TCG-detector`, `tcgcollector/tcgcollector`, `oddevan/trainerdb`, `Sam-May-Futurelab/CardWizz`, `Boblebol/pokevault`, `petterhj/pjuuldex` | — | — | — | — | Carried from the RAW doc without re-verification. **[RAW, unconfirmed]** |

---

## 8. Corrections and open items from `PRIOR-ART-RAW.md`

**Wrong (verified):**

1. *"Both also hotlink card images from `assets.tcgdex.net` rather than caching them locally."* —
   **False for pokecollector.** `backend/api/images.py` is a caching proxy that stores image bytes in
   a Postgres `image_cache` table. The downstream recommendation ("hotlinking … eliminates the
   multi-GB local image cache … solves a hardware problem at the same time") rests on a false premise
   and needs re-deriving.
2. *"pokecollector ships virtual binders … Two independent projects, both with working binders" →
   "binder mechanics already solved twice — match, don't differentiate."* — pokecollector's
   `BinderCard` has **no page/slot column** and its UI is a tile grid. Solved **once**, in
   unlicensed code. The binder must be built.
3. *"No open-source Standard / Expanded / GLC legality engine was found anywhere. Nothing validates
   rotation …"* — overstated. pokecollector ships card-level Standard legality
   (`services/standard_legality.py`) and **TCGdex publishes `legal{standard, expanded}` and
   `regulationMark` per card**, in bulk over GraphQL. The deck-level rules (60 cards, 4-copy, ACE
   SPEC, banlists) and GLC are still unbuilt — but the gap is smaller and cheaper than described.
4. `tcgdex/python-sdk` last push listed as 2026-07-22; actual **2026-06-19**.

**Unverifiable / not re-checked (do not treat as established):**

5. Everything about `Trust1509/pokecollect`'s internals — its Cardmarket `-holo` mapping, the binder
   dim-filter behaviour, the Gemini `corners` prompt, the deleted Android app, its dependency pins.
   The RAW doc cloned and read that repo; I did not. Its GitHub metadata (exists, public, 2★,
   pushed 2026-07-19, **no licence**) I did re-verify today. Note that if the RAW doc's description
   of pokecollect's `-holo` handling is accurate, it contradicts what I verified live from TCGdex —
   see §2a.
6. `open-cards/open-cards` (Codeberg) — not fetched.
7. Limitless decklist docs, Moss Machine sorting write-up — not fetched.
8. The scanner cluster (`hj3yoo`, `tranhd95`, `em4go`, `tcgcollector`, `oddevan`, `CardWizz`,
   `pokevault`, `pjuuldex`) — metadata not re-verified in this pass.
9. Whether `postgres:16.3-alpine` (pokecollect's pin) publishes arm64. I verified `18-alpine` does;
   16.3 was not checked.
10. Whether `tcgdex/cards-database`'s self-hosted API image builds and runs on aarch64 — **not
    verified**, and it is load-bearing for the architecture. It belongs to the TCGdex-viability
    workstream; do not let it fall through.

**Confirmed by this pass:** pokecollector is AGPL-3.0 with a real LICENSE file; 34★; pushed
2026-07-22; not archived; Python 3.11; PostgreSQL 18; React 18 + Vite + Tailwind + TanStack Query;
leaderboard/achievements/compare exist; sealed-product tracking exists and is unique to it;
pokecollect has **no** licence (`/license` → HTTP 404); `tcgdex/cards-database` is MIT and actively
maintained; both leaders use TCGdex as their sole data source and take Cardmarket prices through it
rather than from Cardmarket directly.
