---
date: "2026-08-26"
title: "Card art is addressed directly on the object store, and the whole catalog is warmed"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-26 — Card art is addressed directly on the object store, and the whole catalog is warmed
**Decided by:** Claude Opus 5 on behalf of @cheyras

**Problem, measured before anything was changed.** Against production, cold
cache, 1440×900, signed in as the QA account: card art arrived at p50 **1954 ms**,
p90 **4154 ms**, slowest **12 647 ms**, and on `/series/scarlet-violet/sv03.5`
**7 of 22** tiles were still blank six seconds after the page had settled. The
loaded-tile count went *down* while scrolling (20 → 14 → 28 → 9), because the
grid virtualiser recycles rows and every re-mounted tile restarted the same slow
request. `/api/sets/:id?pageSize=250` took 1819 ms and `/api/insights/pokedex?pageSize=1025`
2404 ms. Screenshots and the raw harness output are the evidence for all of it.

**Three independent causes, not one.**

1. **Every image was a serverless round trip plus a redirect.** `/deckpal/images/*`
   is a Vercel function that, on a HIT, does not serve bytes — it probes Storage
   and answers `302` to the public object URL. So each tile cost
   `browser → function → Storage probe → 302 → browser → Storage CDN`. Measured
   on the pages above: **89, 93 and 320** image requests per page, **100% of them
   302s**. A 200-card set page opened ~200 function invocations, and the queueing
   behind them is what made art dribble in unevenly.
2. **89% of the catalog had no object at all.** Swept every card via the public
   API against the public bucket: **18,840 of 21,066** cards had no `low` object.
   The bucket only ever held what someone had happened to look at, because *no
   bulk warm path for the cloud tier existed* — `warm`/`warm:gaps`/`warm:pkmn`
   fill the self-host DISK cache, and `storage:backfill` only mirrors an existing
   disk cache, which on a box without one is an empty work-list. Every first view
   therefore paid a ~1.5–2.5 s upstream-fetch-and-upload inside the function.
3. **A card with no manifest row could never self-heal.** `resolveSourceUrl()`
   returned null when `getManifestRow` found nothing, so the fill declined to try
   the one URL that might have worked — permanently, on every request. 585 cards
   were in that state.

**Decision.**

- **The SPA addresses the object directly.** The stored path is a pure function of
  the request path (B6) and the bucket is public, so `lib/cardArt.ts` maps
  `/deckpal/images/…` to the public object URL and the tile requests that — one
  request, straight to the CDN, no function in the path. The algebra is *imported*
  from `@deckpal/storage/paths` (new subpath export), not reimplemented: sprites
  and card art both rewrite non-obviously (`sprites/pixel/25.png` → `sprites/25.png`;
  `…/001/low.webp` → `…/001.low.webp`) and a second copy of that mapping would
  drift. **The image tier remains the fallback**, so a cold asset still fills
  lazily and self-heals; it is simply no longer on the happy path. Self-host has
  no Supabase URL, so it keeps using the proxied path unchanged.
- **Art is fetched CORS-readable** (`crossorigin="anonymous"`, the bucket sends
  `Access-Control-Allow-Origin: *`), which also fixes a quota problem: the service
  worker's 2000-entry image cache was full of *opaque* responses, which browsers
  pad against the origin quota far beyond the ~14 KB a card weighs, risking
  `purgeOnQuotaError` dropping the whole cache. The cache name is bumped to
  `deckpal-img-v2` so those entries are not inherited.
- **`warm:cloud` (`apps/images/src/cloudWarm.ts`) is the missing bulk path.** It
  drives the deployed tier's own lazy fill over a work-list taken from OUR catalog
  via the public API — no database, no service-role key, no session. It writes
  nothing itself; the handler's `putStorageAsset` does, so there is exactly one
  implementation of the provenance rules (B1) rather than two to keep in step.
- **The missing-row case now uses the canonical derivation.** `canonicalSourceUrl`
  is a documented derivation (DATA-LAYER §5.3) of a path *our own API emitted from
  our own catalog*, and the NULL-`source_url` branch already trusted it; refusing
  it when the row was absent entirely was an inconsistency that failed silently
  and forever. Nothing is written unless a fetch actually succeeds.

**Why not a Vercel rewrite straight to Storage.** It would also remove the
function hop, but it hardcodes the Storage origin into `vercel.json`, proxies
every byte through Vercel (bandwidth we currently do not pay), and — decisively —
loses the lazy fill, which is the only thing that makes a cold or newly-released
card appear at all.

**Verified, against the live product.**

*The warm is data and is already live, so its half is measured on production with
the OLD code still deployed — which is what isolates it from the code change:*

| page | before | after the warm |
|---|---|---|
| `sv03.5` | p50 1954 ms, p90 4154 ms, 15/22 tiles | p50 **338 ms**, p90 **396 ms**, **44/44** |
| `me01` | p50 3178 ms, slowest 12 647 ms, 15/19 | p50 **334 ms**, slowest **626 ms**, **44/44** |
| `/pokedex` | p50 2456 ms, 37/43 sprites | p50 **370 ms**, **100/100** |

*The code change was A/B'd separately: both bundles built from this tree and its
parent, served by one local harness against the same live backend, so the only
variable is the code.* Card-art p50 ~2x and p90 ~2.8x better again on top of the
above; image requests on a set page **74 proxy hops → 0**; `/pokedex` sprites
**2/100 → 99/99** loaded. Formerly-empty sets end-to-end on production: `swsh1`
44/44 and `sm3` 40/40 at DPR 2, **zero placeholders served**.

Coverage: **20,474 of 21,066 cards (97.2%) now have both qualities**, from 2,226
with `low` at the start. `warm:cloud` filled 20,802 assets in its final full pass.
The service worker's v1→v2 migration is verified in a browser (a seeded
`deckpal-img-v1` is gone after activation, `deckpal-img-v2` present).

**The honest residue: 592 cards (2.8%), in 32 sets.** Trainer kits (`tk-*`, 14
sets), e-card (`ecard2`, `ecard3`, `bog`), `mfb`, `cel25cc`, `xya`, `ex5.5`,
`dc1`, and a handful of promos. TCGdex serves no art for these at any extension;
they answer the placeholder, which is the correct answer until a source exists.
`warm:pkmn` against pkmn.gg is the route and needs the credentialed `PKMN_AUTH`
session. **Two of the 592 cannot be represented at all**: `exu-!` and `exu-?`
("Unseen Forces Unown Collection") have `!` and `?` as their collector numbers,
which `SEGMENT` in paths.ts rejects by design — the traversal defence and the
id are in genuine conflict, and widening the regex is a B6 path-contract change
that has not been made here.

**Not verified here:** `manifest:check --object-store`, which needs
`SUPABASE_SERVICE_ROLE_KEY` this session did not have. Every byte went in through
`putStorageAsset`, which writes the `image_asset` row *before* it publishes bytes
and deletes it if the upload fails, so orphans are structurally prevented rather
than merely checked — but the maintainer should run the reconcile to confirm.

**Implications.**
- `VITE_CARD_ART_BUCKET` is a new *optional* build-time variable, documented in
  `DEPLOYMENT.md`. It defaults to `card-art`, matching the server's own default;
  a fork that renamed its bucket and does not set it does not get broken images,
  it gets today's proxied behaviour, because the fallback covers it.
- `apps/web` now depends on `@deckpal/storage` for its path algebra only. That
  subpath is zero-dependency and side-effect free; do not import the package root
  into the browser bundle, which reaches Postgres and the service role.
- Run `warm:cloud` after every catalog import and set release, or new cards ship
  cold and the first person to look at them pays for it.

