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
`pnpm --filter deckscout-images manifest:check` (exits non-zero on drift) before declaring it done.

Note the two `kind`/`cache_key` values below are the only shapes in use today; a slot needing a
new `kind` outside the migration-006 CHECK list needs an additive migration.

---

## Active slots (seed)

### card-art — status: active
- Purpose / renders: the card image (grid tiles, card detail, binder, scanner). The spine of the UI.
- Cardinality: per-card × quality
- Cache path: `<CACHE_ROOT>/images/<lang>/<serie>/<set>/<localId>.<low|high>.webp`  →  served: `GET /deckscout/images/<lang>/<serie>/<set>/<localId>/<low|high>.webp`
- image_asset kind: `card` · cache_key: `card:<setId>-<localId>:<low|high>`
- Format: webp; tiers: **low** (grid + scanner dHash) + **high** (detail).
- Sourcing: primary the catalog CDN (Pokémon: `assets.tcgdex.net/<lang>/<serie>/<set>/<localId>/<q>.webp`) → fallback pkmn.gg signed URLs from `api.tcg.gg/…/v1/card/<set>` (`largeImageUrl`→high, `thumbImageUrl`→low — these are **card-level** fields on each card object, NOT inside `variantMap`; pkmn card `number` can be non-numeric and differ from our `local_id`, e.g. `MEW` vs `001` for miscp — match by name then) → tertiary (single oddball cards) a public MediaWiki archive scan (e.g. Bulbagarden Archives: `api.php?list=search&srnamespace=6` → `prop=imageinfo` URL), re-encoded to tier geometry (high 600w / low 245w webp; used for miscp-001 Ancient Mew, TCGdex has no `image` field for it). Enumerate from the `card` table (NOT the source manifest — it omits sets). Warmers: `apps/images/src/warmer.ts` (manifest walk), `warmGaps.ts` (CDN gap probe), `warmFromPkmn.ts` (fallback) — all write via `store.ts`.
- Optimization: two tiers; LRU cap + evictor on `high` (`apps/images/src/evict.ts`).
- Verify: `curl` served URL → HTTP 200, real bytes (not the ~1 KB placeholder); count `find … -size +2k`; `manifest:check` exits 0.
- Game-specific: no.
- Added: (original build) · notes: feeds the scanner — after warming, `scan:index` + restart `deckscout-api`. 2026-08-07: 1,970 files here had no manifest row; backfilled, and the ad-hoc scripts that caused it were folded into `warmGaps.ts`/`warmFromPkmn.ts`.

### set-logo — status: active
- Purpose / renders: the set wordmark on set pages, set headers, and (as the series icon) the series index.
- Cardinality: per-set
- Cache path: `<CACHE_ROOT>/sets/<setId>/logo.webp`  →  served: `GET /deckscout/images/sets/<setId>/logo.webp`
- image_asset kind: `set-logo` · cache_key: `set:<setId>:logo`
- Format: webp; single.
- Sourcing: the catalog source's set-level logo URL (Pokémon: `card_set` base URLs from TCGdex). Enumerate from `card_set`. See `apps/images/src/setWarmer.ts`.
- Optimization: single small asset; graceful client fallback to a text card on 404 (no broken image).
- Verify: `curl /deckscout/images/sets/<setId>/logo.webp` → 200; series index renders the base-set logo.
- Game-specific: no (most TCGs have set/expansion logos).
- Known residue (2026-08-10, #15): TCGdex publishes **no logo for any of the 12 McDonald's Collection
  sets** in any of its 14 languages (CDN 404s on `en|univ/mc/<set>/logo`), so a whole series has none.
  Do **not** fill it from pokemontcg.io — its `mcd*` logos are byte-identical across nine sets and are
  McDonald's *corporate* logo, not a set logo (see DECISIONS.md 2026-08-10 for the trademark line).
  The series index instead falls back to the rep set's **symbol** tile (`/api/series.repHasLogo` says
  which asset exists), and sets with neither get `deriveSetTag`'s year. Same shape for Trainer kits.

### set-symbol — status: active
- Purpose / renders: the small set symbol/icon shown beside a set / on cards.
- Cardinality: per-set
- Cache path: `<CACHE_ROOT>/sets/<setId>/symbol.webp`  →  served: `GET /deckscout/images/sets/<setId>/symbol.webp`
- image_asset kind: `set-symbol` · cache_key: `set:<setId>:symbol`
- Format: webp; single.
- Sourcing: catalog set-symbol URL; enumerate from `card_set`. Same warmer family as set-logo.
- Optimization: tiny; 404 → neutral client placeholder.
- Verify: `curl … /symbol.webp` → 200 (some sets legitimately have none → placeholder is correct).
- Game-specific: no.

### species-sprite — status: active
- Purpose / renders: Pokédex grid + species pages — pixel sprite and official-artwork, each with a shiny variant.
- Cardinality: per-species × {pixel|art} × {normal|shiny}
- Cache path: `<SPRITE_ROOT>/[other/official-artwork/][shiny/]<id>.png`  →  served: `GET /deckscout/images/sprites/<pixel|art>/[shiny/]<id>.png`
- image_asset kind: **none — deliberately not tracked.** `SPRITE_ROOT` is a separate tree outside `IMAGE_CACHE_ROOT`, bulk-cloned from one pinned upstream commit, so its provenance is that SHA (recorded in `scripts/fetch-sprites.sh` + `cache/sprites-fetch.log`) rather than a per-file row. `manifest:check` does not scan it — that is correct, not drift.
- Format: png (source is png); single.
- Sourcing: `PokeAPI/sprites` pinned to a commit SHA via `scripts/fetch-sprites.sh`. Enumerate from `dex_species`.
- Optimization: sprites are small pngs; not evicted.
- Verify: Pokédex grid shows real sprites incl. shiny toggle.
- Game-specific: **yes** — the "species/Pokédex" concept is Pokémon's. A game without a species dex simply has no equivalent slot; a different game might introduce its own (e.g. a "character" slot) via `add-image-slot`.

---

## Proposed / future slots

(Empty. The `add-image-slot` skill appends new entries here as they're approved & implemented.)
