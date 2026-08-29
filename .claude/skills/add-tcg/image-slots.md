# Image-Slot Catalog

The growable knowledge base of every **image slot** the app renders — one entry per *kind* of
image, with the intelligence to source, cache, optimize, and verify it. TCG-agnostic: slots are
either universal (card art, set logo/symbol) or game-specific (marked). This catalog is:

- **Consumed by `add-tcg`** — when onboarding a new game, warm *every* active slot below.
- **Maintained by the `add-image-slot` skill** — when the user adds a new kind of image to a
  page, that skill appends a new entry here (after the user approves the sourced images), so the
  knowledge persists for future agents and future TCGs. **Append, don't rewrite existing entries.**

## Entry template (copy this for a new slot)

```
### <slot-name> — status: active | proposed
- Purpose / renders: <what it is; which page/component shows it>
- Cardinality: per-card | per-set | per-species | per-artist | per-rarity | global | …
- Cache path: <exact on-disk path>  →  served: <route>
- image_asset kind: <card|set-logo|set-symbol|set-background|sprite|avatar|banner>  · cache_key: <shape>
- Format: webp|png; tiers: <e.g. low+high | single>
- Sourcing: primary <source+URL pattern> → fallback <source>; enumerate work-list from <DB table>
- Optimization: <encode/resize/evict notes>
- Verify: <what to curl / where to look in the browser> + `manifest:check` exits 0
- Game-specific: no | yes (<why>)
- Added: <date> · by: <who> · notes: <e.g. approved samples, residue>
```

Serving is defined by `apps/images/src/{layout,index}.ts` — a new slot must add a route + a
`…AbsolutePath` there and follow the exact cache-path contract, or the miss-placeholder shows.

**Writing is defined by `apps/images/src/store.ts` — the choke point.** Every slot's warmer calls
`putAsset({ cacheKey, kind, relativePath, bytes, provenance })`, which writes the bytes and the
`image_asset` row together. `provenance` is required: `fromUrl(url)` for anything fetched, or
`unknownProvenance('<why>')` when the source truly can't be established — never a guessed URL.
A slot whose bytes land without a row is broken even if it renders: run
`pnpm --filter deckpal-images manifest:check` (exits non-zero on drift) before declaring it done.

Note the two `kind`/`cache_key` values below are the only shapes in use today; a slot needing a
new `kind` outside the migration-006 CHECK list needs an additive migration.

---

## Active slots (seed)

### card-art — status: active
- Purpose / renders: the card image (grid tiles, card detail, binder, scanner). The spine of the UI.
- Cardinality: per-card × quality
- Cache path: `<CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp`  →  served: `GET /deckpal/images/<lang>/<serie>/<set>/<localId>/<low|high>.webp`
- image_asset kind: `card` · cache_key: `card:<setId>-<localId>:<low|high>`
- Format: webp; tiers: **low** (grid + scanner dHash) + **high** (detail).
- Sourcing: primary the catalog CDN (Pokémon: `assets.tcgdex.net/<lang>/<serie>/<set>/<localId>/<q>.webp`). **Fallback ladder revised 2026-08-26 — read `research/CARD-ART-SOURCES.md` before sourcing a gap.** pkmn.gg is **ruled out** (owner's decision, legal grounds) and TCGplayer images are **ruled out** (their terms forbid automated collection outside the API and bar redistribution to end users; new API access is not granted). The approved fallback is **pokemontcg.io** (`images.pokemontcg.io/<setId>/<number>_hires.png`, 600×825 or better — an exact match for the `high` tier; free, public, unauthenticated), which needs a per-set id + numbering crosswalk (e.g. `cel25cc-CC001` → `cel25c/1_A`) and does not carry every set. A public MediaWiki archive (Bulbagarden) remains a possible tertiary but its crosswalk is **unresolved** — free-text search returns confidently wrong printings — so do not use it without solving that first. Enumerate from the `card` table (NOT the source manifest — it omits sets). Warmers: `apps/images/src/warmer.ts` (manifest walk), `warmGaps.ts` (CDN gap probe, disk tier), `cloudWarm.ts` (**the cloud object tier**) — all write via a choke point; `warmFromPkmn.ts` exists but must not be run.
- Optimization: two tiers; LRU cap + evictor on `high` (`apps/images/src/evict.ts`).
- Verify: `curl` served URL → HTTP 200, real bytes (not the ~1 KB placeholder); count `find … -size +2k`; `manifest:check` exits 0.
- Game-specific: no.
- Added: (original build) · notes: feeds the scanner — after warming, `scan:index` + restart `deckpal-api`. 2026-08-07: 1,970 files here had no manifest row; backfilled, and the ad-hoc scripts that caused it were folded into `warmGaps.ts`/`warmFromPkmn.ts`.

### set-logo — status: active
- Purpose / renders: the set wordmark on set pages, set headers, and (as the series icon) the series index.
- Cardinality: per-set
- Cache path: `<CACHE_ROOT>/sets/<setId>/logo.webp`  →  served: `GET /deckpal/images/sets/<setId>/logo.webp`
- image_asset kind: `set-logo` · cache_key: `set:<setId>:logo`
- Format: webp; single.
- Sourcing: the catalog source's set-level logo URL (Pokémon: `card_set` base URLs from TCGdex); enumerate from `card_set`. **Fallback** when `card_set.logo_url` is NULL: the approved crosswalk in `packages/storage/src/setImageFallback.ts` (`setImageFallbackUrl(setId, 'logo')` — 15 approved pairs sourced from pokemontcg.io `.png` files and Bulbagarden) — `apps/images/src/setWarmer.ts` consults it; the catalog column always takes precedence. See `apps/images/src/setWarmer.ts`.
- Optimization: single small asset; graceful client fallback to a text card on 404 (no broken image).
- Verify: `curl /deckpal/images/sets/<setId>/logo.webp` → 200; series index renders the base-set logo.
- Game-specific: no (most TCGs have set/expansion logos).
- Known residue (2026-08-29): 38 logo pairs stay blank — **20 Trainer Kit logos** (`tk-*`/`tk-ex-*` sets
  share one byte-identical generic wordmark; owner decision 2026-08-29, reads as a bug across sets) and
  **12 McDonald's Collection logos** (the `mcd*` logo files are the byte-identical corporate Golden
  Arches, not a set logo; DECISIONS.md 2026-08-10 trademark ruling), plus 6 more (`mee`, `mep`, `xya`,
  `exu`, `ex5.5`, `miscp`) with no approved source. These render `deriveSetTag`; do **not** "complete" the
  crosswalk — see `packages/storage/src/setImageFallback.ts` for the exclusion rulings. The series index
  falls back to the rep set's **symbol** tile (`/api/series.repHasLogo`).


- **Residue, settled 2026-08-29 (second sourcing pass).** 50 of the 90 originally
  missing (setId, kind) pairs are filled from the static crosswalk in
  `packages/storage/src/setImageFallback.ts`. The remaining 40 break down as:
  **12 McDonald's LOGOS** (trademark — nine are one byte-identical 76,597-byte
  corporate mark); **20 Trainer Kit LOGOS** (a dead end proved with bytes:
  pokemontcg.io serves ONE logo for all four EX kits, md5
  `5ee8b8810dc52db8faaf04eefc337bf9`, and Bulbagarden Archives holds no Trainer
  Kit logo files at all, only per-half-deck SYMBOLS); and **8 pairs with no logo
  as a concept** (`mfb` symbol, `miscp` symbol+logo, `mee` logo, `mep` logo,
  `xya` logo, `exu` logo, `ex5.5` logo) — promo aggregates, energy subsets and
  variant groupings, all of which returned nothing across TCGdex in every
  language, Bulbagarden and Wikimedia Commons.
- **Two lessons for the next sweep of this slot.** (1) TCGdex does NOT 404 for a
  missing asset — the request HANGS, so probe with a short deadline and treat a
  timeout as absent, or a sweep stalls and returns nothing. (2) Bulbagarden names
  Trainer Kit symbols after the POKEMON, not the kit (`SetSymbolExcadrill Half
  Deck.png`), so a set-name search misses them; enumerate the category instead.
  That is why two BW Trainer Kit symbols were first reported as upstream gaps and
  then found on a second pass.

### set-symbol — status: active
- Purpose / renders: the small set symbol/icon shown beside a set / on cards.
- Cardinality: per-set
- Cache path: `<CACHE_ROOT>/sets/<setId>/symbol.webp`  →  served: `GET /deckpal/images/sets/<setId>/symbol.webp`
- image_asset kind: `set-symbol` · cache_key: `set:<setId>:symbol`
- Format: webp; single.
- Sourcing: catalog set-symbol URL (`card_set.symbol_url`); enumerate from `card_set`. **Fallback** when `symbol_url` is NULL: `setImageFallbackUrl(setId, 'symbol')` (same crosswalk, `packages/storage/src/setImageFallback.ts`) — 28 approved pairs from pokemontcg.io `.png` + Bulbagarden, including the McDonald's *symbols* (a genuine printed expansion mark, unlike the logos) and MEP. Same warmer family as set-logo.
- Optimization: tiny; 404 → neutral client placeholder.
- Verify: `curl … /symbol.webp` → 200 (some sets legitimately have none → placeholder is correct).
- Game-specific: no.
- Known residue (2026-08-29): 9 symbol pairs stay blank — the Trainer Kit / EX symbols (`tk-bw-e`,
  `tk-bw-z`, `exu`, `ex5.5`, `miscp`), `mfb`'s symbol, `xya`, and the `2023sv`/`2024sv` symbols have no
  approved source; the UI's derived acronym tag is the correct rendering. The McDonald's *logos* are a
  separate residue (see set-logo); the McDonald's *symbols* ARE filled. Do not add to the crosswalk —
  see `packages/storage/src/setImageFallback.ts`.

### species-sprite — status: active
- Purpose / renders: Pokédex grid + species pages — pixel sprite and official-artwork, each with a shiny variant.
- Cardinality: per-species × {pixel|art} × {normal|shiny}
- Cache path: `<SPRITE_ROOT>/[other/official-artwork/][shiny/]<id>.png`  →  served: `GET /deckpal/images/sprites/<pixel|art>/[shiny/]<id>.png`
- image_asset kind: **none — deliberately not tracked.** `SPRITE_ROOT` is a separate tree outside `IMAGE_CACHE_ROOT`, bulk-cloned from one pinned upstream commit, so its provenance is that SHA (recorded in `scripts/fetch-sprites.sh` + `cache/sprites-fetch.log`) rather than a per-file row. `manifest:check` does not scan it — that is correct, not drift.
- Format: png (source is png); single.
- Sourcing: `PokeAPI/sprites` pinned to a commit SHA via `scripts/fetch-sprites.sh`. Enumerate from `dex_species`.
- Optimization: sprites are small pngs; not evicted.
- Verify: Pokédex grid shows real sprites incl. shiny toggle.
- Game-specific: **yes** — the "species/Pokédex" concept is Pokémon's. A game without a species dex simply has no equivalent slot; a different game might introduce its own (e.g. a "character" slot) via `add-image-slot`.

---

## Proposed / future slots

(Empty. The `add-image-slot` skill appends new entries here as they're approved & implemented.)
